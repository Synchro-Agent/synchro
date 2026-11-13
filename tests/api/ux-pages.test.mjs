// Trang 404 có thương hiệu, bộ nhớ đệm của phông chữ và biểu tượng, lượt hỏi định kỳ của Mức dùng. Cần npm run dev:mock đang chạy.
const B = process.env.BASE ?? "http://localhost:3200";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };

const nf = await fetch(`${B}/khong-co-trang-nay-${Date.now()}`, { headers: { accept: "text/html" } });
const html = await nf.text();
ok(nf.status === 404, "địa chỉ sai trả 404", nf.status);
ok(html.includes("err-page") && html.includes("Không tìm thấy trang này"), "trang 404 của Synchro, không phải trang mặc định", html.slice(0, 200));
ok(/href="\/"/.test(html), "có đường về trang chủ");

const font = await fetch(`${B}/fonts/BeVietnamPro-Regular.woff2`);
ok(font.ok && /max-age=31536000/.test(font.headers.get("cache-control") ?? ""), "phông chữ giữ một năm", font.headers.get("cache-control"));
const lic = await fetch(`${B}/fonts/OFL-BeVietnamPro.txt`);
ok(lic.ok && /SIL Open Font License/.test(await lic.text()), "giấy phép OFL của Be Vietnam Pro đi kèm phông");
ok((await fetch(`${B}/fonts/AnthropicSans-Variable.woff2`)).status === 404, "không còn phông Anthropic Sans");
// Logo, bộ đọc cú pháp tree-sitter, phim giới thiệu (B3.6): giữ một tuần như biểu tượng.
for (const p of ["/icon-192.png", "/icon-maskable-512.png", "/logos/ai2.svg", "/ts/tree-sitter-python.wasm", "/intro/synchro-intro-poster.jpg"]) {
  const r = await fetch(B + p);
  ok(r.ok && /max-age=604800/.test(r.headers.get("cache-control") ?? ""), `${p} giữ một tuần`, r.headers.get("cache-control"));
}
const home = await (await fetch(B, { headers: { accept: "text/html" } })).text();
ok(html.includes("rel=\"preload\"") && home.includes("BeVietnamPro-Regular.woff2"), "tải sớm phông chữ chính");
ok(home.includes('class="boot"'), "trang đầu có khung app, không phải khung trắng");

// Chưa đăng nhập: Mức dùng trả lỗi JSON, không làm sập gì; đăng nhập được kiểm ở tests/ui/ux-states.mjs.
const u = await fetch(`${B}/api/usage/details?tz=0`);
ok(u.status === 401 && typeof (await u.json()).error === "string", "lỗi của Mức dùng là JSON có error");

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
