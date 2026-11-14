// B5 bước 0: công cụ so cascade tĩnh (scripts/css-cascade.mjs) và chỉ số CSS (scripts/css-metrics.mjs) tính đúng. Hàm thuần, không cần máy chủ.
import path from "node:path";

const C = await import(path.resolve("scripts/css-cascade.mjs"));
const M = await import(path.resolve("scripts/css-metrics.mjs"));
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("1. Specificity theo Selectors 4");
for (const [s, want] of [
  ["html body .a", [0, 1, 2]], [".a.b:hover", [0, 3, 0]], ["#x .a::before", [1, 1, 1]], [":where(html body .btn) .x", [0, 1, 0]],
  [":is(.a, #b) span", [1, 0, 1]], [".a:not(.b, .c .d)", [0, 3, 0]], ["[data-theme=\"dark\"] .m", [0, 2, 0]], ["li:nth-child(2 of .on)", [0, 2, 1]],
  ["a:before", [0, 0, 2]], [".x\\:y", [0, 1, 0]],
]) ok(eq(C.specificity(s), want), `${s} → ${want}`, C.specificity(s));

console.log("2. Thứ tự thắng: lớp, !important đảo chiều, không lớp");
const sheets = [{ name: "a.css", css: "@layer base, ds; @layer base{.x{color:red}.y{color:red!important}} .z{color:red!important}" }, { name: "b.css", css: "@layer ds{html body .x{color:blue}.y{color:blue!important}}" }];
const L = C.collect(sheets);
const d = (sheet, sel, imp) => L.decls.find((x) => x.sheet === sheet && x.sel === sel && x.imp === imp && x.atom === "color");
ok(C.precede(d("b.css", "html body .x", false), d("a.css", ".x", false), L) > 0, "lớp sau thắng lớp trước dù specificity bằng / thấp hơn");
ok(C.precede(d("a.css", ".y", true), d("b.css", ".y", true), L) > 0, "!important ở lớp TRƯỚC thắng !important ở lớp sau");
ok(C.precede(d("a.css", ".y", true), d("a.css", ".z", true), L) > 0, "!important trong lớp thắng !important không lớp");

console.log("3. Phần tử có thể trùng: @media, chủ đề, viết tắt");
const m = (q) => C.parseMedia(q);
ok(!m("(max-width:760px)").some((a) => m("(min-width:761px)").some((b) => Math.max(a.lo, b.lo) <= Math.min(a.hi, b.hi))), "max 760 và min 761 không giao nhau");
ok(C.subject('html[data-theme="dark"] body .a').theme === "D" && C.subject(':root:not([data-theme="dark"]) .a').theme === "L", "nhận chủ đề tối / sáng");
ok(C.atoms("margin").includes("margin-left") && C.atoms("border").includes("border-top-color") && C.atoms("font").includes("font-size"), "viết tắt trải ra thuộc tính gốc");
ok(eq(C.subject(".a :is(.b, .c)::after").alts.map((a) => a.cls), [["b"], ["c"]]) && C.subject(".a::after").pel === "after", ":is ở phần tử chủ thành các phương án; ::after");

console.log("4. Hai phiên bản: gỡ html body + bọc lớp không đổi bên thắng khi lớp giữ đúng thứ tự");
const co = { groups: [{ cls: new Set(["x"]) }], byCls: new Map([["x", [{ cls: new Set(["x"]) }]]]), wild: new Set(), tags: new Map() };
const A = C.collect([{ name: "g.css", css: ".x{color:red}" }, { name: "d.css", css: "html body .x{color:blue}" }]);
const B1 = C.collect([{ name: "g.css", css: "@layer g, d; @layer g{.x{color:red}}" }, { name: "d.css", css: "@layer g, d; @layer d{.x{color:blue}}" }]);
const B2 = C.collect([{ name: "g.css", css: "@layer d, g; @layer g{.x{color:red}}" }, { name: "d.css", css: "@layer d, g; @layer d{.x{color:blue}}" }]);
const r1 = C.diff(A, B1, co), r2 = C.diff(A, B2, co);
ok(r1.flips.length === 0 && r1.lost.length === 0 && r1.pairs === 1, "lớp đúng thứ tự: 0 cặp đổi", JSON.stringify(r1));
ok(r2.flips.length === 1, "lớp sai thứ tự: báo 1 cặp đổi", JSON.stringify(r2.flips));

console.log("5. Chuyển !important sang lớp syn-over (css-unimportant.mjs) không đổi bên thắng");
const U = await import(path.resolve("scripts/css-unimportant.mjs"));
const HEAD = "@layer base, syn, syn-over;\n";
const src = `${HEAD}@layer syn {\n.x{color:red!important;margin:0}\n.a .x{color:teal!important}\n@media (max-width:760px){.y .x{color:blue!important}}\n.x.x.x{color:black}\n}\n`;
const later = { name: "l.css", css: `${HEAD}@layer syn{.y.x.x.x{color:gray}}` };
const t = U.transform(src, "t.css");
const co2 = { groups: [{ cls: new Set(["x", "y", "a"]) }], byCls: new Map(["x", "y", "a"].map((c) => [c, [{ cls: new Set(["x", "y", "a"]) }]])), wild: new Set(), tags: new Map() };
const r3 = C.diff(C.collect([{ name: "t.css", css: src }, later]), C.collect([{ name: "t.css", css: t.css }, later]), co2);
ok(t.moved.length === 3 && M.measureCss(t.css).important === 0 && /@layer syn-over\s*\{[\s\S]*@media \(max-width:760px\)\{\s*\.y \.x\{color:blue\}/.test(t.css), "chuyển đủ 3 khai báo, giữ @media bao quanh", t.css);
ok(r3.flips.length === 0 && r3.lost.length === 0 && r3.extra.length === 0 && r3.pairs > 0, "0 cặp đổi bên thắng", JSON.stringify(r3.flips[0] ?? r3.lost));
const k = U.transform(`${HEAD}@layer syn {\nhtml body .modal.sm h2{font-size:16px!important;font-weight:560!important}\n}\n`, "app/synchro-ds.css");
ok(k.kept.length === 1 && k.kept[0].prop === "font-size" && k.moved.length === 1, "giữ !important ở chỗ đè style nội dòng (KEEP)", JSON.stringify(k));

console.log("6. Chỉ số CSS");
const x = M.measureCss('html body .a{font-size:13px!important;z-index:30} html[data-theme="dark"] body .b{color:#fff;--t:#000} @media (max-width:700px){.c{font:600 12px/1.4 x;z-index:5}} .d{font-size:.9em}');
ok(eq(x, { important: 1, htmlBody: 2, fontSize: 2, zIndex: 1, mediaWidth: 1, darkHex: 1 }), "đếm đúng từng loại", JSON.stringify(x));
const all = M.measureAll(".");
ok(Object.keys(M.CEIL).every((k) => all.total[k] <= M.CEIL[k]), "mã nguồn hiện tại không vượt trần", JSON.stringify(all.total));

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
