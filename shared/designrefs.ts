// Thư viện mẫu thiết kế tham chiếu: kiểu dữ liệu chung của bộ chụp mẫu, bộ chọn mẫu và vòng dựng - chấm.
// Mẫu chỉ là nguồn cảm hứng: lưu nguyên tắc, số đo và ảnh thu nhỏ cho model nhìn; logo, chữ, ảnh và phông độc quyền
// của trang nguồn không bao giờ đi vào sản phẩm.

export const REF_DOMAINS = ["web", "slide", "poster", "email", "dashboard", "doc"] as const;
export type RefDomain = (typeof REF_DOMAINS)[number];

export const REF_MOODS = [
  "dark-cinematic", "clean-light", "warm-craft", "bold-color", "minimal-mono", "editorial", "tech",
  "playful", "luxury", "data-dense", "organic", "retro-print", "swiss-precise", "energetic",
] as const;
export type RefMood = (typeof REF_MOODS)[number];

export const REF_INDUSTRIES = [
  "finance", "tech-saas", "ai", "ecommerce", "food-beverage", "hospitality-travel", "real-estate-interior",
  "fashion-beauty", "health-wellness", "education", "culture-music", "events", "media-publishing",
  "nonprofit-gov", "industrial-b2b", "consulting", "sports", "kids-family", "crafts-artisan", "general",
] as const;
export type RefIndustry = (typeof REF_INDUSTRIES)[number];

export const REF_AUDIENCES = [
  "consumer", "youth", "premium", "families", "b2b", "investors", "developers", "internal", "students", "public",
] as const;
export type RefAudience = (typeof REF_AUDIENCES)[number];

// Số mẫu mỗi mảng và trần dung lượng: ảnh WebP nhỏ đủ cho model nhìn bố cục, cả thư viện vẫn nhẹ trong repo.
export const REF_QUOTA: Record<RefDomain, number> = {
  web: 40,
  slide: 25,
  poster: 25,
  email: 20,
  dashboard: 20,
  doc: 20,
};
export const REF_LIMITS = {
  imageMaxBytes: 100_000,
  imageMaxWidth: 1280,
  imageMaxHeight: 1600,
  catalogMaxBytes: 15_000_000,
} as const;

export type FontCat = "sans" | "display" | "serif" | "mono";
export type KitFont = { id: string; family: string; cat: FontCat; licence: "OFL-1.1" | "Apache-2.0"; italic: boolean };
// Bộ phông Synchro tự phục vụ: giấy phép mở, đủ dấu tiếng Việt. Sản phẩm thiết kế chỉ được dùng phông trong bộ này.
export const KIT_FONTS = [
  { id: "be-vietnam-pro", family: "Be Vietnam Pro", cat: "sans", licence: "OFL-1.1", italic: false },
  { id: "inter", family: "Inter", cat: "sans", licence: "OFL-1.1", italic: false },
  { id: "plus-jakarta-sans", family: "Plus Jakarta Sans", cat: "sans", licence: "OFL-1.1", italic: false },
  { id: "montserrat", family: "Montserrat", cat: "sans", licence: "OFL-1.1", italic: false },
  { id: "ibm-plex-sans", family: "IBM Plex Sans", cat: "sans", licence: "OFL-1.1", italic: false },
  { id: "archivo", family: "Archivo", cat: "sans", licence: "OFL-1.1", italic: false },
  { id: "bricolage-grotesque", family: "Bricolage Grotesque", cat: "display", licence: "OFL-1.1", italic: false },
  { id: "space-grotesk", family: "Space Grotesk", cat: "sans", licence: "OFL-1.1", italic: false },
  { id: "lexend", family: "Lexend", cat: "sans", licence: "OFL-1.1", italic: false },
  { id: "unbounded", family: "Unbounded", cat: "display", licence: "OFL-1.1", italic: false },
  { id: "oswald", family: "Oswald", cat: "display", licence: "OFL-1.1", italic: false },
  { id: "anton", family: "Anton", cat: "display", licence: "OFL-1.1", italic: false },
  { id: "playfair-display", family: "Playfair Display", cat: "serif", licence: "OFL-1.1", italic: true },
  { id: "fraunces", family: "Fraunces", cat: "serif", licence: "OFL-1.1", italic: true },
  { id: "source-serif-4", family: "Source Serif 4", cat: "serif", licence: "OFL-1.1", italic: true },
  { id: "cormorant-garamond", family: "Cormorant Garamond", cat: "serif", licence: "OFL-1.1", italic: true },
  { id: "jetbrains-mono", family: "JetBrains Mono", cat: "mono", licence: "OFL-1.1", italic: false },
] as const satisfies readonly KitFont[];
export type KitFontId = (typeof KIT_FONTS)[number]["id"];
export const kitFont = (id: string): KitFont | undefined => KIT_FONTS.find((f) => f.id === id);
const FALLBACK: Record<FontCat, string> = {
  sans: `"Noto Sans",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif`,
  display: `"Noto Sans",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif`,
  serif: `"Noto Serif",Georgia,"Times New Roman",serif`,
  mono: `"Noto Sans Mono",ui-monospace,Menlo,Consolas,monospace`,
};
/** Chuỗi font-family của một phông trong bộ, kèm phông dự phòng cùng loại (máy không tải được vẫn đủ dấu). */
export function fontStack(id: string): string {
  const f = kitFont(id);
  return f ? `"${f.family}",${FALLBACK[f.cat]}` : FALLBACK.sans;
}

export type ColorRole = "bg" | "surface" | "raised" | "ink" | "muted" | "accent" | "accent2" | "line" | "pos" | "neg";
export type RefColor = { hex: string; role: ColorRole; share: number };
export type RefFont = { kit: KitFontId; seen: string; seenLicence: "open" | "proprietary" | "unknown"; weight: number };
export type RefTokens = {
  theme: "light" | "dark";
  colors: RefColor[];
  fonts: { head: RefFont; body: RefFont; mono: RefFont | null };
  type: {
    basePx: number;
    ratio: number;
    sizes: number[];
    headLine: number;
    bodyLine: number;
    headCase: "none" | "upper";
  };
  tracking: { display: number; heading: number; body: number; label: number };
  radius: { outer: number; inner: number; pill: boolean };
  shadow: { level: 0 | 1 | 2 | 3; css: string };
  spacing: { unit: 4 | 8; section: number; gutter: number; density: "airy" | "balanced" | "dense" };
  layout: { columns: number; maxWidth: number; align: "left" | "center" | "asymmetric"; emptyShare: number };
  imagery: {
    kind: "photo" | "illustration" | "3d" | "type-only" | "data" | "mixed";
    share: number;
    light: string;
    lens: string;
    grade: string;
    subject: string;
  };
};
export type TokenField = keyof RefTokens;

export type DesignRef = {
  v: 1;
  id: string;
  domain: RefDomain;
  title: string;
  moods: RefMood[];
  industries: RefIndustry[];
  audience: RefAudience[];
  source_url: string;
  source_host: string;
  source_kind: "public-page" | "public-image" | "cc-by" | "cc0" | "own";
  /** Người làm ra tác phẩm khi source_url không nêu (ảnh lấy từ trang tổng hợp, kho lưu trữ). */
  credit?: string;
  /** Trang ghi quyền sử dụng (CC0, phạm vi công cộng) cho mẫu cc0 / cc-by. */
  rights_url?: string;
  captured_at: string;
  image: { file: string; width: number; height: number; bytes: number; layout: "single" | "grid4" };
  tokens: RefTokens;
  measured: TokenField[];
  why: string;
  licence: string;
};
export type RefIndexRow = {
  id: string;
  domain: RefDomain;
  title: string;
  moods: RefMood[];
  industries: RefIndustry[];
  audience: RefAudience[];
  host: string;
  theme: "light" | "dark";
  paletteKey: string;
  fontPair: string;
  imagery: RefTokens["imagery"]["kind"];
  // Điền khi máy chủ nạp thư viện (đọc từ JSON của mẫu), index.json không cần có: bộ chọn dùng để tránh bảng màu kem
  // nâu và hình đề cấm.
  bg?: string;
  accent?: string;
  ink?: string;
  subject?: string;
};
export type RefIndex = { v: 1; built_at: string; refs: RefIndexRow[] };

// Số đo đọc từ trang đang mở (TOKEN_PROBE chạy trong trình duyệt): màu dạng #rrggbb, cỡ px, giãn chữ em.
export type ProbeText = {
  tag: string;
  size: number;
  weight: number;
  family: string;
  tracking: number;
  line: number;
  upper: boolean;
  color: string;
  bg: string;
  chars: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
export type ProbeRect = { x: number; y: number; w: number; h: number };
export type ProbeBox = ProbeRect & { radius: number; shadow: string; bg: string; border: string };
export type ProbeMedia = ProbeRect & { kind: "img" | "video" | "canvas" | "svg" | "bg"; hero: boolean };
export type Probe = {
  url: string;
  vw: number;
  vh: number;
  scrollH: number;
  pageBg: string;
  texts: ProbeText[];
  boxes: ProbeBox[];
  media: ProbeMedia[];
  gaps: number[];
  paddings: number[];
  maxWidth: number;
  columns: number;
  fonts: { family: string; loaded: boolean }[];
};
export type PaletteColor = { hex: string; share: number };
export type ProbeTokens = { tokens: Partial<RefTokens>; measured: TokenField[] };

// Bộ token trộn cho một sản phẩm: model dán nguyên khối CSS này, không tự đặt màu, phông.
export const MIX_ATTR = "data-sx-mix";
export const MIX_FONTS_ATTR = "data-sx-fonts";
export const MIX_VARS = [
  "--sx-bg", "--sx-surface", "--sx-raised", "--sx-ink", "--sx-muted", "--sx-accent", "--sx-accent2", "--sx-line",
  "--sx-neutral", "--sx-pos", "--sx-neg", "--sx-vivid", "--sx-vivid2", "--sx-bw", "--sx-r", "--sx-ri",
  "--sx-shadow", "--sx-blur", "--sx-lh", "--sx-head", "--sx-body", "--sx-mono",
  "--sx-track-display", "--sx-track-head", "--sx-track-label",
] as const;
export type MixRole = "palette" | "type" | "shape" | "layout";
export type StyleMix = {
  id: string;
  preset: string;
  domain: RefDomain;
  tokens: RefTokens;
  css: string;
  brand: string | null;
};
export type TurnRef = {
  id: string;
  source: "catalog" | "mine" | "follow";
  label: string;
  roles: MixRole[];
  domain: RefDomain;
  title: string;
  why: string;
  tokens: RefTokens;
};
export type BriefFacets = {
  domain: RefDomain;
  industries: RefIndustry[];
  moods: RefMood[];
  audience: RefAudience[];
  theme: "light" | "dark" | null;
  brand: string | null;
  /** Tâm trạng lấy theo mặc định của ngành (đề không tả): chỉ là đoán, nhẹ ký hơn lời đề. */
  moodGuess?: boolean;
  /** Đề tự đòi tông ấm (ấm, kem, nâu, đồng): bảng màu kem nâu lúc đó là đúng đề, không phạt. */
  warmOk?: boolean;
  /** Hình đề cấm ("không hình ổ bánh hay lúa mì"): mẫu có chủ thể đó bị bỏ. */
  avoid?: string[];
};
export type StyleTurn = { mix: StyleMix; refs: TurnRef[]; facets: BriefFacets; note: string | null };
export type DesignStyleSel = { kind: "mine" | "follow"; id: string };
export type TurnImageIn = { media_type: string; data: string };
export type StyleTurnInput = {
  uid: string;
  conv?: string;
  typed: string;
  format: "slide" | "doc" | "graphic";
  seed?: string;
  ownBrand: boolean;
  sel: DesignStyleSel | null;
  images: TurnImageIn[];
  incognito: boolean;
  signal?: AbortSignal;
  onStatus?: (text: string) => void;
};

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const isHex = (s: string) => /^#[0-9a-f]{6}$/.test(s);
// Nền tối hẳn: độ chói tương đối tới 0,1 (khoảng #595959 trở xuống). Nền đỏ, xám vừa có chữ trắng vẫn không phải
// giao diện tối, xếp chúng vào "dark" làm bộ trộn đặt nền sáng cho một mẫu "tối".
export const DARK_BG_MAX = 0.1;
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
/** Tỉ lệ tương phản WCAG giữa hai màu #rrggbb. */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
/** Khóa thô của bảng màu (độ sáng nền, sắc màu nhấn): hai sản phẩm cùng khóa trông cùng một bảng màu. */
export function paletteKey(colors: RefColor[]): string {
  const bg = colors.find((c) => c.role === "bg");
  const accent = colors.find((c) => c.role === "accent");
  if (!bg || !accent) return "none";
  const b = hsl(bg.hex);
  const a = hsl(accent.hex);
  const hue = a.s < 0.15 ? "n" : String(Math.round(a.h / 30) % 12);
  return `${Math.round(b.l * 4)}-${hue}`;
}
export const fontPairKey = (t: Pick<RefTokens, "fonts">) => `${t.fonts.head.kit}+${t.fonts.body.kit}`;
