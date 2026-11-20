// Thư viện mẫu tổng hợp cho kiểm thử bộ chọn mẫu khi chưa có thư viện thật (catalog/design-refs): 54 mẫu qua 6 mảng, đủ
// nền sáng / tối, đủ tâm trạng, ngành, 7 trang nguồn mỗi mảng, bảng màu và cặp phông khác nhau. Sinh tất định (không
// ngẫu
// nhiên) để kết quả chọn mẫu lặp lại được. writeCatalog() ghi ra thư mục đúng cấu trúc thư viện thật, kèm ảnh WebP nhỏ.
import fs from "node:fs";
import path from "node:path";

const MOODS = ["dark-cinematic", "clean-light", "warm-craft", "bold-color", "minimal-mono", "editorial", "tech",
  "playful",
  "luxury", "data-dense", "organic", "retro-print", "swiss-precise", "energetic"];
const INDUSTRIES = ["finance", "tech-saas", "ai", "ecommerce", "food-beverage", "hospitality-travel",
  "real-estate-interior",
  "fashion-beauty", "health-wellness", "education", "culture-music", "events", "media-publishing", "nonprofit-gov",
  "industrial-b2b", "consulting", "sports", "kids-family", "crafts-artisan", "general"];
const AUDIENCES = ["consumer", "youth", "premium", "families", "b2b", "investors", "developers", "internal",
  "students", "public"];
// [nền, chữ, nhấn, nhấn 2]: sắc nhấn trải khắp vòng màu, nền từ trắng tới đen.
const PALETTES = [
  ["#ffffff", "#111827", "#2563eb", "#0ea5e9"], ["#0b0d12", "#f1f5f9", "#22d3ee", "#a78bfa"],
  ["#f6f1e9", "#2b2118", "#c2410c", "#365314"], ["#111111", "#fafafa", "#facc15", "#f97316"],
  ["#eef2ff", "#1e1b4b", "#7c3aed", "#db2777"], ["#0f1a14", "#e8f5ec", "#34d399", "#fbbf24"],
  ["#fff7ed", "#431407", "#ea580c", "#0f766e"], ["#f8fafc", "#0f172a", "#16a34a", "#0284c7"],
  ["#1a1023", "#f5e9ff", "#e879f9", "#38bdf8"], ["#fefce8", "#1c1917", "#dc2626", "#1d4ed8"],
  ["#ecfeff", "#083344", "#0891b2", "#be123c"], ["#18181b", "#f4f4f5", "#fb7185", "#a3e635"],
  ["#fdf2f8", "#500724", "#be185d", "#4d7c0f"], ["#f0fdf4", "#052e16", "#15803d", "#b45309"],
  ["#0c0a09", "#fafaf9", "#f59e0b", "#14b8a6"], ["#e7e5e4", "#1c1917", "#4f46e5", "#e11d48"],
  ["#f5f3ff", "#2e1065", "#9333ea", "#0d9488"], ["#020617", "#e2e8f0", "#6366f1", "#f43f5e"],
  ["#fffbeb", "#292524", "#b91c1c", "#15803d"], ["#f1f5f9", "#0f172a", "#e11d48", "#7c3aed"],
  ["#082f49", "#f0f9ff", "#fde047", "#fb923c"], ["#faf5ff", "#3b0764", "#c026d3", "#2563eb"],
  ["#171717", "#e5e5e5", "#84cc16", "#06b6d4"], ["#fff1f2", "#4c0519", "#e11d48", "#0369a1"],
];
const FONT_PAIRS = [
  ["space-grotesk", "inter"], ["fraunces", "be-vietnam-pro"], ["plus-jakarta-sans", "inter"], ["archivo", "inter"],
  ["unbounded", "plus-jakarta-sans"], ["source-serif-4", "ibm-plex-sans"], ["oswald", "montserrat"], ["lexend",
    "lexend"],
  ["cormorant-garamond", "montserrat"], ["bricolage-grotesque", "be-vietnam-pro"], ["ibm-plex-sans", "ibm-plex-sans"],
  ["anton", "archivo"], ["montserrat", "inter"], ["playfair-display", "inter"], ["inter", "inter"],
  ["space-grotesk", "ibm-plex-sans"], ["fraunces", "plus-jakarta-sans"], ["archivo", "be-vietnam-pro"],
];
const IMAGERY = ["photo", "type-only", "illustration", "3d", "data", "mixed", "photo", "type-only"];
const SHAPES = [
  { radius: { outer: 0, inner: 0, pill: false }, shadow: { level: 0, css: "none" } },
  { radius: { outer: 16, inner: 8, pill: false }, shadow: { level: 2, css: "0 20px 40px -15px rgba(0,0,0,.4)" } },
  { radius: { outer: 24, inner: 12, pill: true }, shadow: { level: 1, css: "0 8px 16px -4px rgba(15,23,42,.08)" } },
  { radius: { outer: 8, inner: 4, pill: false }, shadow: { level: 2, css: "5px 5px 0 0 #000000" } },
  { radius: { outer: 4, inner: 2, pill: false }, shadow: { level: 1, css: "0 1px 3px rgba(0,0,0,.08)" } },
];
const DOMAINS = { web: 12, slide: 10, poster: 10, email: 6, dashboard: 8, doc: 8 };

const font = (kit, weight) => ({ kit, seen: "Proprietary Sans", seenLicence: "proprietary", weight });
function tokensOf(n, theme) {
  const p = PALETTES[n % PALETTES.length];
  const dark = theme === "dark";
  // Mẫu tối dùng bảng tối, mẫu sáng dùng bảng sáng: chọn bảng cùng loại gần nhất.
  const pal = PALETTES.filter((q) => (parseInt(q[0].slice(1, 3), 16) < 80) === dark);
  const [bg, ink, accent, accent2] = pal[n % pal.length] ?? p;
  const [head, body] = FONT_PAIRS[(n * 7) % FONT_PAIRS.length];
  const shape = SHAPES[n % SHAPES.length];
  return {
    theme,
    colors: [
      { hex: bg, role: "bg", share: 0.6 }, { hex: ink, role: "ink", share: 0.2 },
      { hex: accent, role: "accent", share: 0.08 }, { hex: accent2, role: "accent2", share: 0.04 },
    ],
    fonts: { head: font(head, 700), body: font(body, 400), mono: n % 3 ? null : font("jetbrains-mono", 500) },
    type: { basePx: 16, ratio: 1.25 + (n % 4) * 0.05, sizes: [14, 16, 20, 28, 40, 64], headLine: 1.1 + (n % 3) * 0.05,
      bodyLine: 1.55, headCase: n % 5 ? "none" : "upper" },
    tracking: { display: -0.03 + (n % 3) * 0.01, heading: -0.01, body: 0, label: 0.08 },
    ...structuredClone(shape),
    spacing: { unit: 8, section: 96 + (n % 3) * 16, gutter: 24, density: ["airy", "balanced", "dense"][n % 3] },
    layout: { columns: 12, maxWidth: 1200, align: ["left", "center", "asymmetric"][n % 3], emptyShare: 0.3 },
    imagery: { kind: IMAGERY[n % IMAGERY.length], share: 0.4, light: "low raking window light from left",
      lens: "85mm, f/4, eye level", grade: "warm amber highlights, deep green shadows",
      subject: "tea leaves on dark stone" },
  };
}

/** { rows: RefIndexRow[], refs: DesignRef[] }; paletteKey, fontPairKey lấy từ shared/designrefs.ts (truyền vào). */
export function makeCatalog({ paletteKey, fontPairKey }) {
  const refs = [];
  let n = 0;
  for (const [domain, count] of Object.entries(DOMAINS)) {
    for (let k = 1; k <= count; k++, n++) {
      const id = `${domain}-${String(k).padStart(3, "0")}`;
      const theme = (n * 3) % 10 < 4 ? "dark" : "light";
      const tokens = tokensOf(n, theme);
      const moods = [MOODS[n % MOODS.length], MOODS[(n * 5 + 3) % MOODS.length]].filter((m, i,
        a) => a.indexOf(m) === i);
      const industries = [INDUSTRIES[n % INDUSTRIES.length], INDUSTRIES[(n * 7 + 4) % INDUSTRIES.length]]
        .filter((m, i, a) => a.indexOf(m) === i);
      refs.push({
        v: 1, id, domain, title: `Mẫu thử ${domain} số ${k}`, moods, industries,
        audience: [AUDIENCES[n % AUDIENCES.length]], source_url: `https://host${k % 7}.${domain}.example/`,
        source_host: `host${k % 7}.${domain}.example`, source_kind: "public-page", captured_at: "2026-11-20",
        image: { file: `${domain}/${id}.webp`, width: 320, height: 200, bytes: 0, layout: "single" },
        tokens, measured: ["colors"], why: "Câu một. Câu hai. Câu ba.", licence: "Ảnh thử.",
      });
    }
  }
  const rows = refs.map((r) => ({
    id: r.id, domain: r.domain, title: r.title, moods: r.moods, industries: r.industries, audience: r.audience,
    host: r.source_host, theme: r.tokens.theme, paletteKey: paletteKey(r.tokens.colors),
    fontPair: fontPairKey(r.tokens),
    imagery: r.tokens.imagery.kind,
  }));
  return { rows, refs };
}

/** Ghi thư viện tổng hợp ra dir (index.json, <domain>/<id>.json, <domain>/<id>.webp màu nền của mẫu). */
export async function writeCatalog(dir, cat, sharp) {
  for (const r of cat.refs) {
    fs.mkdirSync(path.join(dir, r.domain), { recursive: true });
    fs.writeFileSync(path.join(dir, r.domain, `${r.id}.json`), JSON.stringify(r));
    const bg = r.tokens.colors[0].hex;
    const img = await sharp({ create: { width: 320, height: 200, channels: 3, background: bg } }).webp().toBuffer();
    fs.writeFileSync(path.join(dir, r.image.file), img);
  }
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ v: 1, built_at: "2026-11-20", refs: cat.rows }));
}
