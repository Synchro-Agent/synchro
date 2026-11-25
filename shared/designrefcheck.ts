// Kiểm thư viện mẫu tham chiếu: từng mẫu đúng kiểu dữ liệu và đủ trường chấm bằng mắt, cả thư viện đủ đa dạng để bộ
// chọn mẫu không lặp lại "AI slop" (nền kem, chữ có chân, nhấn đồng). Hàm thuần, không đọc tệp: build-index.mjs và bài
// thử tự đọc ảnh, đưa số đo thật vào đây.
import { cleanSeen, shadowCssOk } from "./designextract";
import {
  DARK_BG_MAX,
  KIT_FONTS,
  REF_AUDIENCES,
  REF_DOMAINS,
  REF_INDUSTRIES,
  REF_LIMITS,
  REF_MOODS,
  REF_QUOTA,
  fontPairKey,
  isHex,
  luminance,
  paletteKey,
  type DesignRef,
  type RefDomain,
  type RefIndexRow,
  type RefTokens,
  type TokenField,
} from "./designrefs";

const COLOR_ROLES = ["bg", "surface", "raised", "ink", "muted", "accent", "accent2", "line", "pos", "neg"];
const TOKEN_FIELDS: TokenField[] = [
  "theme", "colors", "fonts", "type", "tracking", "radius", "shadow", "spacing", "layout", "imagery",
];
const SOURCE_KINDS = ["public-page", "public-image", "cc-by", "cc0", "own"];
const IMAGERY = ["photo", "illustration", "3d", "type-only", "data", "mixed"];
// Hình có ánh sáng, ống kính, màu ảnh thật: chỉ những loại này cần mô tả cho câu lệnh tạo ảnh chủ đạo.
const PICTURE_KINDS = new Set(["photo", "illustration", "3d", "mixed"]);
const kitIds = new Set<string>(KIT_FONTS.map((f) => f.id));
const serifIds = new Set<string>(KIT_FONTS.filter((f) => f.cat === "serif").map((f) => f.id));

// Ngưỡng đa dạng của cả thư viện: đủ mẫu tối, mẫu có hình thật, mẫu Việt Nam; giới hạn số mẫu cùng nguồn và số mẫu
// thuộc đúng kiểu nhàm đang muốn tránh.
export const VARIETY = {
  perHost: 3,
  moodsPerDomain: 8,
  darkShare: 0.3,
  pictureShare: 0.3,
  vietnamese: 10,
  creamSerifCopper: 3,
  // Một phông chiếm quá 35% vai tiêu đề hoặc vai thân thì bộ trộn lại kéo mọi sản phẩm về cùng một giọng chữ.
  kitFontShare: 0.35,
  // Hình chiếm dưới 10% khung thì không dạy được gì về cách dùng hình; khi đó là "type-only" hoặc "data".
  pictureMinShare: 0.1,
} as const;

/**
 * Token của một mẫu vừa chụp mà chưa đo được trường nào ngoài màu: người duyệt phải chấm lại bằng mắt. Bộ kiểm dùng
 * chính các giá trị này để nhận ra trường còn bỏ trống (vd. phông Inter 400 cho cả tiêu đề và thân).
 */
export function defaultTokens(theme: "light" | "dark"): RefTokens {
  const font = (kit: "inter") => ({ kit, seen: "", seenLicence: "unknown" as const, weight: 400 });
  return {
    theme,
    colors: [],
    fonts: { head: font("inter"), body: font("inter"), mono: null },
    type: { basePx: 16, ratio: 1.25, sizes: [], headLine: 1.1, bodyLine: 1.5, headCase: "none" },
    tracking: { display: 0, heading: 0, body: 0, label: 0 },
    radius: { outer: 0, inner: 0, pill: false },
    shadow: { level: 0, css: "none" },
    spacing: { unit: 8, section: 64, gutter: 24, density: "balanced" },
    layout: { columns: 1, maxWidth: 1280, align: "left", emptyShare: 0 },
    imagery: { kind: "type-only", share: 0, light: "", lens: "", grade: "", subject: "" },
  };
}
const UNJUDGED = defaultTokens("light");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const inRange = (v: unknown, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const subsetOf = (xs: unknown, all: readonly string[], lo: number, hi: number) =>
  Array.isArray(xs) && xs.length >= lo && xs.length <= hi && new Set(xs).size === xs.length
  && xs.every((x) => all.includes(x));
// Mô tả hình cho câu lệnh tạo ảnh viết bằng tiếng Anh: không có chữ cái mang dấu tiếng Việt.
const VI_MARK = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/** Số câu của đoạn "vì sao": tách ở dấu chấm, hỏi, than có khoảng trắng hoặc hết đoạn ngay sau
 * (số thập phân tiếng Việt dùng dấu phẩy nên không bị tách). */
export function sentenceCount(text: string): number {
  return text.split(/[.!?…]+(?=\s|$)/u).filter((s) => s.trim().length > 0).length;
}

function hsl(hex: string): { h: number; s: number; l: number; c: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l, c: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l, c: d };
}

/** Đúng kiểu sản phẩm đang bị chê: nền sáng ấm (kem, giấy), tiêu đề có chân, màu nhấn nâu / đồng / đất nung. */
export function isCreamSerifCopper(t: RefTokens): boolean {
  const bg = t.colors.find((c) => c.role === "bg");
  const accent = t.colors.find((c) => c.role === "accent");
  if (t.theme !== "light" || !bg || !accent || !serifIds.has(t.fonts.head.kit)) return false;
  const b = hsl(bg.hex);
  const a = hsl(accent.hex);
  // Độ bão hoà HSL của màu gần trắng tuyệt đối (#fffffe) vọt lên gần 1, nên đo thêm độ chênh kênh màu (chroma).
  const warmPaper = b.l > 0.82 && b.s > 0.12 && b.c >= 0.035 && b.h >= 20 && b.h <= 65;
  const copper = a.s > 0.2 && a.l < 0.62 && (a.h <= 45 || a.h >= 345);
  return warmPaper && copper;
}

/** Dòng chỉ mục của một mẫu: đủ để bộ chọn chấm điểm mà không phải đọc cả tệp JSON. */
export function indexRow(ref: DesignRef): RefIndexRow {
  return {
    id: ref.id,
    domain: ref.domain,
    title: ref.title,
    moods: ref.moods,
    industries: ref.industries,
    audience: ref.audience,
    host: ref.source_host,
    theme: ref.tokens.theme,
    paletteKey: paletteKey(ref.tokens.colors),
    fontPair: fontPairKey(ref.tokens),
    imagery: ref.tokens.imagery.kind,
  };
}

// Tên thương hiệu đứng riêng thành từ (không khớp nửa chừng trong từ khác), không phân biệt hoa thường.
// Tên ngắn viết hoa (HAY, MUJI) trùng từ thường trong tiếng Việt ("hay"), nên chỉ khớp đúng hoa thường.
const mentions = (text: string, word: string) => {
  const w = word.trim();
  if (w.length < 3) return false;
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = w.length <= 4 && w === w.toUpperCase() ? "u" : "iu";
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, flags).test(text);
};

function tokenErrors(t: RefTokens): string[] {
  const e: string[] = [];
  if (t.theme !== "light" && t.theme !== "dark") e.push("theme");
  const roles = t.colors.map((c) => c.role);
  for (const need of ["bg", "ink", "accent"]) {
    if (roles.filter((r) => r === need).length !== 1) e.push(`colors: cần đúng một ${need}`);
  }
  if (new Set(roles).size !== roles.length) e.push("colors: vai trùng");
  const hexOf = (role: string) => t.colors.find((c) => c.role === role)?.hex;
  const bg = hexOf("bg");
  const accent = hexOf("accent");
  if (accent && (accent === bg || accent === hexOf("ink"))) e.push(`colors: nhấn ${accent} trùng nền hoặc chữ`);
  if (bg && isHex(bg)) {
    const dark = luminance(bg) <= DARK_BG_MAX;
    if (t.theme === "dark" && !dark) e.push(`theme: dark nhưng nền ${bg} không tối`);
    if (t.theme === "light" && dark) e.push(`theme: light nhưng nền ${bg} tối`);
  }
  for (const c of t.colors) {
    const valid = isHex(c.hex) && COLOR_ROLES.includes(c.role) && inRange(c.share, 0, 1);
    if (!valid) e.push(`colors: ${JSON.stringify(c)}`);
  }
  for (const slot of ["head", "body", "mono"] as const) {
    const f = t.fonts[slot];
    if (!f && slot === "mono") continue;
    if (!f || !kitIds.has(f.kit)) e.push(`fonts.${slot}: phông ngoài bộ ${f?.kit}`);
    else if (typeof f.seen !== "string" || cleanSeen(f.seen) !== f.seen) e.push(`fonts.${slot}.seen: ký tự lạ`);
    else if (!["open", "proprietary", "unknown"].includes(f.seenLicence) || !inRange(f.weight, 100, 1000)) {
      e.push(`fonts.${slot}: ${JSON.stringify(f)}`);
    }
  }
  const ty = t.type;
  const typeOk = inRange(ty.basePx, 8, 40) && inRange(ty.ratio, 1, 2.5) && Array.isArray(ty.sizes)
    && ty.sizes.every((s) => inRange(s, 6, 600)) && inRange(ty.headLine, 0.6, 2) && inRange(ty.bodyLine, 0.9, 2.4)
    && (ty.headCase === "none" || ty.headCase === "upper");
  if (!typeOk) e.push(`type: ${JSON.stringify(ty)}`);
  if (!Object.values(t.tracking).every((v) => inRange(v, -0.12, 0.4)) || Object.keys(t.tracking).length !== 4) {
    e.push(`tracking: ${JSON.stringify(t.tracking)}`);
  }
  if (!inRange(t.radius.outer, 0, 1000) || !inRange(t.radius.inner, 0, 1000) || typeof t.radius.pill !== "boolean") {
    e.push(`radius: ${JSON.stringify(t.radius)}`);
  }
  if (![0, 1, 2, 3].includes(t.shadow.level) || typeof t.shadow.css !== "string") e.push("shadow");
  else if (!shadowCssOk(t.shadow.css)) e.push(`shadow.css: không phải box-shadow hợp lệ ${t.shadow.css.slice(0, 80)}`);
  const sp = t.spacing;
  if (![4, 8].includes(sp.unit) || !inRange(sp.section, 0, 1000) || !inRange(sp.gutter, 0, 200)
    || !["airy", "balanced", "dense"].includes(sp.density)) {
    e.push(`spacing: ${JSON.stringify(sp)}`);
  }
  const lay = t.layout;
  if (!inRange(lay.columns, 1, 16) || !inRange(lay.maxWidth, 200, 4000) || !inRange(lay.emptyShare, 0, 1)
    || !["left", "center", "asymmetric"].includes(lay.align)) {
    e.push(`layout: ${JSON.stringify(lay)}`);
  }
  const im = t.imagery;
  if (!IMAGERY.includes(im.kind) || !inRange(im.share, 0, 1)) e.push(`imagery: ${JSON.stringify(im)}`);
  else if (PICTURE_KINDS.has(im.kind) && im.share < VARIETY.pictureMinShare) {
    e.push(`imagery: ${im.kind} mà chỉ chiếm ${im.share} khung`);
  }
  if (PICTURE_KINDS.has(im.kind)) {
    for (const k of ["light", "lens", "grade", "subject"] as const) {
      if (!im[k]?.trim()) e.push(`imagery.${k}: thiếu mô tả cho câu lệnh tạo ảnh`);
      else if (VI_MARK.test(im[k])) e.push(`imagery.${k}: viết tiếng Anh`);
    }
  }
  return e;
}

/** Lỗi của một mẫu (rỗng là hợp lệ). `brands`: tên thương hiệu nguồn, không được xuất hiện trong tên và "vì sao". */
export function checkRef(ref: DesignRef, brands: string[] = []): string[] {
  const e: string[] = [];
  if (ref.v !== 1) e.push("v");
  if (!REF_DOMAINS.includes(ref.domain) || !new RegExp(`^${ref.domain}-\\d{3}$`).test(ref.id)) e.push("id / domain");
  if (!ref.title?.trim() || ref.title.length > 100) e.push("title: trống hoặc quá dài");
  if (!subsetOf(ref.moods, REF_MOODS, 1, 3)) e.push(`moods: ${JSON.stringify(ref.moods)}`);
  if (!subsetOf(ref.industries, REF_INDUSTRIES, 1, 3)) e.push(`industries: ${JSON.stringify(ref.industries)}`);
  if (!subsetOf(ref.audience, REF_AUDIENCES, 1, 3)) e.push(`audience: ${JSON.stringify(ref.audience)}`);
  let host = "";
  try {
    const u = new URL(ref.source_url);
    host = u.host.replace(/^www\./, "");
    if (u.protocol !== "https:" && u.protocol !== "http:") e.push("source_url: không phải trang web");
  } catch {
    // URL hỏng thì ghi lỗi; không ném để báo được hết lỗi của mẫu trong một lượt.
    e.push("source_url: không đọc được");
  }
  if (host && host !== ref.source_host) e.push(`source_host ${ref.source_host} ≠ ${host}`);
  if (!SOURCE_KINDS.includes(ref.source_kind)) e.push("source_kind");
  // Mẫu tự do bản quyền phải trỏ được tới trang ghi quyền, để trả lời được khi có người hỏi hay đề nghị gỡ.
  const httpUrl = (v: unknown) => typeof v === "string" && /^https?:\/\/[^\s]+$/.test(v);
  if ((ref.source_kind === "cc0" || ref.source_kind === "cc-by") && !httpUrl(ref.rights_url)) {
    e.push("rights_url: mẫu cc0 / cc-by cần trang ghi quyền");
  }
  if (ref.rights_url !== undefined && !httpUrl(ref.rights_url)) e.push("rights_url");
  if (ref.credit !== undefined && (typeof ref.credit !== "string" || !ref.credit.trim() || ref.credit.length > 160
    || /[\n<>]/.test(ref.credit))) {
    e.push("credit");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ref.captured_at) || Number.isNaN(Date.parse(ref.captured_at))) e.push("captured_at");
  const im = ref.image;
  if (im.file !== `${ref.domain}/${ref.id}.webp`) e.push(`image.file ${im.file}`);
  if (!inRange(im.width, 200, REF_LIMITS.imageMaxWidth) || !inRange(im.height, 150, REF_LIMITS.imageMaxHeight)) {
    e.push(`image: ${im.width}×${im.height}`);
  }
  if (!inRange(im.bytes, 1, REF_LIMITS.imageMaxBytes)) e.push(`image.bytes ${im.bytes}`);
  if (im.layout !== "single" && im.layout !== "grid4") e.push("image.layout");
  e.push(...tokenErrors(ref.tokens));
  const measured = Array.isArray(ref.measured) ? ref.measured : [];
  // Phông không đo được trên trang thì phải chấm bằng mắt; còn đúng Inter 400 cho cả hai vai là chưa ai chấm.
  const f = ref.tokens.fonts;
  if (!measured.includes("fonts") && same(f.head, UNJUDGED.fonts.head) && same(f.body, UNJUDGED.fonts.body)) {
    e.push("fonts: chưa chấm (còn Inter 400 mặc định)");
  }
  const untouched = (["tracking", "spacing"] as const).filter((k) => !measured.includes(k)
    && same(ref.tokens[k], UNJUDGED[k]));
  if (untouched.length === 2) e.push("tracking, spacing: chưa chấm (còn giá trị mặc định)");
  if (!Array.isArray(ref.measured) || new Set(ref.measured).size !== ref.measured.length
    || !ref.measured.every((m) => TOKEN_FIELDS.includes(m))) {
    e.push(`measured: ${JSON.stringify(ref.measured)}`);
  }
  const n = sentenceCount(ref.why ?? "");
  if (n < 3 || n > 5) e.push(`why: ${n} câu, cần 3-5`);
  if (!/\d/.test(ref.why ?? "")) e.push("why: cần số đo cụ thể");
  if (!ref.licence?.trim()) e.push("licence");
  // Tên miền ngắn (hay.com) trùng từ tiếng Việt thường gặp, nên chỉ xét tên miền từ 4 chữ.
  const hostWord = ref.source_host.split(".").slice(-2, -1)[0] ?? "";
  const words = hostWord.length >= 4 ? [...brands, hostWord] : brands;
  for (const b of words) {
    if (mentions(ref.title ?? "", b)) e.push(`title nêu thương hiệu "${b}"`);
    if (mentions(ref.why ?? "", b)) e.push(`why nêu thương hiệu "${b}"`);
  }
  return e;
}

export type CatalogStats = {
  total: number;
  bytes: number;
  perDomain: Record<RefDomain, number>;
  moodsPerDomain: Record<RefDomain, number>;
  darkShare: number;
  pictureShare: number;
  vietnamese: number;
  creamSerifCopper: string[];
  crowdedHosts: Record<string, number>;
  topKit: { head: [string, number]; body: [string, number] };
};

// Nền tảng đăng bài nói (mỗi tài khoản là một người hay một xưởng khác nhau) không có giọng thiết kế chung: giới hạn
// số mẫu cùng nguồn tính theo tác giả ở đoạn đầu đường dẫn (speakerdeck.com/<tác giả>/…), còn trang thường tính theo
// máy chủ để một thương hiệu không chiếm cả mảng.
const AUTHOR_HOSTS = new Set(["speakerdeck.com", "slides.com"]);
export function publisherOf(r: Pick<DesignRef, "source_host" | "source_url">): string {
  if (!AUTHOR_HOSTS.has(r.source_host)) return r.source_host;
  const author = r.source_url.split("/")[3];
  return author ? `${r.source_host}/${author}` : r.source_host;
}

/** Kiểm cả thư viện: hạn mức từng mảng, dung lượng, và các luật đa dạng. `vietnamese`: mã mẫu của thương hiệu Việt. */
export function checkCatalog(refs: DesignRef[], vietnamese: Set<string>): { errors: string[]; stats: CatalogStats } {
  const errors: string[] = [];
  const ids = refs.map((r) => r.id);
  if (new Set(ids).size !== ids.length) errors.push("mã mẫu trùng");
  const perDomain = Object.fromEntries(REF_DOMAINS.map((d) => [d, 0])) as Record<RefDomain, number>;
  const moods = Object.fromEntries(REF_DOMAINS.map((d) => [d, new Set<string>()])) as Record<RefDomain, Set<string>>;
  const hosts = new Map<string, number>();
  for (const r of refs) {
    perDomain[r.domain]++;
    for (const m of r.moods) moods[r.domain].add(m);
    const key = publisherOf(r);
    hosts.set(key, (hosts.get(key) ?? 0) + 1);
  }
  for (const d of REF_DOMAINS) {
    if (perDomain[d] !== REF_QUOTA[d]) errors.push(`${d}: ${perDomain[d]} mẫu, hạn mức ${REF_QUOTA[d]}`);
    if (moods[d].size < VARIETY.moodsPerDomain) errors.push(`${d}: chỉ ${moods[d].size} tâm trạng`);
  }
  const crowded = Object.fromEntries([...hosts].filter(([, n]) => n > VARIETY.perHost));
  for (const [h, n] of Object.entries(crowded)) errors.push(`${h}: ${n} mẫu cùng nguồn (tối đa ${VARIETY.perHost})`);
  const total = refs.length || 1;
  const darkShare = refs.filter((r) => r.tokens.theme === "dark").length / total;
  const pictureShare = refs.filter((r) => PICTURE_KINDS.has(r.tokens.imagery.kind)).length / total;
  const vn = refs.filter((r) => vietnamese.has(r.id)).length;
  const cream = refs.filter((r) => isCreamSerifCopper(r.tokens)).map((r) => r.id);
  const bytes = refs.reduce((s, r) => s + r.image.bytes, 0);
  if (darkShare < VARIETY.darkShare) errors.push(`mẫu tối ${Math.round(darkShare * 100)}%`);
  if (pictureShare < VARIETY.pictureShare) errors.push(`mẫu có hình ${Math.round(pictureShare * 100)}%`);
  if (vn < VARIETY.vietnamese) errors.push(`mẫu Việt Nam: ${vn}`);
  if (cream.length > VARIETY.creamSerifCopper) errors.push(`kem + chữ có chân + đồng: ${cream.join(", ")}`);
  if (bytes >= REF_LIMITS.catalogMaxBytes) errors.push(`thư viện ${bytes} byte`);
  const topOf = (slot: "head" | "body"): [string, number] => {
    const n = new Map<string, number>();
    for (const r of refs) n.set(r.tokens.fonts[slot].kit, (n.get(r.tokens.fonts[slot].kit) ?? 0) + 1);
    const [kit, count] = [...n].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    return [kit, count / total];
  };
  const topKit = { head: topOf("head"), body: topOf("body") };
  for (const slot of ["head", "body"] as const) {
    const [kit, share] = topKit[slot];
    if (share > VARIETY.kitFontShare) errors.push(`phông ${slot} ${kit} chiếm ${Math.round(share * 100)}%`);
  }
  // Nhiều mẫu chung một địa chỉ nguồn (trang danh sách, kho lưu trữ, một báo cáo nhiều trang) thì địa chỉ không chỉ ra
  // tác phẩm nào: mỗi mẫu phải ghi công riêng để còn trả lời được người làm ra nó hay đề nghị gỡ.
  const byUrl = new Map<string, DesignRef[]>();
  for (const r of refs) byUrl.set(r.source_url, [...(byUrl.get(r.source_url) ?? []), r]);
  for (const [url, group] of byUrl) {
    const bare = group.filter((r) => !r.credit?.trim()).map((r) => r.id);
    if (group.length > 1 && bare.length) errors.push(`${bare.join(", ")}: chung nguồn ${url} mà không ghi công`);
  }
  const moodsPerDomain = Object.fromEntries(REF_DOMAINS.map((d) => [d, moods[d].size])) as Record<RefDomain, number>;
  const stats: CatalogStats = {
    total: refs.length,
    bytes,
    perDomain,
    moodsPerDomain,
    darkShare,
    pictureShare,
    vietnamese: vn,
    creamSerifCopper: cream,
    crowdedHosts: crowded,
    topKit,
  };
  return { errors, stats };
}
