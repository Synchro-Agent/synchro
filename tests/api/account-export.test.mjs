// Tải dữ liệu từ máy chủ, trần credit giọng nói mỗi ngày, báo cáo CSP chạy thử, ảnh đại diện có đường dẫn riêng. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-export-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "export-key"; process.env.ADMIN_EMAILS = "boss@export.test";
const CACHE = path.join(process.cwd(), ".cache", "files");
fs.mkdirSync(CACHE, { recursive: true });
const m = await loadTs(["authstore", "chatstore", "artifactstore", "memory", "codestore", "speechapi", "ops", "fileproc/owners", "api/auth/account/export/route", "api/auth/avatar/route", "api/csp-report/route", "api/files/mine/route"]);
const { authstore: AS, chatstore: CS, artifactstore: ART, memory: MEM, codestore: CODE, speechapi: SP, ops: OPS, "fileproc/owners": OWN, "api/auth/account/export/route": EX, "api/auth/avatar/route": AV, "api/csp-report/route": CSP, "api/files/mine/route": FR } = m;
const B = "http://localhost:3200";
const u = AS.createUser({ email: "a@export.test", name: "A", verified: true, passwordHash: "bí-mật-băm" }), v = AS.createUser({ email: "b@export.test", name: "B", verified: true }), boss = AS.createUser({ email: "boss@export.test", name: "Boss", verified: true });
const req = (p, cookie, init = {}) => new Request(B + p, { headers: { origin: B, host: "localhost:3200", cookie, "user-agent": "t", "x-forwarded-for": "9.9.9.9" }, ...init });
const cookieOf = (x) => AS.createSession(x, req("/", ""), "password").split(";")[0];
const ca = cookieOf(u), cb = cookieOf(v), cz = cookieOf(boss);
const fid = "a".repeat(40);
try {
  console.log("1. Tải dữ liệu từ máy chủ");
  CS.pushItems(u.id, [{ kind: "chat", id: "1", upd: Date.now(), data: JSON.stringify({ id: 1, title: "Chat một", msgs: [{ role: "user", text: "xin chào" }] }) }, { kind: "project", id: "2", upd: Date.now(), data: JSON.stringify({ id: 2, name: "Dự án" }) }, { kind: "chat", id: "3", upd: Date.now(), data: JSON.stringify({ id: 3, title: "Sẽ xóa", msgs: [] }) }]);
  CS.pushItems(u.id, [{ kind: "chat", id: "3", upd: Date.now() + 1, deleted: true }]);
  CS.pushItems(v.id, [{ kind: "chat", id: "9", upd: Date.now(), data: JSON.stringify({ id: 9, title: "Của người khác", msgs: [] }) }]);
  ART.saveArtifact(u.id, "1", { ident: "a", title: "Bài", type: "html", content: "<p>bản đầy đủ</p>" });
  MEM.addMemory(u.id, ["Thích trà gừng"]);
  CODE.putSession(u.id, 7, { title: "Phiên Code riêng", data: { nodes: [] } });
  let r = await EX.GET(req("/api/auth/account/export", ca));
  ok(r.status === 200 && /attachment/.test(r.headers.get("content-disposition")), "tải về thành tệp đính kèm", r.status);
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { ok(false, "JSON hợp lệ", String(e)); }
  ok(j?.profile?.email === u.email && j.chats.length === 1 && j.chats[0].title === "Chat một" && j.projects.length === 1, "có hồ sơ, đoạn chat, dự án; không có đoạn chat đã xóa", j);
  ok(j?.artifacts?.[0]?.versions?.[0]?.content === "<p>bản đầy đủ</p>", "artifact đủ nội dung", j?.artifacts);
  ok(!text.includes("Của người khác"), "không lẫn dữ liệu người khác");
  ok(j?.memory?.some((x) => x.content === "Thích trà gừng") && j?.codeSessions?.some((s) => s.title === "Phiên Code riêng"), "có bộ nhớ và phiên Code đã lưu", j?.codeSessions);
  // Kết quả Autopilot vẫn ở khóa "inbox" như tệp tải trước khi đổi tên.
  const keys = ["memory", "codeSessions", "apps", "appData", "appComments", "skills", "plugins", "inbox", "generatedFiles",
    "speechItems", "instructionsHistory", "notIncluded"];
  for (const k of keys) ok(Array.isArray(j?.[k]), `có mục ${k}`, j?.[k]);
  ok(!text.includes("bí-mật-băm") && !/password_hash|enc_auth/.test(text), "không có mật khẩu băm hay token");
  ok((await EX.GET(req("/api/auth/account/export", ""))).status === 401, "cần đăng nhập");

  console.log("2. Tải một tệp đã tải lên");
  fs.writeFileSync(path.join(CACHE, fid + ".bin"), "<script>nội dung</script>"); fs.writeFileSync(path.join(CACHE, fid + ".json"), "{}");
  OWN.claimFile(u.id, fid, 25, "hợp đồng.html");
  r = await FR.GET(req(`/api/files/mine?download=${fid}`, ca));
  ok(r.status === 200 && (await r.text()).includes("nội dung") && r.headers.get("content-type") === "application/octet-stream", "tải được tệp gốc", r.status);
  ok(/attachment; filename\*=UTF-8''h%E1%BB%A3p/.test(r.headers.get("content-disposition")) && /sandbox/.test(r.headers.get("content-security-policy")), "luôn là tệp đính kèm, có sandbox, giữ tên", r.headers.get("content-disposition"));
  ok((await FR.GET(req(`/api/files/mine?download=${fid}`, cb))).status === 404, "người khác không tải được");
  ok((await FR.GET(req(`/api/files/mine?download=../../x`, ca))).status === 404, "mã lạ: không thoát thư mục");

  // Trần giọng nói theo ngày: xem speech-budget.test.mjs.

  console.log("4. Báo cáo CSP");
  const report = { "csp-report": { "document-uri": `${B}/share/ma-bi-mat?x=1`, "blocked-uri": "https://evil.example/a.js?token=abc", "effective-directive": "script-src-elem", "violated-directive": "script-src" } };
  r = await CSP.POST(req("/api/csp-report", "", { method: "POST", body: JSON.stringify(report) }));
  ok(r.status === 204, "nhận báo cáo, không trả nội dung", r.status);
  const seen = OPS.opsSnapshot().csp;
  ok(seen.length === 1 && seen[0].detail.includes("https://evil.example") && !seen[0].detail.includes("abc") && !seen[0].detail.includes("x=1"), "chỉ giữ nguồn và đường dẫn, không giữ truy vấn", seen);
  r = await CSP.POST(req("/api/csp-report", "", { method: "POST", body: "không phải JSON" }));
  ok(r.status === 204, "nội dung lạ: bỏ qua");
  for (let i = 0; i < 40; i++) await CSP.POST(req("/api/csp-report", "", { method: "POST", body: JSON.stringify(report) }));
  ok(OPS.opsSnapshot().csp[0].n <= 30, "giới hạn theo IP", OPS.opsSnapshot().csp[0].n);

  console.log("5. Ảnh đại diện");
  const data = "data:image/png;base64,iVBORw0KGgo=";
  AS.db().prepare("UPDATE users SET avatar = ? WHERE id = ?").run(data, u.id);
  const pub = AS.publicUser(AS.getUser(u.id));
  ok(pub.avatar?.startsWith("/api/auth/avatar?u=") && !pub.avatar.includes("base64"), "/api/auth/me chỉ trả đường dẫn", pub.avatar);
  r = await AV.GET(req(pub.avatar, ca));
  ok(r.status === 200 && r.headers.get("content-type") === "image/png" && /immutable/.test(r.headers.get("cache-control")) && /private/.test(r.headers.get("cache-control")), "chính chủ xem được, nhớ lâu trong trình duyệt riêng", r.status);
  ok((await AV.GET(req(pub.avatar, cb))).status === 404, "người khác không xem được");
  ok((await AV.GET(req(pub.avatar, cz))).status === 200, "quản trị viên xem được (danh sách người dùng)");
  AS.db().prepare("UPDATE users SET avatar = ? WHERE id = ?").run("data:image/png;base64,iVBORw0KGgoAAAA=", u.id);
  ok(AS.publicUser(AS.getUser(u.id)).avatar !== pub.avatar, "đổi ảnh thì đổi đường dẫn");
  AS.db().prepare("UPDATE users SET avatar = ? WHERE id = ?").run("https://x.test/a.png", u.id);
  ok(AS.publicUser(AS.getUser(u.id)).avatar === "https://x.test/a.png", "ảnh từ Google, GitHub giữ nguyên địa chỉ");
} finally {
  for (const x of [".bin", ".json"]) fs.rmSync(path.join(CACHE, fid + x), { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
