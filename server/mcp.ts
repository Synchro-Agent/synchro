// MCP client (chỉ chạy ở máy chủ) nói chuyện với máy chủ MCP từ xa của connector.
// Hỗ trợ cả ba thế hệ giao thức và tự nhận ra máy chủ dùng thế hệ nào (theo mục Backward Compatibility của đặc tả):
//  - modern (2026-07-28): không có phiên, mỗi request mang phiên bản + khả năng trong _meta và header MCP-Protocol-Version / Mcp-Method / Mcp-Name.
//  - legacy (2025-03-26 … 2025-11-25): Streamable HTTP, bắt tay initialize rồi gửi kèm Mcp-Session-Id.
//  - sse (2024-11-05, đã ngừng khuyến nghị): mở luồng GET, nhận sự kiện "endpoint", gửi POST tới endpoint đó, kết quả về qua luồng.
import "server-only";
import { downText, retryAfterMs, safeFetch, TempFail, timeLimit } from "./safefetch";
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
  /** Synchro đánh dấu (không phải của máy chủ, không lưu): công cụ của connector người dùng tự thêm, readOnlyHint của máy chủ không được tin. */
  untrusted?: boolean;
};
type ToolInfo = Pick<McpTool, "name" | "annotations" | "description" | "inputSchema" | "untrusted">;
// Công cụ có vẻ chỉ đọc khi máy chủ không khai báo gì (nhiều máy chủ không gửi annotations): tên bắt đầu bằng động từ đọc, không kèm động từ ghi, và không có dấu hiệu chạy lệnh.
// Máy chủ đã khai báo readOnlyHint (true hay false) thì luôn theo khai báo. Đoán sai theo hướng "đọc" là ghi không cần duyệt, nên mọi chỗ không chắc đều không đoán.
const toolWords = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const READ_VERB = new Set(["get", "list", "search", "read", "fetch", "query", "find", "show"]);
// "query", "find" đứng một mình không nói đọc cái gì (có thể là chạy câu lệnh bất kỳ); các động từ còn lại đứng một mình là chuẩn chung của công cụ đọc.
const VAGUE_ALONE = new Set(["query", "find"]);
// So cả từ, không so chuỗi con: get_credits (edit), get_asset (set), list_posts (post) là công cụ đọc.
const WRITE_VERB = new Set(["create", "delete", "remove", "write", "insert", "replace", "edit", "execute", "drop", "cancel", "destroy", "purge", "upsert", "overwrite", "truncate", "alter", "grant", "revoke"]);
// Vừa là động từ vừa là danh từ: get_post, list_run_logs, get_update là đọc; chỉ tính là ghi khi nối sau and / or / then (find_and_update, get_or_set).
const WRITE_NOUN = new Set(["post", "run", "set", "update", "patch", "upload", "put", "publish", "send", "add", "save", "store", "move", "rename", "archive", "assign", "approve", "reject", "mark", "lock", "merge", "deploy", "trigger", "import", "apply", "commit", "push", "start", "stop"]);
const LINK_WORD = new Set(["and", "or", "then"]);
const RISKY_PARAM = /^(sql|sql_?query|query_?sql|statement|stmt|command|cmd|mutation|shell)$/i;
const RISKY_TEXT = /(^|[.!?:;]\s+|\b(to|can|will|and|then|may|that|you)\s+)(run|runs|execute|executes)\b|\bexecut(e|es|ing)\b|\brunning\s+(a|an|any|the|arbitrary|raw|custom|sql)\b|\b(arbitrary|raw|any)\s+(sql|command|statement|quer)|\bsql\b|thực thi|chạy\s+(lệnh|câu|truy vấn|sql)/i;
function looksRead(t: ToolInfo) {
  const w = toolWords(t.name);
  if (!READ_VERB.has(w[0]) || (w.length === 1 && VAGUE_ALONE.has(w[0]))) return false;
  // Động từ ghi rõ ràng; hoặc sau and / or / then bất kỳ từ không phải động từ đọc (get_and_forward, list_and_share): coi là ghi (fail-closed).
  if (w.some((x, i) => WRITE_VERB.has(x) || (i > 0 && LINK_WORD.has(w[i - 1]) && !READ_VERB.has(x)))) return false;
  if (RISKY_TEXT.test(t.description ?? "")) return false;
  const schema = t.inputSchema as { properties?: Record<string, unknown> } | undefined;
  if (schema?.properties && typeof schema.properties === "object" && Object.keys(schema.properties).some((k) => RISKY_PARAM.test(k))) return false;
  return !/\bsql\b/i.test(JSON.stringify(schema ?? {}));
}
// Connector tự thêm (untrusted): không tin readOnlyHint của máy chủ (máy chủ lạ có thể khai báo công cụ xóa dữ liệu là "chỉ đọc" để chạy không cần duyệt),
// và tên kết thúc bằng động từ / danh từ ghi (get_post, fetch_and_send, list_update) tính là ghi.
const endsWrite = (name: string) => { const w = toolWords(name); const last = w[w.length - 1] ?? ""; return WRITE_VERB.has(last) || WRITE_NOUN.has(last); };
const roHint = (t: ToolInfo) => (t.untrusted ? undefined : t.annotations?.readOnlyHint);
export const guessedRead = (t: ToolInfo) => roHint(t) === undefined && !t.annotations?.destructiveHint && looksRead(t) && !(t.untrusted && endsWrite(t.name));
export const readLike = (t: ToolInfo) => roHint(t) === true || guessedRead(t);
// Công cụ có thể xóa dữ liệu. Đặc tả MCP: không khai báo destructiveHint thì mặc định là có; riêng công cụ không khai báo gì mà động từ rõ là không ghi (ask_question, resolve_library_id)
// thì không cảnh báo xóa dữ liệu, nhưng vẫn phải hỏi trước vì không phải công cụ đọc.
const NEUTRAL_VERB = new Set(["ask", "answer", "explain", "summarize", "summarise", "analyze", "analyse", "describe", "check", "count", "compare", "validate", "lookup", "resolve", "translate", "calculate", "estimate", "preview", "suggest", "recommend"]);
export const destructiveLike = (t: ToolInfo) => {
  // Connector tự thêm (untrusted): không tin readOnlyHint cũng không tin destructiveHint:false của máy chủ lạ.
  const a = t.annotations, ro = roHint(t), dh = t.untrusted ? undefined : a?.destructiveHint;
  if (ro === true || dh === false) return false;
  if (dh === true || ro === false) return true;
  return !guessedRead(t) && !NEUTRAL_VERB.has(toolWords(t.name)[0]);
};
// Quy tắc đoán cũ (so chuỗi con, chấp nhận query / find đứng một mình): quyền "Luôn cho phép" tự cấp theo quy tắc này cần xét lại một lần (xem migratePerms ở connectors.ts).
const OLD_READ = /^(get|list|search|read|fetch|query|find|show)(?:[_\-.]|[A-Z]|$)/, OLD_WRITE = /(create|update|delete|remove|write|set|send|post|add|insert|replace|edit|execute|run|put|patch|drop|cancel|publish|upload)/i;
export const oldGuessedRead = (t: ToolInfo) => t.annotations?.readOnlyHint === undefined && !t.annotations?.destructiveHint && OLD_READ.test(t.name) && !OLD_WRITE.test(t.name);
// Lỗi tạm thời của máy chủ mà gọi lại được: chỉ áp dụng cho lời gọi không làm thay đổi dữ liệu (bắt tay, danh sách, công cụ chỉ đọc / idempotent).
const RETRY_STATUS = new Set([429, 502, 503, 504]);
const RETRIES = 2, MAX_WAIT = 10_000;
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((ok) => { const t = setTimeout(ok, ms); signal?.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true }); });
const isDown = (s: number) => s === 408 || s === 425 || s === 429 || (s >= 500 && s !== 501 && s !== 505);
// Công cụ chạy lâu: tối đa 20 phút một lời gọi; đang trả lời bằng luồng SSE mà im quá 5 phút thì coi là treo.
// CLI chờ một lời gọi tối đa 30 phút (cli_engines.ts), lời gọi đó gồm cả lúc chờ duyệt: BRIDGE_CALL_MAX chừa 2 phút để Synchro luôn trả lời trước khi CLI tự cắt.
export const TOOL_BUDGET = 20 * 60_000;
export const BRIDGE_CALL_MAX = 28 * 60_000;
const TOOL_IDLE = 5 * 60_000;
// Cả bước dò thế hệ máy chủ có chung một hạn, mỗi kiểu thử tối đa 8 giây: máy chủ treo không được giữ nút Kết nối hàng phút.
const DETECT_MS = 24_000, PROBE_MS = 8_000;
export type CallOpts = { timeout?: number; idle?: number; signal?: AbortSignal };
type Rpc = { jsonrpc: "2.0"; id?: string | number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown } };
type Sent = { status: number; reply?: Rpc; headers: Headers };
// lateNoRetry: quá giờ thì không thử lại (dò máy chủ: thử lại chỉ chờ thêm một lần nữa).
type PostOpts = { timeout: number; retry?: boolean; lateNoRetry?: boolean; idle?: number; signal?: AbortSignal };

export class McpError extends Error {
  constructor(message: string, public kind: "auth" | "scope" | "forbidden" | "protocol" | "rpc", public status = 0, public wwwAuth = "", public code?: number) { super(message); }
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
  /** Máy chủ báo danh sách công cụ vừa đổi (notifications/tools/list_changed trên luồng đang mở). */
  onToolsChanged?: () => void;
  private version = LEGACY;
  private session?: string;
  private ready = false;
  private nextId = 1;
  private sse?: { endpoint: string; ctl: AbortController; pending: Map<string | number, (m: Rpc | Error) => void>; closed?: Error; last: number };
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
    // 403 không phải "hết phiên": máy chủ nhận ra bạn nhưng không cho vào. Đăng nhập lại có thể đổi được tài khoản hay quyền, nhưng không được nói là phiên đã hết hạn.
    if (status === 403) return new McpError(this.token ? "Máy chủ từ chối quyền truy cập của tài khoản đã đăng nhập (lỗi 403). Hãy kết nối lại, hoặc kiểm tra quyền của tài khoản trên ứng dụng đó." : "Máy chủ từ chối truy cập (lỗi 403). Connector này có thể cần token hoặc quyền riêng từ nhà cung cấp.", "forbidden", status, www);
    return new McpError(this.token ? "Phiên đăng nhập của connector đã hết hạn. Hãy kết nối lại." : "Connector này cần đăng nhập.", "auth", status, www);
  }

  // Gửi một message bằng POST tới url; đọc JSON hoặc luồng SSE tới khi có response cùng id. retry: gặp lỗi mạng / 429 / 502 / 503 / 504 thì gửi lại.
  private async post(url: string, msg: Rpc, extra: Record<string, string>, o: PostOpts): Promise<Sent> {
    for (let i = 0; ; i++) {
      let res: Response | null = null;
      const idle = o.idle ? new AbortController() : null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Chỉ tính thời gian im lặng sau khi đã có header: máy chủ trả JSON thì chỉ có header lúc công cụ chạy xong.
      const beat = () => { if (!idle) return; clearTimeout(timer); timer = setTimeout(() => idle.abort(new TempFail("Máy chủ im lặng quá lâu khi đang chạy công cụ.", 0, undefined, true)), o.idle); };
      try {
        const signal = idle ? (o.signal ? AbortSignal.any([o.signal, idle.signal]) : idle.signal) : o.signal;
        // Phản hồi có thể là luồng SSE sống lâu của một công cụ chạy dài: bỏ trần đọc 10MB (JSON thường đã có trần MAX_BODY 8MB trong readText).
        res = await safeFetch(url, { method: "POST", headers: this.headers(extra), body: JSON.stringify(msg), timeout: o.timeout, secret: this.secret, signal, maxBytes: 0 });
        if (o.retry && i < RETRIES && RETRY_STATUS.has(res.status)) {
          const wait = Math.min(retryAfterMs(res.headers.get("retry-after")) ?? 1000 * 3 ** i, MAX_WAIT);
          await res.body?.cancel();
          await sleep(wait, o.signal);
          continue;
        }
        const www = res.headers.get("www-authenticate") ?? "";
        // authError phân loại: thiếu quyền, token tự nhập bị từ chối, hay máy chủ không cho vào (403).
        if (res.status === 401 || res.status === 403) {
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
            else if (m.method === "notifications/tools/list_changed") this.onToolsChanged?.();
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
        if (!stopped && !(e instanceof McpError) && !(e instanceof TempFail) && (idle?.signal.aborted || res)) e = (idle?.signal.reason as Error) ?? ((e as Error).name === "TimeoutError" ? new TempFail("Máy chủ phản hồi quá lâu.", 0, undefined, true) : new TempFail(`Kết nối tới ${new URL(url).host} bị ngắt giữa chừng.`));
        if (o.retry && i < RETRIES && e instanceof TempFail && !stopped && !(o.lateNoRetry && e.timedOut)) { await sleep(1000 * 3 ** i, o.signal); continue; }
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
  private async initialize(o: PostOpts = { timeout: 20_000, retry: true }) {
    const r = await this.post(this.url, { jsonrpc: "2.0", id: this.nextId++, method: "initialize", params: { protocolVersion: LEGACY, capabilities: {}, clientInfo: CLIENT } }, {}, o);
    const res = r.reply?.result as { protocolVersion?: string; serverInfo?: { name?: string; title?: string; icons?: ServerIcon[] } } | undefined;
    if (!res && isDown(r.status)) throw new TempFail(this.downMsg(r.status), r.status);
    if (!res) throw new McpError(r.reply?.error?.message ?? `Máy chủ trả về lỗi ${r.status} khi bắt tay.`, "protocol", r.status);
    this.session = r.headers.get("mcp-session-id") ?? undefined;
    this.version = res.protocolVersion || LEGACY;
    this.serverName = res.serverInfo?.title || res.serverInfo?.name;
    this.serverIcons = Array.isArray(res.serverInfo?.icons) ? res.serverInfo!.icons : undefined;
    this.ready = true;
    await this.post(this.url, { jsonrpc: "2.0", method: "notifications/initialized" }, this.legacyHeaders(), { timeout: 10_000, signal: o.signal }).catch(() => {});
  }
  private async legacy(method: string, params: Record<string, unknown>, o: PostOpts): Promise<Sent> {
    // Bắt tay nằm trong cùng hạn và cùng nút Dừng với lời gọi: không thì máy chủ treo ở bước này giữ nút Làm mới, Kết nối cả phút dù đã hết hạn.
    const hello: PostOpts = { timeout: 20_000, retry: true, signal: o.signal };
    if (!this.ready) await this.initialize(hello);
    let r = await this.post(this.url, { jsonrpc: "2.0", id: this.nextId++, method, params }, this.legacyHeaders(), o);
    // Phiên hết hạn: 404, hoặc 400 kèm lời báo về phiên (máy chủ từ chối ngay ở cửa, công cụ chưa chạy). Bắt tay lại một lần.
    if (this.session && (r.status === 404 || (r.status === 400 && /session/i.test(r.reply?.error?.message ?? "")))) {
      this.session = undefined; this.ready = false;
      await this.initialize(hello);
      r = await this.post(this.url, { jsonrpc: "2.0", id: this.nextId++, method, params }, this.legacyHeaders(), o);
    }
    return r;
  }

  // ---- HTTP+SSE đời 2024-11-05 ----
  private async sseOpen(o: { wait?: number; signal?: AbortSignal } = {}) {
    const ctl = new AbortController();
    const late = () => ctl.abort(new TempFail("Máy chủ phản hồi quá lâu.", 0, undefined, true));
    // Chờ header tối đa 20 giây (máy chủ treo không được giữ nút Kết nối hàng phút); có header rồi luồng mới được sống lâu.
    const wait = setTimeout(late, o.wait ?? 20_000);
    // Hết hạn chung hay bấm Dừng trong lúc bắt tay thì thôi; bắt tay xong luồng sống độc lập với hạn này.
    o.signal?.addEventListener("abort", late, { once: true });
    if (o.signal?.aborted) late();
    try {
      await this.sseStart(ctl, wait, o.signal);
    } finally { o.signal?.removeEventListener("abort", late); }
  }
  private async sseStart(ctl: AbortController, wait: ReturnType<typeof setTimeout>, signal?: AbortSignal) {
    // Luồng SSE sống lâu (tới 40 phút), tổng byte có thể vượt trần 10MB: bỏ trần đọc cho riêng luồng này.
    const res = await safeFetch(this.url, { method: "GET", headers: { accept: "text/event-stream", ...this.authHeaders() }, signal: ctl.signal, timeout: 40 * 60_000, secret: this.secret, maxBytes: 0 })
      .catch((e) => { throw ctl.signal.aborted ? ctl.signal.reason : e; })
      .finally(() => clearTimeout(wait));
    if (res.status === 401 || res.status === 403) { await res.body?.cancel(); throw this.authError(res.status, res.headers.get("www-authenticate") ?? ""); }
    if (isDown(res.status)) { await res.body?.cancel(); throw new TempFail(this.downMsg(res.status), res.status); }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) { await res.body?.cancel(); throw new McpError(`Máy chủ trả về lỗi ${res.status}.`, "protocol", res.status); }
    const state = { endpoint: "", ctl, pending: new Map<string | number, (m: Rpc | Error) => void>(), last: Date.now() } as NonNullable<McpClient["sse"]>;
    this.sse = state;
    let opened = false;
    const endpoint = new Promise<string>((ok, fail) => {
      const t = setTimeout(() => fail(new McpError("Máy chủ không gửi địa chỉ endpoint.", "protocol")), 15_000);
      (async () => {
        try {
          for await (const ev of sseEvents(res, () => { state.last = Date.now(); })) {
            if (ev.event === "endpoint") {
              const u = new URL(ev.data.trim(), this.url);
              // Endpoint phải cùng nguồn với máy chủ, không cho chuyển dữ liệu sang nơi khác.
              if (u.origin !== new URL(this.url).origin) { fail(new McpError("Endpoint của máy chủ không cùng tên miền.", "protocol")); ctl.abort(); return; }
              opened = true; clearTimeout(t); ok(u.toString());
              continue;
            }
            let m: Rpc;
            try { m = JSON.parse(ev.data); } catch { continue; }
            if (m.id !== undefined && (m.result !== undefined || m.error)) { state.pending.get(m.id)?.(m); state.pending.delete(m.id); }
            else if (m.method === "notifications/tools/list_changed") this.onToolsChanged?.();
            else if (m.method && m.id !== undefined && state.endpoint) this.answer(state.endpoint, m, {});
          }
        } catch (e) { if (!ctl.signal.aborted) state.closed = e instanceof McpError ? e : new TempFail(`Kết nối tới ${new URL(this.url).host} bị ngắt giữa chừng.`); }
        // Đã bắt tay rồi mà luồng đứt là lỗi tạm thời, lời gọi đang chờ có thể đã chạy ở phía hãng (call() báo "không rõ kết quả" với công cụ ghi). Chưa có endpoint mới là máy chủ không nói đúng chuẩn.
        state.closed ??= opened ? new TempFail(`Kết nối tới ${new URL(this.url).host} bị ngắt giữa chừng.`) : new McpError("Máy chủ đã đóng kết nối.", "protocol");
        clearTimeout(t); fail(state.closed);
        for (const f of [...state.pending.values()]) f(state.closed);
        state.pending.clear();
      })();
    });
    state.endpoint = await endpoint;
    const init = await this.sseSend("initialize", { protocolVersion: SSE_VERSION, capabilities: {}, clientInfo: CLIENT }, { timeout: 20_000, signal });
    const res2 = init.reply?.result as { serverInfo?: { name?: string; title?: string; icons?: ServerIcon[] } } | undefined;
    if (!res2) throw new McpError(init.reply?.error?.message ?? "Máy chủ không bắt tay được.", "protocol");
    this.serverName = res2.serverInfo?.title || res2.serverInfo?.name;
    this.serverIcons = Array.isArray(res2.serverInfo?.icons) ? res2.serverInfo!.icons : undefined;
    await safeFetch(state.endpoint, { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), timeout: 10_000, secret: this.secret }).then((r) => r.body?.cancel()).catch(() => {});
    this.ready = true;
  }
  // Kết quả về qua luồng GET nên hạn chờ, im lặng và Dừng phải tự canh ở đây (POST của thế hệ này trả lời ngay).
  private async sseSend(method: string, params: Record<string, unknown>, o: PostOpts): Promise<Sent> {
    const s = this.sse!;
    if (s.closed) throw s.closed;
    const id = this.nextId++, at = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined, watch: ReturnType<typeof setInterval> | undefined, off = () => {};
    const end = () => { clearTimeout(timer); clearInterval(watch); off(); s.pending.delete(id); };
    const reply = new Promise<Rpc>((ok, fail) => {
      const stop = (e: unknown) => { end(); fail(e); };
      timer = setTimeout(() => stop(new TempFail("Máy chủ phản hồi quá lâu.", 0, undefined, true)), o.timeout);
      if (o.idle) watch = setInterval(() => { if (Date.now() - Math.max(s.last, at) > o.idle!) stop(new TempFail("Máy chủ im lặng quá lâu khi đang chạy công cụ.", 0, undefined, true)); }, Math.min(o.idle, 2000));
      if (o.signal) {
        const f = () => stop(o.signal!.reason ?? new DOMException("Đã dừng", "AbortError"));
        if (o.signal.aborted) f(); else { o.signal.addEventListener("abort", f, { once: true }); off = () => o.signal!.removeEventListener("abort", f); }
      }
      s.pending.set(id, (m) => { if (m instanceof Error) stop(m); else { end(); ok(m); } });
    });
    reply.catch(() => {});
    let r: Response;
    try { r = await safeFetch(s.endpoint, { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), timeout: 20_000, secret: this.secret, signal: o.signal }); }
    catch (e) { end(); throw e; }
    if (r.status === 401 || r.status === 403) { end(); await r.body?.cancel(); throw this.authError(r.status, r.headers.get("www-authenticate") ?? ""); }
    await r.body?.cancel();
    if (isDown(r.status)) { end(); throw new TempFail(this.downMsg(r.status), r.status, retryAfterMs(r.headers.get("retry-after"))); }
    if (r.status >= 400) { end(); throw new McpError(`Máy chủ trả về lỗi ${r.status}.`, "protocol", r.status); }
    return { status: r.status, reply: await reply, headers: r.headers };
  }

  // Nhận ra thế hệ của máy chủ: thử request mới trước, không được thì initialize, cuối cùng thử luồng SSE cũ.
  // down: có bước gặp lỗi tạm thời (429, 5xx, mất mạng): máy chủ đang gặp sự cố chứ chưa thể kết luận "không phải MCP".
  // denied: có bước bị từ chối hẳn (403); bước khác vẫn có thể được (máy chủ chỉ chặn một kiểu gọi), không bước nào được thì mới báo đúng lý do này.
  private async detect(signal?: AbortSignal) {
    const stop = timeLimit(DETECT_MS, signal);
    const probe: PostOpts = { timeout: PROBE_MS, retry: true, lateNoRetry: true, signal: stop };
    let down: TempFail | null = null, denied: McpError | null = null;
    const note = (e: unknown) => {
      if (e instanceof McpError && (e.kind === "auth" || e.kind === "scope")) throw e;
      if (e instanceof McpError && e.kind === "forbidden") denied = e;
      else if (e instanceof TempFail) down = e;
      else if (e instanceof McpError && isDown(e.status)) down = new TempFail(this.downMsg(e.status), e.status);
    };
    let r: Sent | null = null;
    // Máy chủ treo khi nhận POST (thường là máy chủ SSE đời cũ) vẫn có thể trả lời GET: ghi nhận rồi thử tiếp từng kiểu một lần.
    try { r = await this.modern("server/discover", {}, probe); if (isDown(r.status)) down = new TempFail(this.downMsg(r.status), r.status); }
    catch (e) { note(e); }
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
    try { await this.initialize(probe); this.era = "legacy"; return; }
    catch (e) { note(e); }
    try { await this.sseOpen({ wait: PROBE_MS, signal: stop }); this.era = "sse"; return; }
    catch (e) { note(e); }
    // Biến gán trong note nên TypeScript không thấy; ép kiểu lại để đọc.
    const refused = denied as McpError | null, gone = down as TempFail | null;
    if (refused) throw refused;
    if (gone) throw new TempFail(this.downMsg(gone.status), gone.status);
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
  // Công cụ chỉ đọc, danh sách: gặp lỗi tạm thời thì thử lại một lần như đường Streamable HTTP. Luồng vừa đứt thì mở lại trước khi gửi.
  private async sseSendRetry(method: string, params: Record<string, unknown>, o: PostOpts): Promise<Sent> {
    try { return await this.sseSend(method, params, o); }
    catch (e) {
      if (!o.retry || !(e instanceof TempFail) || o.signal?.aborted || (o.lateNoRetry && e.timedOut)) throw e;
      await sleep(1000, o.signal);
      if (this.sse?.closed) { this.ready = false; await this.sseOpen({ signal: o.signal }); }
      return this.sseSend(method, params, o);
    }
  }
  private async once(method: string, params: Record<string, unknown>, o: PostOpts, tool?: McpTool): Promise<Record<string, unknown>> {
    if (!this.era) await this.detect(o.signal);
    let r: Sent;
    if (this.era === "modern") {
      r = await this.modern(method, params, o, tool);
      // Máy chủ báo phiên bản không hỗ trợ (đã lưu nhầm thế hệ): dò lại một lần.
      if (r.reply?.error?.code === -32022 && this.saved) { this.forget(); return this.once(method, params, o, tool); }
    } else if (this.era === "legacy") r = await this.legacy(method, params, o);
    else {
      // Luồng đã đứt từ lời gọi trước: lời gọi này chưa gửi đi nên mở lại được, kể cả với công cụ ghi.
      if (this.sse?.closed) this.ready = false;
      if (!this.ready) await this.sseOpen({ signal: o.signal });
      r = await this.sseSendRetry(method, params, o);
    }
    // Máy chủ đang lỗi (429, 5xx) mà chưa có kết quả: sự cố tạm thời phía nhà cung cấp.
    if (isDown(r.status) && !r.reply) throw new TempFail(this.downMsg(r.status), r.status, retryAfterMs(r.headers.get("retry-after")));
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

  /** Máy chủ trả sai dạng (thiếu mảng tools) thì báo lỗi, không coi là "hết công cụ": danh sách rỗng giả sẽ xóa quyền người dùng đã đặt. */
  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 25; page++) {
      const r = await this.request("tools/list", cursor ? { cursor } : {}, { timeout: 30_000, retry: true, signal });
      if (!Array.isArray(r.tools)) throw new McpError("Máy chủ trả về danh sách công cụ không hợp lệ.", "protocol");
      // "untrusted" là dấu của Synchro, máy chủ không được tự gửi.
      out.push(...((r.tools as McpTool[]).filter((t) => t && typeof t.name === "string" && t.name.length > 0 && t.name.length <= 128 && headerParams(t.inputSchema) !== null).map(({ untrusted: _u, ...t }) => t)));
      cursor = typeof r.nextCursor === "string" && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    return out;
  }

  // Chỉ gọi lại khi máy chủ khai báo rõ là không làm thay đổi dữ liệu (chỉ đọc, hoặc idempotent): công cụ ghi gửi lại có thể làm hai lần, nên không dựa vào đoán theo tên.
  callTool(tool: McpTool, args: Record<string, unknown>, o: CallOpts = {}) {
    // Quá giờ thì không gọi lại: hạn đã là cả phần thời gian CLI còn chờ được, gọi lại sẽ vượt hạn đó và CLI tự cắt trước khi Synchro kịp trả lời.
    // Chỉ gọi lại khi máy chủ khai báo rõ là chỉ đọc / idempotent (không bao giờ dựa vào đoán theo tên: gửi lại công cụ ghi có thể làm hai lần).
    // Connector tự thêm (untrusted): máy chủ lạ có thể khai man readOnlyHint cho công cụ ghi để được gửi lại — chỉ gọi lại khi tên công cụ cũng cho thấy là đọc.
    const hinted = tool.annotations?.readOnlyHint === true || tool.annotations?.idempotentHint === true;
    const retry = tool.untrusted ? hinted && looksRead(tool) : hinted;
    return this.request("tools/call", { name: tool.name, arguments: args }, { timeout: o.timeout ?? TOOL_BUDGET, idle: o.idle ?? TOOL_IDLE, signal: o.signal, retry, lateNoRetry: true }, tool);
  }

  // Đóng phiên: xóa phiên đời cũ (nếu có), đóng luồng SSE.
  async close() {
    if (this.era === "legacy" && this.session) await safeFetch(this.url, { method: "DELETE", headers: this.headers(this.legacyHeaders()), timeout: 5_000, secret: this.secret }).then((r) => r.body?.cancel()).catch(() => {});
    this.sse?.ctl.abort();
  }
}

// Ảnh công cụ trả về (base64 + loại ảnh), tối đa MAX_IMAGES: lưu thành tệp cho người dùng, ảnh đầu tiên gửi kèm cho model.
export const MAX_IMAGES = 8;
export function resultImages(r: Record<string, unknown>): { all: number; images: { data: string; mime: string }[] } {
  const list = ((r.content as Record<string, unknown>[] | undefined) ?? []).filter((x) => x?.type === "image" && typeof x.data === "string" && x.data);
  return { all: list.length, images: list.slice(0, MAX_IMAGES).map((c) => ({ data: String(c.data), mime: String(c.mimeType ?? "image/png").toLowerCase() })) };
}

// Kết quả tools/call → văn bản cho model (âm thanh chỉ ghi chú; nội dung có cấu trúc thành JSON).
export function resultText(r: Record<string, unknown>): { text: string; isError: boolean } {
  const parts: string[] = [];
  for (const c of (r.content as Record<string, unknown>[] | undefined) ?? []) {
    if (c.type === "text") parts.push(String(c.text ?? ""));
    else if (c.type === "image") parts.push(`[Ảnh ${c.mimeType ?? ""} do công cụ trả về]`);
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
