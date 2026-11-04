// Xuất tài liệu Markdown thành tệp Word thật và nhúng font khi xuất PNG. Hàm thuần chạy không cần máy chủ; API chạy khi có bản giả lập ở cổng 3200.
import { createRequire } from "node:module";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const R = createRequire(path.join(process.cwd(), "package.json"));
const JSZip = R("jszip"), sharp = R("sharp");
const { mddocx: M, artfonts: F } = await loadTs(["mddocx", "artfonts"]);

console.log("1. Tệp Word thật");
const png = (await sharp({ create: { width: 1200, height: 600, channels: 3, background: "#28a" } }).png().toBuffer()).toString("base64");
const webp = (await sharp({ create: { width: 100, height: 50, channels: 3, background: "#a28" } }).webp().toBuffer()).toString("base64");
const blocks = [
  { k: "h", level: 1, runs: [{ t: "Tiêu đề Việt" }] }, { k: "h", level: 2, runs: [{ t: "Mục" }] },
  { k: "p", runs: [{ t: "Đoạn " }, { t: "đậm", b: 1 }, { t: "nghiêng", i: 1 }, { t: "gạch", s: 1 }, { t: "mã", code: 1 }, { t: "link", href: "https://a.vn/x" }, { t: "xấu", href: "javascript:alert(1)" }, { t: "", br: 1 }] },
  { k: "li", ordered: false, level: 0, list: 1, runs: [{ t: "Chấm" }] }, { k: "li", ordered: false, level: 1, list: 1, runs: [{ t: "Chấm con" }] },
  { k: "li", ordered: true, level: 0, list: 2, runs: [{ t: "Số một" }] }, { k: "li", ordered: true, level: 0, list: 3, runs: [{ t: "Số khác" }] },
  { k: "quote", runs: [{ t: "Trích" }] }, { k: "code", text: "a = 1\nb = 2" }, { k: "hr" },
  { k: "table", rows: [{ head: true, cells: [[{ t: "Cột 1" }], [{ t: "Cột 2" }]] }, { head: false, cells: [[{ t: "x" }]] }] },
  { k: "img", src: `data:image/png;base64,${png}` }, { k: "img", src: `data:image/webp;base64,${webp}` },
  { k: "img", src: "https://ngoai.example/a.png", alt: "Ảnh không lấy được" }, { k: "khong-biet" }, null,
];
const buf = await M.blocksToDocx(blocks, "Tài liệu thử");
ok(buf.subarray(0, 2).toString() === "PK", "là tệp zip (.docx)");
const z = await JSZip.loadAsync(buf);
const doc = await z.file("word/document.xml").async("string");
ok(!!z.file("[Content_Types].xml") && !!z.file("word/styles.xml") && !!z.file("word/numbering.xml"), "đủ các phần của tệp Word");
ok(/w:val="Heading1"/.test(doc) && /w:val="Heading2"/.test(doc) && /Tiêu đề Việt/.test(doc), "tiêu đề đúng kiểu Heading, tiếng Việt nguyên vẹn");
ok(/<w:b\/>[\s\S]*đậm/.test(doc) && /<w:i\/>[\s\S]*nghiêng/.test(doc) && /<w:strike\/>[\s\S]*gạch/.test(doc) && /Consolas[\s\S]*mã/.test(doc), "đậm, nghiêng, gạch, mã");
const rels = await z.file("word/_rels/document.xml.rels").async("string");
ok(/https:\/\/a\.vn\/x/.test(rels) && /w:hyperlink/.test(doc) && !/javascript:/.test(rels + doc), "liên kết http giữ lại, javascript: bị bỏ", rels);
const num = [...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
ok(new Set(num.slice(-2)).size === 2, "hai danh sách số là hai danh sách riêng", num.join());
ok(/<w:tbl>/.test(doc) && /w:tblHeader/.test(doc) && (doc.match(/<w:tc>/g) ?? []).length === 4, "bảng đủ ô, dòng ngắn được bù cho đều, có dòng tiêu đề");
const media = Object.keys(z.files).filter((n) => /^word\/media\/.+\.png$/.test(n));
ok(media.length === 2 && /Ảnh không lấy được/.test(doc), "ảnh nhúng vào tệp; ảnh ngoài không nhúng được thì giữ chú thích", media.join());
const ext = [...doc.matchAll(/<wp:extent cx="(\d+)"/g)].map((m) => Math.round(+m[1] / 9525));
ok(ext[0] === 600 && ext[1] === 100, "ảnh rộng hơn vùng chữ được thu lại", ext.join());
ok(/w:w="11906"/.test(doc) && /w:h="16838"/.test(doc), "khổ A4");
const empty = await JSZip.loadAsync(await M.blocksToDocx([], "x"));
ok(!!empty.file("word/document.xml"), "tài liệu rỗng vẫn tạo được tệp");

console.log("2. Nhúng font khi xuất PNG");
const css = `/* vietnamese */\n@font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/s/inter/vi.woff2) format('woff2'); unicode-range: U+0102-0103, U+1EA0-1EF9; }\n/* cyrillic */\n@font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/s/inter/cy.woff2) format('woff2'); unicode-range: U+0400-045F; }\n/* latin */\n@font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/s/inter/la.woff2) format('woff2'); unicode-range: U+0000-00FF; }\n`;
const asked = [];
const fake = async (u) => { asked.push(String(u)); if (String(u).includes("googleapis")) return new Response(css); if (String(u).endsWith("hong.woff2")) return new Response("", { status: 404 }); return new Response(new Uint8Array([1, 2, 3])); };
const page = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap" rel="stylesheet"><p>Xin chào thế giới ạ</p>`;
const out = await F.fontEmbedCss(page, fake);
ok(asked[0] === "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap", "đọc đúng địa chỉ font của trang", asked[0]);
ok(/data:font\/woff2;base64,AQID/.test(out) && !/gstatic/.test(out), "font nhúng thành data:, không còn địa chỉ ngoài", out.slice(0, 200));
ok(asked.some((u) => u.endsWith("vi.woff2")) && asked.some((u) => u.endsWith("la.woff2")) && !asked.some((u) => u.endsWith("cy.woff2")), "chỉ tải phần font có ký tự trang dùng", asked.join());
ok((await F.fontEmbedCss("<p>không có font ngoài</p>", async () => { throw new Error("không được gọi"); })) === "", "trang không dùng font ngoài: không gọi mạng");
ok((await F.fontEmbedCss(page, async () => { throw new Error("mất mạng"); })) === "", "mất mạng: trả rỗng, ảnh vẫn xuất được");
const partial = await F.fontEmbedCss(`<style>@font-face{font-family:A;src:url(https://fonts.gstatic.com/hong.woff2)}@font-face{font-family:B;src:url(https://fonts.gstatic.com/tot.woff2)}</style>`, fake);
ok(/font-family:B/.test(partial) && !/font-family:A/.test(partial), "một font lỗi không làm mất các font khác", partial);

console.log("3. API");
const B = "http://localhost:3200";
const up = process.env.SYNCHRO_SKIP_API ? null : await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) }).catch(() => null);
const cookie = process.env.SYNCHRO_SKIP_API ? null : process.env.SYNCHRO_ADMIN_COOKIE ?? (up?.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0];
if (cookie) {
  const post = (body, c = cookie, h = {}) => fetch(B + "/api/mddocx", { method: "POST", headers: { "content-type": "application/json", origin: B, ...(c ? { cookie: c } : {}), ...h }, body: JSON.stringify(body) });
  const r = await post({ blocks: [{ k: "p", runs: [{ t: "chào" }] }], title: "x" });
  const b = Buffer.from(await r.arrayBuffer());
  ok(r.status === 200 && b.subarray(0, 2).toString() === "PK" && /wordprocessingml/.test(r.headers.get("content-type") ?? ""), "API trả tệp .docx", r.status);
  ok((await post({ blocks: "x" })).status === 400, "thiếu nội dung: 400");
  ok((await post({ blocks: [] }, "")).status === 401, "chưa đăng nhập: 401");
} else console.log("  (bỏ qua: không có máy chủ giả lập)");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
