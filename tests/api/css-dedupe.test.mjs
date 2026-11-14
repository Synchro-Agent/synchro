// B5 bước 8 (canh gác): CSS của app không còn khai báo chết chắc chắn (bị một khai báo cùng selector, cùng @media, luôn nạp cùng, luôn đứng
// trên che hẳn). scripts/css-dedupe.mjs: dự án thật phải 0; bộ mẫu kiểm từng trường hợp phải giữ (dự phòng, thứ tự dev / prod khác nhau,
// tệp tải chậm, html body có thể là chính body…) và từng trường hợp được xóa.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const D = await import(path.resolve("scripts/css-dedupe.mjs"));
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };

console.log("1. Dự án thật");
const real = D.findDead(D.load(path.resolve(".")));
ok(real.size === 0, "0 khai báo chết (chạy node scripts/css-dedupe.mjs --write để xóa)", [...real.keys()].slice(0, 10).map((d) => `${d.parent.selector} { ${d.prop}: ${d.value} } :${d.source?.start?.line}`).join("\n"));

console.log("2. Bộ mẫu");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "css-dedupe-"));
for (const f of [...D.FIRST, ...D.LAZY]) { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), "@layer syn, syn-over;\n"); }
const put = (f, css) => fs.writeFileSync(path.join(tmp, f), `@layer syn, syn-over;\n${css}\n`);
put("app/globals.css", `@layer syn{
.a{color:red;margin:0}
.b{height:100vh;height:100dvh}
.c{height:100vh}
.d{color:red}
.e,.f{color:red}
.g{color:red}
.h{padding-left:4px}
@media (max-width:760px){.i{color:red}}
.j{color:red}
.cv-dragging{cursor:default}
.k{backdrop-filter:blur(2px)}
.l{color:red!important}
.m{color:red}
}
@layer syn-over{.g{color:blue}}`);
put("app/synchro-ds.css", `@layer syn{
.a{color:blue}
.c{height:100dvh}
html body .d{color:blue}
.e{color:blue}
.h{padding:0}
@media (max-width: 760px){.i{color:blue}}
.j{color:blue}
html body .cv-dragging{cursor:col-resize}
.k{-webkit-backdrop-filter:blur(3px)}
.l{color:blue!important}
}`);
put("app/glass.css", `@layer syn{.m{color:blue}}`);
put("app/projects.css", `@layer syn{.p{color:red}.q{color:red}.q{color:blue}}`);
put("app/settings.css", `@layer syn{.p{color:blue}}`);
const dead = D.findDead(D.load(tmp));
const has = (sel, prop) => [...dead.keys()].some((d) => d.parent.selector === sel && d.prop === prop);
ok(has(".a", "color"), "cùng selector, tệp tải đầu nạp sau (DS sau globals ở cả dev lẫn prod) → chết");
ok(!has(".a", "margin"), "thuộc tính không bị che thì giữ");
ok(!has(".b", "height"), "hai giá trị trong cùng luật (dự phòng 100vh / 100dvh) → giữ");
ok(!has(".c", "height"), "bị che bởi giá trị cú pháp mới (dvh) → giữ làm dự phòng");
ok(has(".d", "color"), "html body X ở cùng lớp che X → chết");
ok(!has(".e,.f", "color"), "danh sách selector chỉ bị che một phần → giữ");
ok(has(".g", "color"), "lớp syn-over che lớp syn → chết");
ok(has(".h", "padding-left"), "viết tắt padding nạp sau che padding-left → chết");
ok(has(".i", "color"), "cùng @media (khác khoảng trắng) → chết");
ok(!has(".cv-dragging", "cursor"), "lớp đặt lên chính <body> (cv-dragging): html body X không trúng nó → giữ");
ok(!has(".k", "backdrop-filter"), "tên có tiền tố hãng khác tên gốc → giữ");
ok(!has(".l", "color"), "!important → giữ");
ok(!has(".m", "color"), "glass.css nạp sau globals ở dev nhưng trước ở prod → giữ");
ok(!has(".p", "color"), "tệp tải chậm khác (có thể chưa nạp) → giữ");
ok(has(".q", "color"), "trong cùng tệp tải chậm, luật sau cùng selector → chết");
ok(dead.size === 7, "đúng 7 khai báo chết trong bộ mẫu", dead.size);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
