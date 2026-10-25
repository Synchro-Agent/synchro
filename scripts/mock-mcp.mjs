// Máy chủ MCP giả lập để thử Connectors của Synchro ở máy cục bộ (npm run dev:mock tự chạy ở cổng 4011).
//  /mcp     Streamable HTTP đời 2025 (initialize + Mcp-Session-Id), BẮT BUỘC đăng nhập OAuth đầy đủ: Protected Resource Metadata,
//           metadata máy chủ đăng nhập, đăng ký động, trang đồng ý, PKCE S256, iss, refresh token xoay vòng. Công cụ: ghi chú.
//  /modern  Giao thức 2026-07-28 (không phiên, _meta + header Mcp-Method / Mcp-Name / Mcp-Param-*), không cần đăng nhập.
//  /sse     HTTP+SSE đời 2024-11-05 (GET mở luồng, sự kiện endpoint, POST tới /messages), không cần đăng nhập.
// POST /__expire làm mọi access token hết hạn để thử luồng làm mới token.
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const rid = (n = 12) => crypto.randomBytes(n).toString("base64url");
const s256 = (v) => crypto.createHash("sha256").update(v).digest("base64url");

export function startMockMcp(port = 4011) {
  const BASE = `http://127.0.0.1:${port}`;
  const clients = new Map(), codes = new Map(), access = new Map(), refresh = new Map(), sessions = new Set(), sse = new Map();
  const notes = [{ id: "n1", title: "Kế hoạch ra mắt Synchro", body: "Ra mắt bản desktop vào tháng 12, mobile quý 1." }, { id: "n2", title: "Ý tưởng tên tính năng", body: "Connectors, Skills, Speech." }];

  const NOTE_TOOLS = [
    { name: "search_notes", title: "Search notes", description: "Tìm ghi chú theo từ khóa.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Từ khóa" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
    { name: "create_note", title: "Create note", description: "Tạo ghi chú mới.", inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
    { name: "delete_note", title: "Delete note", description: "Xóa một ghi chú theo id.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, annotations: { readOnlyHint: false, destructiveHint: true } },
  ];
  const MODERN_TOOLS = [
    { name: "get_time", title: "Get time", description: "Giờ hiện tại của máy chủ.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
    { name: "lookup_region", title: "Lookup region", description: "Tra thông tin một vùng.", inputSchema: { type: "object", properties: { region: { type: "string", "x-mcp-header": "Region" }, detail: { type: "boolean" } }, required: ["region"] }, annotations: { readOnlyHint: true } },
    { name: "list_orders", title: "List orders", description: "Liệt kê đơn hàng của cửa hàng (dữ liệu lớn).", inputSchema: { type: "object", properties: { limit: { type: "integer" } } }, annotations: { readOnlyHint: true } },
  ];
  // Kết quả lớn (~60 KB JSON) để thử ngữ cảnh theo tham chiếu: Synchro không nhét nguyên văn vào lịch sử chat.
  const CITY = ["Hà Nội", "Đà Nẵng", "TP. Hồ Chí Minh", "Cần Thơ", "Hải Phòng"];
  const ORDERS = Array.from({ length: 400 }, (_, i) => ({ id: `DH${String(i + 1).padStart(4, "0")}`, customer: `Khách ${i + 1}`, city: CITY[i % 5], total: 150000 + ((i * 7919) % 90) * 10000, status: i % 7 === 0 ? "đã hủy" : i % 3 === 0 ? "đang giao" : "đã giao", items: [{ sku: `SP${(i % 23) + 1}`, qty: (i % 4) + 1 }] }));
  const SSE_TOOLS = [{ name: "echo", title: "Echo", description: "Lặp lại nội dung gửi vào.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, annotations: { readOnlyHint: true } }];

  // Logo để thử tự nhận diện: trang chủ khai báo favicon SVG; máy chủ /modern tự khai báo icon trong serverInfo.
  const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#F59E0B"/><path d="M18 18h28v6H18zm0 11h28v6H18zm0 11h18v6H18z" fill="#fff"/></svg>`;
  const MODERN_ICON = "data:image/svg+xml;base64," + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#7C3AED"/><path d="M32 14l14 32H18z" fill="#fff"/></svg>`).toString("base64");
  const MODERN_INFO = { name: "mock-modern", title: "Mock Modern", version: "1.0.0", icons: [{ src: MODERN_ICON, mimeType: "image/svg+xml", sizes: ["any"] }] };
  const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
  function callNotes(name, a = {}) {
    if (name === "search_notes") { const q = String(a.query ?? "").toLowerCase(); const r = notes.filter((n) => (n.title + " " + n.body).toLowerCase().includes(q)); return text(r.length ? r.map((n) => `[${n.id}] ${n.title}: ${n.body}`).join("\n") : "Không có ghi chú nào khớp."); }
    if (name === "create_note") { if (!a.title) return text("Thiếu title.", true); const n = { id: "n" + (notes.length + 1), title: String(a.title), body: String(a.body ?? "") }; notes.push(n); return text(`Đã tạo ghi chú ${n.id}: ${n.title}`); }
    if (name === "delete_note") { const i = notes.findIndex((n) => n.id === a.id); if (i < 0) return text(`Không có ghi chú ${a.id}.`, true); notes.splice(i, 1); return text(`Đã xóa ghi chú ${a.id}.`); }
    return null;
  }

  const send = (res, code, obj, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
  const html = (res, body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(body); };
  const body = (req) => new Promise((ok) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => ok(s)); });
  const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
  const err = (id, code, message, data) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
  const decode = (v) => (v && v.startsWith("=?base64?") && v.endsWith("?=") ? Buffer.from(v.slice(9, -2), "base64").toString("utf8") : v);
  const bearer = (req) => { const t = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""); const a = access.get(t); return a && a.exp > Date.now() ? a : null; };

  async function handler(req, res) {
    const u = new URL(req.url, BASE);
    const p = u.pathname;

    if (p === "/" && req.method === "GET") return html(res, `<!doctype html><html><head><title>Mock Notes</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="mask-icon" href="/mask.svg"></head><body>Mock Notes</body></html>`);
    if (p === "/favicon.svg") { res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end(FAVICON); }
    // ---------------- OAuth ----------------
    if (p === "/.well-known/oauth-protected-resource/mcp" || p === "/.well-known/oauth-protected-resource") return send(res, 200, { resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ["notes:read", "notes:write"], bearer_methods_supported: ["header"] });
    if (p === "/.well-known/oauth-authorization-server") return send(res, 200, { issuer: BASE, authorization_endpoint: `${BASE}/authorize`, token_endpoint: `${BASE}/token`, registration_endpoint: `${BASE}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["notes:read", "notes:write", "offline_access"], authorization_response_iss_parameter_supported: true });
    if (p === "/register" && req.method === "POST") {
      const b = json(await body(req)) ?? {};
      if (!Array.isArray(b.redirect_uris) || !b.redirect_uris.length) return send(res, 400, { error: "invalid_redirect_uri" });
      const c = { client_id: "mock_" + rid(8), redirect_uris: b.redirect_uris, client_name: b.client_name };
      clients.set(c.client_id, c);
      return send(res, 201, { ...c, client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: "none" });
    }
    if (p === "/authorize") {
      // Client đã đăng ký trước lần khởi động lại máy chủ giả lập vẫn được nhận (máy chủ chỉ lưu trong bộ nhớ).
      const q = u.searchParams, cid = q.get("client_id") ?? "";
      if (!clients.has(cid) && cid.startsWith("mock_") && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(q.get("redirect_uri") ?? "")) clients.set(cid, { client_id: cid, redirect_uris: [q.get("redirect_uri")], client_name: "Synchro" });
      const c = clients.get(cid);
      if (!c || !c.redirect_uris.includes(q.get("redirect_uri"))) return html(res, "<p>client_id hoặc redirect_uri không hợp lệ.</p>");
      if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return html(res, "<p>Thiếu PKCE S256.</p>");
      if (q.get("resource") !== `${BASE}/mcp`) return html(res, `<p>resource không đúng: ${q.get("resource")}</p>`);
      const back = new URL(q.get("redirect_uri"));
      back.searchParams.set("state", q.get("state") ?? "");
      back.searchParams.set("iss", BASE);
      if (q.get("decision") === "deny") { back.searchParams.set("error", "access_denied"); res.writeHead(302, { location: back.toString() }); return res.end(); }
      if (q.get("decision") === "allow") {
        const code = rid(16);
        codes.set(code, { client: c.client_id, challenge: q.get("code_challenge"), redirect: q.get("redirect_uri"), scope: q.get("scope") ?? "", exp: Date.now() + 60_000 });
        back.searchParams.set("code", code);
        res.writeHead(302, { location: back.toString() }); return res.end();
      }
      const a = new URL(u); a.searchParams.set("decision", "allow");
      const d = new URL(u); d.searchParams.set("decision", "deny");
      return html(res, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mock Notes</title>
<body style="font:15px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f5f2"><div style="background:#fff;padding:28px;border-radius:14px;max-width:360px;box-shadow:0 4px 24px rgba(0,0,0,.08)">
<h2 style="margin:0 0 8px;font-size:18px">Mock Notes</h2><p style="color:#555"><b>${(c.client_name ?? "Ứng dụng").replace(/</g, "&lt;")}</b> muốn truy cập ghi chú của bạn (${(q.get("scope") ?? "").replace(/</g, "&lt;")}).</p>
<div style="display:flex;gap:8px;justify-content:flex-end"><a id="deny" href="${d}" style="padding:8px 14px;border-radius:8px;border:1px solid #ddd;color:#333;text-decoration:none">Từ chối</a><a id="allow" href="${a}" style="padding:8px 14px;border-radius:8px;background:#141413;color:#fff;text-decoration:none">Cho phép</a></div></div>`);
    }
    if (p === "/token" && req.method === "POST") {
      const f = new URLSearchParams(await body(req));
      const issue = (client, scope) => {
        const at = "at_" + rid(16), rt = "rt_" + rid(16);
        access.set(at, { client, scope, exp: Date.now() + 3600_000 }); refresh.set(rt, { client, scope });
        return { access_token: at, token_type: "Bearer", expires_in: 3600, refresh_token: rt, scope };
      };
      if (f.get("grant_type") === "authorization_code") {
        const c = codes.get(f.get("code") ?? "");
        codes.delete(f.get("code") ?? "");
        if (!c || c.exp < Date.now()) return send(res, 400, { error: "invalid_grant", error_description: "Mã đã hết hạn hoặc đã dùng." });
        if (c.client !== f.get("client_id") || c.redirect !== f.get("redirect_uri")) return send(res, 400, { error: "invalid_grant", error_description: "client_id/redirect_uri không khớp." });
        if (s256(f.get("code_verifier") ?? "") !== c.challenge) return send(res, 400, { error: "invalid_grant", error_description: "PKCE không đúng." });
        if (f.get("resource") !== `${BASE}/mcp`) return send(res, 400, { error: "invalid_target" });
        return send(res, 200, issue(c.client, c.scope));
      }
      if (f.get("grant_type") === "refresh_token") {
        const r = refresh.get(f.get("refresh_token") ?? "");
        if (!r || r.client !== f.get("client_id")) return send(res, 400, { error: "invalid_grant" });
        refresh.delete(f.get("refresh_token"));
        return send(res, 200, issue(r.client, r.scope));
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }
    if (p === "/__expire" && req.method === "POST") { for (const v of access.values()) v.exp = 0; return send(res, 200, { ok: true }); }

    // ---------------- /mcp: Streamable HTTP đời 2025, có đăng nhập ----------------
    if (p === "/mcp") {
      if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
      if (!bearer(req)) return send(res, 401, { error: "invalid_token" }, { "www-authenticate": `Bearer realm="mock", resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp", scope="notes:read notes:write"` });
      const m = json(await body(req));
      if (!m) return send(res, 400, err(null, -32700, "Parse error"));
      if (m.method === "initialize") {
        const sid = rid(10); sessions.add(sid);
        return send(res, 200, ok(m.id, { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "mock-notes", title: "Mock Notes", version: "1.0.0" } }), { "mcp-session-id": sid });
      }
      const sid = req.headers["mcp-session-id"];
      if (!sid || !sessions.has(sid)) return send(res, sid ? 404 : 400, err(m.id ?? null, -32000, "Bad Request: No valid session ID provided"));
      if (m.id === undefined) { res.writeHead(202); return res.end(); }
      if (m.method === "tools/list") return send(res, 200, ok(m.id, { tools: NOTE_TOOLS }));
      if (m.method === "tools/call") {
        const r = callNotes(m.params?.name, m.params?.arguments);
        if (!r) return send(res, 200, err(m.id, -32602, `Unknown tool ${m.params?.name}`));
        // Trả lời bằng luồng SSE (kèm một thông báo tiến độ) để thử cách đọc SSE của Synchro.
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1, total: 2 } })}\n\n`);
        res.write(`event: message\ndata: ${JSON.stringify(ok(m.id, r))}\n\n`);
        return res.end();
      }
      return send(res, 200, err(m.id, -32601, "Method not found"));
    }

    // ---------------- /modern: 2026-07-28, không phiên ----------------
    if (p === "/modern") {
      if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
      const m = json(await body(req));
      if (!m) return send(res, 400, err(null, -32700, "Parse error"));
      const meta = m.params?._meta ?? {};
      const ver = meta["io.modelcontextprotocol/protocolVersion"];
      if (!ver || !meta["io.modelcontextprotocol/clientCapabilities"]) return send(res, 400, err(m.id ?? null, -32602, "Missing required _meta fields"));
      if (ver !== "2026-07-28") return send(res, 400, err(m.id, -32022, "Unsupported protocol version", { supported: ["2026-07-28"], requested: ver }));
      if (req.headers["mcp-protocol-version"] !== ver || req.headers["mcp-method"] !== m.method) return send(res, 400, err(m.id, -32020, "Header mismatch: MCP-Protocol-Version / Mcp-Method"));
      const info = { "io.modelcontextprotocol/serverInfo": MODERN_INFO };
      if (m.method === "server/discover") return send(res, 200, ok(m.id, { resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, serverInfo: MODERN_INFO, _meta: info }));
      if (m.method === "tools/list") return send(res, 200, ok(m.id, { resultType: "complete", tools: MODERN_TOOLS, _meta: info }));
      if (m.method === "tools/call") {
        if (decode(req.headers["mcp-name"]) !== m.params?.name) return send(res, 400, err(m.id, -32020, "Header mismatch: Mcp-Name"));
        if (m.params.name === "get_time") return send(res, 200, ok(m.id, { resultType: "complete", ...text(`Giờ máy chủ: ${new Date().toISOString()}`), _meta: info }));
        if (m.params.name === "list_orders") return send(res, 200, ok(m.id, { resultType: "complete", ...text(JSON.stringify({ shop: "Synchro Store", count: ORDERS.length, orders: ORDERS })), _meta: info }));
        if (m.params.name === "lookup_region") {
          const region = m.params.arguments?.region;
          if (decode(req.headers["mcp-param-region"]) !== region) return send(res, 400, err(m.id, -32020, "Header mismatch: Mcp-Param-Region"));
          return send(res, 200, ok(m.id, { resultType: "complete", ...text(`Vùng ${region}: hoạt động bình thường.`), structuredContent: { region, ok: true }, _meta: info }));
        }
        return send(res, 200, ok(m.id, { resultType: "complete", ...text(`Không có công cụ ${m.params.name}`, true) }));
      }
      return send(res, 404, err(m.id, -32601, "Method not found"));
    }

    // ---------------- /sse: HTTP+SSE đời 2024-11-05 ----------------
    if (p === "/sse" && req.method === "GET") {
      const sid = rid(8);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`event: endpoint\ndata: /messages?sessionId=${sid}\n\n`);
      sse.set(sid, res);
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => { clearInterval(ping); sse.delete(sid); });
      return;
    }
    if (p === "/messages" && req.method === "POST") {
      const stream = sse.get(u.searchParams.get("sessionId") ?? "");
      if (!stream) return send(res, 404, { error: "unknown session" });
      const m = json(await body(req));
      res.writeHead(202); res.end();
      if (!m || m.id === undefined) return;
      let out;
      if (m.method === "initialize") out = ok(m.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mock-sse", title: "Mock SSE", version: "1.0.0" } });
      else if (m.method === "tools/list") out = ok(m.id, { tools: SSE_TOOLS });
      else if (m.method === "tools/call" && m.params?.name === "echo") out = ok(m.id, text(`Echo: ${m.params.arguments?.text ?? ""}`));
      else out = err(m.id, -32601, "Method not found");
      setTimeout(() => stream.write(`event: message\ndata: ${JSON.stringify(out)}\n\n`), 30);
      return;
    }
    send(res, 404, { error: `Không có đường dẫn ${p}` });
  }

  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => handler(req, res).catch((e) => send(res, 500, { error: String(e) })));
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.argv[2] ?? 4011);
  await startMockMcp(port);
  console.log(`Máy chủ MCP giả lập: http://127.0.0.1:${port}/mcp (OAuth) · /modern · /sse`);
}
