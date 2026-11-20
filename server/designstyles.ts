// Phong cách người dùng đưa vào Synchro: "follow" là phong cách đọc từ liên kết hay ảnh họ gửi (hết hạn sau 30 ngày nếu
// không
// lưu), "mine" là "Phong cách của tôi" đã lưu (tối đa 20 mỗi người, dùng lại cho sản phẩm sau qua chip "Kiểu: …").
// Token ở bảng design_styles; ảnh WebP (ảnh người dùng gửi hoặc ảnh chụp trang họ đưa, tối đa 150 KB) ở
// DATA_DIR/design-styles/<uid>/<id>.webp, chỉ chủ tài khoản xem được. Xóa tài khoản thì xóa cả thư mục
// (server/purge.ts).
import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RefTokens } from "../shared/designrefs";
import { kitFont } from "../shared/designrefs";
import { mixPalette, validTokens } from "../shared/designpick";
import { DATA_DIR, db, needDisk } from "./db/db";

export const STYLE_LIMITS = { mine: 20, followDays: 30, imageMaxBytes: 150_000, nameMax: 60 } as const;
export type StyleKind = "follow" | "mine";
export type StoredStyle = {
  id: string;
  kind: StyleKind;
  name: string;
  source: string;
  sourceUrl: string | null;
  tokens: RefTokens;
  image: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
};
/** Dạng gửi về trình duyệt: tên, nguồn, ô màu và tên phông để nhận ra phong cách, không có token thô. */
export type PublicStyle = {
  id: string;
  kind: StyleKind;
  name: string;
  source: string;
  host: string | null;
  theme: "light" | "dark";
  swatches: string[];
  fonts: { head: string; body: string };
  image: boolean;
  createdAt: number;
  expiresAt: number | null;
};
export class StyleError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Row = {
  id: string;
  kind: StyleKind;
  name: string;
  source: string;
  source_url: string | null;
  tokens: string;
  image: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
};
const ID = /^ds-[0-9a-f]{16}$/;
const root = () => path.join(DATA_DIR, "design-styles");
const userDir = (uid: string) => path.join(root(), uid.replace(/[^\w-]/g, "_"));
const fromRow = (r: Row): StoredStyle | null => {
  let tokens: RefTokens | null = null;
  try {
    tokens = validTokens(JSON.parse(r.tokens));
  } catch (e) {
    console.error(`[designstyles] token hỏng ở ${r.id}`, e);
  }
  if (!tokens) return null;
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    source: r.source,
    sourceUrl: r.source_url,
    tokens,
    image: r.image,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at,
  };
};
const hostOf = (u: string | null) => {
  if (!u) return null;
  try {
    return new URL(u).hostname;
  } catch {
    // Địa chỉ đã lưu không còn phân tích được: chỉ không hiện tên trang, phong cách vẫn dùng được.
    return null;
  }
};
export function publicStyle(s: StoredStyle): PublicStyle {
  const p = s.tokens.colors.length ? mixPalette(s.tokens.colors, s.tokens.theme) : null;
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    source: s.source,
    host: hostOf(s.sourceUrl),
    theme: s.tokens.theme,
    swatches: p ? [p.bg, p.surface, p.ink, p.vivid, p.vivid2] : [],
    fonts: {
      head: kitFont(s.tokens.fonts.head.kit)?.family ?? "",
      body: kitFont(s.tokens.fonts.body.kit)?.family ?? "",
    },
    image: !!s.image,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
  };
}

/** Bỏ phong cách "follow" đã hết hạn của một người (dòng và ảnh). */
function sweep(uid: string) {
  const now = Date.now();
  const where = "WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at < ?";
  const gone = db().prepare(`SELECT id, image FROM design_styles ${where}`).all(uid, now) as { image: string | null }[];
  for (const g of gone) removeImage(uid, g.image);
  if (gone.length) db().prepare(`DELETE FROM design_styles ${where}`).run(uid, now);
}
function removeImage(uid: string, image: string | null) {
  if (!image) return;
  try {
    fs.rmSync(path.join(userDir(uid), path.basename(image)), { force: true });
  } catch (e) {
    console.error("[designstyles] xóa ảnh", e);
  }
}

export function listStyles(uid: string): PublicStyle[] {
  sweep(uid);
  const sql = "SELECT * FROM design_styles WHERE user_id = ? ORDER BY kind = 'mine' DESC, updated_at DESC";
  const rows = db().prepare(sql).all(uid) as Row[];
  return rows.map(fromRow).filter((s): s is StoredStyle => !!s).map(publicStyle);
}
/** Một phong cách của đúng người này (phong cách hết hạn coi như không còn). */
export function getStyle(uid: string, id: string): StoredStyle | null {
  if (!ID.test(id)) return null;
  const r = db().prepare("SELECT * FROM design_styles WHERE id = ? AND user_id = ?").get(id, uid) as Row | undefined;
  if (!r || (r.expires_at !== null && r.expires_at < Date.now())) return null;
  return fromRow(r);
}
/** Tệp ảnh của một phong cách (đã kiểm chủ ở chỗ gọi), hoặc null. */
export function styleImageFile(id: string): string | null {
  if (!ID.test(id)) return null;
  const r = db().prepare("SELECT user_id, image FROM design_styles WHERE id = ?").get(id) as
    | { user_id: string; image: string | null }
    | undefined;
  if (!r?.image) return null;
  const file = path.join(userDir(r.user_id), path.basename(r.image));
  return fs.existsSync(file) ? file : null;
}
const MINE_COUNT = "SELECT COUNT(*) AS n FROM design_styles WHERE user_id = ? AND kind = 'mine'";
const mineCount = (uid: string) => (db().prepare(MINE_COUNT).get(uid) as { n: number }).n;
const cleanName = (name: unknown, fallback: string) => {
  const n = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, STYLE_LIMITS.nameMax) : "";
  return n || fallback;
};
const fullMsg = `Bạn đã lưu đủ ${STYLE_LIMITS.mine} phong cách. Hãy xóa bớt một phong cách rồi lưu lại.`;

/** Ảnh WebP nhỏ dần chất lượng tới khi dưới 150 KB (rộng tối đa 1280, cao tối đa 1600 tính từ đầu trang). */
async function webpOf(img: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(img).metadata();
  const w = Math.min(meta.width ?? 1280, 1280);
  const scale = meta.width ? w / meta.width : 1;
  const h = Math.min(Math.floor((meta.height ?? 1600) * scale), 1600);
  const base = sharp(img).resize({ width: w, withoutEnlargement: true })
    .extract({ left: 0, top: 0, width: w, height: h });
  for (const quality of [80, 70, 60, 50, 40]) {
    const out = await base.clone().webp({ quality }).toBuffer();
    if (out.length <= STYLE_LIMITS.imageMaxBytes) return out;
  }
  return sharp(img).resize({ width: 800, withoutEnlargement: true }).webp({ quality: 40 }).toBuffer();
}

export type NewStyle = {
  kind: StyleKind;
  name: string;
  source: string;
  sourceUrl?: string | null;
  tokens: RefTokens;
  image?: Buffer | null;
};
/** Lưu một phong cách mới; "mine" quá 20 thì báo, không tự xóa cái cũ. */
export async function addStyle(uid: string, s: NewStyle): Promise<StoredStyle> {
  needDisk();
  sweep(uid);
  if (s.kind === "mine" && mineCount(uid) >= STYLE_LIMITS.mine) throw new StyleError(fullMsg, 409);
  const id = `ds-${crypto.randomBytes(8).toString("hex")}`;
  let image: string | null = null;
  if (s.image?.length) {
    const buf = await webpOf(s.image);
    fs.mkdirSync(userDir(uid), { recursive: true });
    image = `${id}.webp`;
    fs.writeFileSync(path.join(userDir(uid), image), buf);
  }
  const now = Date.now();
  const expires = s.kind === "follow" ? now + STYLE_LIMITS.followDays * 86_400_000 : null;
  const sql = "INSERT INTO design_styles (id, user_id, kind, name, source, source_url, tokens, image, created_at, "
    + "updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  const name = cleanName(s.name, "Phong cách mới");
  const tokens = JSON.stringify(s.tokens);
  db().prepare(sql).run(id, uid, s.kind, name, s.source, s.sourceUrl ?? null, tokens, image, now, now, expires);
  return getStyle(uid, id)!;
}
/** Đổi tên, hoặc lưu một phong cách "follow" thành "Phong cách của tôi" (bỏ hạn 30 ngày). */
export function updateStyle(uid: string, id: string, p: { name?: unknown; save?: boolean }): StoredStyle {
  needDisk();
  const cur = getStyle(uid, id);
  if (!cur) throw new StyleError("Không có phong cách này.", 404);
  const save = p.save === true && cur.kind === "follow";
  if (save && mineCount(uid) >= STYLE_LIMITS.mine) throw new StyleError(fullMsg, 409);
  const name = p.name === undefined ? cur.name : cleanName(p.name, cur.name);
  const sql = "UPDATE design_styles SET name = ?, kind = ?, expires_at = ?, updated_at = ? "
    + "WHERE id = ? AND user_id = ?";
  db().prepare(sql).run(name, save ? "mine" : cur.kind, save ? null : cur.expiresAt, Date.now(), id, uid);
  return getStyle(uid, id)!;
}
export function deleteStyle(uid: string, id: string): boolean {
  if (!ID.test(id)) return false;
  const sql = "SELECT image FROM design_styles WHERE id = ? AND user_id = ?";
  const cur = db().prepare(sql).get(id, uid) as { image: string | null } | undefined;
  if (!cur) return false;
  db().prepare("DELETE FROM design_styles WHERE id = ? AND user_id = ?").run(id, uid);
  removeImage(uid, cur.image);
  return true;
}
/** Xóa tài khoản: bỏ mọi ảnh phong cách của người này (các dòng bị xóa cùng mọi bảng có cột user_id). */
export async function removeUserStyles(uid: string) {
  await fs.promises.rm(userDir(uid), { recursive: true, force: true });
}
