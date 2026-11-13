// Composio của từng người: mỗi tài khoản Synchro có sẵn một connector trỏ tới máy chủ MCP cá nhân của Composio Connect (https://connect.composio.dev/mcp,
// Streamable HTTP). Người dùng bấm "Liên kết Composio" để đăng nhập tài khoản Composio của chính mình (OAuth của MCP: Protected Resource Metadata →
// connect.composio.dev, đăng ký động, PKCE S256, refresh token), hoặc dán khóa người dùng ck_… (header x-consumer-api-key) ở mục Nâng cao.
// Ứng dụng (Gmail, Slack…) được liên kết / gỡ trên trang web của Composio; Synchro không liệt kê ứng dụng và dùng được ngay ứng dụng vừa liên kết vì
// mọi thao tác đi qua công cụ meta của Composio (tìm công cụ, chạy, quản lý kết nối). Không còn khóa dự án Composio dùng chung của quản trị viên.
// Token / khóa nằm mã hóa trong hàng connector của đúng tài khoản đó (app/connectors.ts), không bao giờ ra trình duyệt hay sandbox chạy code.
import type { McpTool } from "./mcp";
import { isConnectUrl } from "./cxlink";
import { actionWords, appName, KNOWN_KITS, metaWords, slugIsRead, slugParts, type CxCard, type CxWrite, type KitHints } from "./cxactions";
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
const SEARCH_TOOL = "COMPOSIO_SEARCH_TOOLS", SCHEMAS_TOOL = "COMPOSIO_GET_TOOL_SCHEMAS";
/** Công cụ luôn hỏi mỗi lần (chạy lệnh / code tùy ý trên máy của Composio): không bao giờ "Luôn cho phép", không "Cho phép trong cuộc trò chuyện này". */
const ALWAYS_ASK = new Set(["COMPOSIO_REMOTE_BASH_TOOL", "COMPOSIO_REMOTE_WORKBENCH"]);
/** Công cụ không đặt được "Luôn cho phép" / "Hỏi một lần mỗi cuộc trò chuyện" ở trang Connectors (chỉ Hỏi mỗi lần hoặc Chặn). */
export const askOnlyTool = (name: string) => ALWAYS_ASK.has(name) || name === PROXY_TOOL;
export function annotate<T extends McpTool>(tools: T[]): T[] {
  return tools.map((t) => (META_READ.has(t.name) && t.annotations?.readOnlyHint === undefined ? { ...t, annotations: { ...t.annotations, readOnlyHint: true, destructiveHint: false } } : t));
}
// toolkit / app trong từng thao tác là chữ do model viết: chỉ để đó, không dùng để tách ứng dụng hay xét quyền (xem slugParts).
type Item = { tool_slug: string; arguments?: unknown; account?: unknown; connected_account_id?: unknown };
type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
/** Các thao tác trong một lời gọi MULTI_EXECUTE; null khi tham số không đúng dạng (khi đó coi như ghi, phải hỏi). */
function items(input: unknown): Item[] | null {
  const list = obj(input).tools;
  if (!Array.isArray(list) || !list.length || list.length > 20) return null;
  return list.every((x) => typeof obj(x).tool_slug === "string" && /^[A-Za-z0-9_]{3,120}$/.test(String(obj(x).tool_slug))) ? (list as Item[]) : null;
}
const method = (input: unknown) => String(obj(input).method ?? "").toUpperCase();
/** Lời gọi luôn phải hỏi mỗi lần: bash / workbench từ xa, gọi API qua Composio với phương thức khác GET. */
export const strictCall = (tool: string, input: unknown) => ALWAYS_ASK.has(tool) || (tool === PROXY_TOOL && method(input) !== "GET");
/** Quyền mà một lời gọi MULTI_EXECUTE cần: chỉ đọc, hay ghi trong những ứng dụng nào. null: không đọc được tham số (coi như ghi, phải hỏi).
 *  user: dùng thêm toolkit mà Composio đã trả cho người này (cxLearn); không có thì chỉ theo danh sách toolkit có sẵn. */
export function execPlan(input: unknown, user?: string): { writes: string[] } | null {
  const list = items(input);
  if (!list) return null;
  const h = cxHints(user);
  const writes = new Set<string>();
  for (const x of list) if (!slugIsRead(x.tool_slug, x.arguments, h)) writes.add(slugParts(x.tool_slug, h).kit);
  return { writes: [...writes] };
}
/** Lời gọi MULTI_EXECUTE chỉ gồm thao tác đọc (GMAIL_FETCH_EMAILS, GITHUB_LIST_…): theo quy tắc "công cụ đọc chạy luôn". Không chắc thì không. */
export const execRead = (input: unknown, user?: string) => execPlan(input, user)?.writes.length === 0;

// ---- điều Composio đã trả về cho từng người dùng (24 giờ, trong bộ nhớ tiến trình) ----
// Chỉ học từ kết quả công cụ meta của Composio (tìm công cụ, xem tham số, quản lý / chờ kết nối), không học từ kết quả thao tác (email, trang web… do người ngoài viết)
// và không bao giờ từ tham số model gửi. Gồm: slug → toolkit (để tách đúng ứng dụng, slugParts), toolkit đã thấy, lược đồ từng công cụ theo toolkit (cache của E3.4),
// và tài khoản đang kết nối của từng toolkit (thẻ duyệt hiện "tài khoản đích" kể cả khi model không truyền).
export const SCHEMA_TTL = 24 * 3600_000;
const LEARN_USERS = 2000, LEARN_SLUGS = 3000, LEARN_KITS = 500, TOOLS_PER_KIT = 40, ENTRY_MAX = 6000;
type Learned = {
  at: number;
  slugs: Map<string, { kit: string; at: number }>;
  kits: Map<string, number>;
  tools: Map<string, Map<string, { at: number; entry: Rec }>>;
  accounts: Map<string, { at: number; label: string | null }>;
  session?: { at: number; value: unknown };
};
const learned = new Map<string, Learned>();
const live = (at: number, now: number) => now - at < SCHEMA_TTL;
function bucket(user: string, now: number): Learned {
  let b = learned.get(user);
  if (!b) {
    if (learned.size >= LEARN_USERS) { const old = [...learned].sort((x, y) => x[1].at - y[1].at)[0]; if (old) learned.delete(old[0]); }
    b = { at: now, slugs: new Map(), kits: new Map(), tools: new Map(), accounts: new Map() };
    learned.set(user, b);
  }
  b.at = now;
  return b;
}
const trim = <K, V>(m: Map<K, V>, max: number) => { while (m.size > max) { const k = m.keys().next().value; if (k === undefined) break; m.delete(k); } };
/** Hiểu biết về toolkit của người dùng (từ kết quả của Composio) cho slugParts / slugIsRead. */
export function cxHints(user?: string, now = Date.now()): KitHints | undefined {
  const b = user ? learned.get(user) : undefined;
  if (!b) return undefined;
  return {
    kits: [...b.kits].filter(([, at]) => live(at, now)).map(([k]) => k),
    slug: (s) => { const e = b.slugs.get(s); return e && live(e.at, now) ? e.kit : undefined; },
  };
}
/** Tài khoản đang kết nối của một toolkit mà Composio đã báo (email, tên, hoặc mã tài khoản). Không biết, hoặc có nhiều tài khoản khác nhau: undefined. */
export function cxAccount(user: string | undefined, kit: string, now = Date.now()): string | undefined {
  const e = user ? learned.get(user)?.accounts.get(kit) : undefined;
  return e && live(e.at, now) && e.label ? e.label : undefined;
}

const KIT_RE = /^[a-z0-9][a-z0-9_]{1,59}$/;
const SLUG_RE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;
const GENERIC = new Set(["data", "results", "result", "response", "items", "session", "connections", "toolkits", "tools", "tool_schemas", "schemas", "details", "connection_details", "error", "meta", "input_schema", "properties"]);
const kitStr = (v: unknown): string | undefined => {
  if (typeof v === "string") { const s = v.trim().toLowerCase(); return KIT_RE.test(s) ? s : undefined; }
  return v && typeof v === "object" && !Array.isArray(v) ? kitStr((v as Rec).slug) : undefined;
};
const slugStr = (v: unknown) => (typeof v === "string" && v.length <= 120 && SLUG_RE.test(v) ? v : undefined);
const under = (slug: string, kit: string) => slug.startsWith(`${kit.toUpperCase()}_`);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{1,40}$/;
const ACCT_KEYS = ["email", "user_email", "account_email", "email_address", "emailAddress", "login", "username", "user_name", "handle", "workspace", "team_name"];
const ACCT_NEST = ["current_user_info", "user_info", "connection_details", "account", "user", "profile", "data", "meta", "connected_account"];
function acctLabel(o: Rec, depth = 0): string | undefined {
  for (const k of ACCT_KEYS) { const v = o[k]; if (typeof v === "string" && v.trim() && v.length <= 120 && (/mail/i.test(k) ? EMAIL.test(v.trim()) : true)) return v.trim(); }
  if (depth < 2) for (const k of ACCT_NEST) { const x = o[k]; if (x && typeof x === "object" && !Array.isArray(x)) { const l = acctLabel(x as Rec, depth + 1); if (l) return l; } }
  if (depth === 0) { const id = o.connected_account_id ?? o.connectedAccountId; if (typeof id === "string" && /^[A-Za-z0-9_-]{3,80}$/.test(id)) return id; }
  return undefined;
}
// Đối tượng nói về một kết nối của toolkit đang hoạt động (không phải đang chờ đăng nhập).
const activeConn = (o: Rec) => {
  const st = o.status ?? o.connection_status;
  if (typeof st === "string") return /^(active|connected|enabled|ok)$/i.test(st);
  if (o.has_active_connection === false || o.is_connected === false) return false;
  return o.has_active_connection === true || o.is_connected === true || typeof o.connected_account_id === "string";
};
const connLike = (o: Rec) => "status" in o || "connected_account_id" in o || "has_active_connection" in o || "is_connected" in o;
type Scan = { pairs: Map<string, string>; kits: Set<string>; entries: Map<string, Rec>; accounts: Map<string, Set<string>>; session?: unknown };
function parseJson(content: string): unknown {
  try { return JSON.parse(content); } catch {
    const m = /\{[\s\S]*\}/.exec(content);
    try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
  }
}
/** Đọc kết quả công cụ meta của Composio: slug ↔ toolkit, toolkit, lược đồ từng công cụ, tài khoản đang kết nối. Không đoán: chỉ lấy trường có cấu trúc. */
export function cxScan(content: string): Scan {
  const out: Scan = { pairs: new Map(), kits: new Set(), entries: new Map(), accounts: new Map() };
  const walk = (v: unknown, key: string, depth: number) => {
    if (!v || typeof v !== "object" || depth > 10) return;
    if (Array.isArray(v)) { for (const x of v.slice(0, 500)) walk(x, key, depth + 1); return; }
    const o = v as Rec;
    if (depth <= 3 && out.session === undefined && (o.session !== undefined || o.session_id !== undefined)) out.session = o.session ?? { id: o.session_id };
    let kit = kitStr(o.toolkit) ?? kitStr(o.toolkit_slug) ?? kitStr(o.app_slug);
    const slug = slugStr(o.tool_slug) ?? slugStr(o.slug) ?? slugStr(o.tool) ?? slugStr(o.name) ?? slugStr(key);
    // Kết quả theo toolkit ({ results: { gmail: { status: "active", connected_account_id } } }): tên toolkit là khóa.
    if (!kit && !slug && KIT_RE.test(key) && !GENERIC.has(key) && connLike(o)) kit = key;
    if (slug && (!kit || under(slug, kit))) {
      if (kit) out.pairs.set(slug, kit);
      out.entries.set(slug, { ...(out.entries.get(slug) ?? {}), ...o });
    }
    if (kit) {
      out.kits.add(kit);
      if (!slug && activeConn(o)) { const l = acctLabel(o); if (l) out.accounts.set(kit, (out.accounts.get(kit) ?? new Set<string>()).add(l)); }
      for (const k of ["tool_slugs", "primary_tool_slugs", "related_tool_slugs", "tools"]) { const a = o[k]; if (Array.isArray(a)) for (const x of a) { const s = slugStr(x); if (s && under(s, kit)) out.pairs.set(s, kit); } }
    }
    for (const [k, x] of Object.entries(o)) walk(x, k, depth + 1);
  };
  walk(parseJson(content), "", 0);
  return out;
}
/** Lược đồ đầu vào trong mục công cụ Composio trả về (tên trường khác nhau giữa các bản). */
function schemaOf(e: Rec): Rec | undefined {
  for (const k of ["input_schema", "inputSchema", "input_parameters", "inputParameters", "parameters", "schema"]) { const v = e[k]; if (v && typeof v === "object" && !Array.isArray(v)) return v as Rec; }
  return undefined;
}
const capEntry = (slug: string, kit: string, e: Rec): Rec => {
  const full = { ...e, tool_slug: slug, toolkit: kit };
  if (JSON.stringify(full).length <= ENTRY_MAX) return full;
  const small: Rec = { tool_slug: slug, toolkit: kit, ...(typeof e.description === "string" ? { description: e.description.slice(0, 600) } : {}) };
  const sc = schemaOf(e);
  if (sc && JSON.stringify(sc).length <= ENTRY_MAX - 800) small.input_schema = sc;
  return small;
};
/** Ghi nhớ kết quả của một công cụ meta Composio (không lỗi) cho người dùng: gọi sau mỗi lần SEARCH_TOOLS / GET_TOOL_SCHEMAS / MANAGE_CONNECTIONS / WAIT_FOR_CONNECTIONS. */
export function cxLearn(user: string, tool: string, content: string, now = Date.now()): void {
  if (!user || !META_READ.has(tool)) return;
  const sc = cxScan(content);
  if (!sc.pairs.size && !sc.kits.size && !sc.accounts.size) return;
  const b = bucket(user, now);
  for (const [slug, kit] of sc.pairs) { b.slugs.delete(slug); b.slugs.set(slug, { kit, at: now }); }
  for (const kit of sc.kits) { b.kits.delete(kit); b.kits.set(kit, now); }
  trim(b.slugs, LEARN_SLUGS); trim(b.kits, LEARN_KITS);
  for (const [kit, labels] of sc.accounts) b.accounts.set(kit, { at: now, label: labels.size === 1 ? [...labels][0].slice(0, 80) : null });
  // Lược đồ công cụ theo toolkit: chỉ lưu từ kết quả tìm công cụ / xem tham số.
  if (tool === SEARCH_TOOL || tool === SCHEMAS_TOOL) {
    for (const [slug, e] of sc.entries) {
      const kit = sc.pairs.get(slug) ?? b.slugs.get(slug)?.kit;
      if (!kit) continue;
      const m = b.tools.get(kit) ?? new Map<string, { at: number; entry: Rec }>();
      const prev = m.get(slug)?.entry ?? {};
      m.delete(slug);
      m.set(slug, { at: now, entry: capEntry(slug, kit, { ...prev, ...e }) });
      trim(m, TOOLS_PER_KIT);
      b.tools.delete(kit); b.tools.set(kit, m);
    }
    trim(b.tools, LEARN_KITS);
    if (sc.session !== undefined && tool === SEARCH_TOOL) b.session = { at: now, value: sc.session };
  }
}

// ---- cache lược đồ công cụ Composio ----
// Một lần "đọc đơn giản" qua Composio tốn 5 bước / ~25 giây vì model phải COMPOSIO_SEARCH_TOOLS rồi COMPOSIO_GET_TOOL_SCHEMAS trước khi chạy.
// Hai công cụ meta này chỉ đọc danh mục công cụ, nên lưu theo (người dùng, toolkit) 24 giờ (E3.4):
//  - lời dặn của lượt sau kèm sẵn tên và tham số các công cụ đã tìm được (cxKnownPrompt): model gọi thẳng MULTI_EXECUTE, bỏ hẳn hai bước tìm;
//  - model vẫn tìm thì: lần đọc y hệt lấy nguyên kết quả cũ; GET_TOOL_SCHEMAS cho slug đã có lược đồ lấy từ cache; SEARCH_TOOLS nói tới toolkit đã có công cụ
//    phù hợp (khác chữ cũng được) trả các công cụ đã biết của toolkit đó. Lần tìm thứ hai cho cùng toolkit trong lượt đi thẳng tới Composio (cache không đủ).
// Bỏ khi connector của người dùng thật sự đổi (liên kết lại, gỡ, đổi quyền, danh sách công cụ khác đi). Không bí mật nào: chỉ là lược đồ công cụ công khai.
const SCHEMA_MAX = 2000;
const SCHEMA_READS = new Set([SEARCH_TOOL, SCHEMAS_TOOL]);
/** Công cụ meta chỉ đọc danh mục / lược đồ công cụ (được phép cache). */
export const isSchemaRead = (tool: string) => SCHEMA_READS.has(tool);
/** Công cụ meta mà Synchro học từ kết quả (cxLearn). */
export const isMetaRead = (tool: string) => META_READ.has(tool);
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as Rec).sort().map((k) => [k, stable((v as Rec)[k])])) : v;
const stableJson = (v: unknown) => { try { return JSON.stringify(stable(v)); } catch { return ""; } };
/** Các toolkit mà một lời gọi đọc lược đồ đụng tới (từ trường toolkit/app, hoặc tiền tố của tool_slug): dùng trong khóa cache. */
export function cacheToolkits(input: unknown): string[] {
  const o = obj(input);
  const out = new Set<string>();
  const add = (v: unknown) => { if (typeof v === "string" && v) { const s = v.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60); if (s) out.add(s); } };
  for (const k of ["toolkit", "toolkit_slug", "app"]) add(o[k]);
  for (const k of ["toolkits", "apps"]) { const a = o[k]; if (Array.isArray(a)) for (const x of a) add(typeof x === "string" ? x : obj(x).slug); }
  for (const k of ["tool_slugs", "tools"]) { const a = o[k]; if (Array.isArray(a)) for (const x of a) { const s = typeof x === "string" ? x : typeof obj(x).tool_slug === "string" ? String(obj(x).tool_slug) : ""; if (s) add(slugParts(s).kit); } }
  return [...out].sort();
}
const USEP = "\u0000";
/** Khóa cache của lần đọc y hệt (người dùng, công cụ, toolkit, tham số). null: không cache lời gọi này (công cụ khác, hoặc không rõ người dùng). */
export function schemaCacheKey(user: string, tool: string, input: unknown): string | null {
  if (!user || !isSchemaRead(tool)) return null;
  return [user, tool, cacheToolkits(input).join(","), stableJson(input)].join(USEP);
}
const schemaStore = new Map<string, { at: number; content: string }>();
const STOP = new Set(["the", "and", "for", "with", "from", "into", "via", "using", "use", "all", "any", "new", "this", "that", "them", "their", "some", "app", "tool", "tools", "account", "user", "please", "find", "search", "way", "my"]);
const stem = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const flat = (k: string) => k.replace(/_/g, "");
function textOf(v: unknown, depth = 0): string {
  if (typeof v === "string") return v;
  if (!v || typeof v !== "object" || depth > 4) return "";
  return (Array.isArray(v) ? v : Object.values(v as Rec)).map((x) => textOf(x, depth + 1)).join(" ");
}
/** Toolkit được nhắc tới trong một câu tìm ("gửi email qua Gmail", "Google Docs"): so với tên toolkit viết liền, cả khi tách thành 2–3 chữ. */
function mentioned(text: string, kits: Iterable<string>): Set<string> {
  const t = tokens(text);
  const forms = new Set<string>();
  for (let i = 0; i < t.length; i++) { forms.add(t[i]); if (i + 1 < t.length) forms.add(t[i] + t[i + 1]); if (i + 2 < t.length) forms.add(t[i] + t[i + 1] + t[i + 2]); }
  const out = new Set<string>();
  for (const k of kits) if (forms.has(flat(k)) || forms.has(appName(k).toLowerCase().replace(/[^a-z0-9]+/g, ""))) out.add(k);
  return out;
}
const CACHE_NOTE = "Synchro: các công cụ này lấy từ cache 24 giờ của những lần tìm trước. Không có công cụ phù hợp thì gọi lại COMPOSIO_SEARCH_TOOLS (lần tìm thứ hai trong lượt đi thẳng tới Composio).";
/** Kết quả lấy từ cache. kits: trả theo toolkit (không phải lần đọc y hệt) — lần tìm thứ hai trong lượt cho cùng toolkit phải đi tới Composio. */
export type SchemaHit = { content: string; kits?: string[] };
/** Tìm trong cache: lần đọc y hệt; GET_TOOL_SCHEMAS cho slug đã có lược đồ; SEARCH_TOOLS nói tới toolkit đã có công cụ phù hợp. */
export function schemaCacheLookup(user: string, tool: string, input: unknown, now = Date.now()): SchemaHit | null {
  const k = schemaCacheKey(user, tool, input);
  if (!k) return null;
  const e = schemaStore.get(k);
  if (e && live(e.at, now)) return { content: e.content };
  if (e) schemaStore.delete(k);
  const b = learned.get(user);
  if (!b) return null;
  const inp = obj(input);
  if (tool === SCHEMAS_TOOL) {
    const slugs = Array.isArray(inp.tool_slugs) ? inp.tool_slugs : [];
    if (!slugs.length || slugs.length > 20 || Object.keys(inp).some((x) => x !== "tool_slugs")) return null;
    const got: Rec = {};
    const kits = new Set<string>();
    for (const s of slugs) {
      const slug = typeof s === "string" ? s.toUpperCase() : "";
      const kit = b.slugs.get(slug)?.kit;
      const t = kit ? b.tools.get(kit)?.get(slug) : undefined;
      if (!kit || !t || !live(t.at, now) || !schemaOf(t.entry)) return null;
      got[slug] = t.entry;
      kits.add(kit);
    }
    return { content: JSON.stringify({ successful: true, data: { tool_schemas: got }, note: CACHE_NOTE }), kits: [...kits] };
  }
  if (tool !== SEARCH_TOOL) return null;
  // Toolkit đã có công cụ trong cache; nhắc tới toolkit đã biết mà chưa có trong cache thì phải tìm thật.
  const cached = [...b.tools].filter(([, m]) => [...m.values()].some((t) => live(t.at, now))).map(([kit]) => kit);
  const known = new Set([...KNOWN_KITS, ...b.kits.keys()]);
  const queries = Array.isArray(inp.queries) && inp.queries.length ? inp.queries.map((q) => textOf(q)) : [textOf(inp)];
  const use = new Set<string>(), want = new Set<string>();
  for (const q of queries) {
    const hit = mentioned(q, cached);
    if (!hit.size || [...mentioned(q, known)].some((x) => !hit.has(x))) return null;
    // Câu tìm phải trùng ít nhất một chữ với tên một công cụ đã biết của toolkit đó ("send an email" ↔ GMAIL_SEND_EMAIL), không thì cache không chắc có công cụ cần.
    const kitWords = new Set([...hit].flatMap((x) => [...tokens(x), flat(x)]));
    const qw = new Set(tokens(q).filter((w) => w.length > 2 && !STOP.has(w) && !kitWords.has(w)).map(stem));
    const match = [...hit].flatMap((kit) => [...(b.tools.get(kit)?.keys() ?? [])].filter((slug) => tokens(slug).slice(tokens(kit).length).some((w) => qw.has(stem(w)))));
    if (!match.length) return null;
    for (const x of hit) use.add(x);
    for (const s of match) want.add(s);
  }
  // Công cụ khớp câu tìm đứng trước; tổng kết quả có giới hạn, phần không vừa chỉ ghi tên (xem tham số bằng GET_TOOL_SCHEMAS, cũng lấy từ cache).
  const all = [...use].flatMap((kit) => [...(b.tools.get(kit) ?? [])].filter(([, t]) => live(t.at, now)).map(([slug, t]) => [slug, t.entry] as const));
  all.sort((x, y) => Number(want.has(y[0])) - Number(want.has(x[0])));
  const results: Rec[] = [], more: string[] = [];
  let size = 0;
  for (const [slug, entry] of all) { const n = JSON.stringify(entry).length; if (size + n <= 30_000) { results.push(entry); size += n; } else more.push(slug); }
  const session = b.session && live(b.session.at, now) ? { session: b.session.value } : {};
  return { content: JSON.stringify({ successful: true, data: { results, ...(more.length ? { more_tool_slugs: more } : {}), ...session }, note: CACHE_NOTE }), kits: [...use] };
}
/** Kết quả đã cache còn trong 24 giờ, hoặc null. */
export function schemaCacheGet(user: string, tool: string, input: unknown, now = Date.now()): string | null {
  return schemaCacheLookup(user, tool, input, now)?.content ?? null;
}
/** Lưu kết quả đọc lược đồ (chỉ khi không lỗi — nơi gọi tự kiểm tra): lần đọc y hệt, và công cụ theo toolkit (cxLearn). */
export function schemaCachePut(user: string, tool: string, input: unknown, content: string, now = Date.now()): void {
  const k = schemaCacheKey(user, tool, input);
  if (!k) return;
  if (schemaStore.size >= SCHEMA_MAX && !schemaStore.has(k)) { const first = schemaStore.keys().next().value; if (first !== undefined) schemaStore.delete(first); }
  schemaStore.set(k, { at: now, content });
  cxLearn(user, tool, content, now);
}
/** Connector của người dùng thay đổi (liên kết lại, đổi quyền, danh sách công cụ đổi, gỡ): bỏ mọi lược đồ đã cache và tài khoản đã biết của người đó.
 *  Hiểu biết slug → toolkit (chỉ dùng để tách ứng dụng) giữ tới hết hạn: bỏ nó chỉ làm thao tác bị hỏi nhiều hơn. */
export function invalidateSchemaCache(user: string): void {
  if (!user) return;
  const pre = user + USEP;
  for (const k of [...schemaStore.keys()]) if (k.startsWith(pre)) schemaStore.delete(k);
  const b = learned.get(user);
  if (b) { b.tools.clear(); b.accounts.clear(); b.session = undefined; }
}
const KNOWN_PROMPT_MAX = 4000, KNOWN_PER_KIT = 12;
/** Lời dặn thêm cho lượt chat: công cụ Composio người dùng đã tìm trong 24 giờ, kèm tham số, để model gọi thẳng COMPOSIO_MULTI_EXECUTE_TOOL. "" khi chưa có. */
export function cxKnownPrompt(user: string, now = Date.now()): string {
  const b = learned.get(user);
  if (!b) return "";
  const lines: string[] = [];
  let size = 0;
  for (const [kit, m] of [...b.tools].reverse()) {
    for (const [slug, t] of [...m].reverse().filter(([, x]) => live(x.at, now)).slice(0, KNOWN_PER_KIT)) {
      const sc = schemaOf(t.entry);
      if (!sc) continue;
      const req = new Set(Array.isArray(sc.required) ? sc.required.filter((x): x is string => typeof x === "string") : []);
      const props = Object.entries(obj(sc.properties)).slice(0, 12).map(([k, v]) => `${k}${req.has(k) ? "*" : ""}${typeof obj(v).type === "string" ? `: ${String(obj(v).type)}` : ""}`);
      const desc = typeof t.entry.description === "string" ? t.entry.description.replace(/\s+/g, " ").trim().slice(0, 140) : "";
      const line = `- ${slug} (${appName(kit)})${desc ? `: ${desc}` : ""}; tham số: ${props.join(", ") || "không có"}`;
      if (size + line.length > KNOWN_PROMPT_MAX) break;
      lines.push(line);
      size += line.length;
    }
  }
  if (!lines.length) return "";
  return `Công cụ Composio người dùng đã dùng trong 24 giờ qua (tên đúng và tham số, * là bắt buộc). Khi một công cụ dưới đây làm được việc, gọi thẳng COMPOSIO_MULTI_EXECUTE_TOOL với đúng tên và tham số đó, không cần COMPOSIO_SEARCH_TOOLS hay COMPOSIO_GET_TOOL_SCHEMAS; thiếu công cụ cần dùng hoặc lời gọi báo sai tham số thì mới tìm lại:\n${lines.join("\n")}`;
}

// ---- nhãn và thẻ duyệt bằng lời thường ----
// Tham số chính hiện ngay sau tên thao tác ("Tạo tài liệu 'Synchro test'"): tên, tiêu đề, người nhận…
const MAIN_KEYS = ["title", "name", "subject", "summary", "file_name", "filename", "channel", "to", "recipient_email", "query", "q", "text", "message", "body", "content", "description", "url", "path"];
const ACCOUNT_KEYS = ["account", "account_email", "connected_account", "connected_account_id", "account_id", "user_email"];
const short = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);
const prim = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(", ") : "");
// Tham số thao tác có thể là chuỗi JSON (Gemini): đọc ra để thẻ hiện đúng tham số chính.
const argsOf = (v: unknown): Rec => { if (typeof v === "string") { try { return obj(JSON.parse(v)); } catch { return {}; } } return obj(v); };
function mainOf(args: Rec) {
  for (const k of MAIN_KEYS) { const v = prim(args[k]); if (v) return short(v, 60); }
  return undefined;
}
function paramsOf(args: Rec): [string, string][] {
  return Object.entries(args).map(([k, v]) => [k, prim(v)] as [string, string]).filter(([k, v]) => v && !/token|secret|password|api[_-]?key|authorization|cookie/i.test(k)).slice(0, 5).map(([k, v]) => [k, short(v, 120)]);
}
function accountOf(...os: Rec[]) {
  for (const o of os) for (const k of ACCOUNT_KEYS) { const v = prim(o[k]); if (v) return short(v, 60); }
  return undefined;
}
/** Thẻ duyệt của một lời gọi Composio: ứng dụng (logo), tài khoản đích, thao tác bằng lời thường, tham số chính. null: không phải công cụ Composio đã biết.
 *  user: tách ứng dụng theo toolkit Composio đã trả cho người này; tài khoản đích lấy từ kết nối Composio đã báo khi model không truyền. */
export function cxCard(tool: string, input: unknown, user?: string): CxCard | null {
  const inp = obj(input);
  if (tool === EXEC_TOOL) {
    const list = items(input);
    if (!list) return null;
    const h = cxHints(user);
    // Mọi thao tác ghi trong lời gọi (cần duyệt). Thẻ nói về thao tác ghi đầu tiên; toàn đọc thì thao tác đầu.
    const writeItems = list.filter((x) => !slugIsRead(x.tool_slug, x.arguments, h));
    const first = writeItems[0] ?? list[0];
    const { kit, rest } = slugParts(first.tool_slug, h);
    const args = argsOf(first.arguments);
    const plan = execPlan(input, user);
    // Nhiều thao tác ghi: liệt kê từng dòng (ứng dụng · thao tác · tham số chính · tài khoản); "+N" còn lại là thao tác đọc.
    const line = (x: Item): CxWrite => { const p = slugParts(x.tool_slug, h); const a = argsOf(x.arguments); return { name: appName(p.kit), act: actionWords(p.rest) || x.tool_slug, main: mainOf(a), account: accountOf(obj(x), a, inp) ?? cxAccount(user, p.kit) }; };
    const writes = writeItems.length > 1 ? writeItems.map(line) : undefined;
    const more = writes ? list.length - writeItems.length : list.length - 1;
    return { app: kit, name: appName(kit), act: actionWords(rest) || first.tool_slug, main: mainOf(args), account: accountOf(obj(first), args, inp) ?? cxAccount(user, kit), params: paramsOf(args), ...(more > 0 ? { more } : {}), apps: plan?.writes ?? [], ...(writes ? { writes } : {}) };
  }
  if (tool === PROXY_TOOL) {
    const kit = String(inp.toolkit ?? inp.toolkit_slug ?? inp.app ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60);
    const m = method(input) || "?";
    return { app: kit || COMPOSIO, name: kit ? appName(kit) : COMPOSIO_NAME, act: `${metaWords(tool)} ${m}`, main: prim(inp.endpoint) ? short(prim(inp.endpoint), 80) : undefined, account: accountOf(inp) ?? (kit ? cxAccount(user, kit) : undefined), params: paramsOf({ method: m, endpoint: inp.endpoint, body: typeof inp.body === "string" ? inp.body : inp.body ? JSON.stringify(inp.body) : undefined }), ...(m !== "GET" ? { strict: true } : {}) };
  }
  const meta = metaWords(tool);
  if (!meta) return null;
  const detail = ALWAYS_ASK.has(tool) ? prim(inp.command ?? inp.code ?? inp.cmd) : "";
  return { app: COMPOSIO, name: COMPOSIO_NAME, act: meta, ...(detail ? { main: short(detail.split("\n")[0], 80), params: [[inp.command !== undefined ? "command" : "code", short(String(inp.command ?? inp.code ?? inp.cmd), 400)]] } : {}), ...(ALWAYS_ASK.has(tool) ? { strict: true } : {}) };
}
/** Nhãn ngắn của lời gọi Composio cho dòng công cụ trong chat: "Google Docs · Tạo tài liệu", "Composio · Tìm công cụ". null: để nhãn mặc định. */
export function cxLabel(tool: string, input: unknown, user?: string): { app: string; act: string } | null {
  const c = cxCard(tool, input, user);
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
