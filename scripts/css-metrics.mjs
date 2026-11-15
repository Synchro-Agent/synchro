// B5 (một hệ token thiết kế): chỉ số CSS chỉ được giảm (ratchet). Đọc mọi tệp app/**/*.css bằng postcss (bỏ chú thích) và đếm:
// - important: khai báo !important;
// - htmlBody: selector có tiền tố chỉ để tăng độ ưu tiên "html body X" / "html[…] body X";
// - fontSize: font-size cứng (px / rem / pt; em, %, var(), inherit, clamp() không tính) và font: viết tắt có cỡ cứng;
// - zIndex: z-index là số ≥ 20 (lớp toàn cục; -1…19 là xếp chồng cục bộ);
// - mediaWidth: điều kiện chiều rộng của @media ngoài các mốc 480, 640, 760/761, 860, 1100;
// - darkHex: mã hex trong luật giao diện tối (bỏ khối chỉ định nghĩa biến --x);
// - inlineFontSize / inlineZIndex: fontSize / zIndex nội dòng trong tsx không dùng token (var(--fs-…) / var(--z-…)).
// Mỗi chỉ số có trần ở CEIL: vượt trần là lỗi (mã thoát 1). Bước B5 nào giảm được thì hạ trần xuống đúng số mới trong cùng commit.
// Dùng: node scripts/css-metrics.mjs [--json]   (scripts/qa.mjs chạy tệp này như một bộ kiểm)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SRC_ROOTS } from "../tests/lib/srcroots.mjs";
// CSS nằm ở app/ hoặc ui/ (H3); mã .tsx ở mọi gốc mã nguồn.
const CSS_ROOTS = ["app", "ui"];

const postcss = createRequire(import.meta.url)("postcss");

// Trần hiện tại (số đo lúc đặt trần). Chỉ được hạ.
// important 14 → 18 (chỉ trong nhánh B5, main vẫn 333): vòng rà B5 tìm ra 4 khai báo đang đè style nội dòng mà lần soát tay bỏ sót (bottom
// của ba menu trong ô soạn tin dự án, padding ≤860px của nút chủ đề trong Cài đặt), trả lại !important; lý do ở KEEP trong css-unimportant.mjs.
// htmlBody 572 → 582 (lần duy nhất tăng, B5 bước 4): khi chuyển !important sang lớp syn-over, 50 selector còn tiền tố html body được chép
// sang khối syn-over (tiền tố quyết định bên thắng giữa các luật syn-over với nhau, gỡ thì đổi bên thắng); không thêm tiền tố cho selector mới.
// Chủ dự án giao quyết định (2026-11-14): giữ trần ~582 tạm thời (nay 581); B5 bước 6 (dedupe, vòng 2) phải đưa htmlBody về ≤ 572 (TARGET dưới đây).
// Thử gỡ tiền tố từng selector của khối syn-over (so cascade tĩnh dev + prod sau mỗi lần gỡ) ngày 2026-11-14
// thì gỡ được 1 (glass.css, ::before của nút kính: 582 → 581), 53 cái còn lại gỡ thì đổi bên thắng; bước 6 gộp bản syn với bản syn-over
// của cùng selector thì mới bỏ được bản chép.
// htmlBody 581 → 560 (B5 bước 8, 2026-11-15): scripts/css-dedupe.mjs xóa 371 khai báo chết (bị khai báo cùng selector / html body cùng selector
// che hẳn), 78 luật trống theo đó; đạt mục tiêu ≤ 572 đặt ngày 2026-11-14.
// fontSize 1243 → 115, inlineFontSize 65 → 20 (B5 bước 6a): scripts/css-tokens.mjs --only fs đổi đúng-bằng sang var(--fs-…); còn lại là cỡ lệch
// thang (15, 17, 14.5, 18…: bước 6b, cần duyệt ảnh), cỡ tính từ biến trong tsx, tùy chọn xterm / Monaco và home.tsx (đợi B2).
// zIndex 63 → 0, inlineZIndex 22 → 1 (B5 bước 7a): mọi z-index ≥ 20 theo tầng --z-* (calc(var(--z-bậc dưới) + n), giữ thứ tự); còn glass-folder
// zIndex: v + 1 (tính từ biến).
// darkHex 96 → 43 (B5 bước 9): màu trạng thái của giao diện tối → --ds-ok / --ds-warn / --ds-bad / --ds-plan / --ds-ask, bảng màu biểu đồ → --viz-0…7.
// Còn lại: nền xám cũ (#222, #252525, #2d2d2d…), #fff / #000 / mặt nạ, vài màu riêng (#ec82b2, #6aa8f0, #ffa497…): cần chọn token bề mặt.
export const CEIL = { important: 18, htmlBody: 560, fontSize: 115, zIndex: 0, mediaWidth: 88, darkHex: 43, inlineFontSize: 20, inlineZIndex: 1 };
// Mục tiêu có hạn: chỉ số phải về tới max trong bước ghi ở by (đặt ngày set). In ra cùng kết quả; bước đó hạ CEIL theo.
// Đích cuối của B5 (acceptance 1 của kế hoạch): in kèm số còn thừa, không làm hỏng bộ kiểm; mỗi bước sau hạ CEIL dần về đây.
// important < 30 và zIndex / inlineZIndex 0 (trừ một chỗ tính từ biến) đã đạt.
export const TARGET = {
  htmlBody: { max: 0, by: "B5 bước 3 còn lại (gỡ tiền tố cần so cascade động từng tệp)", set: "2026-11-15" },
  fontSize: { max: 0, by: "B5 bước 6b (cỡ lệch thang, cần chủ dự án duyệt ảnh trước / sau)", set: "2026-11-15" },
  mediaWidth: { max: 0, by: "B5 bước 7b (mốc @media ngoài thang, chuyển theo bảng kèm ảnh điện thoại / máy tính bảng)", set: "2026-11-15" },
  darkHex: { max: 0, by: "B5 bước 9b (nền xám cũ, #fff / #000: chọn token bề mặt)", set: "2026-11-15" },
};
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
  const files = CSS_ROOTS.flatMap((r) => (fs.existsSync(path.join(root, r)) ? walk(path.join(root, r), /\.css$/) : [])).sort();
  const per = Object.fromEntries(files.map((f) => [path.relative(root, f), measureCss(fs.readFileSync(f, "utf8"), f)]));
  let inlineFontSize = 0, inlineZIndex = 0;
  for (const f of SRC_ROOTS.flatMap((r) => (fs.existsSync(path.join(root, r)) ? walk(path.join(root, r), /\.tsx$/) : []))) {
    const s = fs.readFileSync(f, "utf8");
    // Giá trị là token ("var(--fs-…)" / "var(--z-…)" hay calc của nó) thì không tính (B5 bước 6a / 7a).
    inlineFontSize += (s.match(/\bfontSize\s*:(?!\s*["'`]var\(--fs-)/g) ?? []).length;
    inlineZIndex += (s.match(/\bzIndex\s*:(?!\s*["'`](var\(--z-|calc\(var\(--z-))/g) ?? []).length;
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
    const t = TARGET[k];
    if (t && total[k] > t.max) console.log(`  → mục tiêu ${k} ≤ ${t.max} trong ${t.by} (đặt ${t.set}); còn thừa ${total[k] - t.max}`);
  }
  process.exit(bad ? 1 : 0);
}
