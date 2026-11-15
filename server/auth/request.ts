// Đọc yêu cầu HTTP: IP, địa chỉ chính thức (APP_URL), kiểm tra Origin chống CSRF, cookie; bọc route handler (handle).
import "server-only";
import crypto from "node:crypto";
import { MIN } from "./config";
import { AuthError } from "./errors";
import { timed } from "../servertiming";

// ---- request ----
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const clientIp = (req: Request) => ((req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "local").slice(0, 64);
const host = (req: Request) => req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
const isHttps = (req: Request) => (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";

// APP_URL là địa chỉ chính thức của Synchro, đặt cố định ở máy chủ thật. Khi có, appUrl() và sameOrigin() CHỈ tin nó
// (không nghe header Host của yêu cầu — Host giả mạo không đổi được địa chỉ hay qua được kiểm tra chống CSRF).
const APP_URL = process.env.APP_URL?.replace(/\/$/, "") || "";
const appHost = (() => { try { return APP_URL ? new URL(APP_URL).host : ""; } catch { return ""; } })();
// Production nên luôn đặt APP_URL. Thiếu thì CẢNH BÁO to và tạm dùng Host của yêu cầu (hành vi cũ) để không làm sập VPS;
// chỉ hard-fail khi đặt SYNCHRO_REQUIRE_APP_URL=1 (mặc định tắt).
if (process.env.NODE_ENV === "production" && !APP_URL) {
  const msg = "APP_URL chưa được đặt trong môi trường production: đang tạm dùng Host của yêu cầu (dễ bị giả mạo). Hãy đặt APP_URL.";
  if (process.env.SYNCHRO_REQUIRE_APP_URL === "1") throw new Error("[authstore] " + msg + " (SYNCHRO_REQUIRE_APP_URL=1)");
  console.error("[authstore] " + msg + " Đặt SYNCHRO_REQUIRE_APP_URL=1 để bắt buộc.");
}
export const appUrl = (req: Request) => APP_URL || `${isHttps(req) ? "https" : "http"}://${host(req)}`;

// Mọi request thay đổi dữ liệu phải đến từ chính trang Synchro (chặn CSRF). Tên máy được nhận (allowedOriginHosts): tên máy của APP_URL,
// bản có / không "www." của nó (synchro.net.nz ↔ www.synchro.net.nz), và SYNCHRO_ALLOWED_ORIGINS (danh sách cách nhau bởi dấu phẩy, tên máy
// hoặc địa chỉ đầy đủ). Header Host chỉ được tin khi chính nó nằm trong danh sách đó; không có APP_URL thì mới so với Host của yêu cầu (chỉ xảy ra
// ngoài production, hoặc production chưa đặt APP_URL và chưa bật hard-fail).
const twin = (h: string) => {
  const name = h.replace(/:\d+$/, "");
  if (!name.includes(".") || /^[\d.]+$/.test(name) || name.startsWith("[")) return "";
  return h.startsWith("www.") ? h.slice(4) : `www.${h}`;
};
let allowCache: { key: string; hosts: Set<string> } | null = null;
export function allowedOriginHosts(): Set<string> {
  const extra = process.env.SYNCHRO_ALLOWED_ORIGINS ?? "", key = `${appHost}|${extra}`;
  if (allowCache?.key === key) return allowCache.hosts;
  const hosts = new Set<string>();
  if (appHost) { hosts.add(appHost.toLowerCase()); const t = twin(appHost.toLowerCase()); if (t) hosts.add(t); }
  for (const raw of extra.split(",")) {
    const v = raw.trim();
    if (!v) continue;
    try { hosts.add(new URL(v.includes("://") ? v : `https://${v}`).host); } catch { /* bỏ mục hỏng */ }
  }
  allowCache = { key, hosts };
  return hosts;
}
// Mỗi Origin bị từ chối được ghi một dòng cảnh báo (tối đa mỗi giờ một lần cho mỗi tên máy): đặt sai APP_URL thì nhật ký cho thấy ngay
// mọi thao tác ghi đang bị chặn từ địa chỉ nào, mà kẻ gửi hàng loạt Origin lạ cũng không làm đầy nhật ký được.
const originWarned = new Map<string, number>();
function warnOrigin(h: string) {
  const now = Date.now(), last = originWarned.get(h);
  if (last && now - last < 60 * MIN) return;
  if (originWarned.size >= 500) { for (const [k, v] of originWarned) if (now - v >= 60 * MIN) originWarned.delete(k); if (originWarned.size >= 500) return; }
  originWarned.set(h, now);
  console.warn(`[auth] từ chối yêu cầu ghi từ Origin ${JSON.stringify(h.slice(0, 200))}: không có trong APP_URL / SYNCHRO_ALLOWED_ORIGINS (${[...allowedOriginHosts()].join(", ") || "chưa đặt APP_URL"}).`);
}
export function sameOrigin(req: Request) {
  const o = req.headers.get("origin");
  let oh = "";
  try { oh = o ? new URL(o).host : ""; } catch { oh = ""; }
  if (oh) {
    const allow = allowedOriginHosts(), h = host(req).toLowerCase();
    // Có APP_URL: Origin phải nằm trong danh sách (Host trùng Origin cũng chỉ được nhận khi Host nằm trong danh sách).
    // Không có APP_URL: như cũ, Origin trùng Host của yêu cầu, cộng các tên máy thêm bằng SYNCHRO_ALLOWED_ORIGINS.
    if (allow.has(oh) || (!appHost && oh === h)) return;
    warnOrigin(oh);
  }
  throw new AuthError("Yêu cầu không hợp lệ.", 403);
}

export function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export function cookie(req: Request, name: string, value: string, maxAge: number, o: { sameSite?: "Lax" | "None"; path?: string } = {}) {
  const ss = o.sameSite ?? "Lax";
  return `${name}=${encodeURIComponent(value)}; Path=${o.path ?? "/"}; HttpOnly; SameSite=${ss}; Max-Age=${maxAge}${isHttps(req) || ss === "None" ? "; Secure" : ""}`;
}

// Bọc route handler: AuthError → JSON lỗi; lỗi khác → 500 và ghi log. Mọi phản hồi mang header Server-Timing (auth / work / total).
export function handle<A extends unknown[]>(fn: (req: Request, ...a: A) => Promise<Response> | Response) {
  return timed(async (req: Request, ...a: A) => {
    try { return await fn(req, ...a); } catch (e) {
      if (e instanceof AuthError) return Response.json({ error: e.message, ...e.extra }, { status: e.status });
      console.error("[auth]", e);
      return Response.json({ error: "Lỗi máy chủ. Vui lòng thử lại." }, { status: 500 });
    }
  });
}
export const withCookies = (res: Response, ...cookies: string[]) => { cookies.forEach((c) => res.headers.append("Set-Cookie", c)); return res; };
