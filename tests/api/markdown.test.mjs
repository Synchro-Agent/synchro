// Bộ phân tích Markdown của câu trả lời model: danh sách, nhấn chữ, link, ảnh, công thức, bảng, khối code, câu đang viết dở. Tự chạy được, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
const { mdparse: M } = await loadTs(["mdparse"]);
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const blocks = (t) => M.parseMarkdown(t).tops.map((x) => x.b);
const inl = (t, o) => M.parseInline(t, o);
const J = (x) => JSON.stringify(x);
const eq = (a, b, n) => ok(J(a) === J(b), n, { got: a, want: b });

console.log("1. Danh sách đánh số");
{
  let b = blocks("1. Một\n2. Hai\n3. Ba");
  ok(b.length === 1 && b[0].t === "list" && b[0].ordered && b[0].items.length === 3, "ba bước là một danh sách", b);
  b = blocks("1. Bước một\n- chi tiết một\n2. Bước hai\n- chi tiết hai\n3. Bước ba\n- chi tiết ba");
  ok(b.length === 1 && b[0].items.length === 3 && b[0].items.every((it) => it.c[1]?.t === "list" && !it.c[1].ordered), "gạch đầu dòng sát lề giữa các bước thành chi tiết của từng bước, số chạy 1 2 3", b);
  b = blocks("1. A\n\n2. B\n\n3. C");
  ok(b.length === 1 && b[0].items.length === 3, "dòng trống giữa các bước vẫn một danh sách", b);
  b = blocks("1. A\n\nĐoạn chen giữa.\n\n2. B\n\n3. C");
  ok(b[0].start === 1 && b[1].t === "p" && b[2].t === "list" && b[2].start === 2 && b[2].items.length === 2, "đoạn văn chen giữa: danh sách sau bắt đầu từ 2", b);
  b = blocks("1. A\n```bash\nls\n```\n2. B");
  ok(b[0].t === "list" && b[1].t === "code" && b[1].code === "ls" && b[2].start === 2, "khối code sát lề giữa các bước: bước sau vẫn là 2", b);
  b = blocks("5. Năm\n6. Sáu");
  ok(b[0].start === 5, "bắt đầu từ 5", b);
  b = blocks("1) Một\n2) Hai");
  ok(b[0].t === "list" && b[0].items.length === 2, "kiểu 1) cũng là danh sách", b);
  b = blocks("1. Bước\n   ```bash\n   npm i\n     --save\n   ```\n2. Tiếp");
  ok(b.length === 1 && b[0].items[0].c[1]?.t === "code" && b[0].items[0].c[1].code === "npm i\n  --save" && b[0].items.length === 2, "code thụt trong mục nằm trong mục, bỏ đúng phần thụt", b);
}

console.log("2. Danh sách lồng");
{
  let b = blocks("- Cha\n  - Con\n    - Cháu\n- Cha 2");
  ok(b.length === 1 && b[0].items.length === 2, "hai mục cấp một", b);
  const con = b[0].items[0].c[1];
  ok(con?.t === "list" && con.items[0].c[1]?.t === "list" && con.items[0].c[1].items[0].c[0].s === "Cháu", "ba cấp lồng đúng", b);
  b = blocks("- A\n    - B\n        - C\n    - D\n- E");
  ok(b[0].items.length === 2 && b[0].items[0].c[1].items.length === 2 && b[0].items[0].c[1].items[0].c[1]?.t === "list", "thụt 4 cách", b);
  b = blocks("1. Một\n  - con thụt hai cách\n    - cháu\n2. Hai");
  ok(b.length === 1 && b[0].items.length === 2 && b[0].items[0].c[1].t === "list" && b[0].items[0].c[1].items[0].c[1]?.t === "list", "thụt 2 cách dưới số là con", b);
  b = blocks("1. Một\n   1. Một một\n   2. Một hai\n2. Hai");
  ok(b[0].items[0].c[1].ordered && b[0].items[0].c[1].items.length === 2 && b[0].items.length === 2, "số lồng trong số", b);
  b = blocks("- A\n\n  đoạn thứ hai của A\n\n- B");
  ok(b[0].items.length === 2 && b[0].items[0].c[1]?.t === "p", "đoạn thứ hai thụt vào thuộc mục", b);
  b = blocks("- A\ntiếp dòng của A\n- B");
  ok(b[0].items.length === 2 && b[0].items[0].c[0].s === "A\ntiếp dòng của A", "dòng tiếp không thụt thuộc đoạn của mục", b);
  b = blocks("- [ ] chưa\n- [x] xong\n  - [X] con");
  ok(b[0].items[0].task && !b[0].items[0].done && b[0].items[1].done && b[0].items[1].c[1].items[0].done, "checklist, kể cả lồng", b);
  b = blocks("- A\n\n\nKết luận");
  ok(b[1]?.t === "p" && b[1].s === "Kết luận", "đoạn sau dòng trống không dính vào danh sách", b);
  ok(blocks("> - a\n>   - b\n> 1. c")[0].c[0].items[0].c[1]?.t === "list", "danh sách lồng trong trích dẫn", blocks("> - a\n>   - b"));
}

console.log("3. Nhấn chữ");
{
  eq(inl("*nghiêng* và _nghiêng_"), [{ t: "em", c: ["nghiêng"] }, " và ", { t: "em", c: ["nghiêng"] }], "*x* và _x_");
  eq(inl("**đậm**"), [{ t: "strong", c: ["đậm"] }], "**x**");
  const n = inl("***x***");
  ok(J(n).includes('"em"') && J(n).includes('"strong"') && !J(n).includes("*"), "***x*** không còn dấu sao", n);
  eq(inl("**đậm *nghiêng* tiếp**"), [{ t: "strong", c: ["đậm ", { t: "em", c: ["nghiêng"] }, " tiếp"] }], "**đậm *nghiêng* tiếp**");
  eq(inl("~~bỏ~~"), [{ t: "del", c: ["bỏ"] }], "~~x~~");
  eq(inl("snake_case_name và tiếng_việt_có_dấu"), ["snake_case_name và tiếng_việt_có_dấu"], "gạch dưới giữa từ không nhấn, kể cả chữ có dấu");
  eq(inl("2*3*4 và a**2 + b**2 và 5 * 3 * 2"), ["2*3*4 và a**2 + b**2 và 5 * 3 * 2"], "phép tính không thành nhấn chữ");
  eq(inl("*a* 2*3*4"), [{ t: "em", c: ["a"] }, " 2*3*4"], "phép nhân sau chữ nghiêng đã đóng vẫn giữ nguyên");
  eq(inl("**Giá**100"), [{ t: "strong", c: ["Giá"] }, "100"], "đóng đậm ngay trước số");
  eq(inl("khoảng ~5 phút đến ~10 phút"), ["khoảng ~5 phút đến ~10 phút"], "dấu ~ đơn giữ nguyên");
  eq(inl("**Lưu ý:**tiếp"), [{ t: "strong", c: ["Lưu ý:"] }, "tiếp"], "**Lưu ý:**tiếp vẫn đậm như bản cũ");
  eq(inl("\\*không nhấn\\*"), ["*không nhấn*"], "ký tự thoát");
  eq(inl("**Tiếng Việt có dấu: ắ ằ ẳ ẵ ặ**"), [{ t: "strong", c: ["Tiếng Việt có dấu: ắ ằ ẳ ẵ ặ"] }], "tiếng Việt");
  eq(inl("*việt*nam"), [{ t: "em", c: ["việt"] }, "nam"], "* giữa từ vẫn nhấn như CommonMark");
  ok(M.inlineText(inl("**a** *b* `c` [d](https://x.y) ~~e~~")) === "a b c d e", "chữ thuần khi chép bảng", M.inlineText(inl("**a** *b* `c` [d](https://x.y) ~~e~~")));
  const big = "*a ".repeat(20000); const t0 = Date.now(); inl(big); ok(Date.now() - t0 < 1500, "60 KB dấu sao không làm treo", Date.now() - t0);
}

console.log("4. Link, ảnh, xuống dòng");
{
  eq(inl("xem https://example.com/a_b_c."), ["xem ", { t: "a", href: "https://example.com/a_b_c", c: ["https://example.com/a_b_c"] }, "."], "địa chỉ trần, bỏ dấu chấm cuối");
  eq(inl("(https://en.wikipedia.org/wiki/A_(b))"), ["(", { t: "a", href: "https://en.wikipedia.org/wiki/A_(b)", c: ["https://en.wikipedia.org/wiki/A_(b)"] }, ")"], "ngoặc trong địa chỉ");
  eq(inl("<https://example.org>"), [{ t: "a", href: "https://example.org", c: ["https://example.org"] }], "<địa chỉ>");
  eq(inl("**https://example.com**"), [{ t: "strong", c: [{ t: "a", href: "https://example.com", c: ["https://example.com"] }] }], "địa chỉ trong đậm");
  eq(inl("www.example.com"), [{ t: "a", href: "https://www.example.com", c: ["www.example.com"] }], "www.");
  eq(inl("[chữ](https://a.b \"tiêu đề\")"), [{ t: "a", href: "https://a.b", c: ["chữ"] }], "link có tiêu đề");
  eq(inl("[**đậm**](https://a.b)"), [{ t: "a", href: "https://a.b", c: [{ t: "strong", c: ["đậm"] }] }], "nhấn trong link");
  eq(inl("[Tải video](sandbox:/outputs/x.mp4)"), [{ t: "span", c: ["Tải video"] }], "sandbox:/ chỉ hiện chữ");
  eq(inl("[x](javascript:alert(1))"), [{ t: "span", c: ["x"] }], "javascript: không thành link");
  eq(inl("a<br>b<br/>c"), ["a", { t: "br" }, "b", { t: "br" }, "c"], "<br>");
  eq(inl("<sup>2</sup> <kbd>Ctrl</kbd> <script>x</script>"), [{ t: "sup", c: ["2"] }, " ", { t: "kbd", c: ["Ctrl"] }, " <script>x</script>"], "chỉ thẻ trong danh sách cho phép, thẻ khác là chữ");
  eq(inl("a &amp; b &lt;c&gt; &bogus;"), ["a & b <c> &bogus;"], "thực thể HTML");
  eq(inl("![mèo](https://x.y/a.png)"), [{ t: "img", src: "https://x.y/a.png", alt: "mèo" }], "ảnh");
  ok(M.imageKind("https://evil.test/a.png?d=secret") === "link", "ảnh ngoài không tự tải");
  ok(M.imageKind("/api/outputs/a.png") === "inline" && M.imageKind("data:image/png;base64,AAAA") === "inline", "ảnh của Synchro hiện ngay");
  ok(M.imageKind("data:image/svg+xml;base64,AAAA") === "text" && M.imageKind("sandbox:/a.png") === "text" && M.imageKind("/api/auth/logout") === "text", "còn lại chỉ hiện chú thích");
  eq(inl("`a*b*c` và ``x`y``"), [{ t: "code", v: "a*b*c" }, " và ", { t: "code", v: "x`y" }], "trong code không phân tích");
  eq(inl("```inline```"), [{ t: "code", v: "inline" }], "ba dấu trên một dòng là code nội dòng");
  eq(inl("chú thích[^1]"), ["chú thích", { t: "fn", id: "1" }], "chú thích");
  const b = blocks("Câu[^1]\n\n[^1]: Nguồn");
  ok(b[b.length - 1].t === "fns" && b[b.length - 1].items[0].s === "Nguồn", "định nghĩa chú thích xuống cuối", b);
}

console.log("5. Công thức");
{
  eq(inl("$E = mc^2$"), [{ t: "math", v: "E = mc^2" }], "$…$");
  eq(inl("\\(a^2+b^2\\)"), [{ t: "math", v: "a^2+b^2", display: false }], "\\(…\\)");
  eq(inl("$$x$$"), [{ t: "math", v: "x", display: true }], "$$…$$ nội dòng");
  for (const s of ["giá $5 đến $10", "$5 hoặc 10$ tùy", "US$5 và US$6", "$HOME/bin:$PATH", "tổng $100,$200", "giá $ 5"]) eq(inl(s), [s], "không nhầm tiền: " + s);
  let b = blocks("$$\na^2 + b^2\n= c^2\n$$");
  ok(b[0].t === "math" && b[0].v === "a^2 + b^2\n= c^2", "khối $$ nhiều dòng", b);
  b = blocks("\\[\nx\n\\]\nsau");
  ok(b[0].t === "math" && b[0].v === "x" && b[1].s === "sau", "khối \\[ \\]", b);
  b = blocks("$$ chưa đóng\ncâu sau");
  ok(b[0].t === "p", "$$ không đóng không nuốt phần còn lại", b);
}

console.log("6. Bảng");
{
  let b = blocks("| A | B |\n|:--|--:|\n| 1 | **x**<br>y |\n| `a\\|b` | c |");
  ok(b[0].t === "table" && J(b[0].align) === '["left","right"]' && b[0].rows.length === 2 && b[0].rows[0][1] === "**x**<br>y" && b[0].rows[1][0] === "`a|b`", "căn cột, xuống dòng trong ô, \\|", b);
  b = blocks("A | B\n--|--\n1 | 2");
  ok(b[0].t === "table" && b[0].head[1] === "B" && b[0].rows[0][1] === "2", "bảng không có | ngoài", b);
  b = blocks("| A | B |\n|---|---|\n| 1 | 2");
  ok(b[0].t === "table" && b[0].rows[0][1] === "2", "dòng đang viết chưa có | cuối vẫn thuộc bảng", b);
  ok(blocks("| A |\n|---|\n| `x|y` |")[0].rows[0][0] === "`x|y`", "| trong `code` không chia ô");
  ok(blocks("a | b không phải bảng")[0].t === "p", "chữ có | vẫn là đoạn văn");
}

console.log("7. Khối code và khối riêng");
{
  let b = blocks("```js\nconst a = 1;\n```");
  ok(b[0].t === "code" && b[0].lang === "js" && b[0].code === "const a = 1;" && b[0].closed, "khối thường", b);
  b = blocks("```js\nconst a = **1**;\n\n\n- b\n# c");
  ok(b[0].closed === false && b[0].code === "const a = **1**;\n\n\n- b\n# c", "đang viết dở: giữ nguyên, chưa đóng", b);
  b = blocks("````md\n```js\nx\n```\n````");
  ok(b.length === 1 && b[0].code === "```js\nx\n```", "bốn dấu chứa ba dấu", b);
  b = blocks("```md\n# Tiêu đề\n```js\nx\n```\nsau\n```\nhết");
  ok(b[0].t === "code" && b[0].code === "# Tiêu đề\n```js\nx\n```\nsau" && b[1].s === "hết", "khối lồng cùng độ dài khi viết README", b);
  b = blocks("```\nmột\n```\ngiữa\n```\nhai\n```");
  ok(b.length === 3 && b[0].code === "một" && b[1].s === "giữa" && b[2].code === "hai", "hai khối liền nhau không lồng", b);
  b = blocks("```python\nprint(1)\n```python\nprint(2)\n```");
  ok(b[0].t === "code" && b[0].closed, "dòng mở thừa không làm mất khối", b);
  b = blocks("Mã: ```python\nx = 1\n```\nHết");
  ok(b[0].s === "Mã:" && b[1].t === "code" && b[1].lang === "python" && b[2].s === "Hết", "mở khối giữa dòng (câu trả lời cũ)", b);
  b = blocks("```js\nx()```\nsau");
  ok(b[0].code === "x()" && b[0].closed && b[1].s === "sau", "đóng cuối dòng (câu trả lời cũ) không nuốt phần sau", b);
  b = blocks("Dùng ``` để mở khối code.\nDòng hai.");
  ok(b.length === 1 && b[0].t === "p", "``` trong câu văn không mở khối", b);
  b = blocks('```ask\n{"q":"?"}\n```');
  ok(b[0].lang === "ask" && b[0].closed && b[0].code === '{"q":"?"}', "thẻ hỏi lại", b);
  b = blocks('```chart\n{"a":1}');
  ok(b[0].lang === "chart" && !b[0].closed, "biểu đồ chưa viết xong", b);
  b = blocks("~~~\ncode\n~~~");
  ok(b[0].t === "code" && b[0].code === "code", "~~~", b);
  b = blocks("```python title=x\n\tif a:\n\t\tb\n```");
  ok(b[0].lang === "python" && b[0].code === "\tif a:\n\t\tb", "tab trong code giữ nguyên, tên ngôn ngữ chỉ lấy từ đầu", b);
  b = blocks("```\none\n```\n\n```\ntwo\n```\n");
  ok(b[0].idx === 0 && b[1].idx === 1, "đánh số khối code theo thứ tự", b);
  const arts = "**Trang**\n\n```html\n<!doctype html>\n<p>*không* **phân tích**</p>\n```";
  b = blocks(arts);
  ok(b[0].s === "**Trang**" && b[1].lang === "html" && b[1].code.includes("*không*"), "artifact hiện dạng code giữ nguyên", b);
}

console.log("8. Khối khác");
{
  let b = blocks("# Một\n## Hai ##\n###### Sáu\n#không phải");
  ok(b[0].level === 1 && b[1].level === 2 && b[1].s === "Hai" && b[2].level === 6 && b[3].t === "p", "tiêu đề", b);
  b = blocks("Tiêu đề\n===\nVăn\n---\nsau");
  ok(b[0].t === "h" && b[1].s === "Văn" && b[2].t === "hr", "=== là tiêu đề, --- là đường kẻ", b);
  b = blocks("> a\n> b\n>\n> c\nd");
  ok(b[0].t === "quote" && b[0].c.length === 2 && b[0].c[0].s === "a\nb" && b[1].s === "d", "trích dẫn", b);
  ok(blocks("> > lồng")[0].c[0].t === "quote", "trích dẫn lồng");
  b = blocks("dòng 1\ndòng 2\n\ndòng 3");
  ok(b.length === 2 && b[0].s === "dòng 1\ndòng 2", "xuống dòng trong đoạn giữ nguyên", b);
  ok(J(inl("a\nb")) === '["a",{"t":"br"},"b"]', "xuống dòng thành <br>");
  ok(J(blocks("***\n---\n___\n* * *").map((x) => x.t)) === '["hr","hr","hr","hr"]', "đường kẻ");
  ok(blocks("Một\r\nHai\r\n\r\n- ba\r\n")[1].items[0].c[0].s === "ba", "xuống dòng Windows");
  ok(blocks("").length === 0 && blocks("\n\n  \n").length === 0, "rỗng");
  ok(blocks(">".repeat(2000) + " x").length === 1 && blocks("- ".repeat(2000) + "x").length >= 1, "lồng quá sâu không tràn ngăn xếp");
  const long = "- mục\n".repeat(5000) + "đoạn\n\n".repeat(5000); const t0 = Date.now(); blocks(long); ok(Date.now() - t0 < 1500, "tài liệu dài vẫn nhanh", Date.now() - t0);
}

console.log("9. Câu đang viết dở (chảy chữ)");
{
  const live = (s) => inl(s, { open: true });
  eq(live("**đậm dở"), [{ t: "strong", c: ["đậm dở"] }], "** chưa đóng hiện đậm luôn");
  eq(live("abc **"), ["abc "], "dấu trần cuối câu được giấu");
  eq(live("*ngh"), [{ t: "em", c: ["ngh"] }], "* chưa đóng");
  eq(live("`co"), [{ t: "code", v: "co" }], "` chưa đóng");
  eq(live("~~bỏ"), [{ t: "del", c: ["bỏ"] }], "~~ chưa đóng");
  eq(live("xem [tài liệu](https://exa"), ["xem ", { t: "span", c: ["tài liệu"] }], "link đang viết chỉ hiện chữ");
  eq(live("![ảnh](https://exa"), [], "ảnh đang viết chưa hiện");
  eq(live("**a** và **b"), [{ t: "strong", c: ["a"] }, " và ", { t: "strong", c: ["b"] }], "đoạn trước đã đóng không đổi");
  eq(live("x_y"), ["x_y"], "snake_case đang viết không nghiêng");
  // Mỗi tiền tố của một câu trả lời đều phân tích được, khối đã xong không đổi khi chữ về thêm.
  const full = "# Đề\n\n1. Bước **một**\n   - con *x*\n2. Bước hai\n\n```js\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nHết $x^2$.\n";
  let bad = null, prevSrc = [];
  for (let i = 0; i <= full.length; i++) {
    try {
      const p = full.slice(0, i), { tops } = M.parseMarkdown(p);
      for (const t of tops) if (t.b.t === "p" || t.b.t === "h") inl(t.b.s, { open: true });
      // Tiêu đề xong rồi thì giữ nguyên (TopView nhớ theo chữ gốc).
      if (i > 6 && tops[0]?.src !== "# Đề") bad = bad ?? { i, src: tops[0]?.src };
      prevSrc = tops;
    } catch (e) { bad = { i, e: String(e) }; break; }
  }
  ok(!bad, "mọi tiền tố đều phân tích được, khối đầu ổn định", bad);
  const end = M.parseMarkdown(full).tops.map((t) => t.b.t);
  ok(J(end) === '["h","list","code","table","p"]' && prevSrc.length === 5, "kết quả cuối đúng cấu trúc", end);
}

console.log("10. Ngoặc thoát không phải công thức");
{
  const mathOf = (t) => inl(t).filter((x) => x.t === "math").map((x) => x.v);
  eq(inl("Kính gửi \\[Tên khách hàng\\], cảm ơn \\[Công ty\\]"), ["Kính gửi [Tên khách hàng], cảm ơn [Công ty]"], "mẫu thư giữ nguyên chữ trong ngoặc");
  eq(inl("regex: ^\\[a-z\\]+$"), ["regex: ^[a-z]+$"], "lớp ký tự của regex");
  eq(inl("\\[^abc\\] và \\[0-9\\] và \\[A-Za-z\\]"), ["[^abc] và [0-9] và [A-Za-z]"], "regex phủ định, khoảng số, nhiều khoảng");
  eq(inl("xem \\[1\\] và \\[2\\]"), ["xem [1] và [2]"], "trích dẫn thoát ngoặc");
  eq(inl("(\\(ví dụ\\)) và \\(note\\)"), ["((ví dụ)) và (note)"], "chữ thường trong \\( \\)");
  for (const [t, v] of [["\\(x\\)", "x"], ["\\(f(x)\\)", "f(x)"], ["\\(x, y\\)", "x, y"], ["\\(O(n)\\)", "O(n)"], ["\\(a^2+b^2\\)", "a^2+b^2"], ["\\[ E = mc^2 \\]", "E = mc^2"], ["\\[\\frac{a}{b}\\]", "\\frac{a}{b}"], ["\\[y = mx + b\\]", "y = mx + b"], ["\\[x_1\\]", "x_1"], ["\\[\\text{Tên khách}\\]", "\\text{Tên khách}"]]) eq(mathOf("a " + t + " b"), [v], "vẫn là công thức: " + t);
  let b = blocks("\\[Tên khách hàng\\]\n\nsau");
  ok(b[0].t === "p" && J(inl(b[0].s)) === '["[Tên khách hàng]"]', "đứng riêng một dòng vẫn là chữ", b);
  b = blocks("\\[\nE = mc^2\n\\]");
  ok(b[0].t === "math", "khối nhiều dòng vẫn là công thức", b);
  b = blocks("\\[\nGhi chú của người viết\n\\]");
  ok(b[0].t === "p", "khối nhiều dòng chỉ có chữ thì không", b);
  eq(mathOf("$$Tên$$"), ["Tên"], "$$ vẫn giữ nghĩa công thức");
}

console.log("11. Mở khối code giữa dòng trong danh sách");
{
  let b = blocks("1. Run: ```bash\nnpm i\n```\n2. Next\n\nEnd paragraph");
  ok(b.length === 2 && b[0].t === "list" && b[0].items.length === 2, "hai bước rồi một đoạn văn", b);
  ok(b[0].items[0].c[0].s === "Run:" && b[0].items[0].c[1]?.t === "code" && b[0].items[0].c[1].lang === "bash" && b[0].items[0].c[1].code === "npm i" && b[0].items[0].c[1].closed, "code nằm trong bước, đóng đúng", b[0].items[0]);
  ok(b[0].items[1].c[0].s === "Next" && b[1].t === "p" && b[1].s === "End paragraph", "phần sau không bị nuốt vào khối code", b);
  b = blocks("- Mã: ```js\n  const a = 1;\n  ```\n- Tiếp");
  ok(b.length === 1 && b[0].items.length === 2 && b[0].items[0].c[1]?.code === "const a = 1;", "dòng code thụt", b);
  b = blocks("- A\n  Chạy: ```bash\n  ls\n  ```\n- B");
  ok(b.length === 1 && b[0].items.length === 2 && b[0].items[0].c[1]?.t === "code" && b[0].items[0].c[1].code === "ls", "mở ở dòng tiếp theo của mục", b);
  b = blocks("- A\nchạy: ```bash\nls\n```\n- B");
  ok(b.length === 1 && b[0].items.length === 2 && b[0].items[0].c.some((x) => x.t === "code" && x.code === "ls"), "mở ở dòng tiếp không thụt", b);
  b = blocks("- Bọc mã bằng ```\n- Hết");
  ok(b.length === 1 && b[0].items.length === 2, "``` cuối câu không có khối nào theo sau thì không mở", b);
  b = blocks("1. Run: ```bash\nnpm i");
  ok(b[0].t === "list" && b[0].items[0].c[1]?.t === "code" && !b[0].items[0].c[1].closed && b[0].items[0].c[1].code === "npm i", "đang chảy chữ: khối code chưa đóng", b);
  ok(blocks("Mã: ```python\nprint(1)\n```\nHết").map((x) => x.t).join() === "p,code,p", "giữa dòng ngoài danh sách vẫn đúng");
}

console.log("12. Câu sau danh sách");
{
  let b = blocks("- a\n- b\nTiếp theo là phần khác.");
  ok(b.length === 2 && b[0].items.length === 2 && b[0].items[1].c[0].s === "b" && b[1].t === "p" && b[1].s === "Tiếp theo là phần khác.", "câu mới không dính vào gạch đầu dòng cuối", b);
  b = blocks("1. một\n2. hai\nKết luận cuối bài.");
  ok(b[1]?.t === "p" && b[1].s === "Kết luận cuối bài." && b[0].items.length === 2, "danh sách số cũng vậy", b);
  b = blocks("- a\nTiếp của a\n- b");
  ok(b.length === 1 && b[0].items.length === 2 && b[0].items[0].c[0].s === "a\nTiếp của a", "còn mục sau thì vẫn là dòng tiếp", b);
  b = blocks("- một câu rất dài bị\nngắt dòng cứng ở giữa");
  ok(b.length === 1 && b[0].items[0].c[0].s === "một câu rất dài bị\nngắt dòng cứng ở giữa", "chữ thường là văn ngắt dòng cứng", b);
  b = blocks("- a\nCác việc khác:\n- b");
  ok(b.length === 3 && b[1].t === "p" && b[2].t === "list", "câu dẫn kết thúc bằng hai chấm mở danh sách mới", b);
  b = blocks("- a\n  - con\nCâu sau");
  ok(b.length === 2 && b[1].s === "Câu sau", "sau danh sách con cũng vậy", b);
  b = blocks("- a\nCâu một\nCâu hai");
  ok(b.length === 2 && b[1].s === "Câu một\nCâu hai", "đoạn nhiều dòng sau danh sách đi cùng nhau", b);
}

console.log("13. Dấu sao trong công thức viết thẳng");
{
  eq(inl("5*x; x*5"), ["5*x; x*5"], "5*x; x*5 giữ dấu sao");
  eq(inl("2*x + 3*y = z"), ["2*x + 3*y = z"], "biến và hệ số");
  eq(inl("(a+b)*c*d"), ["(a+b)*c*d"], "sau ngoặc đóng");
  eq(inl("a*b*c"), ["a*b*c"], "ba thừa số");
  eq(inl("*nghiêng* và x*y"), [{ t: "em", c: ["nghiêng"] }, " và x*y"], "nhấn thật đi cùng phép nhân");
  eq(inl("*x*y"), [{ t: "em", c: ["x"] }, "y"], "dấu mở ở đầu từ vẫn đóng được giữa từ");
  eq(inl("Từ **đậm**tiếp"), ["Từ ", { t: "strong", c: ["đậm"] }, "tiếp"], "hai sao vẫn là đậm");
  eq(inl("đang *viết", { open: true }), ["đang ", { t: "em", c: ["viết"] }], "đang chảy chữ vẫn nghiêng được");
  eq(inl("x*y", { open: true }), ["x*y"], "đang chảy chữ không nghiêng phép nhân");
}

console.log("14. Khối code xuống dòng hay cuộn ngang");
{
  const tree = "src/\n├── app/\n│   └── page.tsx\n└── README.md";
  ok(!M.codeWraps("", tree) && !M.codeWraps("", "a b c ".repeat(40)), "không nhãn: cuộn ngang, không xuống dòng");
  ok(!M.codeWraps("text", tree), "cây thư mục dán nhãn text vẫn cuộn");
  ok(!M.codeWraps("text", "+---+---+\n| a | b |\n+---+---+"), "bảng ASCII dán nhãn text vẫn cuộn");
  ok(!M.codeWraps("output", "name     size\nfoo.ts   12"), "đầu ra căn cột vẫn cuộn");
  ok(!M.codeWraps("js", "const a = 1;"), "mã có ngôn ngữ cuộn");
  ok(M.codeWraps("log", "Error: something failed " + "x".repeat(200)) && M.codeWraps("stdout", "done") && M.codeWraps("Text", "câu dài"), "nhật ký, đầu ra thường xuống dòng");
}

console.log("Đang viết: ẩn tạm công thức / bảng còn dở (streamSafe)");
{
  const S = M.streamSafe;
  eq(S("Công thức:\n\n$$\nx^2 +"), "Công thức:\n", "$$ chưa đóng: ẩn tới khi đóng");
  eq(S("Công thức:\n\n$$\nx^2\n$$\nXong"), "Công thức:\n\n$$\nx^2\n$$\nXong", "$$ đã đóng: giữ nguyên");
  eq(S("A\n$$x^2$$\nB"), "A\n$$x^2$$\nB", "$$ một dòng: giữ nguyên");
  eq(S("Bảng:\n\n| Tên | Tuổi |"), "Bảng:\n", "bảng mới có tiêu đề: ẩn dòng tiêu đề");
  eq(S("Bảng:\n| Tên | Tuổi |\n|---|--"), "Bảng:", "dòng phân cách chưa xong: vẫn ẩn");
  eq(S("| Tên | Tuổi |\n|---|---|\n| An | 3"), "| Tên | Tuổi |\n|---|---|\n| An | 3", "bảng đã có dòng phân cách: hiện từng dòng");
  eq(S("```js\nconst a = '$$'\n$$"), "```js\nconst a = '$$'\n$$", "trong khối code đang mở: không cắt");
  eq(S("Chào bạn"), "Chào bạn", "chữ thường: giữ nguyên");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
if (fail) process.exit(1);
