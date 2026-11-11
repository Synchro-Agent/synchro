// Composio giả lập (gắn vào API giả lập ở /composio/…): đủ để chạy thử Composio của Synchro không cần khóa thật, không ra Internet.
//  POST /composio/api/v3.1/tool_router/session            tạo phiên Tool Router cho một user_id, trả mcp.url trỏ về máy chủ MCP bên dưới
//  GET  /composio/api/v3.1/connected_accounts?user_ids=…   ứng dụng đã kết nối của người dùng
//  DELETE /composio/api/v3.1/connected_accounts/{id}       ngắt một ứng dụng
//  POST /composio/mcp/{session}                            máy chủ MCP của phiên (Streamable HTTP, không phiên MCP): 3 công cụ meta
//  GET  /composio/link/{id}                                Connect Link: mở là coi như người dùng đã đăng nhập ứng dụng (ACTIVE)
//  GET/POST /composio/_debug                               xem lời gọi, số phiên; { reset } xóa hết, { dropSessions } giả lập Composio xóa phiên
// Mọi đường dẫn (trừ Connect Link và _debug) đòi header x-api-key đúng; khóa không bao giờ được ghi lại.
export const COMPOSIO_KEY = "ak_mock_composio_0001";

// listed: tổng số lần đọc danh sách ứng dụng (không bị cắt như calls), để kiểm thử đếm lời gọi Composio khi tải trang liên tục.
export const CX = { sessions: new Map(), accounts: [], calls: [], seq: 0, listed: 0 };
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); return true; };
const fail = (res, code, message) => send(res, code, { error: { message, code, slug: "error", status: code } });
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const text = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });

const TOOLS = [
  { name: "COMPOSIO_SEARCH_TOOLS", description: "Search for the right tools across 1000+ apps for a use case.", inputSchema: { type: "object", properties: { queries: { type: "array", items: { type: "object", properties: { use_case: { type: "string" } } } }, session_id: { type: "string" } }, required: ["queries"] } },
  { name: "COMPOSIO_MANAGE_CONNECTIONS", description: "Check or create connections for toolkits. Returns a redirect_url for the user to sign in when a toolkit is not connected.", inputSchema: { type: "object", properties: { toolkits: { type: "array", items: { type: "string" } }, reinitiate_all: { type: "boolean" }, session_id: { type: "string" } }, required: ["toolkits"] } },
  { name: "COMPOSIO_MULTI_EXECUTE_TOOL", description: "Execute one or more tools found with COMPOSIO_SEARCH_TOOLS.", inputSchema: { type: "object", properties: { tools: { type: "array", items: { type: "object", properties: { tool_slug: { type: "string" }, arguments: { type: "object" } }, required: ["tool_slug", "arguments"] } }, session_id: { type: "string" } }, required: ["tools"] } },
];
const SLUGS = { gmail: ["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"], slack: ["SLACK_LIST_CHANNELS", "SLACK_SEND_MESSAGE"], github: ["GITHUB_LIST_REPOSITORIES", "GITHUB_CREATE_ISSUE"] };

export async function composioHandler(req, res, p, b) {
  if (!p.startsWith("/composio/")) return false;
  const origin = `http://${req.headers.host}`;
  if (p === "/composio/_debug") {
    if (req.method === "POST") {
      if (b?.reset) { CX.sessions.clear(); CX.accounts.length = 0; CX.calls.length = 0; }
      if (b?.dropSessions) CX.sessions.clear();
      if (b?.account) CX.accounts.push({ id: `ca_${++CX.seq}`, user_id: String(b.account.user_id), toolkit: { slug: String(b.account.slug) }, status: b.account.status ?? "ACTIVE", created_at: new Date().toISOString() });
    }
    return send(res, 200, { sessions: [...CX.sessions.entries()].map(([id, s]) => ({ id, user_id: s.user_id })), accounts: CX.accounts, calls: CX.calls.slice(-60), listed: CX.listed });
  }
  // Connect Link: người dùng bấm, "đăng nhập" xong ở trang của Composio.
  const link = /^\/composio\/link\/([\w-]+)$/.exec(p);
  if (link && req.method === "GET") {
    const a = CX.accounts.find((x) => x.id === link[1]);
    if (!a) { res.writeHead(404, { "content-type": "text/html" }); res.end("<p>Link expired</p>"); return true; }
    a.status = "ACTIVE";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>Connected</title><p id="done">Connected ${a.toolkit.slug}. You can close this tab.</p>`);
    return true;
  }
  CX.calls.push(`${req.method} ${p}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
  if (req.headers["x-api-key"] !== COMPOSIO_KEY) return fail(res, 401, "Invalid API key");

  const api = p.replace(/^\/composio\/api\/v3\.1/, "");
  if (api === "/tool_router/session" && req.method === "POST") {
    if (!b?.user_id) return fail(res, 400, "user_id is required");
    const id = `trs_${(++CX.seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    CX.sessions.set(id, { user_id: String(b.user_id), manage: !!b?.manage_connections?.enable });
    return send(res, 201, { session_id: id, mcp: { type: "http", url: `${origin}/composio/mcp/${id}` }, tool_router_tools: TOOLS.map((t) => t.name), config: { user_id: String(b.user_id) }, config_version: 1 });
  }
  if (api === "/connected_accounts" && req.method === "GET") {
    CX.listed++;
    const q = new URL(req.url, origin).searchParams;
    const users = q.getAll("user_ids").flatMap((x) => x.split(",")).filter(Boolean);
    const items = CX.accounts.filter((a) => !users.length || users.includes(a.user_id)).slice(0, Number(q.get("limit")) || 100);
    return send(res, 200, { items: items.map((a) => ({ ...a, auth_config: { id: "ac_mock", auth_scheme: "OAUTH2", is_composio_managed: true, is_disabled: false }, updated_at: a.created_at, data: { access_token: "never-shown" } })), next_cursor: null, total_pages: 1, current_page: 1, total_items: items.length });
  }
  const del = /^\/connected_accounts\/([\w-]+)$/.exec(api);
  if (del && req.method === "DELETE") {
    const i = CX.accounts.findIndex((a) => a.id === del[1]);
    if (i < 0) return fail(res, 404, "Connected account not found");
    CX.accounts.splice(i, 1);
    return send(res, 200, { success: true });
  }

  const mcp = /^\/composio\/mcp\/([\w-]+)$/.exec(p);
  if (mcp) {
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
    const s = CX.sessions.get(mcp[1]);
    if (!s) return fail(res, 404, "Session not found");
    const m = b;
    if (!m || typeof m !== "object") return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    if (m.id === undefined) { res.writeHead(202); res.end(); return true; }
    if (m.method === "initialize") return send(res, 200, rpcOk(m.id, { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "composio", title: "Composio", version: "1.0.0" } }));
    if (m.method === "tools/list") return send(res, 200, rpcOk(m.id, { tools: TOOLS }));
    if (m.method === "tools/call") {
      const name = m.params?.name, args = m.params?.arguments ?? {};
      if (name === "COMPOSIO_SEARCH_TOOLS") {
        const q = JSON.stringify(args).toLowerCase();
        const kit = Object.keys(SLUGS).find((k) => q.includes(k)) ?? "gmail";
        return send(res, 200, rpcOk(m.id, text({ successful: true, data: { results: SLUGS[kit].map((slug) => ({ tool_slug: slug, toolkit: kit })), session: { id: mcp[1], instructions: "" } } })));
      }
      if (name === "COMPOSIO_MANAGE_CONNECTIONS") {
        const results = {};
        for (const kit of (Array.isArray(args.toolkits) ? args.toolkits : []).map((x) => String(x).toLowerCase())) {
          const have = CX.accounts.find((a) => a.user_id === s.user_id && a.toolkit.slug === kit && a.status === "ACTIVE");
          if (have && !args.reinitiate_all) { results[kit] = { status: "active", connected_account_id: have.id }; continue; }
          const a = { id: `ca_${++CX.seq}`, user_id: s.user_id, toolkit: { slug: kit }, status: "INITIATED", created_at: new Date().toISOString() };
          CX.accounts.push(a);
          results[kit] = { status: "initiated", toolkit: kit, redirect_url: `${origin}/composio/link/${a.id}`, instructions: "Share the redirect_url with the user." };
        }
        return send(res, 200, rpcOk(m.id, text({ successful: true, data: { message: "Connection status", results, summary: { total: Object.keys(results).length } } })));
      }
      if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
        const out = (Array.isArray(args.tools) ? args.tools : []).map((t, index) => {
          const kit = String(t.tool_slug ?? "").split("_")[0].toLowerCase();
          const ok = CX.accounts.some((a) => a.user_id === s.user_id && a.toolkit.slug === kit && a.status === "ACTIVE");
          return ok ? { index, tool_slug: t.tool_slug, response: { data: kit === "gmail" ? { messages: [{ subject: "Mock email from Composio", from: "team@example.com" }] } : { ok: true } } }
            : { index, tool_slug: t.tool_slug, error: `No active connection for ${kit}. Use COMPOSIO_MANAGE_CONNECTIONS.` };
        });
        return send(res, 200, rpcOk(m.id, text({ successful: out.every((x) => !x.error), data: { results: out, success_count: out.filter((x) => !x.error).length, error_count: out.filter((x) => x.error).length, total_count: out.length } })));
      }
      return send(res, 200, { jsonrpc: "2.0", id: m.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
    }
    return send(res, 200, { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
  }
  return fail(res, 404, "Not found");
}
