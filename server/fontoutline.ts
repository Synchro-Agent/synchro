// Chữ logo trong SVG tải về thành đường nét (<path>): tệp mở ở máy không cài phông, in ấn, đưa vào phần mềm khác vẫn
// đúng hình chữ, kể cả dấu tiếng Việt chồng (Ấ, Ỗ). Chỉ đổi phần tử <text data-sx-logo>: chữ thường của hình giữ là
// chữ (phông nhúng ở ui/artfonts.ts), vì chữ nét không chọn, không tìm, không đọc to được.
// Dựng nét bằng fontTools trong sandbox (cùng nơi chạy code), từ đúng tệp woff2 của bộ phông Synchro: mỗi ký tự lấy ở
// tệp bộ ký tự có ký tự đó (như trình duyệt chọn theo unicode-range), phông biến thiên lấy đúng độ đậm. Không có bảng
// kerning (cặp chữ khít) vì không có bộ dựng chữ HarfBuzz trong sandbox; giãn chữ (letter-spacing) thì giữ.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { KIT_FONTS, type KitFontId } from "../shared/designrefs";
import { KIT_FONT_FILES } from "../shared/kitfonts";
import { presetOf } from "../shared/designpresets";
import { execRun, runner } from "./coderun";

export type LogoText = {
  text: string; font: KitFontId; weight: number; italic: boolean; size: number; tracking: number;
  x: number; y: number; anchor: "start" | "middle" | "end"; fill: string; attrs: string;
};
const MAX_LOGOS = 12, MAX_CHARS = 80;
const num = (v: string | undefined, d = 0) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : d;
};
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? m[1] ?? m[2] : undefined;
};
const styleProp = (tag: string, name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i")
  .exec(attr(tag, "style") ?? "")?.[1]?.trim();
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
  .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/** Họ phông của bộ trong một giá trị font-family; var(--sx-head|body) thì theo khối token trộn hoặc preset của hình. */
export function kitFamilyOf(value: string, svg: string): KitFontId | null {
  let v = value;
  const ref = /var\(\s*--sx-(head|body|mono)\b/.exec(v)?.[1] as "head" | "body" | "mono" | undefined;
  if (ref) {
    const block = /<style\b[^>]*data-sx-mix[\s\S]*?<\/style>/.exec(svg)?.[0] ?? "";
    const mixed = new RegExp(`--sx-${ref}\\s*:\\s*([^;}]+)`).exec(block);
    const preset = presetOf(/data-sx-preset=["']?([\w-]+)/.exec(svg)?.[1] ?? "");
    v = mixed?.[1] ?? (preset ? preset[ref] : "");
  }
  const first = v.split(",")[0]?.replace(/["']/g, "").trim().toLowerCase();
  return (KIT_FONTS.find((f) => f.family.toLowerCase() === first)?.id as KitFontId | undefined) ?? null;
}

/** Các <text data-sx-logo> đổi được (chữ thuần, phông trong bộ, có cỡ chữ); phần tử khác giữ nguyên. */
export function logoTexts(svg: string): { tag: string; full: string; logo: LogoText }[] {
  const out: { tag: string; full: string; logo: LogoText }[] = [];
  for (const m of svg.matchAll(/(<text\b[^>]*\bdata-sx-logo\b[^>]*>)([^<]*)<\/text>/gi)) {
    if (out.length >= MAX_LOGOS) break;
    const tag = m[1], text = unescape(m[2]).normalize("NFC").trim();
    const family = styleProp(tag, "font-family") ?? attr(tag, "font-family") ?? "";
    const font = kitFamilyOf(family, svg);
    const size = num(styleProp(tag, "font-size") ?? attr(tag, "font-size"));
    if (!text || text.length > MAX_CHARS || !font || size <= 0) continue;
    const w = styleProp(tag, "font-weight") ?? attr(tag, "font-weight") ?? "400";
    const weight = w === "bold" ? 700 : w === "normal" ? 400 : num(w, 400);
    const ls = styleProp(tag, "letter-spacing") ?? attr(tag, "letter-spacing") ?? "0";
    const tracking = /em\s*$/.test(ls) ? num(ls) : num(ls) / size;
    const anchor = (styleProp(tag, "text-anchor") ?? attr(tag, "text-anchor") ?? "start") as LogoText["anchor"];
    const italic = /italic/i.test(styleProp(tag, "font-style") ?? attr(tag, "font-style") ?? "");
    const keep = ["transform", "opacity", "class", "id"].flatMap((k) => {
      const v = attr(tag, k);
      return v ? [`${k}="${v}"`] : [];
    });
    out.push({ tag, full: m[0], logo: {
      text, font, weight, italic, size, tracking, x: num(attr(tag, "x")), y: num(attr(tag, "y")),
      anchor: anchor === "middle" || anchor === "end" ? anchor : "start",
      fill: styleProp(tag, "fill") ?? attr(tag, "fill") ?? "currentColor", attrs: keep.join(" "),
    } });
  }
  return out;
}

/** Tệp woff2 cho một kiểu chữ: bản biến thiên chứa độ đậm đó, không thì bản tĩnh gần nhất; đủ mọi bộ ký tự. */
export function filesFor(font: KitFontId, weight: number, italic: boolean): string[] {
  const all = KIT_FONT_FILES[font].filter((f) => f.style === (italic ? "italic" : "normal"));
  const list = all.length ? all : KIT_FONT_FILES[font];
  const span = (w: string) => {
    const [a, b] = w.split("-").map(Number);
    return [a, b ?? a];
  };
  const dist = (w: string) => {
    const [a, b] = span(w);
    return weight < a ? a - weight : weight > b ? weight - b : 0;
  };
  const best = Math.min(...list.map((f) => dist(f.weight)));
  const spec = list.find((f) => dist(f.weight) === best)!.weight;
  return list.filter((f) => f.weight === spec).map((f) => `${font}/${f.file}`);
}

// Chạy trong sandbox: đọc tệp woff2 (fontTools + brotli có sẵn trong image), lấy nét từng ký tự theo cmap, đặt liên
// tiếp theo độ rộng ký tự cộng giãn chữ; phông biến thiên đặt trục wght theo độ đậm (kẹp vào khoảng của phông).
export const OUTLINE_PY = String.raw`import json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
cfg = json.load(open("outline.json"))
cache = {}
def load(p):
    if p not in cache:
        cache[p] = TTFont(p)
    return cache[p]
res = []
for it in cfg["items"]:
    fonts = [load(p) for p in it["files"]]
    x, parts, missing = 0.0, [], []
    for i, ch in enumerate(it["text"]):
        f = next((f for f in fonts if ord(ch) in f.getBestCmap()), None)
        if f is None:
            missing.append(ch)
            continue
        loc = None
        if "fvar" in f:
            loc = {}
            for a in f["fvar"].axes:
                if a.axisTag == "wght":
                    loc["wght"] = max(a.minValue, min(a.maxValue, it["weight"]))
        gs = f.getGlyphSet(location=loc) if loc else f.getGlyphSet()
        g = gs[f.getBestCmap()[ord(ch)]]
        s = it["size"] / f["head"].unitsPerEm
        pen = SVGPathPen(gs, ntos=lambda v: ("%.2f" % v).rstrip("0").rstrip("."))
        g.draw(TransformPen(pen, (s, 0, 0, -s, x, 0)))
        parts.append(pen.getCommands())
        x += g.width * s + (it["tracking"] * it["size"] if i < len(it["text"]) - 1 else 0)
    res.append({"d": " ".join(p for p in parts if p), "width": round(x, 2), "missing": missing})
print(json.dumps(res))
`;

const KIT_DIR = () => path.join(process.cwd(), "public/kitfonts/v1");
const round = (n: number) => Math.round(n * 100) / 100;

/** Đổi chữ logo thành nét. null: không đổi được (không có sandbox, lỗi) — nơi gọi giữ nguyên chữ và phông nhúng. */
export async function outlineLogos(uid: string, svg: string, signal?: AbortSignal): Promise<string | null> {
  const found = logoTexts(svg);
  if (!found.length) return svg;
  if (runner() !== "workspace") return null;
  const items = found.map(({ logo }) => ({
    text: logo.text, weight: logo.weight, size: logo.size, tracking: logo.tracking,
    files: filesFor(logo.font, logo.weight, logo.italic),
  }));
  const used = [...new Set(items.flatMap((i) => i.files))];
  const files = [
    { path: "outline.py", data: Buffer.from(OUTLINE_PY) },
    { path: "outline.json", data: Buffer.from(JSON.stringify({ items })) },
    ...used.map((p) => ({ path: p, data: fs.readFileSync(path.join(KIT_DIR(), p)) })),
  ];
  const r = await execRun({ uid, files, argv: ["python3", "outline.py"], net: false, timeout: 60, signal });
  if (r.exit !== 0) {
    console.warn(`[fontoutline] fontTools lỗi: ${(r.stderr || r.stdout).slice(-300)}`);
    return null;
  }
  let res: { d: string; width: number; missing: string[] }[];
  try {
    res = JSON.parse(r.stdout.trim().split("\n").pop() ?? "[]");
  } catch (e) {
    console.warn(`[fontoutline] kết quả không đọc được: ${(e as Error).message}`);
    return null;
  }
  let out = svg;
  found.forEach(({ full, logo }, i) => {
    const g = res[i];
    // Thiếu ký tự trong phông (chữ ngoài bộ tiếng Việt / Latin): giữ chữ, phông nhúng vẫn hiện đúng như khung xem.
    if (!g?.d || g.missing.length) return;
    const shift = logo.anchor === "middle" ? g.width / 2 : logo.anchor === "end" ? g.width : 0;
    const label = logo.text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const move = `translate(${round(logo.x - shift)} ${round(logo.y)})`;
    const outer = logo.attrs ? ` ${logo.attrs}` : "";
    const path1 = `<path d="${g.d}" transform="${move}" fill="${logo.fill}"/>`;
    out = out.replace(full, `<g data-sx-logo role="img" aria-label="${label}"${outer}>${path1}</g>`);
  });
  return out;
}
