// Composio: connector chính của mọi tài khoản (chỉ chạy ở máy chủ). Quản trị viên dán một khóa dự án Composio ở Cài đặt → Providers
// (hoặc biến môi trường COMPOSIO_API_KEY); mỗi người dùng Synchro có một phiên Tool Router riêng (user_id = mã tài khoản Synchro),
// tạo một lần rồi dùng lại. Máy chủ MCP của phiên có các công cụ tìm công cụ trong hơn 1000 ứng dụng, tạo Connect Link để người dùng
// đăng nhập ứng dụng (OAuth do Composio quản lý, không cần Client ID) và chạy công cụ. Khóa chỉ gắn vào từng lời gọi ở máy chủ này:
// không lưu vào hàng connector của ai, không gửi về trình duyệt, không vào sandbox chạy code.
// API (docs.composio.dev, tháng 11/2026): POST /tool_router/session, GET /connected_accounts?user_ids=…, DELETE /connected_accounts/{id}.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { serviceKey } from "./providers";
import { slugRead, type McpTool } from "./mcp";

export const COMPOSIO = "composio";
export const COMPOSIO_NAME = "Composio";
export const COMPOSIO_COLOR = "#5B4BDB";
export const NO_KEY = "Quản trị viên chưa thêm khóa Composio nên Composio chưa dùng được.";
export const KEY_REJECTED = "Composio từ chối khóa API của Synchro. Hãy báo quản trị viên kiểm tra khóa Composio ở Cài đặt → Providers.";

export class ComposioError extends Error { constructor(m: string, public status = 502) { super(m); } }

export const composioKey = () => serviceKey("composio");
/** Dấu vân tay của khóa (không đảo ngược được): đổi sang khóa của dự án khác thì phiên cũ không còn thuộc về dự án mới, phải tạo lại. */
export const keyPrint = (k: string) => crypto.createHash("sha256").update(`composio:${k}`).digest("hex").slice(0, 16);

async function call<T>(p: string, o: { method?: string; body?: unknown; timeout?: number } = {}): Promise<T> {
  const k = composioKey();
  if (!k) throw new ComposioError(NO_KEY, 503);
  let r: Response;
  try {
    r = await fetch(`${k.base}${p}`, {
      method: o.method ?? "GET",
      headers: { "x-api-key": k.key, accept: "application/json", ...(o.body === undefined ? {} : { "content-type": "application/json" }) },
      body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: AbortSignal.timeout(o.timeout ?? 15_000),
    });
  } catch (e) { throw new ComposioError(`Không kết nối được tới Composio: ${(e as Error).name === "TimeoutError" ? "quá thời gian chờ" : (e as Error).message}`.slice(0, 300), 503); }
  const text = await r.text();
  let j: unknown = null;
  try { j = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new ComposioError(KEY_REJECTED, 502);
    const e = (j as { error?: { message?: string } | string; message?: string } | null);
    const m = typeof e?.error === "string" ? e.error : e?.error?.message ?? e?.message ?? text.slice(0, 200);
    throw new ComposioError(`Composio báo lỗi ${r.status}${m ? `: ${String(m).slice(0, 200)}` : ""}`, r.status === 404 ? 404 : r.status >= 500 || r.status === 429 ? 503 : 502);
  }
  return j as T;
}

// Máy chủ MCP của phiên: Composio trả về https; API giả lập chạy ở http cục bộ thì cho http khi chính địa chỉ API cũng là http.
function okMcpUrl(u: string) {
  try {
    const x = new URL(u), base = new URL(composioKey()?.base ?? "https://x");
    return x.protocol === "https:" || (x.protocol === "http:" && base.protocol === "http:");
  } catch { return false; }
}

/** Tạo phiên Tool Router cho một tài khoản Synchro, bật trình quản lý kết nối (Connect Link) của Composio. */
export async function createSession(uid: string): Promise<{ session: string; url: string; fp: string }> {
  const k = composioKey();
  if (!k) throw new ComposioError(NO_KEY, 503);
  const j = await call<{ session_id?: string; mcp?: { type?: string; url?: string } }>("/tool_router/session", { method: "POST", body: { user_id: uid, manage_connections: { enable: true } } });
  const url = j?.mcp?.url ?? "";
  if (!j?.session_id || !okMcpUrl(url)) throw new ComposioError("Composio không trả về địa chỉ máy chủ MCP hợp lệ cho phiên.", 502);
  return { session: String(j.session_id), url, fp: keyPrint(k.key) };
}

// ---- ứng dụng người dùng đã kết nối qua Composio ----
// logo: tệp có sẵn trong public/connectors; img: logo Composio trả về (meta.logo), tải hộ qua /api/favicon?app=… khi không có tệp sẵn.
export type ComposioApp = { id: string; app: string; name: string; logo?: string; img?: string; status: string; alias?: string; createdAt: string | null };
type Item = { id?: string; user_id?: string; status?: string; alias?: string; created_at?: string; toolkit?: { slug?: string } };
const NAMES: Record<string, string> = {
  github: "GitHub", gitlab: "GitLab", googledrive: "Google Drive", googlesheets: "Google Sheets", googledocs: "Google Docs", googlecalendar: "Google Calendar",
  googleslides: "Google Slides", googlemeet: "Google Meet", googlemaps: "Google Maps", hubspot: "HubSpot", linkedin: "LinkedIn", youtube: "YouTube", clickup: "ClickUp",
  onedrive: "OneDrive", outlook: "Outlook", sharepoint: "SharePoint", whatsapp: "WhatsApp", paypal: "PayPal", quickbooks: "QuickBooks", zoho: "Zoho", posthog: "PostHog",
};
export const appName = (slug: string) => NAMES[slug] ?? slug.split(/[_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
// Logo có sẵn trong public/connectors (simple-icons, CC0); không có thì giao diện hiện chữ cái đầu.
const logoOf = (slug: string) => (/^[a-z0-9]+$/.test(slug) && fs.existsSync(path.join(process.cwd(), "public", "connectors", `${slug}.svg`)) ? slug : undefined);
// Đang chờ người dùng bấm Connect Link: chưa phải ứng dụng đã kết nối.
const PENDING = new Set(["INITIALIZING", "INITIATED"]);
const APPS_TTL = 60_000;
// Bộ nhớ và hạn mức dùng chung cho mọi route trong tiến trình (Next dựng mỗi route một bản mô-đun riêng): trang Connectors, trang chat (/api/llm) cùng thấy một bản.
type AppsState = { apps: Map<string, { at: number; list: ComposioApp[]; fp: string }>; loading: Map<string, Promise<ComposioApp[]>>; soft: Map<string, { n: number; t: number; last: number }>; all: { n: number; t: number } };
const gx = globalThis as unknown as { __synchroComposioApps?: AppsState };
const AX = (gx.__synchroComposioApps ??= { apps: new Map(), loading: new Map(), soft: new Map(), all: { n: 0, t: 0 } });
const apps = AX.apps, loading = AX.loading;
// Trang Connectors muốn danh sách mới (vừa đăng nhập ứng dụng ở Connect Link), nhưng mọi tài khoản dùng chung một khóa dự án Composio của quản trị viên:
// một tài khoản tải trang liên tục không được làm Composio giới hạn tốc độ (429) khóa đó cho mọi người. Mỗi tài khoản tối đa một lần tải mới mỗi giây và
// 30 lần mỗi 10 phút, cả máy chủ 600 lần mỗi 10 phút; quá thì dùng bản đã nhớ (60 giây). Lời gọi cùng lúc của một tài khoản dùng chung một yêu cầu.
// Máy giả lập (SYNCHRO_RELAX_LIMITS, như limit() ở authstore.ts) nới hạn mức để chạy lại bộ kiểm thử nhiều lần liền không bị danh sách cũ.
const RELAX = process.env.SYNCHRO_RELAX_LIMITS === "1" ? 50 : 1;
const SOFT = { gap: 1000, perUser: 30 * RELAX, all: 600 * RELAX, win: 10 * 60_000 };
// last: lần tải mới gần nhất do trang yêu cầu (không tính lần đọc bộ nhớ của appCount: vừa đăng nhập ứng dụng xong thì trang vẫn phải lấy được bản mới).
const soft = AX.soft;
function freshAllowed(uid: string): boolean {
  const now = Date.now();
  if (soft.size > 20_000) for (const [k, v] of soft) if (v.t < now) soft.delete(k);
  const u = soft.get(uid);
  if (u && now - u.last < SOFT.gap) return false;
  if (u && u.t >= now && u.n >= SOFT.perUser) return false;
  const softAll = AX.all;
  if (softAll.t >= now && softAll.n >= SOFT.all) return false;
  if (!u || u.t < now) soft.set(uid, { n: 1, t: now + SOFT.win, last: now }); else { u.n++; u.last = now; }
  if (softAll.t < now) { softAll.n = 1; softAll.t = now + SOFT.win; } else softAll.n++;
  return true;
}

/** fresh: true bỏ qua bộ nhớ (ngắt ứng dụng: phải đúng danh sách thật); "page": trang muốn bản mới, có hạn mức (freshAllowed); false: nhớ 60 giây. */
export async function listApps(uid: string, fresh: boolean | "page" = false): Promise<ComposioApp[]> {
  // Bản nhớ của khóa Composio cũ (quản trị viên vừa đổi / gỡ khóa) không dùng lại.
  const k = composioKey(), hit = apps.get(uid);
  const want = fresh === "page" ? freshAllowed(uid) : fresh;
  if (!want && hit && hit.fp === (k ? keyPrint(k.key) : "") && Date.now() - hit.at < APPS_TTL) return hit.list;
  const going = loading.get(uid);
  if (going) return going;
  const p = fetchApps(uid).finally(() => loading.delete(uid));
  loading.set(uid, p);
  return p;
}
async function fetchApps(uid: string): Promise<ComposioApp[]> {
  const j = await call<{ items?: Item[] }>(`/connected_accounts?user_ids=${encodeURIComponent(uid)}&limit=100&order_by=created_at&order_direction=desc`);
  // user_id trong kết quả đã bị Composio đánh dấu bỏ dần: còn thì phải khớp (phòng khi bộ lọc không được áp, không bao giờ hiện tài khoản của người khác).
  const list = (Array.isArray(j?.items) ? j!.items : [])
    .filter((x) => x && typeof x.id === "string" && (!x.user_id || x.user_id === uid) && !PENDING.has(String(x.status ?? "")))
    .map((x): ComposioApp => {
      const slug = String(x.toolkit?.slug ?? "").toLowerCase().slice(0, 60);
      const logo = logoOf(slug);
      return { id: x.id!, app: slug, name: appName(slug) || "?", logo, ...(!logo && /^[a-z0-9_-]+$/.test(slug) ? { img: `/api/favicon?app=${slug}` } : {}), status: String(x.status ?? ""), ...(x.alias ? { alias: String(x.alias).slice(0, 60) } : {}), createdAt: x.created_at ?? null };
    });
  const k = composioKey();
  apps.set(uid, { at: Date.now(), list, fp: k ? keyPrint(k.key) : "" });
  return list;
}
// Logo của từng ứng dụng (toolkit) theo API v3.1: GET /toolkits/{slug} → meta.logo. Nhớ 1 ngày; ảnh tải qua app/iconproxy.ts.
const kitLogos = new Map<string, { at: number; url: string | null }>();
const LOGO_TTL = 86_400_000;
export async function toolkitLogoUrl(slug: string): Promise<string | null> {
  if (!/^[a-z0-9_-]{1,60}$/.test(slug)) return null;
  const hit = kitLogos.get(slug);
  if (hit && Date.now() - hit.at < LOGO_TTL) return hit.url;
  let url: string | null = null;
  try {
    const j = await call<{ meta?: { logo?: unknown }; logo?: unknown }>(`/toolkits/${encodeURIComponent(slug)}`, { timeout: 8_000 });
    const raw = typeof j?.meta?.logo === "string" ? j.meta.logo : typeof j?.logo === "string" ? j.logo : "";
    // Chỉ địa chỉ https (API giả lập chạy http cục bộ thì nhận http như chính API, giống okMcpUrl).
    if (raw && raw.length < 2000 && okMcpUrl(raw)) url = raw;
  } catch (e) { if (e instanceof ComposioError && e.status >= 500) return null; }
  kitLogos.delete(slug); kitLogos.set(slug, { at: Date.now(), url });
  // Tối đa 500 ứng dụng trong bộ nhớ (bỏ mục cũ nhất): slug lạ ngẫu nhiên không làm bảng lớn mãi.
  while (kitLogos.size > 500) kitLogos.delete(kitLogos.keys().next().value!);
  return url;
}
/** Số ứng dụng đang kết nối (từ bộ đệm nếu còn mới), lỗi thì null: trang không chờ Composio quá lâu. */
export async function appCount(uid: string): Promise<number | null> {
  try { return (await listApps(uid)).filter((a) => a.status === "ACTIVE").length; } catch { return null; }
}
export const forgetApps = (uid: string) => { apps.delete(uid); };
/** Vừa tạo Connect Link: người dùng sắp đăng nhập một ứng dụng, lần tải trang tới phải lấy danh sách mới (bỏ bộ nhớ và khoảng chờ 1 giây, vẫn trong hạn mức). */
export const appsMayChange = (uid: string) => { apps.delete(uid); const u = soft.get(uid); if (u) u.last = 0; };

/** Ngắt một ứng dụng: chỉ khi nó đúng là của tài khoản này (có trong danh sách lọc theo user_id). */
export async function disconnectApp(uid: string, id: string) {
  if (!/^[\w-]{1,100}$/.test(id)) throw new ComposioError("Mã ứng dụng không hợp lệ.", 400);
  const mine = (await listApps(uid, true)).find((a) => a.id === id);
  if (!mine) throw new ComposioError("Không tìm thấy ứng dụng này trong tài khoản của bạn.", 404);
  await call(`/connected_accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  forgetApps(uid);
  return mine;
}

// ---- công cụ của phiên ----
// Công cụ meta không thay đổi gì trong ứng dụng của người dùng: tìm công cụ, xem tham số, tạo Connect Link / xem trạng thái kết nối.
// Khi máy chủ không tự khai báo, Synchro coi chúng là công cụ đọc (chạy không cần hỏi). Chạy thao tác (MULTI_EXECUTE), bash / workbench từ xa,
// gọi API thẳng (PROXY_EXECUTE) vẫn hỏi trước như công cụ ghi; riêng MULTI_EXECUTE với toàn thao tác chỉ đọc thì chạy luôn (execRead).
const META_READ = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS"]);
export const EXEC_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";
export const LINK_TOOL = "COMPOSIO_MANAGE_CONNECTIONS";
export function annotate<T extends McpTool>(tools: T[]): T[] {
  return tools.map((t) => (META_READ.has(t.name) && t.annotations?.readOnlyHint === undefined ? { ...t, annotations: { ...t.annotations, readOnlyHint: true, destructiveHint: false } } : t));
}
/** Lời gọi MULTI_EXECUTE chỉ gồm thao tác đọc (GMAIL_FETCH_EMAILS, GITHUB_LIST_…): theo quy tắc "công cụ đọc chạy luôn". Không chắc thì không. */
export function execRead(input: unknown): boolean {
  const list = (input as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(list) || !list.length || list.length > 20) return false;
  return list.every((x) => x && typeof x === "object" && typeof (x as { tool_slug?: unknown }).tool_slug === "string" && slugRead((x as { tool_slug: string }).tool_slug, (x as { arguments?: unknown }).arguments));
}

// ---- Connect Link trong kết quả công cụ → nút trong khung chat ----
const LINK_KEYS = ["redirect_url", "redirectUrl", "connect_url", "connectUrl", "connect_link", "redirect_uri"];
function linkHost(u: string) {
  try {
    const x = new URL(u), base = composioKey()?.base;
    const b = base ? new URL(base) : null;
    if (x.username || x.password) return false;
    if (b && x.host === b.host && x.protocol === b.protocol) return true;
    return x.protocol === "https:" && (x.hostname === "composio.dev" || x.hostname.endsWith(".composio.dev"));
  } catch { return false; }
}
/** Connect Link Composio trả về (chỉ địa chỉ của Composio): mỗi ứng dụng một nút. Kết quả đến từ ngoài, nên không nhận địa chỉ nơi khác. */
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
      if (typeof u === "string" && u.length < 2000 && linkHost(u)) {
        const slug = String(o.toolkit ?? o.toolkit_slug ?? o.app ?? key ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
        if (!out.has(u)) out.set(u, { app: slug, name: slug ? appName(slug) : COMPOSIO_NAME, url: u });
      }
    }
    for (const [k, x] of Object.entries(o)) walk(x, /^(data|results|result|response|items|session)$/.test(k) ? key : k, depth + 1);
  };
  walk(j, "", 0);
  return [...out.values()];
}

/** Lời dặn thêm cho model khi có Composio. */
export const COMPOSIO_PROMPT = `Composio nối Synchro với hơn 1000 ứng dụng của người dùng (Gmail, Slack, GitHub, Notion, Google Drive…). Cách dùng: tìm công cụ phù hợp bằng COMPOSIO_SEARCH_TOOLS, rồi chạy bằng COMPOSIO_MULTI_EXECUTE_TOOL đúng tên và tham số vừa tìm được. Ứng dụng chưa kết nối thì gọi COMPOSIO_MANAGE_CONNECTIONS: Synchro tự hiện nút "Kết nối" cho đường link Composio trả về, hãy nói người dùng bấm nút đó, đăng nhập xong thì nhắc lại yêu cầu. Đừng tự chép hay bịa đường link kết nối.`;
