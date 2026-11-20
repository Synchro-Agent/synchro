// Mẫu tham chiếu cho một lượt thiết kế: chọn 3 mẫu theo đề bài, trộn token, trả ảnh mẫu cho model dựng và người chấm.
// Thư viện mẫu là tệp trong repo (catalog/design-refs, index.json + một JSON và một ảnh WebP mỗi mẫu), đọc một lần rồi
// giữ trong bộ nhớ theo thời điểm sửa của index.json. Lịch sử sản phẩm của từng người ở bảng design_history. Ảnh chụp
// trang mẫu chỉ đi vào ngữ cảnh của model, không bao giờ hiện cho người dùng; khối chữ gửi model không có địa chỉ trang
// nguồn, nên model không thể "làm giống hệt <hãng>".
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type {
  BriefFacets, DesignRef, MixRole, RefIndex, RefIndexRow, RefTokens, StyleMix, StyleTurn, StyleTurnInput, TurnRef,
} from "../shared/designrefs";
import {
  bestRef, briefFacets, briefHeadCat, buildMix, followAsk, mixKeys, pickRefs, validTokens, type HistoryRow,
  type MixPart,
} from "../shared/designpick";
import { db } from "./db/db";
import { getStyle, styleImageFile, type StoredStyle } from "./designstyles";
import { FollowError, followStyle } from "./designfollow";

/** Thư mục thư viện mẫu; DESIGN_REFS_DIR đổi chỗ (máy chủ đặt thư viện ngoài repo, bộ kiểm thử dùng thư viện nhỏ). */
export const refsDir = () => process.env.DESIGN_REFS_DIR ?? path.join(process.cwd(), "catalog", "design-refs");
const HISTORY_KEEP = 50;
const HISTORY_READ = 10;

type Cache = { dir: string; mtime: number; index: RefIndex | null; refs: Map<string, DesignRef | null> };
let cache: Cache | null = null;
function catalog(): Cache {
  const dir = refsDir();
  let mtime = 0;
  try {
    mtime = fs.statSync(path.join(dir, "index.json")).mtimeMs;
  } catch {
    // Chưa có thư viện mẫu (bản dựng chưa kèm catalog): mọi lượt chạy như khi chưa có tính năng này.
    mtime = -1;
  }
  if (cache && cache.dir === dir && cache.mtime === mtime) return cache;
  let index: RefIndex | null = null;
  if (mtime > 0) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as RefIndex;
      index = j && j.v === 1 && Array.isArray(j.refs) ? j : null;
    } catch (e) {
      console.error("[designrefs] index.json hỏng", e);
    }
  }
  cache = { dir, mtime, index, refs: new Map() };
  return cache;
}
/** Bảng tóm tắt thư viện mẫu (rỗng khi chưa có thư viện). */
export const refRows = (): RefIndexRow[] => catalog().index?.refs ?? [];

const REF_ID = /^(web|slide|poster|email|dashboard|doc)-\d{3}$/;
/** Một mẫu đầy đủ (token, lý do, ảnh) theo mã; mã lạ hoặc tệp hỏng thì null. */
export function getRef(id: string): DesignRef | null {
  const m = REF_ID.exec(id);
  if (!m) return null;
  const c = catalog();
  if (c.refs.has(id)) return c.refs.get(id) ?? null;
  let ref: DesignRef | null = null;
  const file = path.join(c.dir, m[1], `${id}.json`);
  try {
    const j = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as DesignRef) : null;
    ref = j && j.id === id && validTokens(j.tokens) ? j : null;
  } catch (e) {
    console.error(`[designrefs] không đọc được mẫu ${id}`, e);
  }
  c.refs.set(id, ref);
  return ref;
}
/** Đường dẫn ảnh của mẫu, chỉ trong thư mục thư viện (tên tệp trong JSON không được trỏ ra ngoài). */
function refImage(ref: DesignRef): string | null {
  const dir = path.resolve(refsDir());
  const file = path.resolve(dir, ref.image.file);
  return file.startsWith(dir + path.sep) && fs.existsSync(file) ? file : null;
}

// ---------------------------------------------------------------- lịch sử
type HistRow = { ref_ids: string; palette_key: string; font_pair: string; brand: string | null };
/** Sản phẩm gần nhất của người dùng, mới trước. */
export function designHistory(uid: string, n = HISTORY_READ): HistoryRow[] {
  try {
    const sql = "SELECT ref_ids, palette_key, font_pair, brand FROM design_history WHERE user_id = ? "
      + "ORDER BY created_at DESC, id DESC LIMIT ?";
    const rows = db().prepare(sql).all(uid, n) as HistRow[];
    return rows.map((r) => ({
      refIds: JSON.parse(r.ref_ids) as string[],
      paletteKey: r.palette_key,
      fontPair: r.font_pair,
      brand: r.brand,
    }));
  } catch (e) {
    // Không đọc được lịch sử thì vẫn chọn mẫu, chỉ mất luật không lặp cho lượt này.
    console.error("[designrefs] đọc lịch sử", e);
    return [];
  }
}
function recordDesign(uid: string, conv: string | undefined, t: StyleTurn) {
  const k = mixKeys(t.mix.tokens);
  const d = db();
  const ins = "INSERT INTO design_history (user_id, conv, mix_id, domain, brand, ref_ids, palette_key, font_pair, "
    + "preset, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  const trim = "DELETE FROM design_history WHERE user_id = ? AND id NOT IN "
    + "(SELECT id FROM design_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)";
  const refIds = t.refs.filter((r) => r.source === "catalog").map((r) => r.id);
  d.transaction(() => {
    d.prepare(ins).run(uid, conv ?? null, t.mix.id, t.mix.domain, t.mix.brand, JSON.stringify(refIds), k.paletteKey,
      k.fontPair, t.mix.preset, JSON.stringify(t.mix.tokens), Date.now());
    d.prepare(trim).run(uid, uid, HISTORY_KEEP);
  })();
}
/** Bản trộn đã ghi của một sản phẩm (theo mã data-sx-mix), cho "Lưu làm phong cách của tôi". */
export function mixRecord(uid: string, mixId: string): { tokens: RefTokens; preset: string; domain: string } | null {
  const sql = "SELECT tokens, preset, domain FROM design_history WHERE user_id = ? AND mix_id = ? "
    + "ORDER BY id DESC LIMIT 1";
  const r = db().prepare(sql).get(uid, mixId) as { tokens: string; preset: string; domain: string } | undefined;
  const tokens = r ? validTokens(JSON.parse(r.tokens)) : null;
  return r && tokens ? { tokens, preset: r.preset, domain: r.domain } : null;
}

/** Token của mẫu thư viện hợp đề nhất: nền thang chữ, hình khối cho phong cách đọc từ ảnh / trang người dùng gửi. */
export function followBase(facets: BriefFacets, seed: string): RefTokens | null {
  const best = bestRef(refRows(), facets, seed);
  return best ? getRef(best.id)?.tokens ?? null : null;
}

// ---------------------------------------------------------------- lượt thiết kế
// Nhãn và tiêu đề mẫu là chữ trong lời nhắc gửi model dựng (khối <design_refs>, nhãn ảnh), không hiện trên giao diện.
const promptLabel = (k: number) => `Mẫu ${k}`;
const promptTitle = (s: StoredStyle) => (s.kind === "mine"
  ? `Phong cách của người dùng: ${s.name}`
  : `Phong cách người dùng gửi: ${s.name}`);
const catalogTurnRef = (ref: DesignRef, roles: MixRole[], k: number): TurnRef => ({
  id: ref.id,
  source: "catalog",
  label: promptLabel(k),
  roles,
  domain: ref.domain,
  title: ref.title,
  why: ref.why,
  tokens: ref.tokens,
});
const styleTurnRef = (s: StoredStyle, domain: StyleMix["domain"]): TurnRef => ({
  id: s.id,
  source: s.kind,
  label: promptLabel(1),
  roles: ["palette", "type", "shape"],
  domain,
  title: promptTitle(s),
  why: s.kind === "mine"
    ? "Phong cách người dùng đã lưu: dùng đúng màu, phông và hình khối này cho mọi phần của sản phẩm."
    : "Người dùng muốn sản phẩm theo phong cách này: giữ màu, nhịp chữ và hình khối; "
      + "không chép chữ, logo hay ảnh của nguồn.",
  tokens: s.tokens,
});

/**
 * Bộ phong cách cho một sản phẩm thiết kế mới: phong cách người dùng chọn (chip "Kiểu: …"), phong cách đọc từ liên kết
 * hay ảnh họ gửi kèm lời "theo kiểu này", hoặc 3 mẫu thư viện hợp đề. Không có gì để dùng (bảng tính, chưa có thư viện)
 * thì null và lượt chạy như trước. Ghi sản phẩm vào lịch sử trừ khi đang ẩn danh.
 */
export async function styleForTurn(i: StyleTurnInput): Promise<StyleTurn | null> {
  const facets = briefFacets(i.typed, i.format);
  if (!facets) return null;
  const seed = i.seed ?? i.conv ?? i.uid;
  const headCat = briefHeadCat(i.typed);
  const rows = refRows();
  let note: string | null = null;
  let own: StoredStyle | null = null;
  if (i.sel) {
    own = getStyle(i.uid, i.sel.id);
    if (!own) note = "Phong cách người dùng chọn không còn (đã xóa hoặc hết hạn): dùng mẫu trong thư viện.";
  }
  const ask = own ? null : followAsk(i.typed, i.images.length > 0);
  if (ask) {
    try {
      const src = "url" in ask ? { url: ask.url } : { image: i.images[0] };
      const base = followBase(facets, seed);
      own = await followStyle({ uid: i.uid, facets, base, ...src, signal: i.signal, onStatus: i.onStatus });
    } catch (e) {
      if (!(e instanceof FollowError)) console.error("[designrefs] đọc phong cách người dùng gửi", e);
      note = `Không đọc được phong cách người dùng gửi (${(e as Error).message}). Đã dùng mẫu trong thư viện; `
        + "nói rõ điều này với người dùng.";
    }
  }
  if (i.signal?.aborted) return null;
  let refs: TurnRef[];
  let parts: MixPart[];
  const history = own ? [] : designHistory(i.uid);
  if (own) {
    // Phong cách riêng giữ mọi vai; một mẫu thư viện cùng mảng chỉ để gợi ý bố cục, không đổi màu hay phông.
    const extra = bestRef(rows, facets, seed);
    const extraRef = extra ? getRef(extra.id) : null;
    refs = [styleTurnRef(own, facets.domain)];
    if (extraRef) refs.push(catalogTurnRef(extraRef, ["layout"], 2));
    parts = [{ tokens: own.tokens, roles: ["palette", "type", "shape", "layout"], moods: facets.moods }];
  } else {
    const picks = pickRefs({ facets, rows, history, seed, headCat });
    const full = (picks ?? []).map((p) => ({ p, ref: getRef(p.row.id) })).filter((x) => x.ref);
    if (!full.length) return null;
    refs = full.map((x, k) => catalogTurnRef(x.ref!, x.p.roles, k + 1));
    parts = full.map((x) => ({ tokens: x.ref!.tokens, roles: x.p.roles, moods: x.ref!.moods }));
  }
  // Phong cách riêng của người dùng được lặp lại có chủ đích: không đổi phông theo lịch sử.
  const avoid = own ? undefined : { facets, history, headCat };
  const mix = buildMix(parts, facets.domain, i.ownBrand && !own, facets.brand, avoid);
  const turn: StyleTurn = { mix, refs, facets, note };
  if (!i.incognito) {
    try {
      recordDesign(i.uid, i.conv, turn);
    } catch (e) {
      console.error("[designrefs] ghi lịch sử", e);
    }
  }
  return turn;
}

// ---------------------------------------------------------------- ảnh mẫu cho model
const JPEG_CACHE_MAX = 48;
const jpegCache = new Map<string, Buffer>();
async function jpegOf(file: string, width: number): Promise<Buffer | null> {
  let key = "";
  try {
    key = `${file}:${fs.statSync(file).mtimeMs}:${width}`;
  } catch {
    // Tệp đã bị xóa (người dùng xóa phong cách, gỡ mẫu khỏi thư viện): bỏ ảnh này, các ảnh khác vẫn gửi.
    return null;
  }
  const hit = jpegCache.get(key);
  if (hit) return hit;
  const sharp = (await import("sharp")).default;
  // Đọc tệp ra bộ nhớ trước: libvips giữ ảnh đã giải mã theo tên tệp, tệp thay nội dung sẽ ra ảnh cũ.
  const src = await fs.promises.readFile(file);
  const buf = await sharp(src).resize({ width, withoutEnlargement: true }).flatten({ background: "#ffffff" })
    .jpeg({ quality: 78 }).toBuffer();
  if (jpegCache.size >= JPEG_CACHE_MAX) jpegCache.delete(jpegCache.keys().next().value!);
  jpegCache.set(key, buf);
  return buf;
}
const imageLabel = (r: TurnRef, k: number) => {
  if (r.source === "follow") return "Mẫu người dùng gửi: làm theo phong cách này";
  const name = r.title.replace(/^[^:]*:\s*/, "");
  if (r.source === "mine") return `Phong cách người dùng đã lưu (${name}): làm theo phong cách này`;
  return `Mẫu tham chiếu ${k} (không phải ảnh người dùng gửi): ${r.title}`;
};
/** Ảnh JPEG của từng mẫu trong lượt (theo thứ tự refs), chiều rộng theo widths; mẫu không có ảnh thì bỏ qua. */
export async function turnImages(t: StyleTurn, widths: number[]): Promise<{ label: string; jpeg: Buffer }[]> {
  const out: { label: string; jpeg: Buffer }[] = [];
  for (let k = 0; k < t.refs.length; k++) {
    const r = t.refs[k];
    const ref = r.source === "catalog" ? getRef(r.id) : null;
    const file = ref ? refImage(ref) : r.source === "catalog" ? null : styleImageFile(r.id);
    if (!file) continue;
    const width = widths[k] ?? widths[widths.length - 1] ?? 800;
    try {
      const jpeg = await jpegOf(file, width);
      if (jpeg) out.push({ label: imageLabel(r, k + 1), jpeg });
    } catch (e) {
      console.error(`[designrefs] không đổi được ảnh mẫu ${r.id} sang JPEG`, e);
    }
  }
  return out;
}
