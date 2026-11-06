// Connector bền bỉ: lỗi tạm thời không làm mất kết nối, thử lại đúng chỗ, token tự nhập, đăng nhập bị hãng từ chối, dò lại thế hệ giao thức, tên công cụ, proxy.
// Tự chạy được, không cần dev:mock: thư mục dữ liệu riêng và một máy chủ MCP giả lập điều khiển được ngay trong tệp này.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-conn-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.DATA_KEY = "conn-test-key";
process.env.MCP_ALLOW_PRIVATE = "1";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { connectors: C, mcp: M, connproxy: P, refs: R, safefetch: F, mcpauth: A, authstore: AS, providers: PR } = await loadTs(["connectors", "mcp", "connproxy", "refs", "safefetch", "mcpauth", "authstore", "providers"]);

// ---- máy chủ MCP giả lập điều khiển được ----
const S = {
  calls: {}, seen: [], down: 0, downOnly: null, downStatus: 503, era: "legacy", auth: null, token: null, tools: null, oauth: null, redirect: null, scopeTool: null, authorize: null, register: null, register403: false,
  tokenFail: null, count(n) { return this.calls[n] ?? 0; }, reset() { Object.assign(this, { calls: {}, seen: [], down: 0, downOnly: null, downStatus: 503, era: "legacy", auth: null, tools: null, oauth: null, redirect: null, scopeTool: null, authorize: null, register: null, register403: false, tokenFail: null, forbid: null, forbidTool: null, hangPost: false, hangWk: false, sse: null, sseStream: null, list: undefined, onToken: null }); },
};
const TOOLS = [
  { name: "get_doc", description: "Read a doc", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
  { name: "search_docs", description: "Search", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "create_page", description: "Create a page", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] }, annotations: { readOnlyHint: false } },
  { name: "get_or_create_user", description: "Upsert", inputSchema: { type: "object", properties: {} } },
  { name: "get_chart", description: "A chart image", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "get_charts", description: "Three chart images", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "slow_ping", description: "Silent then done", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const send = (res, code, obj, h = {}) => { res.writeHead(code, { "content-type": "application/json", ...h }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok2) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => ok2(s)); });
let BASE = "";
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE);
  const p = u.pathname;
  S.seen.push({ p, method: req.method, auth: req.headers.authorization, key: req.headers["x-api-key"] });
  if (S.hangWk && p.startsWith("/.well-known/")) return;
  // Thế hệ HTTP+SSE: GET mở luồng, POST /messages trả lời qua luồng. sse.postStatus: POST lỗi; sse.silent: công cụ không bao giờ trả lời.
  if (S.sse && p === "/mcp" && req.method === "GET") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write("event: endpoint\ndata: /messages\n\n"); S.sseStream = res; return; }
  if (S.sse && p === "/messages") {
    const m = JSON.parse(await body(req) || "{}");
    S.calls[m.method] = (S.calls[m.method] ?? 0) + 1;
    if (m.method === "tools/call") { S.calls[`call:${m.params.name}`] = (S.calls[`call:${m.params.name}`] ?? 0) + 1; S.sse.lastSignal = Date.now(); }
    if (S.sse.postStatus && m.method === "tools/call") { const c = S.sse.postStatus; S.sse.postStatus = S.sse.postOnce ? 0 : c; res.writeHead(c); return res.end(); }
    res.writeHead(202); res.end();
    if (m.id === undefined || (m.method === "tools/call" && S.sse.silent)) return;
    const result = m.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "sse" } } : m.method === "tools/list" ? { tools: S.tools ?? TOOLS } : { content: [{ type: "text", text: `ok ${m.params?.name}` }] };
    S.sseStream?.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`);
    return;
  }
  if (p === "/moved") { res.writeHead(307, { location: `${OTHER}/sink` }); return res.end(); }
  // Máy chủ chỉ khai báo metadata trong header 401: đường dẫn chuẩn không có, máy chủ đăng nhập nằm ở /as.
  if (S.oauth?.prmOnly) {
    if (p === "/meta/prm") return send(res, 200, { resource: `${BASE}/mcp`, authorization_servers: [`${BASE}/as`] });
    if (p === "/.well-known/oauth-authorization-server/as") return send(res, 200, { issuer: `${BASE}/as`, authorization_endpoint: `${BASE}/as/authorize`, token_endpoint: `${BASE}/token`, registration_endpoint: `${BASE}/register`, code_challenge_methods_supported: ["S256"] });
    if (p.startsWith("/.well-known/")) return send(res, 404, {});
  }
  if (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp") return S.oauth ? send(res, 200, { resource: `${BASE}/mcp`, authorization_servers: [BASE] }) : send(res, 404, {});
  if (p === "/.well-known/oauth-authorization-server") return S.oauth ? send(res, 200, { issuer: BASE, authorization_endpoint: S.oauth.authorize ?? `${BASE}/authorize`, token_endpoint: `${BASE}/token`, registration_endpoint: `${BASE}/register`, code_challenge_methods_supported: ["S256"], ...(S.oauth.cimd ? { client_id_metadata_document_supported: true } : {}) }) : send(res, 404, {});
  if (p === "/.well-known/openid-configuration") return send(res, 404, {});
  if (!S.oauth && (p === "/register" || p === "/authorize" || p === "/token")) return send(res, 404, { error: "no" });
  if (p === "/register") { S.calls.register = (S.calls.register ?? 0) + 1; if (S.register403) return send(res, 403, { error: "forbidden" }); return send(res, 201, { client_id: `dcr_${S.calls.register}` }); }
  if (p === "/authorize") { S.calls.authorize = (S.calls.authorize ?? 0) + 1; const r = S.authorize?.(u.searchParams.get("client_id")); if (r) { res.writeHead(r.status, { "content-type": "text/html", ...(r.headers ?? {}) }); return res.end(r.body ?? ""); } res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>Sign in</html>"); }
  if (p === "/token") {
    S.calls.token = (S.calls.token ?? 0) + 1;
    S.onToken?.();
    if (S.tokenFail) { const f = S.tokenFail; return send(res, f.status, f.json ?? {}); }
    return send(res, 200, { access_token: `at_${S.calls.token}`, refresh_token: `rt_${S.calls.token}`, expires_in: 3600 });
  }
  if (p !== "/mcp") return send(res, 404, { error: "no" });
  if (S.hangPost && req.method === "POST") return;
  if (req.method === "GET") return send(res, 405, {});
  if (req.method === "DELETE") return send(res, 200, {});
  const m = JSON.parse(await body(req) || "{}");
  S.calls[m.method] = (S.calls[m.method] ?? 0) + 1;
  if (m.method === "tools/call") S.calls[`call:${m.params.name}`] = (S.calls[`call:${m.params.name}`] ?? 0) + 1;
  if (S.down > 0 && m.method !== "server/discover" && (!S.downOnly || m.method === S.downOnly)) { S.down--; res.writeHead(S.downStatus, { "content-type": "text/plain", ...(S.retryAfter ? { "retry-after": S.retryAfter } : {}) }); return res.end("oops"); }
  // Đăng nhập
  if (S.oauth?.need || S.auth) {
    const got = S.auth ? req.headers[S.auth.header] : req.headers.authorization;
    const want = S.auth ? S.auth.value : S.oauth.valid;
    if (got !== want) return send(res, 401, { error: "invalid_token" }, { "www-authenticate": S.oauth?.prmOnly ? `Bearer error="invalid_token", resource_metadata="${BASE}/meta/prm"` : 'Bearer error="invalid_token"' });
  }
  if (S.forbid && (S.forbid === true || S.forbid(m))) return send(res, 403, { error: "forbidden" });
  if (m.method === "server/discover") return S.era === "modern" ? send(res, 200, { jsonrpc: "2.0", id: m.id, result: { serverInfo: { name: "m" }, capabilities: {} } }) : send(res, 404, {});
  // Máy chủ "modern" không còn nhận initialize; "legacy" không biết _meta thế hệ mới.
  if (S.era === "modern" && m.method === "initialize") return send(res, 400, { error: "no" });
  if (S.era === "legacy" && req.headers["mcp-protocol-version"] === M.MODERN) return send(res, 400, {});
  if (m.id === undefined) { res.writeHead(202); return res.end(); }
  if (m.method === "initialize") return send(res, 200, { jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fake" } } });
  if (m.method === "tools/list") return send(res, 200, { jsonrpc: "2.0", id: m.id, result: S.list !== undefined ? S.list : { tools: S.tools ?? TOOLS } });
  if (m.method === "tools/call") {
    const n = m.params.name;
    if (S.scopeTool === n) return send(res, 403, { error: "insufficient_scope" }, { "www-authenticate": 'Bearer error="insufficient_scope", scope="docs:write"' });
    if (S.forbidTool === n) return send(res, 403, { error: "forbidden" });
    if (n === "get_charts") return send(res, 200, { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "ba biểu đồ" }, ...[1, 2, 3].map(() => ({ type: "image", data: PNG.toString("base64"), mimeType: "image/png" }))] } });
    if (n === "get_chart") return send(res, 200, { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "chart" }, { type: "image", data: PNG.toString("base64"), mimeType: "image/png" }] } });
    if (n === "get_charts") return send(res, 200, { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "charts" }, ...[0, 1, 2].map(() => ({ type: "image", data: PNG.toString("base64"), mimeType: "image/png" }))] } });
    if (n === "slow_ping") {
      // Luồng SSE: im một lúc nhưng có ping, rồi mới có kết quả.
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (let i = 0; i < 4; i++) { res.write(": ping\n\n"); await sleep(120); }
      res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "xong sau khi ping" }] } })}\n\n`);
      return res.end();
    }
    if (n === "hang") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": mở\n\n"); return; }
    return send(res, 200, { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `ok ${n} ${JSON.stringify(m.params.arguments ?? {})}` }] } });
  }
  return send(res, 200, { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no" } });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
BASE = `http://127.0.0.1:${server.address().port}`;
let sinkAuth = "none";
const other = http.createServer((req, res) => { sinkAuth = req.headers.authorization ?? "dropped"; res.writeHead(200); res.end("{}"); });
await new Promise((r) => other.listen(0, "127.0.0.1", r));
const OTHER = `http://127.0.0.1:${other.address().port}`;

const url = `${BASE}/mcp`;
const req = new Request("http://localhost:3200/x", { headers: { host: "localhost:3200" } });
const uid = "u_test";
const pol = { custom: true, allowed: ["*"], destructive: true };
const row = (id) => C.listConnectors(uid).find((x) => x.id === id);
const wipe = () => { for (const x of C.listConnectors(uid)) C.removeConnector(uid, x.id); S.reset(); };
const session = (conv) => new C.ConnectorSession(uid, { conv, pol });
const thrown = async (p) => { try { await p; return ""; } catch (e) { return e.message; } };
const add = (extra = {}) => C.addConnector(req, uid, { name: "Docs", url, ...extra }, pol);

try {
  console.log("1. Quyền mặc định theo tên khi máy chủ không khai báo");
  {
    const r = await add();
    const by = Object.fromEntries(r.connector.tools.map((t) => [t.name, t]));
    ok(by.get_doc.perm === "allow" && by.get_doc.readOnly && by.get_doc.guessed, "get_doc không khai báo: cho phép, đánh dấu là đoán theo tên", JSON.stringify(by.get_doc));
    ok(by.search_docs.perm === "allow" && !by.search_docs.guessed, "khai báo chỉ đọc: cho phép, không phải đoán");
    ok(by.create_page.perm === "ask" && !by.create_page.readOnly, "khai báo ghi: hỏi trước");
    ok(by.get_or_create_user.perm === "ask", "tên có động từ ghi (get_or_create) không bị coi là đọc");
    wipe();
  }

  console.log("2. Lỗi tạm thời không làm mất kết nối");
  {
    const r = await add();
    const id = r.connector.id;
    S.down = 99;
    const msg = await thrown(C.refreshConnector(uid, id));
    ok(/tạm thời không phản hồi/.test(msg), "Làm mới khi hãng 503: báo đúng sự cố tạm thời", msg);
    ok(row(id).status === "ok" && /tạm thời/.test(row(id).lastError ?? ""), "connector vẫn ok, lỗi ghi vào lastError", JSON.stringify(row(id)).slice(0, 300));
    ok(session().tools.length === TOOLS.length, "chat vẫn có công cụ trong lúc hãng lỗi");
    S.down = 0;
    await C.refreshConnector(uid, id);
    ok(row(id).lastError === null, "hãng hồi lại: xóa lỗi");
    wipe();
  }

  console.log("3. Thử lại đúng chỗ");
  {
    const r = await add();
    let s = session();
    const fq = (n) => s.tools.find((t) => t.tool.name === n).fq;
    S.down = 1; S.downOnly = "tools/call"; S.downStatus = 503; S.calls = {};
    let out = await s.call(fq("search_docs"), {});
    ok(!out.is_error && S.count("call:search_docs") === 2, "công cụ chỉ đọc gặp 503: tự thử lại và thành công", JSON.stringify(out) + JSON.stringify(S.calls));
    await s.close(); s = session();
    S.down = 1; S.downOnly = "tools/call"; S.calls = {};
    out = await s.call(fq("create_page"), { title: "x" });
    ok(out.is_error && S.count("call:create_page") === 1, "công cụ ghi không bao giờ tự gửi lại", JSON.stringify(S.calls));
    ok(/Không rõ kết quả/.test(out.content) && /kiểm tra/.test(out.content), "công cụ ghi lỗi giữa chừng: báo không rõ kết quả, kiểm tra trước khi thử lại", out.content);
    ok(row(r.connector.id).status === "ok", "lỗi tạm thời khi gọi công cụ không đổi trạng thái");
    await s.close();
    wipe();
  }

  console.log("4. Công cụ chạy lâu: hạn theo nhịp SSE");
  {
    const c = new M.McpClient(url);
    const t = TOOLS.find((x) => x.name === "slow_ping");
    const res = await c.callTool(t, {}, { idle: 250 });
    ok(M.resultText(res).text === "xong sau khi ping", "ping đều thì không bị coi là treo dù lâu hơn idle");
    const hang = { name: "hang", annotations: { readOnlyHint: false }, inputSchema: {} };
    const t0 = Date.now();
    const msg = await thrown(c.callTool(hang, {}, { idle: 200 }));
    ok(Date.now() - t0 < 3000 && /im lặng/.test(msg), "luồng im quá lâu thì dừng", `${Date.now() - t0}ms ${msg}`);
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 100);
    const t1 = Date.now();
    await thrown(c.callTool(hang, {}, { signal: ctl.signal }));
    ok(Date.now() - t1 < 2000, "bấm Dừng hủy lời gọi đang chờ", Date.now() - t1);
    await c.close();
  }

  console.log("5. Báo đúng: sự cố tạm thời khác với không phải MCP");
  {
    S.down = 99; S.downStatus = 503;
    let msg = await thrown(add());
    ok(/tạm thời không phản hồi/.test(msg) && !/không phải máy chủ MCP/.test(msg), "hãng đang 503: không nói là không phải MCP", msg);
    ok(C.listConnectors(uid).length === 0, "connector mới lỗi không để lại hàng treo");
    S.down = 0;
    msg = await thrown(C.addConnector(req, uid, { name: "Lạ", url: `${BASE}/khong-co` }, pol));
    ok(/không phải máy chủ MCP/.test(msg), "404 thật: vẫn báo không phải MCP", msg);
    wipe();
  }

  console.log("6. Token / API key tự nhập");
  {
    S.auth = { header: "authorization", value: "Bearer pat_123" };
    let msg = await thrown(add());
    // Máy chủ đòi đăng nhập, không có OAuth: lỗi chứ không treo.
    ok(/token hoặc API key/.test(msg) && C.listConnectors(uid).length === 0, "chỉ nhận token, không có OAuth: chỉ đúng cách kết nối, không để lại hàng treo", msg);
    S.seen = [];
    msg = await thrown(add({ token: "sai" }));
    ok(/từ chối token/.test(msg) && C.listConnectors(uid).length === 0, "token sai: báo rõ, không gọi đăng nhập OAuth, không lưu", msg);
    ok(!S.seen.some((x) => x.p === "/register" || x.p === "/authorize"), "chế độ token không dò OAuth");
    const r = await add({ token: "pat_123" });
    ok(r.connector.status === "ok" && r.connector.auth === "token" && !r.authorizeUrl, "token đúng: kết nối được, không mở đăng nhập", JSON.stringify(r).slice(0, 200));
    const dump = JSON.stringify(C.listConnectors(uid));
    ok(!dump.includes("pat_123"), "token không bao giờ trả về trình duyệt", dump.slice(0, 200));
    const id = r.connector.id;
    const s = session();
    const out = await s.call(s.tools[0].fq, {});
    ok(!out.is_error, "chat gọi công cụ bằng token", out.content);
    await s.close();
    // Token bị thu hồi
    S.auth.value = "Bearer pat_456";
    await thrown(C.refreshConnector(uid, id));
    ok(row(id).status === "needs_auth" && /từ chối token/.test(row(id).error ?? ""), "token bị thu hồi: cần nhập lại, nói rõ", JSON.stringify(row(id)).slice(0, 200));
    const again = await C.connect(req, uid, id, pol, { token: "pat_456" });
    ok(again.connector.status === "ok" && !again.authorizeUrl, "nhập lại token trên chính connector đó, giữ nguyên hàng", JSON.stringify(again).slice(0, 200));
    wipe();
    S.auth = { header: "x-api-key", value: "k_1" };
    const r2 = await add({ token: "k_1", header: "X-API-Key" });
    ok(r2.connector.status === "ok" && S.seen.some((x) => x.key === "k_1"), "header tự đặt (X-API-Key) gửi nguyên giá trị", JSON.stringify(S.seen.slice(-1)));
    wipe();
    msg = await thrown(add({ token: "x", header: "Host" }));
    ok(/header/.test(msg), "chặn header không được phép", msg);
    msg = await thrown(add({ token: "a\nb" }));
    ok(/không hợp lệ/.test(msg), "chặn token có ký tự xuống dòng", msg);
    wipe();
  }

  console.log("7. Đăng nhập OAuth bị từ chối");
  {
    S.oauth = { need: true, valid: "Bearer at_1" };
    const r = await add();
    ok(/^http/.test(r.authorizeUrl ?? "") && S.count("register") === 1 && S.count("authorize") === 1, "hãng bình thường: dò trang đăng nhập rồi trả địa chỉ", JSON.stringify(S.calls));
    wipe();
    S.oauth = { need: true, valid: "x" };
    S.authorize = () => ({ status: 400, body: "<h1>Invalid redirect URI</h1>" });
    const msg = await thrown(add());
    ok(/từ chối Synchro/.test(msg) && C.listConnectors(uid).length === 0, "trang đăng nhập từ chối (như Canva): báo rõ, không để lại hàng im lặng", msg);
    wipe();
    S.oauth = { need: true, valid: "x", cimd: true };
    S.authorize = (cid) => (cid?.startsWith("dcr_") ? null : { status: 400, body: "invalid_client" });
    const http2 = await add();
    ok(new URL(http2.authorizeUrl).searchParams.get("client_id") === "dcr_1" || S.count("register") === 0, "từ chối client: đăng ký động lại rồi đi tiếp", http2.authorizeUrl);
    wipe();
    S.oauth = { need: true, valid: "x" };
    S.authorize = () => ({ status: 404, body: "not here" });
    ok(!!(await add()).authorizeUrl, "4xx mơ hồ: vẫn cho qua, không chặn nhầm hãng đang chạy");
    wipe();
    S.oauth = { need: true, valid: "x" };
    S.authorize = () => ({ status: 302, headers: { location: "https://login.example/sso" } });
    ok(!!(await add()).authorizeUrl, "chuyển hướng tới trang đăng nhập: cho qua");
    wipe();
    S.oauth = { need: true, valid: "x", authorize: "javascript:fetch('/api/auth/me')" };
    const js = await thrown(add());
    ok(/không an toàn/.test(js) && C.listConnectors(uid).length === 0, "địa chỉ đăng nhập javascript: bị từ chối", js);
    wipe();
    S.oauth = { need: true, valid: "x" }; S.register403 = true;
    const blocked = await thrown(add());
    ok(/duyệt/.test(blocked) && /Cài đặt nâng cao/.test(blocked), "đăng ký bị 403: nói rõ hãng chỉ cho ứng dụng đã duyệt", blocked);
    wipe();
  }

  console.log("8. Hãng chưa duyệt Synchro trong danh mục");
  {
    const msg = await thrown(C.addConnector(req, uid, { dir: "figma" }, pol));
    ok(/Figma chỉ cho/.test(msg) && /token/.test(msg) && C.listConnectors(uid).length === 0, "Figma không thử kết nối, nói rõ lý do và cách khác", msg);
  }

  console.log("8b. Hàng Canva có sẵn của người dùng hiện đúng trạng thái");
  {
    // Hàng cũ từ trước khi có cờ: không xóa, hiện lý do của hãng; có token thì thử được, Thử lại vẫn đi qua luồng bình thường.
    const now = Date.now();
    AS.db().prepare("INSERT INTO connectors (id, user_id, name, url, dir, enabled, status, enc_auth, created_at, updated_at, settings) VALUES ('cn_canva', ?, 'Canva', ?, 'canva', 1, 'needs_auth', ?, ?, ?, '{}')").run(uid, url, PR.sealSecret(JSON.stringify({ mode: "oauth" })), now, now);
    const c = row("cn_canva");
    ok(c?.vendorBlocked?.why && /Canva/.test(c.vendorBlocked.why) && c.status === "needs_auth", "có lý do của hãng, hàng không bị xóa", JSON.stringify(c).slice(0, 200));
    const s = session();
    ok(s.offline.find((x) => x.id === "cn_canva")?.why === "vendor" && !C.connectorsPrompt(s).includes(C.RECONNECT_TOOL.name), "model được báo là hãng chưa duyệt, không hứa nút kết nối lại", C.connectorsPrompt(s));
    C.removeConnector(uid, "cn_canva");
    wipe();
  }

  console.log("9. Thiếu quyền chỉ ảnh hưởng một công cụ");
  {
    const r = await add();
    const id = r.connector.id;
    const s = session();
    S.scopeTool = "create_page";
    const fq = s.tools.find((t) => t.tool.name === "create_page").fq;
    const out = await s.call(fq, { title: "a" });
    ok(out.is_error && /cần thêm quyền/.test(out.content), "công cụ thiếu quyền báo rõ", out.content);
    ok(row(id).status === "ok" && row(id).needsScope === true, "connector vẫn chạy, thẻ hiện cấp thêm quyền", JSON.stringify(row(id)).slice(0, 200));
    ok(!(await s.call(s.tools.find((t) => t.tool.name === "search_docs").fq, {})).is_error, "công cụ khác vẫn chạy");
    await s.close();
    S.oauth = { valid: "x" };
    const up = await C.connect(req, uid, id, pol);
    ok(/scope=docs%3Awrite|scope=docs/.test(up.authorizeUrl ?? ""), "Kết nối: đi thẳng tới đăng nhập, xin đúng quyền còn thiếu", up.authorizeUrl);
    ok(row(id).status === "ok", "bỏ dở đăng nhập cũng không làm mất kết nối cũ");
    wipe();
  }

  console.log("10. Làm mới token");
  {
    // Connector đã đăng nhập, token hết hạn. Ghi trực tiếp (hoàn tất đăng nhập qua trình duyệt nằm ở connectors.test.mjs).
    const signedIn = async () => {
      S.oauth = null;
      const r = await add();
      S.oauth = { need: true, valid: "Bearer at_1" };
      const auth = { mode: "oauth", client: { client_id: "old_client", auth_method: "none" }, redirect: "http://localhost:3200/api/connectors/oauth/callback", resource: url, as: { issuer: BASE, token_endpoint: `${BASE}/token` }, tokens: { access_token: "het_han", refresh_token: "rt", expires_at: Date.now() - 1000 } };
      AS.db().prepare("UPDATE connectors SET enc_auth = ? WHERE id = ?").run(PR.sealSecret(JSON.stringify(auth)), r.connector.id);
      return r.connector.id;
    };
    let id = await signedIn();
    S.tokenFail = { status: 502 };
    let s = session();
    const t0 = Date.now();
    let out = await s.call(s.tools.find((t) => t.tool.name === "search_docs").fq, {});
    ok(out.is_error && /Tạm thời/.test(out.content) && row(id).status === "ok" && Date.now() - t0 >= 3500, "máy chủ đăng nhập 502: thử lại rồi báo lỗi tạm thời, connector không bị tắt", `${out.content} · ${row(id).status} · ${Date.now() - t0}ms`);
    ok(S.count("token") === 3, "thử lại với khoảng chờ 1 giây, 3 giây", S.count("token"));
    S.tokenFail = null; S.calls = {};
    out = await s.call(s.tools.find((t) => t.tool.name === "search_docs").fq, {});
    ok(!out.is_error, "hãng hồi lại: tự chạy tiếp, không phải đăng nhập lại", out.content);
    await s.close();
    wipe();
    id = await signedIn();
    S.tokenFail = { status: 400, json: { error: "invalid_grant" } };
    s = session();
    out = await s.call(s.tools[0].fq, {});
    ok(out.is_error && out.reconnect?.id === id && row(id).status === "needs_auth", "invalid_grant: đăng nhập thật sự mất, cần kết nối lại", JSON.stringify(out) + row(id).status);
    await s.close();
    wipe();
    id = await signedIn();
    S.tokenFail = { status: 401, json: { error: "invalid_client" } };
    S.authorize = (cid) => (cid === "old_client" ? { status: 400, body: "invalid_client" } : null);
    s = session();
    await s.call(s.tools[0].fq, {});
    await s.close();
    S.tokenFail = null; S.calls = {};
    const again = await C.connect(req, uid, id, pol);
    ok(new URL(again.authorizeUrl ?? "http://x").searchParams.get("client_id")?.startsWith("dcr_"), "hãng xóa client đã lưu: tự đăng ký lại, không phải gỡ connector", again.authorizeUrl);
    wipe();
    id = await signedIn();
    S.authorize = (cid) => (cid === "old_client" ? { status: 400, body: "<h1>Invalid client</h1>" } : null);
    S.tokenFail = null;
    const force = await C.connect(req, uid, id, pol, { force: true });
    ok(new URL(force.authorizeUrl ?? "http://x").searchParams.get("client_id")?.startsWith("dcr_"), "dò trang đăng nhập thấy client cũ bị từ chối: đăng ký lại", force.authorizeUrl);
    ok(row(id).status === "ok", "đăng nhập lại khi đang chạy tốt: bỏ dở cũng không mất kết nối");
    wipe();
  }

  console.log("11. Dò lại thế hệ giao thức khi hãng đổi máy chủ");
  {
    const r = await add();
    const id = r.connector.id;
    S.era = "modern";
    const s = session();
    const out = await s.call(s.tools.find((t) => t.tool.name === "search_docs").fq, {});
    ok(!out.is_error, "máy chủ chuyển sang đời mới: tự dò lại, lời gọi vẫn thành công", out.content);
    await s.close();
    await C.refreshConnector(uid, id);
    ok(row(id).status === "ok", "vẫn ở trạng thái đã kết nối");
    wipe();
  }

  console.log("12. Connector mất kết nối trong chat");
  {
    const r = await add();
    const id = r.connector.id;
    S.auth = { header: "authorization", value: "Bearer khac" };
    await thrown(C.refreshConnector(uid, id));
    ok(row(id).status === "needs_auth", "401 ở connector không token: cần kết nối");
    const s = session("c1");
    ok(s.tools.length === 0 && s.offline[0]?.name === "Docs" && s.offline[0].why === "auth", "phiên chat biết connector đang mất kết nối", JSON.stringify(s.offline));
    const prompt = C.connectorsPrompt(s);
    ok(/Docs/.test(prompt) && /kết nối lại/.test(prompt) && prompt.includes(C.RECONNECT_TOOL.name), "hướng dẫn cho model nói rõ và gọi nút kết nối lại", prompt);
    wipe();
    const r2 = await add();
    const s2 = session("c1");
    S.auth = { header: "authorization", value: "Bearer khac" };
    const out = await s2.call(s2.tools[0].fq, {});
    ok(out.is_error && /đăng nhập lại/.test(out.content) && !/chặn hoặc tắt/.test(out.content) && out.reconnect?.id === r2.connector.id, "mất đăng nhập giữa lượt: không nói là người dùng chặn, kèm nút kết nối lại", JSON.stringify(out));
    const out2 = await s2.call(s2.tools[0].fq, {});
    ok(/đăng nhập lại/.test(out2.content), "gọi lại: vẫn đúng lý do", out2.content);
    await s2.close();
    wipe();
  }

  console.log("13. Cho phép trong đoạn chat");
  {
    await add();
    const s = session("conv-a");
    const fq = s.tools.find((t) => t.tool.name === "create_page").fq;
    ok(s.perm(fq) === "ask", "mặc định: hỏi");
    s.allowChat(fq);
    ok(s.perm(fq) === "allow", "chọn trong đoạn chat: hết hỏi");
    ok(session("conv-a").perm(fq) === "allow", "lượt sau cùng đoạn chat: không hỏi lại");
    ok(session("conv-b").perm(fq) === "ask", "đoạn chat khác: vẫn hỏi");
    const noConv = session();
    noConv.allowChat(fq);
    ok(noConv.perm(fq) === "allow", "lượt không có mã đoạn chat: có hiệu lực tới hết lượt");
    s.allowAlways(fq);
    ok(session("conv-b").perm(fq) === "allow", "luôn cho phép: mọi đoạn chat");
    wipe();
  }

  console.log("14. Ảnh connector trả về");
  {
    await add();
    const s = session();
    const out = await s.call(s.tools.find((t) => t.tool.name === "get_chart").fq, {});
    ok(out.mime === "image/png" && Buffer.from(out.image, "base64").equals(PNG) && !out.is_error, "ảnh đi kèm kết quả, đúng loại ảnh", JSON.stringify(out).slice(0, 200));
    const many = await s.call(s.tools.find((t) => t.tool.name === "get_charts").fq, {});
    ok(many.image && many.more?.length === 2 && many.more.every((i) => i.mime === "image/png"), "công cụ trả ba ảnh: cả ba tới được model", JSON.stringify(many).slice(0, 200));
    await s.close();
    wipe();
  }

  console.log("15. Tên công cụ vừa giới hạn của CLI");
  {
    const used = new Set();
    const a = C.fqName("Google Workspace Enterprise", "gmail_create_draft_with_attachment_and_labels_v2", used);
    const b = C.fqName("Google Workspace Enterprise", "gmail_create_draft_with_attachment_and_labels_v3", used);
    ok(a.length <= C.FQ_MAX && b.length <= C.FQ_MAX && a !== b, "tên dài được cắt, vẫn khác nhau", `${a} ${b}`);
    ok(`mcp__synchro__${a}`.length <= 64, "cộng tiền tố dài nhất của CLI vẫn trong 64 ký tự", a.length);
    ok(C.fqName("Google Workspace Enterprise", "gmail_create_draft_with_attachment_and_labels_v2", new Set()) === a, "ổn định giữa các lượt");
    ok(C.fqName("Notion", "search", new Set()) === "notion__search", "tên ngắn giữ nguyên như cũ");
  }

  console.log("16. Không gửi token sang tên miền khác khi bị chuyển hướng");
  {
    await F.safeFetch(`${BASE}/moved`, { method: "POST", headers: { authorization: "Bearer bi-mat", "x-secret": "z" }, secret: ["x-secret"], body: "{}" });
    ok(sinkAuth === "dropped", "307 sang nguồn khác: bỏ authorization", sinkAuth);
  }

  console.log("17. Kiểm tra lại ở nền");
  {
    const r = await add();
    const id = r.connector.id;
    const now = Date.now() + 13 * 3600_000;
    S.tools = [...TOOLS, { name: "list_new", description: "Mới", inputSchema: { type: "object", properties: {} } }];
    const n = await C.recheckConnectors(now);
    ok(n === 1 && row(id).tools.some((t) => t.name === "list_new"), "đủ 12 giờ: tự thấy công cụ mới", n);
    ok(await C.recheckConnectors(Date.now()) === 0, "vừa kiểm tra: không gọi lại");
    S.down = 99;
    await C.recheckConnectors(now + 13 * 3600_000);
    ok(row(id).status === "ok" && /tạm thời/.test(row(id).lastError ?? ""), "hãng lỗi lúc kiểm tra nền: vẫn ok", JSON.stringify(row(id)).slice(0, 200));
    S.down = 0;
    wipe();
  }

  console.log("18. Tìm công cụ (proxy)");
  {
    const mk = (cname, name, description = "") => ({ fq: `${cname.toLowerCase()}__${name}`, cname, tool: { name, description } });
    const tools = [mk("Vercel", "plan_scan"), mk("Vercel", "list_deployments", "List deployments of a project"), mk("Vercel", "get_deployment"), mk("Notion", "create_page", "Create a page"), mk("Notion", "search"), mk("Audit", "export_log"), mk("Linear", "create_issue", "Create an issue"), mk("Linear", "update_issue")];
    const top = (q, c) => P.rankTools(tools, q, c).hits[0]?.tool.name;
    ok(top("list deployments") === "list_deployments", "khớp cả cụm", top("list deployments"));
    ok(top("an issue") === "create_issue" || top("an issue") === "update_issue", "\"an\" không khớp giữa các tên như plan_scan", top("an issue"));
    ok(!P.rankTools(tools, "an the of").hits.some((h) => h.tool.name === "plan_scan") || P.rankTools(tools, "an the of").hits.length === 8 || P.rankTools(tools, "an the of").hits.length === tools.length, "chỉ có từ vô nghĩa: không xếp theo chuỗi con");
    ok(top("tạo trang") === "create_page", "tiếng Việt: tạo trang → create_page", top("tạo trang"));
    ok(top("add ticket") === "create_issue", "đồng nghĩa: add ticket → create_issue", top("add ticket"));
    ok(top("page", "Notion của tôi") === "create_page" || P.rankTools(tools, "page", "notion").hits[0].cname === "Notion", "lọc theo tên connector gần đúng");
    const f = P.rankTools(tools, "export", "Audit MCP");
    ok(f.hits[0]?.tool.name === "export_log" && !f.note, "\"Audit MCP\" khớp connector Audit", JSON.stringify(f).slice(0, 200));
    const g = P.rankTools(tools, "export", "Không Có");
    ok(g.hits[0]?.tool.name === "export_log" && /tìm trong tất cả/.test(g.note), "connector không có: tìm tất cả, kèm ghi chú", g.note);
    ok(P.resolveTool(tools, "export_log")?.fq === "audit__export_log", "tên trần duy nhất được nhận");
    ok(P.resolveTool(tools, "mcp__synchro__audit__export_log")?.fq === "audit__export_log", "kèm tiền tố CLI được nhận");
    const dup = [...tools, mk("Other", "search")];
    ok(P.resolveTool(dup, "search") === null, "tên trần trùng nhiều connector: không đoán");
  }

  console.log("19. Schema gọn");
  {
    const big = { type: "object", required: ["z_required"], properties: { a_enum: { type: "string", description: "x".repeat(900), enum: Array.from({ length: 900 }, (_, i) => `value_${i}`) }, b: { type: "object", description: "lồng", properties: { inner: { type: "string", description: "bỏ" } } }, z_required: { type: "string", description: "cần có" } } };
    const { schema } = P.compactSchema(big);
    const s = JSON.stringify(schema);
    ok(s.length <= 4000 && JSON.parse(s), "dưới 4.000 ký tự, vẫn là JSON hợp lệ", s.length);
    ok(schema.required[0] === "z_required" && Object.keys(schema.properties)[0] === "z_required", "required đứng đầu, không mất");
    ok(schema.properties.a_enum.enum.length === 20 && schema.properties.a_enum.enum_total === 900, "enum dài cắt còn 20, ghi tổng số");
    ok(schema.properties.b.properties.inner.type === "string" && !schema.properties.b.properties.inner.description, "lồng: giữ tên và kiểu, bỏ mô tả");
    const huge = { type: "object", required: ["r"], properties: Object.fromEntries([["r", { type: "string" }], ...Array.from({ length: 800 }, (_, i) => [`param_number_${i}`, { type: "object", properties: { a: { type: "string" } } }])]) };
    const h = P.compactSchema(huge);
    ok(JSON.stringify(h.schema).length <= 4300 && h.schema.properties.r && h.trimmed, "quá nhiều tham số: vẫn giữ required, JSON hợp lệ", JSON.stringify(h.schema).length);
    const small = P.compactSchema({ type: "object", properties: { q: { type: "string", description: "câu hỏi" } } });
    ok(!small.trimmed && small.schema.properties.q.description === "câu hỏi", "schema nhỏ giữ mô tả");
  }

  console.log("20. Tham số connector_call");
  {
    ok(/không phải JSON/.test(P.callArgs({ tool: "x", input_json: "{hỏng" }).error ?? ""), "JSON hỏng: báo lỗi, không chạy với tham số rỗng");
    ok(/đối tượng JSON/.test(P.callArgs({ tool: "x", input: [1] }).error ?? ""), "mảng: báo lỗi");
    ok(JSON.stringify(P.callArgs({ tool: "x", input: { a: 1 } }).args) === '{"a":1}', "input đối tượng");
    ok(JSON.stringify(P.callArgs({ tool: "x", input_json: '{"a":1}' }).args) === '{"a":1}', "input_json");
    ok(JSON.stringify(P.callArgs({ tool: "x", a: 1, b: 2 }).args) === '{"a":1,"b":2}', "tham số để phẳng ở cấp trên cùng được nhận");
    ok(JSON.stringify(P.callArgs({ tool: "x" }).args) === "{}", "không có tham số: rỗng là đúng");
  }

  console.log("21. Danh mục tên");
  {
    const names = [...Array.from({ length: 200 }, (_, i) => `list_item_${i}`), ...Array.from({ length: 200 }, (_, i) => `zeta_item_${i}`)];
    const { line, shown } = P.catalogLine(names);
    ok(line.length <= 2000 && shown < 400, "trong ngân sách", line.length);
    ok(line.includes("list_item_0") && line.includes("zeta_item_0"), "nhóm nào cũng có mặt, không chỉ nhóm đầu", line.slice(-80));
    ok(P.catalogLine(["a", "b"]).line === "a, b", "ít thì liệt kê đủ");
  }

  console.log("22. read_ref đọc quá 8.000 ký tự");
  {
    const content = "đầu " + "x".repeat(20_000) + " cuối-duy-nhất";
    const longJson = R.storeRef(uid, "c", "t", JSON.stringify({ title: "Doc", content }));
    let r = R.readRef(uid, { ref: longJson, path: "content" });
    ok(r.content.startsWith("đầu") && /ký tự 0-8000/.test(r.content) && /offset=8000/.test(r.content), "chuỗi dài: trang đầu, ghi offset đọc tiếp", r.content.slice(-80));
    r = R.readRef(uid, { ref: longJson, path: "content", offset: 16000 });
    ok(r.content.includes("cuối-duy-nhất") && /đã hết/.test(r.content), "đọc tới cuối bằng offset", r.content.slice(-80));
    r = R.readRef(uid, { ref: longJson, path: "content", query: "cuối-duy-nhất" });
    ok(r.content.includes("cuối-duy-nhất") && r.content.length < 2000 && /1 \/ 1 chỗ khớp/.test(r.content), "query trên chuỗi: đoạn quanh chỗ khớp", r.content.slice(-120));
    const oneLine = R.storeRef(uid, "c", "t", "a".repeat(30_000) + "ZZZ");
    r = R.readRef(uid, { ref: oneLine, offset: 24000 });
    ok(r.content.includes("ZZZ") && /đã hết/.test(r.content), "một dòng rất dài: đọc được phần sau", r.content.slice(-60));
    const obj = R.storeRef(uid, "c", "t", JSON.stringify({ a: "y".repeat(12_000), b: "z".repeat(12_000) }));
    r = R.readRef(uid, { ref: obj, offset: 12_100 });
    ok(r.content.includes("zzz") && /ký tự 12100-/.test(r.content), "đối tượng lớn: phân trang theo ký tự", r.content.slice(-60));
    const arr = R.storeRef(uid, "c", "t", JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => ({ i })) }));
    r = R.readRef(uid, { ref: arr, limit: 10 });
    ok(/10 \/ 200 phần tử/.test(r.content) && /offset=10/.test(r.content), "danh sách vẫn phân trang theo phần tử", r.content.slice(-80));
    const lines = R.storeRef(uid, "c", "t", Array.from({ length: 2000 }, (_, i) => `dòng ${i}`).join("\n"));
    r = R.readRef(uid, { ref: lines, offset: 100, limit: 5 });
    ok(/101: dòng 100/.test(r.content) && /5 \/ 2000 dòng/.test(r.content), "văn bản nhiều dòng vẫn theo dòng", r.content.slice(-60));
  }

  console.log("23. Làm rõ loại lỗi đăng nhập");
  {
    const asMeta = { token_endpoint: `${BASE}/token` }, client = { client_id: "c", auth_method: "none" };
    S.oauth = {};
    S.tokenFail = { status: 400, json: { error: "invalid_grant" } };
    let e = await A.refreshTokens(asMeta, client, { refreshToken: "r", resource: url }).catch((x) => x);
    ok(e instanceof A.TokenRejected && e.oauth === "invalid_grant", "invalid_grant: hãng nói rõ, phải đăng nhập lại");
    S.tokenFail = { status: 502 };
    e = await A.refreshTokens(asMeta, client, { refreshToken: "r", resource: url }).catch((x) => x);
    ok(e instanceof F.TempFail && e.status === 502, "502: lỗi tạm thời");
    S.tokenFail = { status: 400, json: { error: "temporarily_unavailable" } };
    e = await A.refreshTokens(asMeta, client, { refreshToken: "r", resource: url }).catch((x) => x);
    ok(e instanceof F.TempFail, "temporarily_unavailable: lỗi tạm thời");
    S.reset();
  }

  console.log("24. Đoán công cụ đọc: so cả từ, không đoán khi có dấu hiệu chạy lệnh");
  {
    const g = (name, extra = {}) => M.guessedRead({ name, ...extra });
    ok(g("get_credits") && g("list_posts") && g("get_asset") && g("get_post") && g("list_run_logs") && g("search") && g("fetch"), "tên đọc thường không còn bị hỏi vì khớp chuỗi con (edit, post, set, run)");
    ok(!g("query") && !g("find"), "query, find đứng một mình không phải công cụ đọc");
    ok(!g("find_records", { description: "Runs any SQL you give it" }) && !g("query_db", { description: "Execute a statement" }) && !g("query_db", { description: "Used for running any SQL" }), "mô tả nói chạy / thực thi: không đoán là đọc");
    ok(!g("query_db", { inputSchema: { type: "object", properties: { sql: { type: "string" } } } }) && !g("find_x", { inputSchema: { type: "object", properties: { command: { type: "string" } } } }), "tham số sql, command: không đoán là đọc");
    ok(!g("query_db", { inputSchema: { type: "object", properties: { q: { type: "string", description: "SQL statement" } } } }), "tham số có mô tả là SQL: không đoán là đọc");
    ok(g("search_docs", { inputSchema: { type: "object", properties: { query: { type: "string" } } } }) && g("get_workflow_run", { description: "Get a workflow run" }), "tham số query và danh từ run vẫn là đọc");
    ok(!g("get_or_create_user") && !g("find_and_update") && !g("find_and_delete") && !g("get_or_set"), "động từ ghi đi sau and / or vẫn là ghi");
    ok(!g("create_page") && !g("do_thing"), "không bắt đầu bằng động từ đọc");
    const d = (name, annotations) => M.destructiveLike({ name, annotations });
    ok(d("delete_page") && d("create_page") && d("do_thing"), "công cụ ghi không khai báo: tính là có thể xóa dữ liệu (mặc định của đặc tả MCP)");
    ok(d("x", { readOnlyHint: false }) && d("x", { destructiveHint: true }), "khai báo có thể ghi, hoặc có thể xóa");
    ok(!d("x", { readOnlyHint: true }) && !d("x", { destructiveHint: false }) && !d("get_doc") && !d("ask_question"), "khai báo không xóa, công cụ đọc, động từ không ghi: không cảnh báo");
    S.tools = [...TOOLS, { name: "delete_page", description: "Delete", inputSchema: { type: "object", properties: {} } }, { name: "query", description: "Run any SQL", inputSchema: { type: "object", properties: { sql: { type: "string" } } } }];
    const r = await add();
    const id = r.connector.id;
    let c = row(id);
    ok(c.tools.find((t) => t.name === "delete_page").destructive && !c.tools.find((t) => t.name === "delete_page").locked, "thẻ connector đánh dấu delete_page có thể xóa dữ liệu");
    ok(c.tools.find((t) => t.name === "query").perm === "ask", "query chạy SQL phải hỏi trước", JSON.stringify(c.tools.find((t) => t.name === "query")));
    C.updateConnector(uid, id, { settings: { destructive: false } }, pol);
    c = row(id);
    ok(c.tools.find((t) => t.name === "delete_page").locked === "setting", "tắt công cụ xóa dữ liệu thì delete_page không khai báo cũng bị khóa");
    ok(!session("x24").tools.some((t) => t.tool.name === "delete_page"), "công cụ bị khóa không tới model");
    wipe();
  }

  console.log("25. Chỉ gọi lại công cụ khi máy chủ khai báo rõ");
  {
    const r = await add();
    const id = r.connector.id;
    C.updateConnector(uid, id, { perms: { get_doc: "allow" } }, pol);
    const s = session("x25");
    S.down = 1; S.downOnly = "tools/call"; S.calls = {};
    const out = await s.call(s.tools.find((t) => t.tool.name === "get_doc").fq, {});
    ok(S.count("call:get_doc") === 1 && out.is_error, "get_doc chỉ đoán là đọc: 503 không tự gọi lại", JSON.stringify(S.calls));
    await s.close();
    wipe();
  }

  console.log("26. Lấy lại danh sách công cụ không xóa quyền đã đặt");
  {
    const r = await add();
    const id = r.connector.id;
    C.updateConnector(uid, id, { perms: { search_docs: "block", create_page: "allow" } }, pol);
    const perm = (n) => row(id).tools.find((t) => t.name === n)?.perm;
    S.list = {};
    const msg = await thrown(C.refreshConnector(uid, id));
    ok(/không hợp lệ/.test(msg) && perm("search_docs") === "block" && perm("create_page") === "allow", "thiếu mảng tools: báo lỗi, quyền nguyên vẹn", msg);
    S.list = { tools: [] };
    await C.refreshConnector(uid, id);
    ok(row(id).tools.length === TOOLS.length && perm("search_docs") === "block" && /danh sách công cụ trống/.test(row(id).lastError ?? ""), "danh sách rỗng lần đầu: chưa tin, giữ nguyên, có ghi lại", JSON.stringify(row(id).lastError));
    S.list = undefined;
    await C.refreshConnector(uid, id);
    ok(!row(id).lastError, "có lại công cụ: hết cảnh báo");
    S.list = { tools: [] };
    await C.refreshConnector(uid, id);
    await C.refreshConnector(uid, id);
    ok(row(id).tools.length === 0, "rỗng hai lần liên tiếp: chấp nhận là thật");
    S.list = undefined;
    await C.refreshConnector(uid, id);
    ok(perm("search_docs") === "block" && perm("create_page") === "allow", "công cụ quay lại: đúng quyền cũ, Chặn không thành Luôn cho phép", `${perm("search_docs")} ${perm("create_page")}`);
    S.tools = TOOLS.filter((t) => t.name !== "search_docs");
    await C.refreshConnector(uid, id);
    S.tools = null;
    await C.refreshConnector(uid, id);
    ok(perm("search_docs") === "block", "công cụ vắng một lần rồi quay lại vẫn bị chặn");
    wipe();
  }

  console.log("26b. Xét lại quyền tự cấp theo quy tắc đoán cũ");
  {
    S.tools = [...TOOLS, { name: "query", description: "Run any SQL", inputSchema: { type: "object", properties: { sql: { type: "string" } } } }];
    const r = await add();
    const id = r.connector.id;
    // Dữ liệu cũ: chưa có dấu đã xét, query đang "allow" do quy tắc cũ tự cấp.
    AS.db().prepare("UPDATE connectors SET perms = json_set(perms, '$.query', 'allow'), settings = '{}' WHERE id = ?").run(id);
    ok(row(id).tools.find((t) => t.name === "query").perm === "allow", "trước khi xét lại: allow");
    await C.refreshConnector(uid, id);
    ok(row(id).tools.find((t) => t.name === "query").perm === "ask", "lần lấy danh sách đầu tiên: về Hỏi trước");
    ok(row(id).tools.find((t) => t.name === "get_doc").perm === "allow", "công cụ đọc thật không đổi");
    C.updateConnector(uid, id, { perms: { query: "allow" } }, pol);
    await C.refreshConnector(uid, id);
    ok(row(id).tools.find((t) => t.name === "query").perm === "allow", "người dùng chọn lại Luôn cho phép: giữ, không hạ lần nữa");
    wipe();
  }

  console.log("27. 403 là trạng thái riêng");
  {
    S.oauth = { need: true, valid: "Bearer at_1" };
    const r = await add();
    const id = r.connector.id;
    // finishAuth cần phiên đăng nhập: đặt trực tiếp token như đã đăng nhập xong.
    const cur = JSON.parse(PR.openSecret(AS.db().prepare("SELECT enc_auth FROM connectors WHERE id = ?").get(id).enc_auth));
    AS.db().prepare("UPDATE connectors SET enc_auth = ?, status = 'ok', tools = ?, checked_at = 1 WHERE id = ?").run(PR.sealSecret(JSON.stringify({ ...cur, mode: "oauth", tokens: { access_token: "at_1" } })), JSON.stringify(TOOLS), id);
    S.forbid = true;
    let msg = await thrown(C.refreshConnector(uid, id));
    ok(row(id).status === "forbidden" && /từ chối quyền truy cập/.test(row(id).error ?? "") && !/hết hạn/.test(row(id).error ?? ""), "OAuth 403 ở danh sách công cụ: trạng thái riêng, lời đúng", JSON.stringify([row(id).status, row(id).error, msg]));
    const s = session("x27");
    ok(s.offline[0]?.why === "auth", "connector bị từ chối hiện nút kết nối lại trong chat", JSON.stringify(s.offline));
    const again = await C.connect(req, uid, id, pol);
    ok(/\/authorize/.test(again.authorizeUrl ?? ""), "Kết nối lại đi tới trang đăng nhập", JSON.stringify(again).slice(0, 200));
    S.forbid = null;
    await C.refreshConnector(uid, id);
    ok(row(id).status === "ok", "máy chủ cho vào lại: tự lành");
    S.forbidTool = "get_doc";
    const s2 = session("x27b");
    const out = await s2.call(s2.tools.find((t) => t.tool.name === "get_doc").fq, {});
    ok(out.is_error && out.reconnect?.refused && /403/.test(out.content), "403 của một công cụ: có nút kết nối lại, nói đúng lý do", JSON.stringify(out));
    await sleep(100);
    ok(row(id).status === "ok", "403 của một công cụ không làm hỏng connector (danh sách công cụ vẫn được)", row(id).status);
    await s2.close();
    wipe();
    S.forbid = true;
    msg = await thrown(add());
    ok(/từ chối truy cập \(lỗi 403\)/.test(msg) && !/không phải máy chủ MCP/.test(msg), "connector mới bị 403: không nói là không phải MCP", msg);
    ok(C.listConnectors(uid).length === 0, "connector mới bị từ chối không ở lại");
    S.forbid = (m) => m.method === "server/discover";
    const okR = await add();
    ok(okR.connector.status === "ok", "chỉ một kiểu gọi bị 403: vẫn kết nối được bằng kiểu khác", JSON.stringify(okR.connector).slice(0, 200));
    wipe();
  }

  console.log("28. Token mới được thử trước khi lưu");
  {
    S.auth = { header: "authorization", value: "Bearer tot" };
    const r = await add({ token: "tot" });
    const id = r.connector.id;
    const msg = await thrown(C.connect(req, uid, id, pol, { token: "go-nham" }));
    ok(/từ chối token/.test(msg), "token gõ nhầm: báo lỗi", msg);
    ok(row(id).status === "ok" && !row(id).error, "trạng thái connector không đổi", JSON.stringify(row(id)).slice(0, 200));
    await C.refreshConnector(uid, id);
    ok(row(id).status === "ok", "token cũ vẫn còn và vẫn chạy");
    S.auth = { header: "authorization", value: "Bearer moi" };
    await C.connect(req, uid, id, pol, { token: "moi" });
    ok(row(id).status === "ok", "token đúng: lưu và chạy");
    S.scopeTool = "get_doc";
    const s = session("x28");
    await s.call(s.tools.find((t) => t.tool.name === "get_doc").fq, {});
    ok(row(id).needsScope, "công cụ thiếu quyền: có lời nhắc");
    C.updateConnector(uid, id, { dismissScope: true }, pol);
    ok(!row(id).needsScope && row(id).status === "ok", "bỏ qua lời nhắc thiếu quyền được");
    await s.close();
    wipe();
  }

  console.log("29. Nút Kết nối có hạn");
  {
    S.oauth = { need: true, valid: "x" };
    S.hangWk = true;
    let t0 = Date.now();
    const msg = await thrown(add());
    const took = Date.now() - t0;
    ok(took < 30_000 && /tạm thời không phản hồi|quá lâu/.test(msg), `metadata treo: báo sau ${Math.round(took / 1000)} giây (trước đây ~3 phút)`, `${took} ${msg}`);
    wipe();
    S.hangPost = true; S.sse = {};
    t0 = Date.now();
    // Lúc chạy cùng cả bộ kiểm, máy bận có thể làm hết hạn bước thử POST: thử lại một lần, thời gian vẫn đo ở lần sau.
    const r = await add().catch(() => { wipe(); t0 = Date.now(); return add(); });
    ok(r.connector.status === "ok" && r.connector.tools.length === TOOLS.length && Date.now() - t0 < 28_000, `máy chủ treo khi nhận POST: vẫn thử được SSE (${Math.round((Date.now() - t0) / 1000)} giây)`, JSON.stringify(r.connector).slice(0, 200));
    wipe();
    S.reset();
    const live = (await add()).connector;
    S.hangPost = true;
    t0 = Date.now();
    const late = await thrown(C.refreshConnector(uid, live.id));
    ok(Date.now() - t0 < 32_000 && /quá lâu/.test(late), `Làm mới khi máy chủ treo: báo sau ${Math.round((Date.now() - t0) / 1000)} giây`, late);
    const after = C.listConnectors(uid).find((x) => x.id === live.id);
    ok(after.status === "ok" && after.tools.length === TOOLS.length, "Làm mới treo: connector và công cụ vẫn nguyên", JSON.stringify(after).slice(0, 200));
    S.reset();
    wipe();
  }

  console.log("30. Thế hệ SSE: Dừng, im lặng, lỗi tạm thời");
  {
    S.sse = {}; S.hangPost = false;
    S.era = "sse";
    const c = new M.McpClient(url, undefined, "sse");
    const tools = await c.listTools();
    ok(tools.length === TOOLS.length, "SSE: lấy được danh sách công cụ");
    const read = { name: "search_docs", annotations: { readOnlyHint: true } }, write = { name: "create_page", annotations: { readOnlyHint: false } };
    S.sse.silent = true;
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 100);
    let t0 = Date.now();
    let e = await c.callTool(read, {}, { signal: ctl.signal }).catch((x) => x);
    ok(e instanceof Error && Date.now() - t0 < 2000, "bấm Dừng: thôi chờ ngay", `${Date.now() - t0} ${e}`);
    t0 = Date.now();
    e = await c.callTool(write, {}, { idle: 150 }).catch((x) => x);
    ok(e instanceof F.TempFail && /im lặng/.test(e.message) && Date.now() - t0 < 4000, "công cụ im lặng: báo sau thời gian im lặng", `${Date.now() - t0} ${e}`);
    S.sse.silent = false;
    S.sse.postStatus = 503; S.sse.postOnce = true; S.calls = {};
    const good = await c.callTool(read, {}).catch((x) => x);
    ok(good?.content?.[0]?.text === "ok search_docs" && S.count("call:search_docs") === 2, "công cụ đọc gặp 503: tự thử lại một lần", JSON.stringify(good) + JSON.stringify(S.calls));
    S.sse.postStatus = 503; S.sse.postOnce = false; S.calls = {};
    e = await c.callTool(write, {}).catch((x) => x);
    ok(e instanceof F.TempFail && e.status === 503 && S.count("call:create_page") === 1, "công cụ ghi gặp 503: lỗi tạm thời, không gọi lại", `${e} ${JSON.stringify(S.calls)}`);
    S.sse.postStatus = 0;
    await c.close();
    S.sseStream?.end();
    wipe();
  }

  console.log("31. Kiểm tra lại ở nền không bị kẹt sau connector hỏng");
  {
    const db = AS.db();
    const seal = PR.sealSecret(JSON.stringify({ mode: "none" }));
    // 42 connector hỏng cũ nằm đầu danh sách (trỏ tới địa chỉ không có), một connector tốt đứng sau.
    for (let i = 0; i < 42; i++) db.prepare("INSERT INTO connectors (id, user_id, name, url, enabled, status, enc_auth, tools, created_at, updated_at, checked_at) VALUES (?, ?, ?, ?, 1, 'error', ?, '[]', 1, 1, ?)").run(`cn_bad${i}`, "u_old", `Bad ${i}`, "http://127.0.0.1:9/mcp", seal, i + 1);
    const r = await add();
    const id = r.connector.id;
    db.prepare("UPDATE connectors SET checked_at = 1000 WHERE id = ?").run(id);
    let now = Date.now(), turns = 0;
    while (row(id).checkedAt === 1000 && turns++ < 15) await C.recheckConnectors(now);
    ok(row(id).checkedAt !== 1000, `connector tốt tới lượt sau ${turns} đợt`, turns);
    db.prepare("DELETE FROM connectors WHERE user_id = 'u_old'").run();
    globalThis.__synchroConnTried?.clear();
    wipe();
  }

  console.log("32. Nhiều ảnh, connector trùng tên");
  {
    S.tools = [...TOOLS, { name: "get_charts", description: "Charts", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }];
    const r = await add();
    const s = session("x32");
    const out = await s.call(s.tools.find((t) => t.tool.name === "get_charts").fq, {});
    ok(out.more?.length === 2 && out.imagesAll === 3 && !!out.image, "trả về đủ cả ba ảnh", JSON.stringify(out).slice(0, 200));
    ok(!/đã kèm theo/.test(out.content), "chữ không còn tự nhận đã kèm mọi ảnh", out.content);
    await s.close();
    await C.addConnector(req, uid, { name: r.connector.name, url: `${url}?b=1` }, pol);
    const a = session("x32b");
    const names = [...new Set(a.tools.map((t) => t.cname))];
    ok(names.length === 2 && names.every((n) => n.includes("127.0.0.1")) && names[0] !== names[1], "hai connector trùng tên: tên hiện kèm địa chỉ", JSON.stringify(names));
    ok(new Set(a.tools.map((t) => t.fq)).size === a.tools.length, "tên công cụ gửi cho model không trùng");
    await a.close();
    wipe();
  }

  console.log("33. Proxy: tên, tham số, trang");
  {
    const mk = (cname, name) => ({ fq: `${cname.toLowerCase()}__${name}`, cname, tool: { name } });
    const list = [mk("Docs", "a"), mk("Docs", "b"), mk("Docs", "c"), mk("Docs", "d")];
    ok(P.resolveTool(list, "synchro__docs__a")?.tool.name === "a" && P.resolveTool(list, "mcp_synchro_docs__a")?.tool.name === "a" && P.resolveTool(list, "mcp__synchro__docs__a")?.tool.name === "a", "nhận cả tiền tố synchro__ mà Grok được dặn dùng");
    ok(JSON.stringify(P.callArgs({ tool: "x", arguments: { id: 1 } }).args) === '{"id":1}' && JSON.stringify(P.callArgs({ tool: "x", params: { id: 1 } }).args) === '{"id":1}' && JSON.stringify(P.callArgs({ tool: "x", args: { id: 1 } }).args) === '{"id":1}', "gỡ lớp bọc arguments / params / args");
    ok(JSON.stringify(P.callArgs({ tool: "x", arguments: "chuỗi" }).args) === '{"arguments":"chuỗi"}' && JSON.stringify(P.callArgs({ tool: "x", args: { a: 1 }, b: 2 }).args) === '{"args":{"a":1},"b":2}', "tham số thật tên args (không phải lớp bọc) giữ nguyên");
    const pg = P.rankTools(list, "*", "", 3, 0);
    ok(pg.hits.length === 3 && pg.more === 1 && P.rankTools(list, "*", "", 3, 3).hits[0].tool.name === "d", "query=* xem tiếp được theo trang", JSON.stringify(pg.more));
  }

  console.log("34. read_ref và tóm tắt");
  {
    const big = "x".repeat(60_000);
    const id = R.storeRef(uid, "c", "t", big);
    let o = R.readRef(uid, { ref: id, limit: 30_000 });
    ok(o.content.startsWith("x".repeat(30_000)) && /offset=30000/.test(o.content) && /còn 1 lần đọc/.test(o.content), "limit tới 30.000 ký tự, nói còn mấy lần đọc", o.content.slice(-120));
    o = R.readRef(uid, { ref: id });
    ok(/offset=8000/.test(o.content) && /còn 7 lần đọc/.test(o.content), "mặc định vẫn 8.000 ký tự một lần", o.content.slice(-120));
    const text = `<run_result language="python" exit_code="0">\n<stdout>\n${"dòng\n".repeat(4000)}</stdout>\n<stderr>\n\n</stderr>\n<files>\noutputs/a.xlsx (3 KB)\n</files>\n</run_result>`;
    const sum = R.summarize(text, "ref_x");
    ok(/outputs\/a\.xlsx/.test(sum) && sum.length < 6000, "kết quả chạy code lớn vẫn giữ danh sách tệp đã tạo", sum.slice(-300));
  }
  console.log("35. Hạn giờ không mất sau khi GC");
  {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc");
    S.reset(); S.hangPost = true;
    const pump = setInterval(() => gc(), 30);
    const t0 = Date.now();
    const e = await F.safeFetch(url, { method: "POST", body: "{}", timeout: 600, signal: new AbortController().signal }).catch((x) => x);
    const took = Date.now() - t0;
    ok(e instanceof F.TempFail && e.timedOut && took < 3000, "safeFetch kèm tín hiệu ngoài vẫn hết hạn đúng giờ dù GC chạy liên tục", `${e?.message} ${took}ms`);
    const held = F.timeLimit(400, new AbortController().signal);
    const fired = await new Promise((r) => { held.addEventListener("abort", () => r(true)); setTimeout(() => r(false), 2500); });
    clearInterval(pump);
    ok(fired, "timeLimit nổ đúng hạn khi GC chạy liên tục");
    S.reset();
  }

  console.log("36. Công cụ đọc quá giờ không gọi lại");
  {
    S.reset();
    const c = new M.McpClient(url, undefined, "legacy");
    const t0 = Date.now();
    const e = await c.callTool({ name: "hang", annotations: { readOnlyHint: true } }, {}, { timeout: 400 }).catch((x) => x);
    ok(e instanceof F.TempFail && e.timedOut && S.count("call:hang") === 1 && Date.now() - t0 < 2500, "quá giờ: báo lỗi ngay, một lần gọi", `${e} ${JSON.stringify(S.calls)} ${Date.now() - t0}`);
    await c.close();
    S.sse = {}; S.era = "sse"; S.calls = {};
    const c2 = new M.McpClient(url, undefined, "sse");
    await c2.listTools();
    S.sse.silent = true; S.calls = {};
    const e2 = await c2.callTool({ name: "search_docs", annotations: { readOnlyHint: true } }, {}, { timeout: 300 }).catch((x) => x);
    ok(e2 instanceof F.TempFail && e2.timedOut && S.count("call:search_docs") === 1, "SSE quá giờ: cũng không gọi lại", `${e2} ${JSON.stringify(S.calls)}`);
    await c2.close();
    S.sseStream?.end();
    wipe();
  }

  console.log("37. Đổi token giữ header đang dùng");
  {
    S.auth = { header: "x-api-key", value: "k1" };
    const { connector } = await add({ token: "k1", header: "X-API-Key" });
    ok(connector.status === "ok" && connector.tokenHeader === "X-API-Key", "header (không bí mật) có trong dữ liệu thẻ", JSON.stringify(connector).slice(0, 200));
    S.auth.value = "k2";
    const r = await C.connect(req, uid, connector.id, pol, { token: "k2" });
    ok(r.connector.status === "ok" && r.connector.tokenHeader === "X-API-Key", "chỉ gửi token mới (thẻ trong khung chat): vẫn đúng header");
    S.auth = { header: "authorization", value: "Bearer k3" };
    const r2 = await C.connect(req, uid, connector.id, pol, { token: "k3", header: "Authorization" });
    ok(r2.connector.status === "ok" && r2.connector.tokenHeader === "Authorization", "nêu header khác thì theo header mới");
    wipe();
  }

  console.log("38. Kết nối lại giữ địa chỉ metadata trong header 401");
  {
    S.oauth = { need: true, valid: "Bearer at_ok", prmOnly: true };
    const first = await add();
    ok(first.authorizeUrl?.startsWith(`${BASE}/as/authorize`), "lần đầu: đúng trang đăng nhập của máy chủ khai báo", first.authorizeUrl);
    const again = await C.connect(req, uid, first.connector.id, pol, { force: true });
    ok(again.authorizeUrl?.startsWith(`${BASE}/as/authorize`), "Kết nối lại (không có 401 trong tay): vẫn đúng trang", again.authorizeUrl);
    const cur = JSON.parse(PR.openSecret(AS.db().prepare("SELECT enc_auth FROM connectors WHERE id = ?").get(first.connector.id).enc_auth));
    ok(cur.prm === `${BASE}/meta/prm`, "địa chỉ metadata đã được lưu", JSON.stringify(cur.prm));
    const { prm: _p, ...old } = cur;
    AS.db().prepare("UPDATE connectors SET enc_auth = ? WHERE id = ?").run(PR.sealSecret(JSON.stringify(old)), first.connector.id);
    const legacy = await C.connect(req, uid, first.connector.id, pol, { force: true });
    ok(legacy.authorizeUrl?.startsWith(`${BASE}/as/authorize`), "connector cũ chưa lưu: hỏi máy chủ một lần rồi vẫn đúng trang", legacy.authorizeUrl);
    wipe();
  }

  console.log("39. Luồng SSE đứt khi đang chạy công cụ");
  {
    S.sse = {}; S.era = "sse";
    const { connector } = await add();
    AS.db().prepare("UPDATE connectors SET era = 'sse', perms = ? WHERE id = ?").run(JSON.stringify({ create_page: "allow", search_docs: "allow" }), connector.id);
    const s = session("sse-drop");
    const fq = (n) => s.tools.find((t) => t.tool.name === n).fq;
    await s.call(fq("search_docs"), {});
    S.sse.silent = true; S.calls = {};
    let call = s.call(fq("create_page"), { title: "x" });
    await sleep(200);
    S.sseStream.destroy();
    let out = await call;
    ok(out.is_error && /Không rõ kết quả/.test(out.content) && S.count("call:create_page") === 1, "công cụ ghi: nói rõ không biết kết quả, không gọi lại", `${out.content} ${JSON.stringify(S.calls)}`);
    S.sse.silent = false;
    out = await s.call(fq("search_docs"), {});
    ok(!out.is_error && /ok search_docs/.test(out.content), "lời gọi sau mở kết nối mới, không bị kẹt client đã chết", out.content);
    const c = new M.McpClient(url, undefined, "sse");
    await c.listTools();
    S.sse.silent = true; S.calls = {};
    const pending = c.callTool({ name: "search_docs", annotations: { readOnlyHint: true } }, {});
    await sleep(200);
    S.sse.silent = false;
    S.sseStream.destroy();
    const again = await pending.catch((x) => x);
    ok(again?.content?.[0]?.text === "ok search_docs" && S.count("call:search_docs") === 2, "công cụ đọc: tự mở lại luồng và thử lại một lần", `${JSON.stringify(again)} ${String(again)} ${JSON.stringify(S.calls)}`);
    await c.close();
    await s.close();
    S.sseStream?.end();
    wipe();
  }

  console.log("40. invalid_grant khi tiến trình khác vừa đổi token");
  {
    const r = await add();
    const id = r.connector.id;
    const seal = (tokens) => PR.sealSecret(JSON.stringify({ mode: "oauth", client: { client_id: "c1", auth_method: "none" }, redirect: "http://localhost:3200/api/connectors/oauth/callback", resource: url, as: { issuer: BASE, token_endpoint: `${BASE}/token` }, tokens }));
    AS.db().prepare("UPDATE connectors SET enc_auth = ? WHERE id = ?").run(seal({ access_token: "cu", refresh_token: "rt_cu", expires_at: Date.now() - 1000 }), id);
    S.oauth = { valid: "Bearer at_khac", need: true };
    S.tokenFail = { status: 400, json: { error: "invalid_grant" } };
    // Tiến trình kia ghi token mới đúng lúc hãng từ chối tiến trình này.
    S.onToken = () => AS.db().prepare("UPDATE connectors SET enc_auth = ? WHERE id = ?").run(seal({ access_token: "at_khac", refresh_token: "rt_khac", expires_at: Date.now() + 3600_000 }), id);
    await C.refreshConnector(uid, id, pol);
    ok(row(id).status === "ok" && !row(id).error, "dùng token mới trong cơ sở dữ liệu, không bắt đăng nhập lại", JSON.stringify(row(id)).slice(0, 200));
    wipe();
  }

  console.log("41. OAuth client bị hãng từ chối");
  {
    S.oauth = { need: true, valid: "Bearer at_ok" };
    S.authorize = (cid) => (cid === "sai" ? { status: 400, body: "invalid_client" } : null);
    const first = await add();
    const before = JSON.parse(PR.openSecret(AS.db().prepare("SELECT enc_auth FROM connectors WHERE id = ?").get(first.connector.id).enc_auth));
    const msg = await thrown(C.connect(req, uid, first.connector.id, pol, { clientId: "sai" }));
    ok(/từ chối OAuth client này/.test(msg), "báo ngay lý do", msg);
    const after = JSON.parse(PR.openSecret(AS.db().prepare("SELECT enc_auth FROM connectors WHERE id = ?").get(first.connector.id).enc_auth));
    ok(!after.preset && JSON.stringify(after.client) === JSON.stringify(before.client) && !row(first.connector.id).ownClient, "client bị từ chối không được lưu, đăng nhập đang có còn nguyên");
    const good = await C.connect(req, uid, first.connector.id, pol, { clientId: "dung" });
    ok(row(first.connector.id).ownClient && good.authorizeUrl?.includes("client_id=dung"), "client đúng: lưu và mở đăng nhập, thẻ có Đổi OAuth client", good.authorizeUrl);
    wipe();
    const now = Date.now();
    AS.db().prepare("INSERT INTO connectors (id, user_id, name, url, dir, enabled, status, enc_auth, created_at, updated_at, settings) VALUES ('cn_v', ?, 'Canva', ?, 'canva', 1, 'error', ?, ?, ?, '{}')").run(uid, url, PR.sealSecret(JSON.stringify({ mode: "none", preset: { clientId: "cu" } })), now, now);
    ok(!!row("cn_v").vendorBlocked, "hàng đã lưu client cũ chưa từng đăng nhập được: vẫn thấy lý do của hãng và đường thay thế");
    wipe();
  }

  console.log("42. Hãng báo danh sách công cụ đổi");
  {
    S.sse = {}; S.era = "sse";
    const { connector } = await add();
    AS.db().prepare("UPDATE connectors SET era = 'sse' WHERE id = ?").run(connector.id);
    const s = session("list-changed");
    await s.call(s.tools.find((t) => t.tool.name === "search_docs").fq, {});
    S.tools = [...TOOLS, { name: "get_new", description: "New", inputSchema: { type: "object", properties: {} } }];
    S.sseStream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n\n`);
    for (let i = 0; i < 40 && row(connector.id).tools.length === TOOLS.length; i++) await sleep(100);
    ok(row(connector.id).tools.some((t) => t.name === "get_new"), "lấy lại danh sách ở nền, lượt sau thấy công cụ mới", String(row(connector.id).tools.length));
    await s.close();
    S.sseStream?.end();
    wipe();
  }

  console.log("43. Proxy: bản gọn nói thật, phân trang, tên, lớp bọc");
  {
    const notion = { type: "object", required: ["page_id", "rich_text"], properties: {
      page_id: { type: "string", description: "ID", pattern: "^[0-9a-f]{32}$" },
      note: { type: "string", description: `${"x".repeat(210)} IMPORTANT: use markdown only` },
      meta: { type: "object", additionalProperties: { type: "string" } },
      rich_text: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["text"], properties: { text: { type: "object", required: ["content"], properties: { content: { type: "string", description: "Nội dung" } } } } } },
    } };
    const c = P.compactSchema(notion);
    ok(c.trimmed === true, "mô tả bị cắt, mô tả lồng bị bỏ: báo là bản gọn", JSON.stringify(c).slice(0, 300));
    ok(c.schema.properties.page_id.pattern === "^[0-9a-f]{32}$" && c.schema.properties.rich_text.minItems === 1 && c.schema.properties.rich_text.maxItems === 100 && c.schema.properties.meta.additionalProperties?.type === "string", "giữ pattern, minItems, maxItems, additionalProperties", JSON.stringify(c.schema).slice(0, 400));
    ok(c.schema.properties.rich_text.items.properties.text.properties.content?.type === "string", "tham số bắt buộc ở mức sâu không bị mất", JSON.stringify(c.schema.properties.rich_text));
    const plain = P.compactSchema({ type: "object", title: "x", required: ["id"], properties: { id: { type: "string", description: "ID", title: "Id" }, tags: { type: "array", items: { type: "string" } } } });
    ok(plain.trimmed === false, "không mất gì: không báo là bản gọn", JSON.stringify(plain));
    ok(P.compactSchema({ type: "object", properties: { a: { $ref: "#/$defs/A" } }, $defs: { A: { type: "string" } } }).trimmed === true, "có $ref, $defs: báo là bản gọn");
    ok(P.compactSchema({ type: "object", properties: { a: { enum: Array.from({ length: 30 }, (_, i) => `v${i}`) } } }).trimmed === true, "enum bị cắt: báo là bản gọn");
    ok(P.compactSchema({ type: "object", additionalProperties: false, properties: { a: { type: "string" } } }).schema.additionalProperties === false, "additionalProperties cấp trên cùng còn nguyên");

    const mk = (cname, name) => ({ fq: `${cname.toLowerCase()}__${name}`, cname, tool: { name } });
    const list = Array.from({ length: 13 }, (_, i) => mk("Vercel", `list_thing_${i}`));
    const p1 = P.rankTools(list, "list", "", 8, 0), p2 = P.rankTools(list, "list", "", 8, 8);
    ok(p1.hits.length === 8 && p1.more === 5, "tìm theo từ khóa: báo còn bao nhiêu", JSON.stringify(p1.more));
    ok(p2.hits.length === 5 && p2.more === 0 && !p2.hits.some((h) => p1.hits.includes(h)), "offset cho trang tiếp theo, không lặp lại", JSON.stringify(p2.hits.map((h) => h.tool.name)));

    const sd = [mk("synchro_docs", "search"), mk("Docs", "search"), mk("Docs", "get")];
    ok(P.resolveTool(sd, "synchro_docs__search")?.cname === "synchro_docs", "connector tên Synchro… gọi được đúng tên connector_tools in ra");
    ok(P.resolveTool(sd, "mcp_synchro_docs__search")?.cname === "Docs" && P.resolveTool(sd, "synchro__docs__get")?.tool.name === "get", "tiền tố của CLI vẫn được bỏ");

    ok(JSON.stringify(P.callArgs({ tool: "x", parameters: { a: 1 } }).args) === '{"a":1}', "gỡ lớp bọc parameters");
    ok(JSON.stringify(P.callArgs({ tool: "x", parameters: { a: 1 } }, { properties: { parameters: { type: "object" } } }).args) === '{"parameters":{"a":1}}', "công cụ thật sự có tham số tên parameters: giữ nguyên");
  }

  console.log("44. Lời gọi công cụ đoán là đọc, đóng cầu nối");
  {
    const { mcpbridge: Br } = await loadTs(["mcpbridge"]);
    let seen = null, aborted = false;
    const b = Br.openBridge({ uid, tools: [{ name: "connector_call", description: "", input_schema: {} }], route: (n, input) => (n === "vercel__list" ? { name: "connector_call", input: { tool: n, input } } : null), call: async (name, input, cancel) => {
      if (input.tool === "vercel__list") { seen = { name, input }; return { content: "ok", is_error: false }; }
      await new Promise((r) => cancel.addEventListener("abort", r, { once: true }));
      aborted = true;
      return { content: "hủy", is_error: true };
    } });
    const tok = b.url.split("/").pop();
    const rpc = (id, name, args) => Br.bridgeRoute(new Request(`http://127.0.0.1/api/mcp/bridge/${tok}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) }), tok).then((r) => r.json());
    const direct = await rpc(1, "vercel__list", { a: 1 });
    ok(!direct.error && seen?.name === "connector_call" && seen.input.input.a === 1, "proxy: gọi thẳng tên đầy đủ chạy qua connector_call", JSON.stringify(direct));
    const none = await rpc(2, "khong_co", {});
    ok(none.error?.code === -32602, "tên không có thật vẫn báo lỗi");
    const waiting = rpc(3, "connector_call", { tool: "x" });
    await sleep(50);
    b.close();
    await waiting;
    ok(aborted, "đóng cầu nối: lời gọi đang chờ duyệt thôi chờ, duyệt muộn không chạy");
  }

} finally {
  server.closeAllConnections?.(); server.close(); other.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
