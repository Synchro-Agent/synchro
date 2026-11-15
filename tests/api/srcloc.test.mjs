// Giao diện ↔ mã nguồn (Alt+Click): đánh dấu dòng mã lên từng thẻ HTML / SVG mà không đổi số dòng, đoạn mã quanh vị trí.
// Hàm thuần, không cần máy chủ: dịch shared/srcloc.ts bằng TypeScript rồi gọi trực tiếp.
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
const out = ts.transpileModule(readFileSync("shared/srcloc.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const f = path.join(mkdtempSync(path.join(tmpdir(), "srcloc-")), "srcloc.mjs");
writeFileSync(f, out);
const { instrumentHtml, stripLoc, parseLoc, snippet } = await import(f);
const locOf = (html, re) => re.exec(html)?.[1];

console.log("1. Trang HTML");
const PAGE = `<!doctype html>
<html><head>
<title>a > b</title>
<style>p > a { color: red } /* <div> */</style>
<script>if (1 < 2 && "<p>") document.title = "</div>";</script>
</head>
<body>
  <!-- <section> trong chú thích -->
  <header data-x="a > b"><h1>Tiêu đề</h1></header>
  <section class="hero">
    <p>Đoạn một
       còn tiếp</p>
    <img src="x.png" alt="ảnh">
    <br/>
  </section>
  <ul><li>Một<li>Hai</ul>
</body>
</html>`;
const I = instrumentHtml(PAGE);
ok(I.split("\n").length === PAGE.split("\n").length, "không thêm dòng nào");
ok(stripLoc(I) === PAGE, "bỏ đánh dấu thì về đúng mã gốc");
ok(locOf(I, /<header data-sx-loc="([^"]+)"/) === "9-9" && locOf(I, /<h1 data-sx-loc="([^"]+)"/) === "9-9", "thẻ có thuộc tính chứa “>” vẫn đúng dòng", I.split("\n")[8]);
ok(locOf(I, /<section data-sx-loc="([^"]+)" class="hero"/) === "10-15", "thẻ nhiều dòng: dòng đầu – dòng cuối", locOf(I, /<section data-sx-loc="([^"]+)"/));
ok(locOf(I, /<p data-sx-loc="([^"]+)">Đoạn một/) === "11-12", "đoạn văn xuống dòng: 11–12");
ok(locOf(I, /<img data-sx-loc="([^"]+)"/) === "13-13" && locOf(I, /<br data-sx-loc="([^"]+)"/) === "14-14", "thẻ rỗng (img, br/) không làm lệch thẻ sau");
ok(!/<(html|head|body|title|style|script)(\s[^>]*)?data-sx-loc/.test(I), "không đánh dấu html, head, body, title, style, script");
ok(!/<section data-sx-loc="[^"]+"> trong chú thích/.test(I) && I.includes("<!-- <section> trong chú thích -->"), "thẻ trong chú thích, style, script giữ nguyên");
ok(I.includes(`document.title = "</div>";`) && !/<div data-sx-loc/.test(I), "chuỗi “</div>” trong script không bị hiểu là thẻ");
ok(locOf(I, /<li data-sx-loc="([^"]+)">Một/) === "16-16", "thẻ không đóng (li) vẫn có dòng");
ok(instrumentHtml(I) === I, "đánh dấu hai lần không nhân đôi");

console.log("2. SVG và đầu vào lạ");
const SVG = `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <style><![CDATA[ rect > x {} ]]></style>\n  <g>\n    <rect x="1" y="1" width="4" height="4"/>\n  </g>\n</svg>`;
const S = instrumentHtml(SVG);
ok(locOf(S, /<svg data-sx-loc="([^"]+)"/) === "2-7" && locOf(S, /<g data-sx-loc="([^"]+)"/) === "4-6" && locOf(S, /<rect data-sx-loc="([^"]+)"/) === "5-5", "SVG: svg 2–7, g 4–6, rect 5", S);
ok(instrumentHtml("chỉ là chữ, 1 < 2") === "chỉ là chữ, 1 < 2" && instrumentHtml("<div class=\"x") === "<div class=\"x", "chữ thường hoặc thẻ dở dang: trả nguyên");

console.log("3. Vị trí và đoạn mã");
ok(JSON.stringify(parseLoc("3-5", 10)) === '{"start":3,"end":5}' && JSON.stringify(parseLoc("8-99", 10)) === '{"start":8,"end":10}' && parseLoc("abc", 10) === null && parseLoc(undefined, 10) === null, "đọc vị trí, giới hạn trong số dòng của tệp");
const sn = snippet(PAGE, { start: 11, end: 12 });
ok(sn.split("\n").length === 6 && sn.startsWith("   9 | ") && sn.includes("  11 |     <p>Đoạn một"), "đoạn mã: 2 dòng trước, 2 dòng sau, kèm số dòng", sn);
ok(snippet("a\nb", { start: 1, end: 1 }) === "   1 | a\n   2 | b", "đầu tệp không lệch");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
