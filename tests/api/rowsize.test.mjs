// Chiều cao ước tính của dòng tin ngoài màn hình (app/rowsize.ts): sát với chiều dài thật để cuộn ngược lên một đoạn chat cũ không giật. Không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x)); };
const { rowsize: R } = await loadTs(["rowsize"]);
const ai = (text, extra = {}) => R.rowHeight({ role: "ai", text, ...extra });

ok(ai("Chào bạn") < 120, "câu ngắn: thấp", ai("Chào bạn"));
const para = "Một câu trả lời dài. ".repeat(200);
ok(ai(para) > 900 && ai(para) < 1400, "đoạn dài khoảng 4000 ký tự: khoảng 45 dòng", ai(para));
ok(ai("a\n\nb\n\nc") < ai("a\nb\nc") + 40, "dòng trống chỉ tính khoảng cách, không tính cả dòng");
const code = "```js\n" + "const x = 1;\n".repeat(40) + "```";
ok(ai(code) > 800 && ai(code) < 1100, "khối code tính theo số dòng", ai(code));
const art = `<artifact identifier="a" type="text/html" title="T">${"<div>x</div>\n".repeat(2000)}</artifact>`;
ok(ai(art) < 200, "artifact chỉ hiện một thẻ, không tính nội dung", ai(art));
ok(ai("", { outs: [1, 2] }) > ai(""), "tệp đính kèm cộng thêm chiều cao");
ok(R.rowHeight({ role: "user", text: "Xin chào" }) < 100, "tin người dùng ngắn", R.rowHeight({ role: "user", text: "Xin chào" }));
ok(R.rowHeight({ role: "ai" }) > 0, "tin chưa có chữ vẫn có số");
console.log(`${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
