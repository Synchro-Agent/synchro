// MCP client (chỉ chạy ở máy chủ) nói chuyện với máy chủ MCP từ xa của connector.
// Hỗ trợ cả ba thế hệ giao thức và tự nhận ra máy chủ dùng thế hệ nào (theo mục Backward Compatibility của đặc tả):
//  - modern (2026-07-28): không có phiên, mỗi request mang phiên bản + khả năng trong _meta và header MCP-Protocol-Version / Mcp-Method / Mcp-Name.
//  - legacy (2025-03-26 … 2025-11-25): Streamable HTTP, bắt tay initialize rồi gửi kèm Mcp-Session-Id.
//  - sse (2024-11-05, đã ngừng khuyến nghị): mở luồng GET, nhận sự kiện "endpoint", gửi POST tới endpoint đó, kết quả về qua luồng.
import { downText, retryAfterMs, safeFetch, TempFail } from "./safefetch";
import type { ServerIcon } from "./connicons";

export const MODERN = "2026-07-28";
export const LEGACY = "2025-11-25";
const SSE_VERSION = "2024-11-05";
const CLIENT = { name: "Synchro", version: "1.0.0" };
const MAX_BODY = 8 * 1024 * 1024;
// Mã lỗi chỉ máy chủ thế hệ mới trả về: HeaderMismatch, MissingRequiredClientCapability, UnsupportedProtocolVersion.
const MODERN_CODES = new Set([-32020, -32021, -32022]);

export type Era = "modern" | "legacy" | "sse";
export type McpTool = {
  name: string; title?: string; description?: string; inputSchema?: Record<string, unknown>;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
};
// Công cụ có vẻ chỉ đọc khi máy chủ không khai báo gì (nhiều máy chủ không gửi annotations): tên bắt đầu bằng động từ đọc và không kèm động từ ghi.
// Máy chủ đã khai báo readOnlyHint (true hay false) thì luôn theo khai báo.
const READ_NAME = /^(get|list|search|read|fetch|query|find|show)(?:[_\-.]|[A-Z]|$)/;
const WRITE_WORD = /(create|update|delete|remove|write|set|send|post|add|insert|replace|edit|execute|run|put|patch|drop|cancel|publish|upload)/i;
export const guessedRead = (t: Pick<McpTool, "name" | "annotations">) => t.annotations?.readOnlyHint === undefined && !t.annotations?.destructiveHint && READ_NAME.test(t.name) && !WRITE_WORD.test(t.name);
export const readLike = (t: Pick<McpTool, "name" | "annotations">) => t.annotations?.readOnlyHint === true || guessedRead(t);
// Lỗi tạm thời của máy chủ mà gọi lại được: chỉ áp dụng cho lời gọi không làm thay đổi dữ liệu (bắt tay, danh sách, công cụ chỉ đọc / idempotent).
const RETRY_STATUS = new Set([429, 502, 503, 504]);
const RETRIES = 2, MAX_WAIT = 10_000;
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((ok) => { const t = setTimeout(ok, ms); signal?.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true }); });
const isDown = (s: number) => s === 408 || s === 425 || s === 429 || (s >= 500 && s !== 501 && s !== 505);
// Công cụ chạy lâu: tối đa 20 phút một lời gọi (cầu nối cho CLI đợi 30 phút); đang trả lời bằng luồng SSE mà im quá 5 phút thì coi là treo.
export const TOOL_BUDGET = 20 * 60_000;
const TOOL_IDLE = 5 * 60_000;
export type CallOpts = { timeout?: number; idle?: number; signal?: AbortSignal };
type Rpc = { jsonrpc: "2.0"; id?: string | number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown } };
type Sent = { status: number; reply?: Rpc; headers: Headers };
type PostOpts = { timeout: number; retry?: boolean; idle?: number; signal?: AbortSignal };

export class McpError extends Error {
  constructor(message: string, public kind: "auth" | "scope" | "protocol" | "rpc", public status = 0, public wwwAuth = "", public code?: number) { super(message); }
}

// Giá trị header an toàn: chữ ASCII thường giữ nguyên, còn lại mã hóa base64 theo dạng =?base64?…?= của đặc tả.
function hv(v: string) {
  const plain = /^[\x21-\x7E](?:[\x20-\x7E]*[\x21-\x7E])?$/.test(v) && !(v.startsWith("=?base64?") && v.endsWith("?="));
  return plain ? v : `=?base64?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

// Tham số đánh dấu x-mcp-header phải được chép ra header Mcp-Param-{tên}. Trả về null nếu khai báo sai (công cụ đó bị loại).
function headerParams(schema: unknown): { name: string; path: string[] }[] | null {
  const out: { name: string; path: string[]; type: string }[] = [];
  const walk = (s: unknown, path: string[]) => {
    if (!s || typeof s !== "object") return;
    const o = s as Record<string, unknown>;
    if (path.length && "x-mcp-header" in o) out.push({ name: String(o["x-mcp-header"]), path, type: String(o.type ?? "") });
    const props = o.properties;
    if (props && typeof props === "object") for (const [k, v] of Object.entries(props)) walk(v, [...path, k]);
  };
  walk(schema, []);
  // Đếm mọi chỗ có x-mcp-header (kể cả chỗ không hợp lệ như trong items, anyOf…) để phát hiện khai báo sai.
  const total = (JSON.stringify(schema ?? {}).match(/"x-mcp-header"\s*:/g) ?? []).length;
  if (total !== out.length) return null;
  const seen = new Set<string>();
  for (const h of out) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(h.name) || seen.has(h.name.toLowerCase()) || !["string", "integer", "boolean"].includes(h.type)) return null;
    seen.add(h.name.toLowerCase());
  }
  return out.map(({ name, path }) => ({ name, path }));
}

async function readText(r: Response) {
  if (!r.body) return "";
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); throw new McpError("Máy chủ trả về dữ liệu quá lớn.", "protocol", r.status); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Đọc luồng Server-Sent Events thành từng sự kiện { event, data }.
async function* sseEvents(r: Response, onChunk?: () => void): AsyncGenerator<{ event: string; data: string }> {
  if (!r.body) return;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", event = "message", data: string[] = [], size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk?.();
      size += value.length;
      if (size > MAX_BODY * 4) throw new McpError("Luồng dữ liệu từ máy chủ quá lớn.", "protocol", r.status);
      buf += dec.decode(value, { stream: true });
      for (let i = buf.search(/\r\n|\n|\r/); i >= 0; i = buf.search(/\r\n|\n|\r/)) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + (buf.startsWith("\r\n", i) ? 2 : 1));
        if (line === "") { if (data.length) yield { event, data: data.join("\n") }; event = "message"; data = []; continue; }
        if (line.startsWith(":")) continue;
        const c = line.indexOf(":");
        const field = c < 0 ? line : line.slice(0, c);
        let v = c < 0 ? "" : line.slice(c + 1);
        if (v.startsWith(" ")) v = v.slice(1);
        if (field === "event") event = v; else if (field === "data") data.push(v);
      }
    }
    if (data.length) yield { event, data: data.join("\n") };
  } finally { reader.cancel().catch(() => {}); }
}

export class McpClient {
  era?: Era;
  serverName?: string;
  serverIcons?: ServerIcon[];
  private version = LEGACY;
  private session?: string;
  private ready = false;
  private nextId = 1;
  private sse?: { endpoint: string; ctl: AbortController; pending: Map<string | number, (m: Rpc) => void>; closed?: Error };
  // Thế hệ đọc từ cơ sở dữ liệu có thể đã cũ (hãng nâng cấp máy chủ): gặp lỗi bắt tay thì dò lại một lần.
  private saved: boolean;

  /** key: token / API key người dùng tự nhập, gửi nguyên văn trong header tên key.header. */
  constructor(private url: string, private token?: string, era?: Era, private key?: { header: string; value: string }) { this.era = era; this.saved = !!era; }

  private authHeaders(): Record<string, string> {
    if (this.key) return { [this.key.header]: this.key.value };
    return this.token ? { authorization: `Bearer ${this.token}` } : {};
  }
  private get secret() { return this.key ? [this.key.header] : []; }
  private headers(extra: Record<string, string> = {}) {
    return { "content-type": "application/json", accept: "application/json, text/event-stream", ...extra, ...this.authHeaders() } as Record<string, string>;
  }

  private authError(status: number, www: string): McpError {
    if (status === 403 && /insufficient_scope/i.test(www)) return new McpError("Connector cần thêm quyền để làm việc này. Hãy cấp thêm quyền trong Cài đặt → Connectors.", "scope", status, www);
    if (this.key) return new McpError("Máy chủ từ chối token hoặc API key này. Hãy kiểm tra lại rồi nhập lại.", "auth", status, www);
    return new McpError(this.token ? "Phiên đăng nhập của connector đã hết hạn. Hãy kết nối lại." : "Connector này cần đăng nhập.", "auth", status, www);
  }

  // Gửi một message bằng POST tới url; đọc JSON hoặc luồng SSE tới khi có response cùng id. retry: gặp lỗi mạng / 429 / 502 / 503 / 504 thì gửi lại.
  private async post(url: string, msg: Rpc, extra: Record<string, string>, o: PostOpts): Promise<Sent> {
    for (let i = 0; ; i++) {
      let res: Response | null = null;
      const idle = o.idle ? new AbortController() : null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Chỉ tính thời gian im lặng sau khi đã có header: máy chủ trả JSON thì chỉ có header lúc công cụ chạy xong.
      const beat = () => { if (!idle) return; clearTimeout(timer); timer = setTimeout(() => idle.abort(new TempFail("Máy chủ im lặng quá lâu khi đang chạy công cụ.")), o.idle); };
      try {
        const signal = idle ? (o.signal ? AbortSignal.any([o.signal, idle.signal]) : idle.signal) : o.signal;
        res = await safeFetch(url, { method: "POST", headers: this.headers(extra), body: JSON.stringify(msg), timeout: o.timeout, secret: this.secret, signal });
        if (o.retry && i < RETRIES && RETRY_STATUS.has(res.status)) {
          const wait = Math.min(retryAfterMs(res.headers.get("retry-after")) ?? 1000 * 3 ** i, MAX_WAIT);
          await res.body?.cancel();
          await sleep(wait, o.signal);
          continue;
        }
        const www = res.headers.get("www-authenticate") ?? "";
        // Token người dùng tự nhập: 403 cũng là bị từ chối; OAuth thì 403 chỉ tính là đăng nhập khi máy chủ nói thiếu quyền.
        if (res.status === 401 || (res.status === 403 && (this.key || /insufficient_scope/i.test(www)))) {
          await res.body?.cancel();
          throw this.authError(res.status, www);
        }
        if (msg.id === undefined) { await res.body?.cancel(); return { status: res.status, headers: res.headers }; }
        if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
          beat();
          for await (const ev of sseEvents(res, beat)) {
            let m: Rpc;
            try { m = JSON.parse(ev.data); } catch { continue; }
            if (m.id === msg.id && (m.result !== undefined || m.error)) return { status: res.status, reply: m, headers: res.headers };
            if (m.method && m.id !== undefined) this.answer(url, m, extra);
          }
          return { status: res.status, headers: res.headers };
        }
        const text = await readText(res);
        let reply: Rpc | undefined;
        try { const j = JSON.parse(text); reply = Array.isArray(j) ? j.find((x: Rpc) => x.id === msg.id) : j; } catch {}
        return { status: res.status, reply, headers: res.headers };
      } catch (e) {
        // Mất mạng hay quá giờ giữa chừng; đọc luồng bị ngắt cũng là lỗi tạm thời.
        const stopped = !!o.signal?.aborted;
        if (!stopped && !(e instanceof McpError) && !(e instanceof TempFail) && (idle?.signal.aborted || res)) e = (idle?.signal.reason as Error) ?? new TempFail(`Kết nối tới ${new URL(url).host} bị ngắt giữa chừng.`);
        if (o.retry && i < RETRIES && e instanceof TempFail && !stopped) { await sleep(1000 * 3 ** i, o.signal); continue; }
        throw e;
      } finally { clearTimeout(timer); }
    }
  }

  // Máy chủ đời cũ có thể hỏi ngược (ping, sampling…). Synchro chỉ trả lời ping, còn lại báo không hỗ trợ.
  private answer(url: string, m: Rpc, extra: Record<string, string>) {
    const reply: Rpc = m.method === "ping" ? { jsonrpc: "2.0", id: m.id, result: {} } : { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Synchro không hỗ trợ yêu cầu này." } };
    safeFetch(url, { method: "POST", headers: this.headers(extra), body: JSON.stringify(reply), timeout: 10_000, secret: this.secret }).then((r) => r.body?.cancel()).catch(() => {});
  }

  // ---- thế hệ mới (2026-07-28) ----
  private async modern(method: string, params: Record<string, unknown>, o: PostOpts, tool?: McpTool): Promise<Sent> {
    const meta = { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientInfo": CLIENT, "io.modelcontextprotocol/clientCapabilities": {} };
    const p = { ...params, _meta: { ...((params._meta as object) ?? {}), ...meta } };
    const h: Record<string, string> = { "mcp-protocol-version": MODERN, "mcp-method": method };
    const name = (params.name ?? params.uri) as string | undefined;
    if (name !== undefined && ["tools/call", "resources/read", "prompts/get"].includes(method)) h["mcp-name"] = hv(String(name));
    if (tool && method === "tools/call") {
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      for (const x of headerParams(tool.inputSchema) ?? []) {
        let v: unknown = args;
        for (const k of x.path) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
        if (v === undefined || v === null) continue;
        if (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isInteger(v))) h[`mcp-param-${x.name.toLowerCase()}`] = hv(String(v));
      }
    }
    return this.post(this.url, { jsonrpc: "2.0", id: this.nextId++, method, params: p }, h, o);
  }

  // ---- Streamable HTTP đời cũ (initialize + phiên) ----
  private legacyHeaders() {
    const h: Record<string, string> = { "mcp-protocol-version": this.version };
    if (this.session) h["mcp-session-id"] = this.session;
    return h;
  }
  private async initialize() {
    const r = await this.post(this.url, { jsonrpc: "2.0", id: this.nextId++, method: "initialize", params: { protocolVersion: LEGACY, capabilities: {}, clientInfo: CLIENT } }, {}, { timeout: 20_000, retry: true });
    const res = r.reply?.result as { protocolVersion?: string; serverInfo?: { name?: string; title?: string; icons?: ServerIcon[] } } | undefined;
    if (!res) throw new McpError(r.reply?.error?.message ?? `Máy chủ trả về lỗi ${r.status} khi bắt tay.`, "protocol", r.status);
    this.session = r.headers.get("mcp-session-id") ?? undefined;
    this.version = res.protocolVersion || LEGACY;
    this.serverName = res.serverInfo?.title || res.serverInfo?.name;
    this.serverIcons = Array.isArray(res.serverInfo?.icons) ? res.serverInfo!.icons : undefined;
    this.ready = true;
    await this.post(this.url, { jsonrpc: "2.0", method: "notifications/initialized" }, this.legacyHeaders(), { timeout: 10_000 }).catch(() => {});
  }
  private async legacy(method: string, params: Record<string, unknown>, o: PostOpts): Promise<Sent> {
    if (!this.ready) await this.initialize();
    let r = await this.post(this.url, { jsonrpc: "2.0", id: this.nextId++, method, params }, this.legacyHeaders(), o);
    // Phiên hết hạn: 404, hoặc 400 kèm lời báo về phiên (máy chủ từ chối ngay ở cửa, công cụ chưa chạy). Bắt tay lại một lần.
    if (this.session && (r.status === 404 || (r.status === 400 && /session/i.test(r.reply?.error?.message ?? "")))) {
      this.session = undefined; this.ready = false;
      await this.initialize();
      r = await this.post(this.url, { jsonrpc: "2.0", id: this.nextId++, method, params }, this.legacyHeaders(), o);
    }
    return r;
  }

  // ---- HTTP+SSE đời 2024-11-05 ----
  private async sseOpen() {
    const ctl = new AbortController();
    // Chờ header tối đa 20 giây (máy chủ treo không được giữ nút Kết nối hàng phút); có header rồi luồng mới được sống lâu.
    const wait = setTimeout(() => ctl.abort(new TempFail("Máy chủ phản hồi quá lâu.")), 20_000);
    const res = await safeFetch(this.url, { method: "GET", headers: { accept: "text/event-stream", ...this.authHeaders() }, signal: ctl.signal, timeout: 40 * 60_000, secret: this.secret })
      .catch((e) => { throw ctl.signal.aborted ? ctl.signal.reason : e; })
      .finally(() => clearTimeout(wait));
    if (res.status === 401 || res.status === 403) { await res.body?.cancel(); throw this.authError(res.status, res.headers.get("www-authenticate") ?? ""); }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) { await res.body?.cancel(); throw new McpError(`Máy chủ trả về lỗi ${res.status}.`, "protocol", res.status); }
    const state = { endpoint: "", ctl, pending: new Map<string | number, (m: Rpc) => void>() } as NonNullable<McpClient["sse"]>;
    this.sse = state;
    const endpoint = new Promise<string>((ok, fail) => {
      const t = setTimeout(() => fail(new McpError("Máy chủ không gửi địa chỉ endpoint.", "protocol")), 15_000);
      (async () => {
        try {
          for await (const ev of sseEvents(res)) {
            if (ev.event === "endpoint") {
              const u = new URL(ev.data.trim(), this.url);
              // Endpoint phải cùng nguồn với máy chủ, không cho chuyển dữ liệu sang nơi khác.
              if (u.origin !== new URL(this.url).origin) { fail(new McpError("Endpoint của máy chủ không cùng tên miền.", "protocol")); ctl.abort(); return; }
              clearTimeout(t); ok(u.toString());
              continue;
            }
            let m: Rpc;
            try { m = JSON.parse(ev.data); } catch { continue; }
            if (m.id !== undefined && (m.result !== undefined || m.error)) { state.pending.get(m.id)?.(m); state.pending.delete(m.id); }
            else if (m.method && m.id !== undefined && state.endpoint) this.answer(state.endpoint, m, {});
          }
        } catch (e) { if (!ctl.signal.aborted) state.closed = e as Error; }
        state.closed ??= new McpError("Máy chủ đã đóng kết nối.", "protocol");
        clearTimeout(t); fail(state.closed);
        for (const f of state.pending.values()) f({ jsonrpc: "2.0", error: { code: -32000, message: state.closed.message } });
        state.pending.clear();
      })();
    });
    state.endpoint = await endpoint;
    const init = await this.sseSend("initialize", { protocolVersion: SSE_VERSION, capabilities: {}, clientInfo: CLIENT }, 20_000);
    const res2 = init.reply?.result as { serverInfo?: { name?: string; title?: string; icons?: ServerIcon[] } } | undefined;
    if (!res2) throw new McpError(init.reply?.error?.message ?? "Máy chủ không bắt tay được.", "protocol");
    this.serverName = res2.serverInfo?.title || res2.serverInfo?.name;
    this.serverIcons = Array.isArray(res2.serverInfo?.icons) ? res2.serverInfo!.icons : undefined;
    await safeFetch(state.endpoint, { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), timeout: 10_000, secret: this.secret }).then((r) => r.body?.cancel()).catch(() => {});
    this.ready = true;
  }
  private async sseSend(method: string, params: Record<string, unknown>, timeout: number): Promise<Sent> {
    const s = this.sse!;
    if (s.closed) throw s.closed;
    const id = this.nextId++;
    const reply = new Promise<Rpc>((ok, fail) => {
      const t = setTimeout(() => { s.pending.delete(id); fail(new McpError("Máy chủ phản hồi quá lâu.", "protocol")); }, timeout);
      s.pending.set(id, (m) => { clearTimeout(t); ok(m); });
    });
    const r = await safeFetch(s.endpoint, { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), timeout: 20_000, secret: this.secret });
    if (r.status === 401 || r.status === 403) { s.pending.delete(id); await r.body?.cancel(); throw this.authError(r.status, r.headers.get("www-authenticate") ?? ""); }
    await r.body?.cancel();
    if (r.status >= 400) { s.pending.delete(id); throw new McpError(`Máy chủ trả về lỗi ${r.status}.`, "protocol", r.status); }
    return { status: r.status, reply: await reply, headers: r.headers };
  }

  // Nhận ra thế hệ của máy chủ: thử request mới trước, không được thì initialize, cuối cùng thử luồng SSE cũ.
  // down: có bước gặp lỗi tạm thời (429, 5xx, mất mạng): máy chủ đang gặp sự cố chứ chưa thể kết luận "không phải MCP".
  private async detect() {
    let down: TempFail | null = null;
    const note = (e: unknown) => {
      if (e instanceof McpError && (e.kind === "auth" || e.kind === "scope")) throw e;
      if (e instanceof TempFail) down = e;
      else if (e instanceof McpError && isDown(e.status)) down = new TempFail(this.downMsg(e.status), e.status);
    };
    let r: Sent | null = null;
    try { r = await this.modern("server/discover", {}, { timeout: 15_000, retry: true }); if (isDown(r.status)) down = new TempFail(this.downMsg(r.status), r.status); }
    catch (e) { note(e); if (e instanceof TempFail) throw new TempFail(this.downMsg(e.status), e.status); }
    const err = r?.reply?.error;
    if (r?.reply?.result && r.status < 300) {
      this.era = "modern";
      const info = (r.reply.result as { serverInfo?: { name?: string; title?: string; icons?: ServerIcon[] }; _meta?: Record<string, { name?: string; title?: string; icons?: ServerIcon[] }> });
      const si = info.serverInfo ?? info._meta?.["io.modelcontextprotocol/serverInfo"];
      this.serverName = si?.title || si?.name;
      this.serverIcons = Array.isArray(si?.icons) ? si!.icons : undefined;
      return;
    }
    if (err && MODERN_CODES.has(err.code)) {
      const sup = ((err.data as { supported?: string[] })?.supported ?? []);
      if (err.code !== -32022 || sup.includes(MODERN)) { this.era = "modern"; return; }
    }
    try { await this.initialize(); this.era = "legacy"; return; }
    catch (e) { note(e); }
    try { await this.sseOpen(); this.era = "sse"; return; }
    catch (e) { note(e); }
    if (down) throw down;
    throw new McpError("Địa chỉ này không phải máy chủ MCP, hoặc máy chủ không phản hồi đúng chuẩn MCP.", "protocol", r?.status ?? 0);
  }
  private downMsg(status = 0) { return downText(new URL(this.url).host, status); }
  // Thế hệ đã lưu không còn đúng: hãng đổi máy chủ. Quên trạng thái cũ để dò lại.
  private forget() {
    this.sse?.ctl.abort();
    this.sse = undefined; this.era = undefined; this.session = undefined; this.ready = false; this.saved = false;
  }

  private async request(method: string, params: Record<string, unknown>, o: PostOpts, tool?: McpTool): Promise<Record<string, unknown>> {
    try { return await this.once(method, params, o, tool); }
    catch (e) {
      // Bắt tay / gọi bị từ chối ở cửa (400, 404, 405, chưa có trả lời JSON-RPC nên công cụ chưa chạy) với thế hệ đã lưu từ trước: dò lại một lần.
      if (!(this.saved && e instanceof McpError && e.kind === "protocol" && [400, 404, 405].includes(e.status))) throw e;
      this.forget();
      return this.once(method, params, o, tool);
    }
  }
  private async once(method: string, params: Record<string, unknown>, o: PostOpts, tool?: McpTool): Promise<Record<string, unknown>> {
    if (!this.era) await this.detect();
    let r: Sent;
    if (this.era === "modern") {
      r = await this.modern(method, params, o, tool);
      // Máy chủ báo phiên bản không hỗ trợ (đã lưu nhầm thế hệ): dò lại một lần.
      if (r.reply?.error?.code === -32022 && this.saved) { this.forget(); return this.once(method, params, o, tool); }
    } else if (this.era === "legacy") r = await this.legacy(method, params, o);
    else { if (!this.ready) await this.sseOpen(); r = await this.sseSend(method, params, o.timeout); }
    // Máy chủ đang lỗi (429, 5xx) mà chưa có kết quả: sự cố tạm thời phía nhà cung cấp.
    if (isDown(r.status) && !r.reply?.result) throw new TempFail(this.downMsg(r.status), r.status, retryAfterMs(r.headers.get("retry-after")));
    if (!r.reply) throw new McpError(r.status >= 400 ? `Máy chủ MCP trả về lỗi ${r.status}.` : "Máy chủ MCP không trả lời.", "protocol", r.status);
    if (r.reply.error) {
      // Lỗi JSON-RPC đi kèm HTTP 400 / 404 trước khi có phiên / bắt tay vẫn là "ở cửa": cho request() dò lại thế hệ nếu cần.
      const door = r.status >= 400 && method !== "tools/call";
      throw new McpError(r.reply.error.message || "Máy chủ MCP báo lỗi.", door ? "protocol" : "rpc", r.status, "", r.reply.error.code);
    }
    const res = r.reply.result ?? {};
    const type = (res as { resultType?: string }).resultType;
    if (type && type !== "complete") throw new McpError(type === "input_required" ? "Công cụ cần thêm thông tin trực tiếp từ bạn, Synchro chưa hỗ trợ kiểu này." : `Máy chủ trả về kiểu kết quả chưa hỗ trợ (${type}).`, "protocol");
    return res;
  }

  async listTools(): Promise<McpTool[]> {
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 25; page++) {
      const r = await this.request("tools/list", cursor ? { cursor } : {}, { timeout: 30_000, retry: true });
      out.push(...(((r.tools as McpTool[]) ?? []).filter((t) => t && typeof t.name === "string" && t.name.length > 0 && t.name.length <= 128 && headerParams(t.inputSchema) !== null)));
      cursor = typeof r.nextCursor === "string" && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    return out;
  }

  // Chỉ gọi lại khi công cụ không làm thay đổi dữ liệu (chỉ đọc, hoặc máy chủ khai báo idempotent): công cụ ghi gửi lại có thể làm hai lần.
  callTool(tool: McpTool, args: Record<string, unknown>, o: CallOpts = {}) {
    return this.request("tools/call", { name: tool.name, arguments: args }, { timeout: o.timeout ?? TOOL_BUDGET, idle: o.idle ?? TOOL_IDLE, signal: o.signal, retry: readLike(tool) || tool.annotations?.idempotentHint === true }, tool);
  }

  // Đóng phiên: xóa phiên đời cũ (nếu có), đóng luồng SSE.
  async close() {
    if (this.era === "legacy" && this.session) await safeFetch(this.url, { method: "DELETE", headers: this.headers(this.legacyHeaders()), timeout: 5_000, secret: this.secret }).then((r) => r.body?.cancel()).catch(() => {});
    this.sse?.ctl.abort();
  }
}

// Ảnh đầu tiên công cụ trả về (base64 + loại ảnh), để gửi cho model và lưu thành tệp cho người dùng.
export function resultImage(r: Record<string, unknown>): { data: string; mime: string } | null {
  const c = ((r.content as Record<string, unknown>[] | undefined) ?? []).find((x) => x?.type === "image" && typeof x.data === "string" && x.data);
  return c ? { data: String(c.data), mime: String(c.mimeType ?? "image/png").toLowerCase() } : null;
}

// Kết quả tools/call → văn bản cho model (âm thanh chỉ ghi chú; nội dung có cấu trúc thành JSON).
export function resultText(r: Record<string, unknown>): { text: string; isError: boolean } {
  const parts: string[] = [];
  for (const c of (r.content as Record<string, unknown>[] | undefined) ?? []) {
    if (c.type === "text") parts.push(String(c.text ?? ""));
    else if (c.type === "image") parts.push(`[Ảnh ${c.mimeType ?? ""} do công cụ trả về, đã kèm theo kết quả]`);
    else if (c.type === "audio") parts.push(`[Âm thanh ${c.mimeType ?? ""} do công cụ trả về]`);
    else if (c.type === "resource") { const x = c.resource as { text?: string; uri?: string } | undefined; parts.push(x?.text ?? `[Tài nguyên ${x?.uri ?? ""}]`); }
    else if (c.type === "resource_link") parts.push(`[Liên kết: ${c.name ?? ""} ${c.uri ?? ""}]`.trim());
  }
  if (!parts.length && r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  let text = parts.join("\n\n").trim() || "(Công cụ không trả về nội dung.)";
  // Kết quả lớn được lưu theo tham chiếu (refs.ts) trước khi tới model, nên giữ đủ để JSON không bị cắt hỏng.
  if (text.length > 2_000_000) text = text.slice(0, 2_000_000) + "\n[Đã cắt bớt vì quá dài]";
  return { text, isError: r.isError === true };
}
