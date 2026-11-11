// Composio, connector chính của mọi tài khoản: khóa do quản trị viên nhập, mỗi người một phiên Tool Router tạo một lần rồi dùng lại,
// khóa không bao giờ ra khỏi máy chủ, thiếu khóa thì báo rõ, Connect Link thành nút, quyền công cụ đọc / ghi, ngắt ứng dụng.
// Tự chạy được, không cần dev:mock: thư mục dữ liệu riêng và Composio giả lập (scripts/mock-composio.mjs) chạy ngay trong tệp này.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
import { COMPOSIO_KEY, CX, composioHandler } from "../../scripts/mock-composio.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const d of req) raw += d;
  let b = {};
  try { b = raw ? JSON.parse(raw) : {}; } catch {}
  const p = new URL(req.url, "http://x").pathname;
  if (!(await composioHandler(req, res, p, b))) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-composio-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "composio-test-key";
process.env.MCP_ALLOW_PRIVATE = "1";
process.env.COMPOSIO_BASE_URL = `${BASE}/composio/api/v3.1`;
delete process.env.COMPOSIO_API_KEY;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { connectors: C, composio: X, providers: PR, catalog: CAT, authstore: AS } = await loadTs(["connectors", "composio", "providers", "catalog", "authstore"]);
const db = AS.db;
const A = "u_alice", Bo = "u_bob";
const leaks = (o) => JSON.stringify(o).includes(COMPOSIO_KEY);
const ses = () => CX.sessions.size;

try {
  console.log("1. Chưa có khóa");
  ok(X.composioKey() === null, "không có khóa");
  ok(await C.ensureComposio(A) === "no_key", "trạng thái no_key rõ ràng, không tạo gì");
  ok(ses() === 0 && C.composioConnector(A) === null, "không gọi Composio, không tạo hàng");
  ok(new C.ConnectorSession(A, { pol: CAT.FULL_CONN }).tools.length === 0, "lượt chat không có công cụ Composio");
  ok(await C.ensureComposio(A, { custom: true, allowed: [], destructive: true }) === "no_key", "thiếu khóa được báo trước cả khi bị chặn");

  console.log("2. Quản trị viên thêm khóa (kiểm tra với Composio trước khi lưu)");
  let threw = "";
  try { await PR.saveProvider({ id: "composio", key: "ak_wrong_key" }); } catch (e) { threw = e.message; }
  ok(/401|không hợp lệ/i.test(threw) && X.composioKey() === null, "khóa sai bị từ chối, không lưu", threw);
  const saved = await PR.saveProvider({ id: "composio", key: COMPOSIO_KEY });
  ok(saved.id === "composio" && X.composioKey()?.key === COMPOSIO_KEY, "khóa đúng được lưu (mã hóa)");
  const adm = await PR.adminList();
  const row = adm.find((p) => p.id === "composio");
  ok(row?.configured && !leaks(adm) && row.keyHint && !row.keyHint.includes(COMPOSIO_KEY), "trang quản trị chỉ thấy khóa dạng che", row?.keyHint);
  ok(!(await PR.catalog()).some((p) => p.id === "composio") && !PR.hasSharedChat(), "Composio không phải nhà cung cấp model chat");

  console.log("3. Phiên tạo một lần cho mỗi người, dùng lại");
  ok(await C.ensureComposio(A) === "active", "Alice: active", JSON.stringify(C.composioConnector(A)));
  ok(ses() === 1 && [...CX.sessions.values()][0].user_id === A && [...CX.sessions.values()][0].manage, "một phiên, user_id = mã tài khoản Synchro, bật quản lý kết nối");
  await C.ensureComposio(A); await C.ensureComposio(A);
  await Promise.all([C.ensureComposio(Bo), C.ensureComposio(Bo)]);
  ok(ses() === 2, "gọi lại nhiều lần (kể cả song song) không tạo thêm phiên", ses());
  const cA = C.composioConnector(A);
  ok(cA?.status === "ok" && cA.tools.length === 3 && cA.auth === "composio" && cA.url === "", "connector có 3 công cụ meta, không lộ địa chỉ phiên", JSON.stringify(cA).slice(0, 300));
  ok(!leaks(cA) && !leaks(C.listConnectors(A)) && !JSON.stringify(db().prepare("SELECT * FROM connectors").all()).includes(COMPOSIO_KEY), "khóa không có trong dữ liệu trả về lẫn trong cơ sở dữ liệu");
  ok(C.listConnectors(A).length === 0, "Composio không nằm trong danh sách connector tự thêm");
  let rm = "";
  try { C.removeConnector(A, cA.id); } catch (e) { rm = e.message; }
  ok(/không gỡ được/.test(rm) && C.composioConnector(A), "không gỡ được Composio (chỉ tắt)", rm);

  console.log("4. Quyền công cụ");
  const s = new C.ConnectorSession(A, { conv: "c1", pol: CAT.FULL_CONN });
  const fq = (n) => s.tools.find((t) => t.tool.name === n)?.fq;
  ok(s.tools.length === 3 && s.tools.every((t) => t.composio), "lượt chat có công cụ Composio", s.tools.map((t) => t.fq).join(","));
  ok(s.perm(fq("COMPOSIO_SEARCH_TOOLS")) === "allow" && s.perm(fq("COMPOSIO_MANAGE_CONNECTIONS")) === "allow", "tìm công cụ, tạo Connect Link: chạy luôn (không đổi gì)");
  ok(s.perm(fq("COMPOSIO_MULTI_EXECUTE_TOOL")) === "ask", "chạy thao tác: hỏi trước");
  ok(s.perm(fq("COMPOSIO_MULTI_EXECUTE_TOOL"), { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }] }) === "allow", "thao tác chỉ đọc (GMAIL_FETCH_EMAILS): chạy luôn");
  ok(s.perm(fq("COMPOSIO_MULTI_EXECUTE_TOOL"), { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }, { tool_slug: "GMAIL_SEND_EMAIL", arguments: {} }] }) === "ask", "lẫn một thao tác ghi: hỏi trước");
  ok(s.perm(fq("COMPOSIO_MULTI_EXECUTE_TOOL"), { tools: [{ tool_slug: "POSTGRES_LIST_ROWS", arguments: { sql: "drop table x" } }] }) === "ask", "tham số chạy lệnh (sql): hỏi trước");
  ok(s.perm(fq("COMPOSIO_MULTI_EXECUTE_TOOL"), { tools: [{ tool_slug: "SLACK_SEND_MESSAGE", arguments: {} }] }) === "ask", "SLACK_SEND_MESSAGE: hỏi trước");
  C.updateConnector(A, cA.id, { perms: { COMPOSIO_MULTI_EXECUTE_TOOL: "block" } });
  ok(new C.ConnectorSession(A, { pol: CAT.FULL_CONN }).perm(fq("COMPOSIO_MULTI_EXECUTE_TOOL"), { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }] }) === "block", "người dùng chặn thì thao tác đọc cũng bị chặn");
  C.updateConnector(A, cA.id, { perms: { COMPOSIO_MULTI_EXECUTE_TOOL: "ask" } });
  ok(/COMPOSIO_SEARCH_TOOLS/.test(C.connectorsPrompt(s)) && /nút "Kết nối"/.test(C.connectorsPrompt(s)), "model được dặn cách dùng Composio và nút Kết nối");

  console.log("5. Connect Link → nút trong khung chat");
  const r1 = await s.call(fq("COMPOSIO_MANAGE_CONNECTIONS"), { toolkits: ["gmail"] });
  const links = X.connectLinks(r1.content);
  ok(!r1.is_error && links.length === 1 && links[0].app === "gmail" && links[0].name === "Gmail" && links[0].url.startsWith(`${BASE}/composio/link/`), "lấy được Connect Link của Gmail", JSON.stringify({ r1, links }).slice(0, 400));
  ok(X.connectLinks(JSON.stringify({ data: { results: { evil: { redirect_url: "https://evil.example/phish" } } } })).length === 0, "đường link không phải của Composio bị bỏ");
  ok(X.connectLinks(JSON.stringify({ x: { redirect_url: "https://connect.composio.dev/link/lk_1" } }))[0]?.app === "x", "nhận link thật của composio.dev");
  ok(X.connectLinks(JSON.stringify({ x: { redirect_url: "javascript:alert(1)" } })).length === 0, "không nhận javascript:");
  let apps = await X.listApps(A, true);
  ok(apps.length === 0, "chưa bấm link: chưa có ứng dụng nào (link đang chờ không tính)");
  await fetch(links[0].url);
  apps = await X.listApps(A, true);
  ok(apps.length === 1 && apps[0].app === "gmail" && apps[0].status === "ACTIVE" && !("data" in apps[0]), "đăng nhập xong: Gmail đã kết nối, không kèm dữ liệu đăng nhập", JSON.stringify(apps));
  const r2 = await s.call(fq("COMPOSIO_MULTI_EXECUTE_TOOL"), { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }] });
  ok(!r2.is_error && /Mock email from Composio/.test(r2.content), "chạy được công cụ Gmail qua Composio", r2.content);
  ok(CX.calls.some((c) => c.startsWith("GET /composio/api/v3.1/connected_accounts?user_ids=u_alice")), "danh sách ứng dụng lọc theo đúng người dùng");
  ok((await X.listApps(Bo, true)).length === 0, "Bob không thấy ứng dụng của Alice");

  console.log("6. Ngắt ứng dụng");
  let no = "";
  try { await X.disconnectApp(Bo, apps[0].id); } catch (e) { no = e.message; }
  ok(/Không tìm thấy/.test(no) && (await X.listApps(A, true)).length === 1, "không ngắt được ứng dụng của người khác", no);
  try { await X.disconnectApp(A, "../x"); } catch (e) { no = e.message; }
  ok(/không hợp lệ/.test(no), "mã lạ bị chặn");
  await X.disconnectApp(A, apps[0].id);
  ok((await X.listApps(A, true)).length === 0 && CX.calls.some((c) => c.startsWith(`DELETE /composio/api/v3.1/connected_accounts/${apps[0].id}`)), "ngắt Gmail: gọi đúng DELETE /connected_accounts/{id}");

  console.log("7. Phiên mất, khóa đổi");
  CX.sessions.clear();
  const s2 = new C.ConnectorSession(A, { pol: CAT.FULL_CONN });
  const r3 = await s2.call(s2.tools.find((t) => t.tool.name === "COMPOSIO_SEARCH_TOOLS").fq, { queries: [{ use_case: "read gmail" }] });
  ok(!r3.is_error && /GMAIL_FETCH_EMAILS/.test(r3.content) && ses() === 1, "Composio xóa phiên: tự tạo phiên mới rồi gọi tiếp", JSON.stringify(r3).slice(0, 300));
  await s2.close();
  const fpBefore = db().prepare("SELECT enc_auth FROM connectors WHERE id = ?").get(cA.id).enc_auth;
  // Đổi sang khóa khác (cùng dự án giả lập nhận "_0001"; giả lập đổi khóa bằng cách đổi vân tay đã lưu).
  const old = JSON.parse(PR.openSecret(fpBefore));
  db().prepare("UPDATE connectors SET enc_auth = ? WHERE id = ?").run(PR.sealSecret(JSON.stringify({ ...old, fp: "khac" })), cA.id);
  const n0 = ses();
  ok(await C.ensureComposio(A) === "active" && ses() === n0 + 1, "khóa đổi (vân tay khác): tạo phiên mới, giữ hàng connector", ses());
  ok(C.composioConnector(A)?.id === cA.id && C.composioConnector(A).tools.find((t) => t.name === "COMPOSIO_MULTI_EXECUTE_TOOL")?.perm === "ask", "quyền công cụ đã đặt vẫn giữ");

  console.log("8. Quản trị viên gỡ khóa / không cho tài khoản");
  ok(await C.ensureComposio(A, { custom: true, allowed: ["notion"], destructive: true }) === "blocked", "không cho tài khoản này: blocked");
  ok(new C.ConnectorSession(A, { pol: { custom: true, allowed: ["notion"], destructive: true } }).tools.length === 0, "bị chặn: lượt chat không có Composio");
  PR.removeProvider("composio");
  ok(await C.ensureComposio(A) === "no_key" && new C.ConnectorSession(A, { pol: CAT.FULL_CONN }).tools.length === 0, "gỡ khóa: no_key, Composio biến khỏi lượt chat (không thành cần kết nối lại)");
  ok(C.composioConnector(A) !== null, "hàng connector (quyền đã đặt) vẫn giữ để dùng lại khi có khóa");
  process.env.COMPOSIO_API_KEY = COMPOSIO_KEY;
  ok(X.composioKey()?.key === COMPOSIO_KEY && await C.ensureComposio(A) === "active", "khóa ở biến môi trường COMPOSIO_API_KEY cũng dùng được");
  delete process.env.COMPOSIO_API_KEY;
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
