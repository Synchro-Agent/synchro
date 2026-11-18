// Canh gác điều khiển giao diện (đợt E, báo lỗi của chủ dự án trên Chrome Windows): các lỗi đã sửa tận gốc không quay lại.
// 1) Không <select> gốc trong giao diện (dùng Dropdown của ui/listbox.tsx): Windows mở danh sách của hệ điều hành, mũi tên lệch.
// 2) Không <input type="color"> gốc ngoài ui/colorpick.tsx (ô ẩn cho nút "Màu khác…").
// 3) Ô nhiều dòng không mang bo viên thuốc: luật chặn :where(textarea) ở lớp syn-over; hàng (--ds-r-row) không dùng --r-pill.
// 4) Thanh cuộn mảnh toàn app có độ ưu tiên 0, nên scrollbar-width:none của dải tab / bộ chọn đoạn / hàng thẻ thắng (Windows hiện mũi tên).
// 5) Dropdown: bàn phím, tên, danh sách gắn vào <body> (đọc mã nguồn).
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 800)); };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
const src = ["ui", "app"].flatMap((d) => walk(d)).filter((f) => /\.tsx$/.test(f));
// Bỏ chú thích (// … và /* … */) để câu nhắc tới <select> trong chú thích không bị tính.
const code = (f) => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

console.log("1. Không <select> gốc");
const sel = src.filter((f) => /<select[\s>]/.test(code(f)));
ok(sel.length === 0, "không tệp .tsx nào dùng <select> (dùng Dropdown của ui/listbox.tsx)", sel.join(", "));

console.log("2. Không ô chọn màu gốc ngoài colorpick.tsx");
const color = src.filter((f) => !f.endsWith(path.join("ui", "colorpick.tsx")) && /type=["{]?["']?color/.test(code(f)));
ok(color.length === 0, "chỉ ui/colorpick.tsx có <input type=\"color\">", color.join(", "));

console.log("3. Bo góc của ô nhiều dòng và hàng");
const ds = fs.readFileSync("app/_shell/synchro-ds.css", "utf8");
const over = ds.slice(ds.lastIndexOf("@layer syn-over{"));
ok(/:where\(textarea\)\{border-radius:var\(--r-field\)\}/.test(over), "luật chặn :where(textarea){border-radius:var(--r-field)} nằm ở lớp syn-over");
const tok = (n) => ds.match(new RegExp(`--${n}:([^;]+);`))?.[1].trim();
ok(tok("ds-r-row") && !/r-pill|999/.test(tok("ds-r-row")), "--ds-r-row không phải viên thuốc", tok("ds-r-row"));
ok(tok("r-row") === "16px", "--r-row = 16px (viên thuốc đúng cho hàng 32px, hàng cao hơn là góc bo 16)", tok("r-row"));
ok(tok("r-field") && !/r-pill|999/.test(tok("r-field")), "--r-field không phải viên thuốc", tok("r-field"));
// Lớp syn: không luật nào đặt textarea bo viên thuốc trực tiếp.
const css = [...walk("app/_shell"), ...walk("ui/styles")].filter((f) => f.endsWith(".css")).map((f) => [f, fs.readFileSync(f, "utf8")]);
const pillTa = css.flatMap(([f, s]) => [...s.matchAll(/([^{}]*textarea[^{}]*)\{([^}]*)\}/g)].filter((m) => /border-radius:\s*(var\(--r-pill\)|999px|99px|9999px)/.test(m[2])).map((m) => `${f}: ${m[1].trim()}`));
ok(pillTa.length === 0, "không luật CSS nào đặt textarea bo viên thuốc", pillTa.join("\n"));

console.log("4. Thanh cuộn của dải");
ok(!/html body \.app \*\{scrollbar-width/.test(ds) && /:where\(\.app \*\)\{scrollbar-width:thin/.test(ds), "thanh cuộn mảnh toàn app có độ ưu tiên 0 (:where(.app *))");
const strip = ds.match(/:where\((\.hstrip[^)]*)\)\{\s*overflow-x:auto;overflow-y:hidden;scrollbar-width:none/);
ok(!!strip, "luật dải cuộn ngang chung: overflow-y:hidden, scrollbar-width:none");
for (const c of [".sp-seg", ".sp-utabs", ".sp-catrow", ".sp-tags", ".ds-seg"]) ok(!!strip && strip[1].split(",").includes(c), `dải ${c} nằm trong luật chung`);
ok(/:where\(\.hstrip[^{]*\)::-webkit-scrollbar\{display:none\}/.test(ds), "ẩn cả ::-webkit-scrollbar của dải");

console.log("5. Dropdown (ui/listbox.tsx)");
const lb = fs.readFileSync("ui/listbox.tsx", "utf8");
ok(/role="combobox"/.test(lb) && /aria-haspopup="listbox"/.test(lb) && /role="listbox"/.test(lb) && /role="option"/.test(lb), "vai trò combobox / listbox / option");
ok(/aria-activedescendant/.test(lb) && /aria-selected=\{sel\}/.test(lb), "aria-activedescendant và aria-selected");
for (const k of ["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp", "Enter", "Escape", "Tab"]) ok(lb.includes(`"${k}"`), `phím ${k}`);
ok(/createPortal\([\s\S]*document\.body/.test(lb) && /position: "fixed"/.test(lb), "danh sách gắn vào <body>, position:fixed (không bị khung cuộn cắt)");
ok(/stopImmediatePropagation/.test(lb), "Esc đóng danh sách mà không đóng hộp thoại chứa nó");
ok(/fold\(/.test(lb) && /\\u0300-\\u036f/.test(lb), "tìm bỏ dấu tiếng Việt");
const L = await import(path.resolve("ui/listbox.tsx")).catch(() => null);
if (L?.fold) ok(L.fold("Tiếng Việt") === "tieng viet" && L.fold("Đà Nẵng") === "da nang", "fold bỏ dấu đúng");

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
