// Composio của từng người: mỗi tài khoản Synchro có sẵn một connector trỏ tới máy chủ MCP cá nhân của Composio Connect (https://connect.composio.dev/mcp,
// Streamable HTTP). Người dùng bấm "Liên kết Composio" để đăng nhập tài khoản Composio của chính mình (OAuth của MCP: Protected Resource Metadata →
// connect.composio.dev, đăng ký động, PKCE S256, refresh token), hoặc dán khóa người dùng ck_… (header x-consumer-api-key) ở mục Nâng cao.
// Ứng dụng (Gmail, Slack…) được liên kết / gỡ trên trang web của Composio; Synchro không liệt kê ứng dụng và dùng được ngay ứng dụng vừa liên kết vì
// mọi thao tác đi qua công cụ meta của Composio (tìm công cụ, chạy, quản lý kết nối). Không còn khóa dự án Composio dùng chung của quản trị viên.
// Token / khóa nằm mã hóa trong hàng connector của đúng tài khoản đó (app/connectors.ts), không bao giờ ra trình duyệt hay sandbox chạy code.
import { slugRead, type McpTool } from "./mcp";
import { isConnectUrl } from "./cxlink";

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

const NAMES: Record<string, string> = {
  github: "GitHub", gitlab: "GitLab", googledrive: "Google Drive", googlesheets: "Google Sheets", googledocs: "Google Docs", googlecalendar: "Google Calendar",
  googleslides: "Google Slides", googlemeet: "Google Meet", googlemaps: "Google Maps", hubspot: "HubSpot", linkedin: "LinkedIn", youtube: "YouTube", clickup: "ClickUp",
  onedrive: "OneDrive", outlook: "Outlook", sharepoint: "SharePoint", whatsapp: "WhatsApp", paypal: "PayPal", quickbooks: "QuickBooks", zoho: "Zoho", posthog: "PostHog",
};
export const appName = (slug: string) => NAMES[slug] ?? slug.split(/[_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// ---- công cụ meta ----
// Công cụ meta không thay đổi gì trong ứng dụng của người dùng: tìm công cụ, xem tham số, tạo Connect Link / xem trạng thái kết nối, chờ kết nối xong.
// Khi máy chủ không tự khai báo, Synchro coi chúng là công cụ đọc (chạy không cần hỏi). Chạy thao tác (MULTI_EXECUTE), bash / workbench từ xa
// vẫn hỏi trước như công cụ ghi; riêng MULTI_EXECUTE với toàn thao tác chỉ đọc thì chạy luôn (execRead).
const META_READ = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_WAIT_FOR_CONNECTIONS"]);
export const EXEC_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";
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
