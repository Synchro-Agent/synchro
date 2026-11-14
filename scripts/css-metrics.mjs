// B5 (một hệ token thiết kế): chỉ số CSS chỉ được giảm (ratchet). Đọc mọi tệp app/**/*.css bằng postcss (bỏ chú thích) và đếm:
// - important: khai báo !important;
// - htmlBody: selector có tiền tố chỉ để tăng độ ưu tiên "html body X" / "html[…] body X";
// - fontSize: font-size cứng (px / rem / pt; em, %, var(), inherit, clamp() không tính) và font: viết tắt có cỡ cứng;
// - zIndex: z-index là số ≥ 20 (lớp toàn cục; -1…19 là xếp chồng cục bộ);
// - mediaWidth: điều kiện chiều rộng của @media ngoài các mốc 480, 640, 760/761, 860, 1100;
// - darkHex: mã hex trong luật giao diện tối (bỏ khối chỉ định nghĩa biến --x);
// - inlineFontSize / inlineZIndex: fontSize / zIndex nội dòng trong tsx.
// Mỗi chỉ số có trần ở CEIL: vượt trần là lỗi (mã thoát 1). Bước B5 nào giảm được thì hạ trần xuống đúng số mới trong cùng commit.
// Dùng: node scripts/css-metrics.mjs [--json]   (scripts/qa.mjs chạy tệp này như một bộ kiểm)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const postcss = createRequire(import.meta.url)("postcss");

// Trần hiện tại (số đo lúc đặt trần). Chỉ được hạ.
export const CEIL = { important: 333, htmlBody: 572, fontSize: 1278, zIndex: 63, mediaWidth: 90, darkHex: 100, inlineFontSize: 65, inlineZIndex: 22 };
export const WIDTHS = new Set([480, 640, 760, 761, 860, 1100]);

const walk = (d, ext, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "api" && e.name !== "node_modules") walk(p, ext, out); }
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
};

const HARD = /(^|[\s,/(])-?\d*\.?\d+(px|rem|pt)\b/;
const isDark = (sel) => /\[data-theme=["']?dark["']?\]/.test(sel);

/** Chỉ số của một tệp CSS. */
export function measureCss(css, file = "") {
  const m = { important: 0, htmlBody: 0, fontSize: 0, zIndex: 0, mediaWidth: 0, darkHex: 0 };
  const root = postcss.parse(css, { from: file });
  root.walkDecls((d) => {
    const rule = d.parent;
    if (rule?.type === "atrule" && /font-face|property/.test(rule.name)) return;
    if (rule?.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) { if (d.important) m.important++; return; }
    if (d.important) m.important++;
    const p = d.prop.toLowerCase(), v = d.value.trim();
    if (p === "font-size" && HARD.test(v) && !/^(clamp|min|max|calc)\(/.test(v)) m.fontSize++;
    if (p === "font" && HARD.test(v.split("/")[0]) && !/var\(/.test(v.split("/")[0])) m.fontSize++;
    if (p === "z-index" && /^\d+$/.test(v) && +v >= 20) m.zIndex++;
    if (rule?.type === "rule" && isDark(rule.selector) && !p.startsWith("--")) m.darkHex += (v.match(/#[0-9a-f]{3,8}\b/gi) ?? []).length;
  });
  root.walkRules((r) => { for (const s of r.selectors ?? []) if (/(^|[\s(,])html(\[[^\]]*\])* body\s/.test(s)) m.htmlBody++; });
  root.walkAtRules("media", (a) => { for (const x of a.params.matchAll(/(?:(?:min|max)-width\s*:\s*|width\s*[<>]=?\s*)([\d.]+)px/g)) if (!WIDTHS.has(+x[1])) m.mediaWidth++; });
  return m;
}

/** Chỉ số của cả dự án: theo tệp và tổng. */
export function measureAll(root = ".") {
  const files = walk(path.join(root, "app"), /\.css$/).sort();
  const per = Object.fromEntries(files.map((f) => [path.relative(root, f), measureCss(fs.readFileSync(f, "utf8"), f)]));
  let inlineFontSize = 0, inlineZIndex = 0;
  for (const f of walk(path.join(root, "app"), /\.tsx$/)) {
    const s = fs.readFileSync(f, "utf8");
    inlineFontSize += (s.match(/\bfontSize\s*:/g) ?? []).length;
    inlineZIndex += (s.match(/\bzIndex\s*:/g) ?? []).length;
  }
  const total = { important: 0, htmlBody: 0, fontSize: 0, zIndex: 0, mediaWidth: 0, darkHex: 0, inlineFontSize, inlineZIndex };
  for (const m of Object.values(per)) for (const k of Object.keys(m)) total[k] += m[k];
  return { per, total };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { per, total } = measureAll(".");
  if (process.argv.includes("--json")) { console.log(JSON.stringify({ per, total, CEIL }, null, 1)); process.exit(0); }
  const keys = Object.keys(CEIL);
  const w = Math.max(...Object.keys(per).map((f) => f.length));
  console.log(`${"tệp".padEnd(w)}  ${["important", "htmlBody", "fontSize", "zIndex", "mediaWidth", "darkHex"].map((k) => k.padStart(10)).join(" ")}`);
  for (const [f, m] of Object.entries(per)) console.log(`${f.padEnd(w)}  ${Object.values(m).map((v) => String(v).padStart(10)).join(" ")}`);
  let bad = 0;
  for (const k of keys) {
    const over = total[k] > CEIL[k];
    if (over) bad++;
    console.log(`${over ? "✗" : "✓"} ${k}: ${total[k]} / trần ${CEIL[k]}${over ? " — VƯỢT TRẦN: chỉ số này chỉ được giảm" : total[k] < CEIL[k] ? ` (hạ trần xuống ${total[k]} được)` : ""}`);
  }
  process.exit(bad ? 1 : 0);
}
