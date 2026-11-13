// Logo của mọi connector (chỉ chạy ở máy chủ), một chỗ cho trang Connectors, menu +, danh sách @, thẻ duyệt công cụ và dòng công cụ trong chat:
// connector mới thêm sau này tự có logo theo đúng thứ tự này, không phải sửa từng chỗ hiện.
//  1. logo có sẵn trong public/connectors (danh mục cũ; Composio; máy chủ MCP của hãng có tệp sẵn như mcp.notion.com → notion.svg)
//  2. icon Synchro tự tìm lúc kết nối (serverInfo.icons, icon trang chủ của hãng, app/connicons.ts), lưu trên hàng connector
//  3. site: biểu tượng trang của tên miền thương hiệu (máy chủ MCP, rồi máy chủ đăng nhập OAuth) tải hộ qua /api/favicon?d=… (app/iconproxy.ts)
//  4. chữ cái đầu (giao diện tự vẽ khi không có gì ở trên, hoặc ảnh không tải được)
import fs from "node:fs";
import path from "node:path";
import { brandHost, publicHost } from "./iconproxy";
import { FILE_LOGOS, logoSrc } from "./vendorlogo";
import { slugIsRead, slugParts } from "./cxactions";

export const COMPOSIO_LOGO = "composio";
export type ConnLogoFields = { logo?: string; color?: string; icon?: string; site?: string };

const have = new Map<string, boolean>();
/** Có tệp public/connectors/<slug>.svg không (nhớ kết quả, chỉ nhận tên chữ thường và số). */
export function bundledLogo(slug: string | null | undefined): string | undefined {
  const s = (slug ?? "").toLowerCase();
  if (!/^[a-z0-9]{2,40}$/.test(s)) return undefined;
  let ok = have.get(s);
  if (ok === undefined) { ok = fs.existsSync(path.join(process.cwd(), "public", "connectors", `${s}.svg`)); have.set(s, ok); }
  return ok ? s : undefined;
}

const hostOf = (u: string | null | undefined) => { try { return u ? new URL(u).hostname : ""; } catch { return ""; } };
/** Đường dẫn biểu tượng trang qua proxy cho một địa chỉ (tên miền thương hiệu, chỉ tên miền công khai), hoặc undefined. */
export function siteOf(...urls: (string | null | undefined)[]): string | undefined {
  for (const u of urls) {
    const h = publicHost(hostOf(u));
    const b = h ? publicHost(brandHost(h)) : null;
    if (b) return `/api/favicon?d=${encodeURIComponent(b)}`;
  }
  return undefined;
}

/** Logo cho một connector: dirLogo/dirColor của danh mục cũ, icon đã tìm (data URI), địa chỉ máy chủ MCP và máy chủ đăng nhập OAuth (nếu có). */
export function connLogo(o: { composio?: boolean; color?: string; dirLogo?: string; icon?: string | null; url?: string | null; issuer?: string | null }): ConnLogoFields {
  if (o.composio) return { logo: COMPOSIO_LOGO, color: o.color };
  if (o.dirLogo) return { logo: o.dirLogo, color: o.color };
  // Máy chủ MCP của một hãng có sẵn logo (mcp.linear.app, mcp.notion.com…): dùng tệp có sẵn, nét hơn ảnh tự tìm.
  const h = publicHost(hostOf(o.url));
  const own = h ? bundledLogo(brandHost(h).split(".")[0]) : undefined;
  if (own && !o.icon) return { logo: own, color: o.color };
  const site = siteOf(o.url, o.issuer);
  return { ...(o.color ? { color: o.color } : {}), ...(o.icon ? { icon: o.icon } : {}), ...(site ? { site } : {}) };
}

// ---- ứng dụng trong Composio (Gmail, Slack…): nút "Kết nối <ứng dụng>", dòng công cụ và thẻ duyệt hiện logo của chính ứng dụng ----
// Không cần khóa Composio nào: 1. tệp có sẵn trong public/connectors (hoặc public/logos), 2. biểu tượng trang chủ của ứng dụng (APP_SITES)
// tải hộ qua /api/favicon?app=<slug> (cùng proxy favicon chặn địa chỉ nội bộ, có giới hạn), 3. giao diện hiện chữ cái đầu.
/** Trang chủ của các ứng dụng hay dùng (slug Composio → tên miền) để lấy biểu tượng trang. */
export const APP_SITES: Record<string, string> = {
  gmail: "mail.google.com", googledrive: "drive.google.com", googlesheets: "sheets.google.com", googledocs: "docs.google.com", googlecalendar: "calendar.google.com",
  googleslides: "slides.google.com", googlemeet: "meet.google.com", googlemaps: "maps.google.com", youtube: "youtube.com", slack: "slack.com", github: "github.com",
  gitlab: "gitlab.com", notion: "notion.so", linear: "linear.app", jira: "atlassian.com", confluence: "atlassian.com", trello: "trello.com", asana: "asana.com",
  hubspot: "hubspot.com", salesforce: "salesforce.com", outlook: "outlook.com", onedrive: "onedrive.live.com", sharepoint: "microsoft.com", microsoftteams: "teams.microsoft.com",
  discord: "discord.com", telegram: "telegram.org", whatsapp: "whatsapp.com", twitter: "x.com", linkedin: "linkedin.com", reddit: "reddit.com", figma: "figma.com",
  dropbox: "dropbox.com", airtable: "airtable.com", clickup: "clickup.com", stripe: "stripe.com", shopify: "shopify.com", zoom: "zoom.us", calendly: "calendly.com",
  todoist: "todoist.com", supabase: "supabase.com", vercel: "vercel.com", sentry: "sentry.io", intercom: "intercom.com", zendesk: "zendesk.com", mailchimp: "mailchimp.com",
  paypal: "paypal.com", quickbooks: "quickbooks.intuit.com", posthog: "posthog.com", miro: "miro.com", canva: "canva.com", monday: "monday.com", zoho: "zoho.com",
};
/** Slug ứng dụng Composio hợp lệ (chữ thường, số, _ -). */
export const appSlug = (s: unknown) => { const x = String(s ?? "").toLowerCase(); return /^[a-z0-9_-]{1,60}$/.test(x) ? x : ""; };
/** Logo của một ứng dụng Composio: tệp có sẵn, không có thì biểu tượng trang chủ qua proxy (icon) nếu biết trang chủ, không thì {} (chữ cái đầu). */
export function appLogo(slug: string): { logo?: string; icon?: string } {
  const s = appSlug(slug);
  if (!s) return {};
  const own = bundledLogo(s);
  if (own) return { logo: own };
  // Logo hãng trong public/logos giữ màu thương hiệu (Hugging Face, Microsoft…): hiện thẳng như ảnh. Logo kiểu mặt nạ cần tô màu nên bỏ qua.
  if (Object.hasOwn(FILE_LOGOS, s) && FILE_LOGOS[s].mode === "img" && !FILE_LOGOS[s].src) return { icon: logoSrc(s) };
  // Mọi slug hợp lệ: proxy thử logo chính thức của Composio rồi tới biểu tượng trang chủ; không có ảnh nào thì 404 và giao diện hiện chữ cái đầu.
  return { icon: `/api/favicon?app=${s}` };
}
/** Ứng dụng mà một lời gọi công cụ Composio nhắm tới: tool_slug đầu tiên (GMAIL_FETCH_EMAILS → gmail) hoặc toolkits[0]. Không rõ: "". */
export function composioAppOf(input: unknown): string {
  const o = (input && typeof input === "object" ? input : {}) as { tools?: unknown; toolkits?: unknown; tool_slug?: unknown; toolkit?: unknown };
  // Thẻ duyệt nói về thao tác ghi đầu tiên (thao tác cần duyệt): logo theo đúng ứng dụng đó.
  const list = Array.isArray(o.tools) ? (o.tools as { tool_slug?: unknown; arguments?: unknown }[]) : [];
  const first = list.length ? (list.find((x) => typeof x?.tool_slug === "string" && !slugIsRead(x.tool_slug, x.arguments)) ?? list[0])?.tool_slug : o.tool_slug;
  if (typeof first === "string" && first.includes("_")) return appSlug(slugParts(first).kit);
  const kit = Array.isArray(o.toolkits) ? o.toolkits[0] : o.toolkit;
  return appSlug(kit);
}
