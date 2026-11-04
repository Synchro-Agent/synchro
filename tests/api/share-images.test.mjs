// Bản chia sẻ: ảnh ngoài trong artifact được nhúng vào bản chụp để người xem chưa đăng nhập vẫn thấy; ảnh không nhúng được thì báo, bản chụp cũ được nhúng khi mở lần đầu. Không cần máy chủ Synchro.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-shareimg-"));
process.env.DATA_DIR = tmp; process.env.MCP_ALLOW_PRIVATE = "1";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let hits = 0;
const srv = http.createServer((q, s) => {
  hits++;
  if (q.url.startsWith("/ok")) { s.writeHead(200, { "content-type": "image/png" }); s.end(PNG); }
  else if (q.url.startsWith("/big")) { s.writeHead(200, { "content-type": "image/png" }); s.end(Buffer.alloc(3 * 1048576, 1)); }
  else if (q.url.startsWith("/html")) { s.writeHead(200, { "content-type": "text/html" }); s.end("<script>alert(1)</script>"); }
  else { s.writeHead(404); s.end(); }
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const B = `http://127.0.0.1:${srv.address().port}`;
const { sharestore: S, authstore: AS } = await loadTs(["sharestore", "authstore"]);
const u = AS.createUser({ email: "share@img.test", name: "S", verified: true });
const msgs = (html) => [{ role: "user", text: "làm trang" }, { role: "ai", text: `Đây:\n<artifact identifier="p" type="html" title="Trang">${html}</artifact>` }];
const art = (snap) => snap.msgs.flatMap((m) => m.segs).find((x) => x.k === "art")?.content ?? "";
try {
  console.log("1. Tạo bản chia sẻ");
  let r = await S.putShare(u.id, "c1", "Có ảnh", msgs(`<img src="${B}/ok.png"><div style="background:url(${B}/ok2.png)"></div>`));
  let v = S.publicShare(r.token);
  ok(r.missingImages === 0 && v.snap.imgs?.missing === 0, "không thiếu ảnh nào", r);
  ok(art(v.snap).includes("data:image/png;base64,") && !art(v.snap).includes(B), "ảnh đã nhúng, không còn URL ngoài", art(v.snap).slice(0, 200));
  r = await S.putShare(u.id, "c2", "Có ảnh hỏng", msgs(`<img src="${B}/ok.png"><img src="${B}/nope.png"><img src="${B}/big.png"><img src="${B}/html.png">`));
  v = S.publicShare(r.token);
  ok(r.missingImages === 3 && v.snap.imgs?.missing === 3, "ảnh lỗi, quá lớn, không phải ảnh: báo thiếu đúng số", r);
  ok(art(v.snap).includes(`${B}/nope.png`) && !art(v.snap).includes("alert(1)"), "giữ nguyên URL ảnh lỗi, không nhúng nội dung không phải ảnh");
  r = await S.putShare(u.id, "c3", "Không ảnh", msgs("<p>không có ảnh</p>"));
  ok(r.missingImages === 0 && S.publicShare(r.token).snap.imgs, "không có ảnh: vẫn đánh dấu đã xử lý");
  const before = S.shareOfConv(u.id, "c1").token;
  r = await S.putShare(u.id, "c1", "Cập nhật", msgs("<p>mới</p>"));
  ok(r.token === before, "cập nhật giữ nguyên địa chỉ");
  let e = null; await S.putShare(u.id, "c4", "Rỗng", []).catch((x) => { e = x; });
  ok(e?.status === 400, "chưa có nội dung: vẫn báo 400", e?.message);
  e = null; await S.putShare(u.id, "c5", "Lớn", Array.from({ length: 30 }, () => ({ role: "user", text: "x".repeat(300_000) }))).catch((x) => { e = x; });
  ok(e?.status === 413, "chữ quá lớn: 413, không tải ảnh", e?.message);

  console.log("2. Bản chụp cũ");
  const legacy = JSON.stringify({ title: "Cũ", msgs: [{ r: "a", segs: [{ k: "art", title: "T", type: "html", lang: null, content: `<img src="${B}/ok.png?v=old">` }] }] });
  AS.db().prepare("INSERT INTO shares (token, user_id, conv, title, snap, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("legacy-token-000000000000", u.id, "c9", "Cũ", legacy, legacy.length, 1000, 2000);
  const shown = await S.shareForView("legacy-token-000000000000");
  ok(art(shown.snap).includes("data:image/png") && shown.at === 2000, "mở lần đầu: nhúng ảnh, giữ mốc thời gian của bản chụp", shown);
  const n = hits;
  const again = await S.shareForView("legacy-token-000000000000");
  ok(hits === n && art(again.snap).includes("data:image/png"), "lần sau không tải lại");
  ok((await S.shareForView("khong-co-token-nay-000000")) === null, "mã lạ: không có gì");
} finally { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
