// B5 bước 4 (canh gác): style nội dòng trong tsx không được thắng khai báo CSS từng mang !important (syn-over / bỏ chữ tại chỗ).
// tools/css-inline.mjs: dự án thật phải 0 cặp chưa giải thích, mục ALLOW nào cũng còn dùng; bộ mẫu nhỏ phải bắt đủ ba dạng mà vòng rà B5
// tìm ra bằng tay (style điều kiện, style truyền qua prop của Menu, h3 margin nội dòng) và thôi báo khi CSS trả lại !important.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const G = await import(path.resolve("tools/css-inline.mjs"));
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };

console.log("1. Dự án thật");
const real = G.conflicts(path.resolve("."));
const bad = real.filter((c) => !c.allowed);
ok(bad.length === 0, "0 cặp style nội dòng ↔ khai báo từng !important chưa giải thích", bad.map((c) => `${c.css} ⇐ ${c.el}`).join("\n"));
const stale = G.ALLOW.filter(([f, e, s]) => !real.some((c) => c.file === f && c.sig === e && c.sel === s));
ok(stale.length === 0, "mục ALLOW nào cũng còn khớp một cặp (gỡ mục thừa khi mã đổi)", JSON.stringify(stale));
const els = G.inlineStyles(path.resolve(".")).elements;
ok(G.inlineStyles(path.resolve(".")).forwarders.get("Menu")?.base.includes("menu"), "nhận ra Menu chuyển style xuống thẻ .menu");
ok(els.some((e) => e.file === "ui/home.tsx" && e.cls.has("plus-menu") && e.props.has("bottom")), "thấy bottom nội dòng của menu + qua prop của Menu");

console.log("2. Bộ mẫu: ba dạng style nội dòng đè khai báo syn-over");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "css-inline-"));
fs.mkdirSync(path.join(tmp, "app"));
fs.symlinkSync(path.resolve("node_modules"), path.join(tmp, "node_modules"));
const css = (imp) => `@layer syn, syn-over;
@layer syn{.menu{position:absolute}.row{display:flex}}
@layer syn-over{
.wrap .menu.pm{top:100%;bottom:auto${imp}}
.box .row{border:1px solid red${imp}}
.box h3{margin:28px 0 10px${imp}}
.other .menu{left:0}
}`;
const write = (imp) => fs.writeFileSync(path.join(tmp, "app/a.css"), css(imp));
fs.writeFileSync(path.join(tmp, "app/ui.tsx"), `export function Menu({ className, style, children }: { className?: string; style?: React.CSSProperties; children?: React.ReactNode }) {
  return <div className={\`menu \${className}\`} style={style}>{children}</div>;
}
`);
fs.writeFileSync(path.join(tmp, "app/page.tsx"), `import { Menu } from "./ui";
function Row({ top, children }: { top?: boolean; children?: React.ReactNode }) {
  return <div className="row" style={top ? { borderTop: 0 } : undefined}>{children}</div>;
}
const pos = { left: 4 };
export default function Page() {
  return (
    <div className="box">
      <Row top>a</Row>
      <h3 style={{ margin: "18px 0 2px" }}>Quiet hours</h3>
      <div className="wrap"><Menu className="pm" style={{ ...pos, bottom: 40 }}>x</Menu></div>
    </div>
  );
}
`);
write("");
let r = G.conflicts(tmp);
const has = (sel, atom) => r.some((c) => c.sel === sel && c.atoms.includes(atom));
ok(has(".box .row", "border-top-width"), "style điều kiện của Row (top ? { borderTop: 0 } : undefined) đè border", JSON.stringify(r.map((c) => c.css)));
ok(has(".box h3", "margin-top"), "h3 margin nội dòng đè margin của syn-over");
ok(has(".wrap .menu.pm", "bottom"), "bottom truyền qua prop style của Menu đè bottom:auto");
ok(!r.some((c) => c.sel === ".other .menu"), "không báo khi tổ tiên (.other) không có trong tệp hay tệp import nó", JSON.stringify(r.map((c) => c.css)));
ok(!r.some((c) => c.atoms.includes("top")), "không báo thuộc tính chỉ CSS đặt (top)");
write("!important");
r = G.conflicts(tmp);
ok(r.length === 0, "trả lại !important thì hết báo (CSS thắng style nội dòng như trên main)", JSON.stringify(r.map((c) => c.css)));
fs.rmSync(tmp, { recursive: true, force: true });

console.log("3. Trải :is phức");
ok(JSON.stringify(G.expandIs(".pj-compose :is(.model-menu,.mic-wrap .menu)")) === JSON.stringify([".pj-compose .model-menu", ".pj-compose .mic-wrap .menu"]), ":is có đối số phức thành hai selector");
ok(JSON.stringify(G.expandIs(".a:is(.b .c,.d)")) === JSON.stringify([".a.c", ".a.d"]), "gắn vào phần ghép: giữ phần ghép cuối của đối số");

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
