// Composio Connect giả lập (gắn vào API giả lập ở /composio/… và /.well-known/…/composio): máy chủ MCP cá nhân của từng tài khoản Composio, như
// https://connect.composio.dev/mcp thật, đủ để chạy thử "Liên kết Composio" của Synchro không cần tài khoản thật, không ra Internet.
//  GET  /.well-known/oauth-protected-resource/composio/mcp   Protected Resource Metadata: authorization_servers = [<gốc>/composio]
//  GET  /.well-known/oauth-authorization-server/composio     metadata máy chủ đăng nhập (như connect.composio.dev: không có iss trong lần chuyển về)
//  POST /composio/oauth2/register                            đăng ký động (DCR)
//  GET  /composio/oauth/authorize                            trang đăng nhập Composio: nút Cho phép / Từ chối; &as=<tài khoản> chọn tài khoản Composio (mặc định "demo")
//  POST /composio/oauth2/token                               authorization_code (PKCE S256 bắt buộc) và refresh_token (xoay vòng)
//  POST /composio/mcp                                        MCP Streamable HTTP không phiên: Bearer <token> hoặc x-consumer-api-key: ck_…; thiếu thì 401 + WWW-Authenticate
//  GET  /composio/link/{id}                                  Connect Link: mở là coi như đã liên kết ứng dụng (ACTIVE)
//  GET/POST /composio/_debug                                 xem trạng thái; { reset }, { link: { account, slug } } (liên kết ứng dụng "trên web Composio"),
//                                                            { expire } (token hết hạn), { revoke } (thu hồi mọi token)
// Mỗi tài khoản Composio chỉ thấy ứng dụng của chính nó. Token / khóa không bao giờ được ghi vào nhật ký lời gọi.
import crypto from "node:crypto";

/** Khóa người dùng ck_ của hai tài khoản Composio giả lập. */
export const CK_KEYS = { alice: "ck_mock_alice_00000001", bob: "ck_mock_bob_000000001" };
// calls: lời gọi công cụ (tài khoản, tên, không có token); accounts: ứng dụng đã liên kết theo tài khoản Composio.
export const CX = { clients: new Map(), codes: new Map(), access: new Map(), refresh: new Map(), accounts: [], calls: [], seq: 0, lists: 0 };
const rid = (n = 12) => crypto.randomBytes(n).toString("base64url");
const s256 = (v) => crypto.createHash("sha256").update(v).digest("base64url");
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); return true; };
const html = (res, body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(body); return true; };
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const text = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const TOOLS = [
  { name: "COMPOSIO_SEARCH_TOOLS", description: "Search for the right tools across 1000+ apps for a use case.", inputSchema: { type: "object", properties: { queries: { type: "array", items: { type: "object", properties: { use_case: { type: "string" } } } } }, required: ["queries"] } },
  { name: "COMPOSIO_MANAGE_CONNECTIONS", description: "Check or create connections for toolkits. Returns a redirect_url for the user to sign in when a toolkit is not connected.", inputSchema: { type: "object", properties: { toolkits: { type: "array", items: { type: "string" } }, reinitiate_all: { type: "boolean" } }, required: ["toolkits"] } },
  { name: "COMPOSIO_MULTI_EXECUTE_TOOL", description: "Execute one or more tools found with COMPOSIO_SEARCH_TOOLS.", inputSchema: { type: "object", properties: { tools: { type: "array", items: { type: "object", properties: { tool_slug: { type: "string" }, arguments: { type: "object" } }, required: ["tool_slug", "arguments"] } } }, required: ["tools"] } },
];
const SLUGS = { gmail: ["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"], slack: ["SLACK_LIST_CHANNELS", "SLACK_SEND_MESSAGE"], github: ["GITHUB_LIST_REPOSITORIES", "GITHUB_CREATE_ISSUE"] };
const active = (acct, kit) => CX.accounts.find((a) => a.account === acct && a.slug === kit && a.status === "ACTIVE");

function whoIs(req) {
  const ck = req.headers["x-consumer-api-key"];
  if (typeof ck === "string") return Object.entries(CK_KEYS).find(([, v]) => v === ck)?.[0] ?? null;
  const t = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const a = CX.access.get(t);
  return a && a.exp > Date.now() ? a.account : null;
}

export async function composioHandler(req, res, p, b) {
  const origin = `http://${req.headers.host}`;
  const ISS = `${origin}/composio`, RES = `${origin}/composio/mcp`;
  if (p === "/.well-known/oauth-protected-resource/composio/mcp") return send(res, 200, { resource: RES, authorization_servers: [ISS], bearer_methods_supported: ["header"], resource_name: "Composio Connect" });
  if (p === "/.well-known/oauth-authorization-server/composio") return send(res, 200, { issuer: ISS, authorization_endpoint: `${ISS}/oauth/authorize`, token_endpoint: `${ISS}/oauth2/token`, registration_endpoint: `${ISS}/oauth2/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["openid", "profile", "email", "offline_access"] });
  if (!p.startsWith("/composio/")) return false;

  if (p === "/composio/_debug") {
    if (req.method === "POST") {
      if (b?.reset) { for (const k of ["clients", "codes", "access", "refresh"]) CX[k].clear(); CX.accounts.length = 0; CX.calls.length = 0; CX.lists = 0; }
      if (b?.link) { const acct = String(b.link.account ?? "demo"), slug = String(b.link.slug); CX.accounts = CX.accounts.filter((a) => !(a.account === acct && a.slug === slug)); CX.accounts.push({ id: `ca_${++CX.seq}`, account: acct, slug, status: "ACTIVE" }); }
      if (b?.unlink) CX.accounts = CX.accounts.filter((a) => !(a.account === String(b.unlink.account ?? "demo") && a.slug === String(b.unlink.slug)));
      if (b?.expire) for (const v of CX.access.values()) v.exp = 0;
      if (b?.revoke) { CX.access.clear(); CX.refresh.clear(); }
    }
    return send(res, 200, { accounts: CX.accounts, calls: CX.calls.slice(-60), clients: CX.clients.size, tokens: CX.access.size, lists: CX.lists });
  }
  // Connect Link: người dùng bấm, đăng nhập ứng dụng xong ở trang của Composio.
  const link = /^\/composio\/link\/([\w-]+)$/.exec(p);
  if (link && req.method === "GET") {
    const a = CX.accounts.find((x) => x.id === link[1]);
    if (!a) { res.writeHead(404, { "content-type": "text/html" }); res.end("<p>Link expired</p>"); return true; }
    a.status = "ACTIVE";
    return html(res, `<!doctype html><title>Connected</title><p id="done">Connected ${esc(a.slug)}. You can close this tab.</p>`);
  }

  // ---------------- OAuth ----------------
  if (p === "/composio/oauth2/register" && req.method === "POST") {
    if (!Array.isArray(b?.redirect_uris) || !b.redirect_uris.length) return send(res, 400, { error: "invalid_redirect_uri" });
    const c = { client_id: "cx_" + rid(8), redirect_uris: b.redirect_uris, client_name: b.client_name };
    CX.clients.set(c.client_id, c);
    return send(res, 201, { ...c, client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: "none" });
  }
  if (p === "/composio/oauth/authorize") {
    const q = new URL(req.url, origin).searchParams, cid = q.get("client_id") ?? "";
    // Client đã đăng ký trước lần khởi động lại máy giả lập vẫn được nhận (chỉ lưu trong bộ nhớ).
    if (!CX.clients.has(cid) && cid.startsWith("cx_") && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(q.get("redirect_uri") ?? "")) CX.clients.set(cid, { client_id: cid, redirect_uris: [q.get("redirect_uri")], client_name: "Synchro" });
    const c = CX.clients.get(cid);
    if (!c || !c.redirect_uris.includes(q.get("redirect_uri"))) return html(res, "<p>Invalid client_id or redirect_uri.</p>");
    if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return html(res, "<p>PKCE S256 required.</p>");
    if (q.get("resource") && q.get("resource") !== RES) return html(res, `<p>Invalid resource: ${esc(q.get("resource"))}</p>`);
    const back = new URL(q.get("redirect_uri"));
    back.searchParams.set("state", q.get("state") ?? "");
    if (q.get("decision") === "deny") { back.searchParams.set("error", "access_denied"); res.writeHead(302, { location: back.toString() }); res.end(); return true; }
    if (q.get("decision") === "allow") {
      const code = rid(16);
      CX.codes.set(code, { client: c.client_id, challenge: q.get("code_challenge"), redirect: q.get("redirect_uri"), account: (q.get("as") || "demo").slice(0, 40), exp: Date.now() + 60_000 });
      back.searchParams.set("code", code);
      res.writeHead(302, { location: back.toString() }); res.end(); return true;
    }
    const a = new URL(req.url, origin); a.searchParams.set("decision", "allow");
    const d = new URL(req.url, origin); d.searchParams.set("decision", "deny");
    return html(res, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in — Composio</title>
<body style="font:15px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f3fb"><div style="background:#fff;padding:28px;border-radius:14px;max-width:360px;box-shadow:0 4px 24px rgba(0,0,0,.08)">
<h2 style="margin:0 0 8px;font-size:18px">Composio</h2><p style="color:#555"><b>${esc(c.client_name ?? "An app")}</b> wants to use your Composio account and the apps you linked there.</p>
<div style="display:flex;gap:8px;justify-content:flex-end"><a id="deny" href="${esc(d)}" style="padding:8px 14px;border-radius:8px;border:1px solid #ddd;color:#333;text-decoration:none">Deny</a><a id="allow" href="${esc(a)}" style="padding:8px 14px;border-radius:8px;background:#5B4BDB;color:#fff;text-decoration:none">Allow</a></div></div>`);
  }
  if (p === "/composio/oauth2/token" && req.method === "POST") {
    // Thân yêu cầu dạng form (application/x-www-form-urlencoded): máy giả lập đọc sẵn vào req.__raw.
    const f = new URLSearchParams(req.__raw ? req.__raw.toString("utf8") : typeof b === "string" ? b : "");
    const issue = (client, account) => {
      const at = "cxat_" + rid(16), rt = "cxrt_" + rid(16);
      CX.access.set(at, { client, account, exp: Date.now() + 3600_000 }); CX.refresh.set(rt, { client, account });
      return { access_token: at, token_type: "Bearer", expires_in: 3600, refresh_token: rt, scope: "openid offline_access" };
    };
    if (f.get("grant_type") === "authorization_code") {
      const c = CX.codes.get(f.get("code") ?? "");
      CX.codes.delete(f.get("code") ?? "");
      if (!c || c.exp < Date.now()) return send(res, 400, { error: "invalid_grant", error_description: "Code expired or used." });
      if (c.client !== f.get("client_id") || c.redirect !== f.get("redirect_uri")) return send(res, 400, { error: "invalid_grant", error_description: "client_id/redirect_uri mismatch." });
      if (s256(f.get("code_verifier") ?? "") !== c.challenge) return send(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed." });
      return send(res, 200, issue(c.client, c.account));
    }
    if (f.get("grant_type") === "refresh_token") {
      const r = CX.refresh.get(f.get("refresh_token") ?? "");
      if (!r || r.client !== f.get("client_id")) return send(res, 400, { error: "invalid_grant" });
      CX.refresh.delete(f.get("refresh_token"));
      return send(res, 200, issue(r.client, r.account));
    }
    return send(res, 400, { error: "unsupported_grant_type" });
  }

  // ---------------- MCP ----------------
  if (p === "/composio/mcp") {
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
    const acct = whoIs(req);
    if (!acct) return send(res, 401, { error: "invalid_token" }, { "www-authenticate": `Bearer error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource/composio/mcp"` });
    const m = b;
    if (!m || typeof m !== "object") return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    if (m.id === undefined) { res.writeHead(202); res.end(); return true; }
    if (m.method === "initialize") return send(res, 200, rpcOk(m.id, { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "composio-connect", title: "Composio", version: "1.0.0" } }));
    if (m.method === "tools/list") { CX.lists++; return send(res, 200, rpcOk(m.id, { tools: TOOLS })); }
    if (m.method === "tools/call") {
      const name = m.params?.name, args = m.params?.arguments ?? {};
      CX.calls.push({ account: acct, tool: name });
      if (name === "COMPOSIO_SEARCH_TOOLS") {
        const q = JSON.stringify(args).toLowerCase();
        const kit = Object.keys(SLUGS).find((k) => q.includes(k)) ?? "gmail";
        return send(res, 200, rpcOk(m.id, text({ successful: true, data: { results: SLUGS[kit].map((slug) => ({ tool_slug: slug, toolkit: kit })) } })));
      }
      if (name === "COMPOSIO_MANAGE_CONNECTIONS") {
        const results = {};
        for (const kit of (Array.isArray(args.toolkits) ? args.toolkits : []).map((x) => String(x).toLowerCase().replace(/[^a-z0-9_-]/g, "")).filter(Boolean)) {
          const have = active(acct, kit);
          if (have && !args.reinitiate_all) { results[kit] = { status: "active", connected_account_id: have.id }; continue; }
          const a = { id: `ca_${++CX.seq}`, account: acct, slug: kit, status: "INITIATED" };
          CX.accounts.push(a);
          results[kit] = { status: "initiated", toolkit: kit, redirect_url: `${origin}/composio/link/${a.id}`, instructions: "Share the redirect_url with the user." };
        }
        return send(res, 200, rpcOk(m.id, text({ successful: true, data: { message: "Connection status", results } })));
      }
      if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
        const out = (Array.isArray(args.tools) ? args.tools : []).map((t, index) => {
          const kit = String(t.tool_slug ?? "").split("_")[0].toLowerCase();
          return active(acct, kit) ? { index, tool_slug: t.tool_slug, response: { data: kit === "gmail" ? { messages: [{ subject: `Mock email for ${acct}`, from: "team@example.com" }] } : { ok: true } } }
            : { index, tool_slug: t.tool_slug, error: `No active connection for ${kit}. Use COMPOSIO_MANAGE_CONNECTIONS.` };
        });
        return send(res, 200, rpcOk(m.id, text({ successful: out.every((x) => !x.error), data: { results: out } })));
      }
      return send(res, 200, { jsonrpc: "2.0", id: m.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
    }
    return send(res, 200, { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
  }
  return send(res, 404, { error: "not found" });
}
