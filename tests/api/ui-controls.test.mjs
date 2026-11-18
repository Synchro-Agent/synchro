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

console.log("6. Khung nổi gắn vào <body> và popover đóng khi bấm ra ngoài");
// Danh sách Dropdown / bảng màu / chọn giờ nằm ở cuối <body>, ngoài DOM của popover mở ra nó: popover nào chứa các ô này mà coi cú bấm vào
// danh sách là "bấm ra ngoài" thì tự đóng trước khi cú bấm tới mục (ô Gửi của bàn trộn ngữ cảnh từng không đổi được bằng chuột).
for (const [f, cls] of [["ui/listbox.tsx", "dd-pop"], ["ui/colorpick.tsx", "cp-pop"], ["ui/timepick.tsx", "tpk-pop"]]) {
  const s = code(f);
  ok(new RegExp(`${cls}[^>]*data-floating`).test(s), `${f}: khung nổi .${cls} mang data-floating`);
}
const ca = fs.readFileSync("ui/clickaway.ts", "utf8");
ok(/export const FLOATING = "data-floating"/.test(ca) && /export const inFloating/.test(ca) && /export const isAway/.test(ca), "ui/clickaway.ts có FLOATING, inFloating, isAway");
// Tệp có ô chọn / ô màu / ô giờ mà có trình nghe mousedown của document so ref.contains(target) trơn (không qua isAway / inFloating).
const hosts = src.filter((f) => /<(Dropdown|ColorField|TimePick)\b/.test(code(f)) && !/ui[\\/](listbox|colorpick|timepick)\.tsx$/.test(f));
const bare = hosts.filter((f) => { const s = code(f); return /addEventListener\("mousedown"/.test(s) && /\.contains\(e\.target as (Node|HTMLElement)\)\)\s*(set|on|close|f\.)/.test(s); });
ok(hosts.length > 5, `tìm được các tệp dùng Dropdown / ColorField (${hosts.length})`);
ok(bare.length === 0, "popover chứa Dropdown / ColorField bỏ qua cú bấm trong khung nổi (isAway / inFloating)", bare.join(", "));
{
  const { loadTs } = await import("../lib/ts.mjs");
  const C = await loadTs(["ui/clickaway"]).then((m) => m["ui/clickaway"]).catch((e) => (ok(false, "nạp ui/clickaway.ts", e.message), null));
  if (C) {
    // Phần tử giả tối thiểu: contains / closest như DOM.
    const up = (x) => { const l = []; for (; x; x = x.parent) l.push(x); return l; };
    const node = (parent, attrs = {}) => { const n = { parent, attrs }; n.contains = (t) => up(t).includes(n); n.closest = (sel) => up(n).find((x) => sel.replace(/^\[|\]$/g, "") in x.attrs) ?? null; return n; };
    const body = node(null), pop = node(body), inside = node(pop), list = node(body, { "data-floating": "" }), opt = node(list), other = node(body);
    ok(!C.isAway(pop, inside), "bấm trong popover: không đóng");
    ok(!C.isAway(pop, opt), "bấm vào mục của danh sách gắn ở <body> (data-floating): không đóng");
    ok(C.isAway(pop, other), "bấm ra ngoài cả hai: đóng");
    ok(C.isAway(null, other), "popover chưa gắn (null): tính là ngoài");
    ok(C.inFloating(opt) && !C.inFloating(other) && !C.inFloating(null), "inFloating đúng");
  }
}

console.log("7. Nút kéo thanh trượt tách khỏi nền ở cả hai chế độ");
{
  const block = (sel) => ds.slice(ds.indexOf(sel + "{")).split("}")[0];
  const root = block(":root"), dark = block('[data-theme="dark"]');
  const v = (b, n) => b.match(new RegExp(`--${n}:([^;]+);`))?.[1].trim();
  ok(/background:var\(--ds-thumb\)/.test(ds) && !/slider-thumb\{[^}]*background:var\(--ds-plate\)/.test(ds), "nút kéo dùng --ds-thumb, không dùng --ds-plate (trùng màu bảng ở chế độ tối)");
  ok(!!v(dark, "ds-thumb") && v(dark, "ds-thumb") !== v(dark, "ds-plate"), "chế độ tối có --ds-thumb riêng, khác --ds-plate", v(dark, "ds-thumb"));
  const hex = (h) => { const m = /^#([0-9a-f]{6})$/i.exec(h ?? ""); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const cr = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const t = hex(v(dark, "ds-thumb")), p = hex(v(dark, "ds-plate"));
  ok(t && p && cr(t, p) >= 3, `chế độ tối: nút kéo / tấm tương phản ≥ 3:1 (${t && p ? cr(t, p).toFixed(1) : "?"}:1)`);
  ok(/--ds-thumb-ring:/.test(root) && /--ds-thumb-ring:/.test(dark), "viền nút kéo (--ds-thumb-ring) có ở cả hai chế độ");
  const sp = fs.readFileSync("ui/styles/speech.css", "utf8");
  ok(!/\.sp-range::-webkit-slider-thumb \{[^}]*background:var\(--card\)/.test(sp), "thanh trượt Speech (.sp-range) không dùng --card cho nút kéo");
}

console.log("8. Dropdown mở bằng chạm không tự focus ô tìm (không bật bàn phím ảo)");
{
  ok(/export const autoFocusSearch/.test(lb) && /autoFocusSearch\(via\.current\)/.test(lb) && /onPointerDown=\{\(e\) => \{ via\.current = e\.pointerType/.test(lb), "ô tìm chỉ tự focus theo autoFocusSearch(cách mở)");
  const m = lb.match(/export const autoFocusSearch = [\s\S]*?=>\s*(via === "key"[^;]+);/);
  const f = m && new Function("via", "coarse", `return ${m[1]};`);
  if (f) {
    ok(f("key", true) === true, "mở bằng bàn phím (kể cả máy cảm ứng): focus ô tìm");
    ok(f("mouse", false) === true && f("pen", true) === true, "mở bằng chuột / bút: focus ô tìm");
    ok(f("touch", false) === false && f("touch", true) === false, "mở bằng chạm: không focus ô tìm");
    ok(f("", true) === false && f("", false) === true, "không rõ cách mở: theo (pointer: coarse)");
  } else ok(false, "đọc được autoFocusSearch");
}

console.log("9. Từ điển phát âm: không nháy \"Chọn một từ điển…\" khi đang tự mở từ điển");
{
  const dc = code("ui/speech/dict.tsx");
  ok(/openFail \? \(\s*<div className="sp-card sp-detect">/.test(dc), "câu \"Chọn một từ điển…\" chỉ hiện khi tự mở bị lỗi (openFail)");
  ok(/sp-dict-wait" aria-busy="true"/.test(dc), "lúc chờ: khung giả của trình sửa (aria-busy)");
  ok(/catch \(e\) \{ setOpenFail\(true\)/.test(dc), "tải từ điển lỗi thì đặt openFail");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
