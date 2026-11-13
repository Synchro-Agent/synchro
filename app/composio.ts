// Composio của từng người: mỗi tài khoản Synchro có sẵn một connector trỏ tới máy chủ MCP cá nhân của Composio Connect (https://connect.composio.dev/mcp,
// Streamable HTTP). Người dùng bấm "Liên kết Composio" để đăng nhập tài khoản Composio của chính mình (OAuth của MCP: Protected Resource Metadata →
// connect.composio.dev, đăng ký động, PKCE S256, refresh token), hoặc dán khóa người dùng ck_… (header x-consumer-api-key) ở mục Nâng cao.
// Ứng dụng (Gmail, Slack…) được liên kết / gỡ trên trang web của Composio; Synchro không liệt kê ứng dụng và dùng được ngay ứng dụng vừa liên kết vì
// mọi thao tác đi qua công cụ meta của Composio (tìm công cụ, chạy, quản lý kết nối). Không còn khóa dự án Composio dùng chung của quản trị viên.
// Token / khóa nằm mã hóa trong hàng connector của đúng tài khoản đó (app/connectors.ts), không bao giờ ra trình duyệt hay sandbox chạy code.
import type { McpTool } from "./mcp";
import { isConnectUrl } from "./cxlink";
import { actionWords, appName, metaWords, slugIsRead, slugParts, type CxCard, type CxWrite } from "./cxactions";
export { appName };

export const COMPOSIO = "composio";
export const COMPOSIO_NAME = "Composio";
export const COMPOSIO_COLOR = "#5B4BDB";
/** Máy chủ MCP cá nhân của Composio Connect. COMPOSIO_CONNECT_URL: máy chủ giả lập khi chạy thử. */
export const CONNECT_URL = process.env.COMPOSIO_CONNECT_URL || "https://connect.composio.dev/mcp";
/** Bản giả lập: Connect Link trỏ về máy cục bộ. Bản thật chỉ nhận link của Composio (https, *.composio.dev). */
export const LOCAL_LINKS = !!process.env.COMPOSIO_CONNECT_URL && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(CONNECT_URL);
/** Trang của Composio để người dùng liên kết / gỡ ứng dụng (bảng điều khiển → Connect Apps). */
export const MANAGE_URL = "https://dashboard.composio.dev";
/** Header của khóa người dùng Composio Connect (ck_…, Composio → Settings → Sessions & API Key). */
export const KEY_HEADER = "x-consumer-api-key";
export const keyOk = (k: string) => /^ck_[A-Za-z0-9_-]{8,200}$/.test(k);
/** Khóa đã che cho giao diện: chỉ tiền tố và 4 ký tự cuối. */
export const maskKey = (v: string) => `${/^([a-z]{1,4}_)/i.exec(v)?.[1] ?? ""}••••${v.length > 12 ? v.slice(-4) : ""}`;

// ---- công cụ meta ----
// Công cụ meta không thay đổi gì trong ứng dụng của người dùng: tìm công cụ, xem tham số, tạo Connect Link / xem trạng thái kết nối, chờ kết nối xong.
// Khi máy chủ không tự khai báo, Synchro coi chúng là công cụ đọc (chạy không cần hỏi).
// Quyền ghi tính theo thao tác thật, không theo công cụ bọc ngoài: MULTI_EXECUTE chạy thao tác của ứng dụng (GOOGLEDOCS_CREATE_DOCUMENT…), "Luôn cho phép"
// ở MULTI_EXECUTE chỉ áp dụng cho thao tác đọc; thao tác ghi theo quyền riêng của từng ứng dụng (mặc định Hỏi mỗi lần, app_perms ở connectors.ts).
// Bash / workbench từ xa và gọi API không phải GET luôn hỏi mỗi lần, không đặt được "Luôn cho phép".
const META_READ = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_WAIT_FOR_CONNECTIONS"]);
export const EXEC_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";
export const PROXY_TOOL = "COMPOSIO_PROXY_EXECUTE";
/** Công cụ luôn hỏi mỗi lần (chạy lệnh / code tùy ý trên máy của Composio): không bao giờ "Luôn cho phép", không "Cho phép trong cuộc trò chuyện này". */
const ALWAYS_ASK = new Set(["COMPOSIO_REMOTE_BASH_TOOL", "COMPOSIO_REMOTE_WORKBENCH"]);
/** Công cụ không đặt được "Luôn cho phép" / "Hỏi một lần mỗi cuộc trò chuyện" ở trang Connectors (chỉ Hỏi mỗi lần hoặc Chặn). */
export const askOnlyTool = (name: string) => ALWAYS_ASK.has(name) || name === PROXY_TOOL;
export function annotate<T extends McpTool>(tools: T[]): T[] {
  return tools.map((t) => (META_READ.has(t.name) && t.annotations?.readOnlyHint === undefined ? { ...t, annotations: { ...t.annotations, readOnlyHint: true, destructiveHint: false } } : t));
}
type Item = { tool_slug: string; arguments?: unknown; account?: unknown; connected_account_id?: unknown; toolkit?: unknown; toolkit_slug?: unknown; app?: unknown };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** Tên ứng dụng do lời gọi khai báo (toolkit / toolkit_slug / app), nếu có: giúp tách đúng ứng dụng có tên nhiều từ. */
const tkOf = (x: Item): string | undefined => { const t = x.toolkit ?? x.toolkit_slug ?? x.app; return typeof t === "string" && t ? t : undefined; };
/** Các thao tác trong một lời gọi MULTI_EXECUTE; null khi tham số không đúng dạng (khi đó coi như ghi, phải hỏi). */
function items(input: unknown): Item[] | null {
  const list = obj(input).tools;
  if (!Array.isArray(list) || !list.length || list.length > 20) return null;
  return list.every((x) => typeof obj(x).tool_slug === "string" && /^[A-Za-z0-9_]{3,120}$/.test(String(obj(x).tool_slug))) ? (list as Item[]) : null;
}
const method = (input: unknown) => String(obj(input).method ?? "").toUpperCase();
/** Lời gọi luôn phải hỏi mỗi lần: bash / workbench từ xa, gọi API qua Composio với phương thức khác GET. */
export const strictCall = (tool: string, input: unknown) => ALWAYS_ASK.has(tool) || (tool === PROXY_TOOL && method(input) !== "GET");
/** Quyền mà một lời gọi MULTI_EXECUTE cần: chỉ đọc, hay ghi trong những ứng dụng nào. null: không đọc được tham số (coi như ghi, phải hỏi). */
export function execPlan(input: unknown): { writes: string[] } | null {
  const list = items(input);
  if (!list) return null;
  const writes = new Set<string>();
  for (const x of list) if (!slugIsRead(x.tool_slug, x.arguments, tkOf(x))) writes.add(slugParts(x.tool_slug, tkOf(x)).kit);
  return { writes: [...writes] };
}
/** Lời gọi MULTI_EXECUTE chỉ gồm thao tác đọc (GMAIL_FETCH_EMAILS, GITHUB_LIST_…): theo quy tắc "công cụ đọc chạy luôn". Không chắc thì không. */
export const execRead = (input: unknown) => execPlan(input)?.writes.length === 0;

// ---- nhãn và thẻ duyệt bằng lời thường ----
// Tham số chính hiện ngay sau tên thao tác ("Tạo tài liệu 'Synchro test'"): tên, tiêu đề, người nhận…
const MAIN_KEYS = ["title", "name", "subject", "summary", "file_name", "filename", "channel", "to", "recipient_email", "query", "q", "text", "message", "body", "content", "description", "url", "path"];
const ACCOUNT_KEYS = ["account", "account_email", "connected_account", "connected_account_id", "account_id", "user_email"];
const short = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);
const prim = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(", ") : "");
function mainOf(args: Record<string, unknown>) {
  for (const k of MAIN_KEYS) { const v = prim(args[k]); if (v) return short(v, 60); }
  return undefined;
}
function paramsOf(args: Record<string, unknown>): [string, string][] {
  return Object.entries(args).map(([k, v]) => [k, prim(v)] as [string, string]).filter(([k, v]) => v && !/token|secret|password|api[_-]?key|authorization|cookie/i.test(k)).slice(0, 5).map(([k, v]) => [k, short(v, 120)]);
}
function accountOf(...os: Record<string, unknown>[]) {
  for (const o of os) for (const k of ACCOUNT_KEYS) { const v = prim(o[k]); if (v) return short(v, 60); }
  return undefined;
}
/** Thẻ duyệt của một lời gọi Composio: ứng dụng (logo), tài khoản nếu biết, thao tác bằng lời thường, tham số chính. null: không phải công cụ Composio đã biết. */
export function cxCard(tool: string, input: unknown): CxCard | null {
  const inp = obj(input);
  if (tool === EXEC_TOOL) {
    const list = items(input);
    if (!list) return null;
    // Mọi thao tác ghi trong lời gọi (cần duyệt). Thẻ nói về thao tác ghi đầu tiên; toàn đọc thì thao tác đầu.
    const writeItems = list.filter((x) => !slugIsRead(x.tool_slug, x.arguments, tkOf(x)));
    const first = writeItems[0] ?? list[0];
    const { kit, rest } = slugParts(first.tool_slug, tkOf(first));
    const args = obj(first.arguments);
    const plan = execPlan(input);
    // Nhiều thao tác ghi: liệt kê từng dòng (ứng dụng · thao tác · tham số chính · tài khoản); "+N" còn lại là thao tác đọc.
    const line = (x: Item): CxWrite => { const p = slugParts(x.tool_slug, tkOf(x)); const a = obj(x.arguments); return { name: appName(p.kit), act: actionWords(p.rest) || x.tool_slug, main: mainOf(a), account: accountOf(obj(x), a, inp) }; };
    const writes = writeItems.length > 1 ? writeItems.map(line) : undefined;
    const more = writes ? list.length - writeItems.length : list.length - 1;
    return { app: kit, name: appName(kit), act: actionWords(rest) || first.tool_slug, main: mainOf(args), account: accountOf(obj(first), args, inp), params: paramsOf(args), ...(more > 0 ? { more } : {}), apps: plan?.writes ?? [], ...(writes ? { writes } : {}) };
  }
  if (tool === PROXY_TOOL) {
    const kit = String(inp.toolkit ?? inp.toolkit_slug ?? inp.app ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
    const m = method(input) || "?";
    return { app: kit || COMPOSIO, name: kit ? appName(kit) : COMPOSIO_NAME, act: `${metaWords(tool)} ${m}`, main: prim(inp.endpoint) ? short(prim(inp.endpoint), 80) : undefined, account: accountOf(inp), params: paramsOf({ method: m, endpoint: inp.endpoint, body: typeof inp.body === "string" ? inp.body : inp.body ? JSON.stringify(inp.body) : undefined }), ...(m !== "GET" ? { strict: true } : {}) };
  }
  const meta = metaWords(tool);
  if (!meta) return null;
  const detail = ALWAYS_ASK.has(tool) ? prim(inp.command ?? inp.code ?? inp.cmd) : "";
  return { app: COMPOSIO, name: COMPOSIO_NAME, act: meta, ...(detail ? { main: short(detail.split("\n")[0], 80), params: [[inp.command !== undefined ? "command" : "code", short(String(inp.command ?? inp.code ?? inp.cmd), 400)]] } : {}), ...(ALWAYS_ASK.has(tool) ? { strict: true } : {}) };
}
/** Nhãn ngắn của lời gọi Composio cho dòng công cụ trong chat: "Google Docs · Tạo tài liệu", "Composio · Tìm công cụ". null: để nhãn mặc định. */
export function cxLabel(tool: string, input: unknown): { app: string; act: string } | null {
  const c = cxCard(tool, input);
  if (c) return { app: c.name, act: c.act };
  // MULTI_EXECUTE chưa rõ tham số (danh sách thao tác lỗi): vẫn bằng lời thường.
  const meta = metaWords(tool);
  return meta ? { app: COMPOSIO_NAME, act: meta } : null;
}

// ---- Connect Link trong kết quả công cụ → nút trong khung chat ----
const LINK_KEYS = ["redirect_url", "redirectUrl", "connect_url", "connectUrl", "connect_link", "connectLink", "redirect_uri", "auth_url", "authUrl", "authorization_url", "link_url"];
/** Connect Link Composio trả về (chỉ địa chỉ Connect Link của Composio, xem cxlink.ts): mỗi ứng dụng một nút. Kết quả đến từ ngoài, nên không nhận địa chỉ nơi khác. */
export function connectLinks(content: string): { app: string; name: string; url: string }[] {
  let j: unknown;
  try { j = JSON.parse(content); } catch {
    const m = /\{[\s\S]*\}/.exec(content);
    try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
  }
  const out = new Map<string, { app: string; name: string; url: string }>();
  const walk = (v: unknown, key: string, depth: number) => {
    if (!v || typeof v !== "object" || depth > 8 || out.size >= 6) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, key, depth + 1); return; }
    const o = v as Record<string, unknown>;
    for (const k of LINK_KEYS) {
      const u = o[k];
      if (typeof u === "string" && isConnectUrl(u, LOCAL_LINKS)) {
        const slug = String(o.toolkit ?? o.toolkit_slug ?? o.app ?? key ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
        if (!out.has(u)) out.set(u, { app: slug, name: slug ? appName(slug) : COMPOSIO_NAME, url: u });
      }
    }
    for (const [k, x] of Object.entries(o)) walk(x, /^(data|results|result|response|items|session|connections)$/.test(k) ? key : k, depth + 1);
  };
  walk(j, "", 0);
  return [...out.values()];
}
/** Connect Link không phải nguồn trích dẫn: lọc khỏi danh sách nguồn của câu trả lời. */
export const notConnectLink = (u: string) => !isConnectUrl(u, LOCAL_LINKS);

/** Lời dặn thêm cho model khi Composio của người dùng đã liên kết. */
export const COMPOSIO_PROMPT = `Composio là tài khoản Composio riêng của người dùng, nối Synchro với các ứng dụng họ đã liên kết trên trang Composio (Gmail, Slack, GitHub, Notion, Google Drive… hơn 1000 ứng dụng). Cách dùng: tìm công cụ phù hợp bằng COMPOSIO_SEARCH_TOOLS, rồi chạy bằng COMPOSIO_MULTI_EXECUTE_TOOL đúng tên và tham số vừa tìm được. Ứng dụng người dùng vừa liên kết trên trang Composio dùng được ngay. Ứng dụng chưa liên kết thì gọi COMPOSIO_MANAGE_CONNECTIONS: Synchro tự hiện nút "Kết nối <Ứng dụng>" ngay trong khung chat cho đường link Composio trả về. Khi đó chỉ nói một câu ngắn mời người dùng bấm nút đó, kết nối xong thì nhắc lại yêu cầu; KHÔNG chép đường link kết nối vào câu trả lời (kể cả dạng link Markdown) và không liệt kê nó trong mục nguồn / "Sources". Đừng tự bịa đường link kết nối.`;
/** Composio có sẵn cho tài khoản nhưng người dùng chưa liên kết. */
export const COMPOSIO_LINK_PROMPT = `Người dùng chưa liên kết Composio (tài khoản Composio riêng của họ, dùng để thao tác trên Gmail, Slack, Notion, Google Drive, GitHub… hơn 1000 ứng dụng). Chỉ khi yêu cầu cần thao tác trên một ứng dụng bên ngoài mà không có connector nào khác làm được: nói một câu ngắn rằng cần liên kết Composio trước, rồi gọi connector_reconnect với connector "Composio" để hiện nút "Liên kết Composio" ngay trong khung chat; liên kết xong thì nhắc lại yêu cầu. Đừng nhắc tới Composio khi yêu cầu không cần ứng dụng bên ngoài.`;
