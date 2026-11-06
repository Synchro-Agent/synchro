// Đăng nhập bằng Google / GitHub / Apple (OAuth 2.0 authorization code, chỉ chạy ở server).
// Mỗi nhà cung cấp chỉ bật khi biến môi trường tương ứng đã được đặt trong .env.production.
import crypto from "node:crypto";
import { appUrl, AuthError, cookie, db, readCookie, type OAuthProfile } from "./authstore";
import { GH_API, GH_WEB } from "./github";

export const PROVIDERS = ["google", "github", "apple"] as const;
export type Provider = (typeof PROVIDERS)[number];
const NAMES: Record<Provider, string> = { google: "Google", github: "GitHub", apple: "Apple" };
const env = (k: string) => process.env[k]?.trim() ?? "";

export const isProvider = (p: string): p is Provider => (PROVIDERS as readonly string[]).includes(p);
export function configured(p: Provider) {
  if (p === "google") return !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));
  if (p === "github") return !!(env("GITHUB_CLIENT_ID") && env("GITHUB_CLIENT_SECRET"));
  return !!(env("APPLE_CLIENT_ID") && env("APPLE_TEAM_ID") && env("APPLE_KEY_ID") && env("APPLE_PRIVATE_KEY"));
}
export const providerStatus = () => Object.fromEntries(PROVIDERS.map((p) => [p, configured(p)])) as Record<Provider, boolean>;

/** Lỗi đăng nhập gần nhất của từng nhà cung cấp, nếu chưa có lần đăng nhập thành công nào sau đó (nhãn "Sẵn sàng" chỉ biết biến môi trường đã đặt). */
export function providerFailures() {
  const out: Partial<Record<Provider, { at: number; detail: string }>> = {};
  for (const p of PROVIDERS) {
    const f = db().prepare("SELECT at, detail FROM audit WHERE action = 'oauth_failed' AND detail LIKE ? ORDER BY id DESC LIMIT 1").get(`${p}:%`) as { at: number; detail: string } | undefined;
    const ok = db().prepare("SELECT at FROM audit WHERE action = 'login' AND detail = ? ORDER BY id DESC LIMIT 1").get(p) as { at: number } | undefined;
    if (f && (!ok || ok.at < f.at)) out[p] = { at: f.at, detail: f.detail.slice(p.length + 2) };
  }
  return out;
}

export const redirectUri = (req: Request, p: Provider) => `${appUrl(req)}/api/auth/oauth/${p}/callback`;
const rand = () => crypto.randomBytes(24).toString("base64url");
const COOKIE_PATH = "/api/auth/oauth";
const stateCookie = (p: Provider) => `oauth_${p}`;
// Apple gửi kết quả bằng POST từ appleid.apple.com nên cookie phải là SameSite=None.
const sameSite = (p: Provider) => (p === "apple" ? "None" : "Lax") as "None" | "Lax";

// purpose "link": người đã đăng nhập kết nối GitHub (quyền repo) cho Synchro Code, không phải đăng nhập.
// purpose "connect": người đã đăng nhập thêm một cách đăng nhập vào tài khoản của mình (Cài đặt → Tài khoản), kể cả khi email khác (Apple Ẩn email).
export type Purpose = "login" | "link" | "connect";
export function start(req: Request, p: Provider, purpose: Purpose = "login") {
  if (!configured(p)) throw new AuthError(`Đăng nhập bằng ${NAMES[p]} chưa được cấu hình trên máy chủ.`, 503);
  const state = rand(), verifier = rand() + rand(), nonce = rand();
  const q = new URLSearchParams({ client_id: env(`${p.toUpperCase()}_CLIENT_ID`), redirect_uri: redirectUri(req, p), state });
  let url: string;
  if (p === "google") {
    q.set("response_type", "code");
    q.set("scope", "openid email profile");
    q.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url"));
    q.set("code_challenge_method", "S256");
    q.set("prompt", "select_account");
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + q;
  } else if (p === "github") {
    q.set("scope", purpose === "link" ? "repo read:user user:email" : "read:user user:email");
    url = `${GH_WEB}/login/oauth/authorize?` + q;
  } else {
    q.set("response_type", "code");
    q.set("response_mode", "form_post");
    q.set("scope", "name email");
    q.set("nonce", nonce);
    url = "https://appleid.apple.com/auth/authorize?" + q;
  }
  return { url, cookie: cookie(req, stateCookie(p), `${state}.${verifier}.${nonce}.${purpose}`, 600, { sameSite: sameSite(p), path: COOKIE_PATH }) };
}
export const purposeOf = (req: Request, p: Provider): Purpose => { const v = (readCookie(req, stateCookie(p)) ?? "").split(".")[3]; return v === "link" || v === "connect" ? v : "login"; };
export const clearState = (req: Request, p: Provider) => cookie(req, stateCookie(p), "", 0, { sameSite: sameSite(p), path: COOKIE_PATH });

const eq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function call<T>(url: string, init: RequestInit, what: string): Promise<T> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j as { error?: unknown }).error) {
    console.error(`[oauth] ${what} ${r.status}`, j);
    throw new AuthError("Không xác thực được với nhà cung cấp đăng nhập. Vui lòng thử lại.", 502);
  }
  return j as T;
}
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(o) });

// Đổi code lấy hồ sơ người dùng. `params` là query (Google/GitHub) hoặc form POST (Apple).
export type OAuthResult = OAuthProfile & { token?: string; login?: string; scopes?: string; refresh?: string; expiresIn?: number; refreshExpiresIn?: number };
export async function finish(req: Request, p: Provider, params: URLSearchParams): Promise<OAuthResult> {
  if (params.get("error")) throw new AuthError(params.get("error") === "access_denied" || params.get("error") === "user_cancelled_authorize" ? "Bạn đã hủy đăng nhập." : "Nhà cung cấp đăng nhập báo lỗi. Vui lòng thử lại.");
  const [state, verifier, nonce] = (readCookie(req, stateCookie(p)) ?? "").split(".");
  const code = params.get("code") ?? "";
  if (!state || !code || !eq(state, params.get("state") ?? "")) throw new AuthError("Phiên đăng nhập đã hết hạn. Vui lòng thử lại.");
  const id = env(`${p.toUpperCase()}_CLIENT_ID`), redirect_uri = redirectUri(req, p);

  if (p === "google") {
    const t = await call<{ access_token: string }>("https://oauth2.googleapis.com/token", form({ code, client_id: id, client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri, grant_type: "authorization_code", code_verifier: verifier }), "google token");
    const u = await call<{ sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } }, "google userinfo");
    return { provider: p, subject: u.sub, email: u.email ?? null, emailVerified: u.email_verified === true, name: u.name ?? "", avatar: u.picture ?? null };
  }

  if (p === "github") {
    const t = await call<{ access_token: string; scope?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number }>(`${GH_WEB}/login/oauth/access_token`, form({ code, client_id: id, client_secret: env("GITHUB_CLIENT_SECRET"), redirect_uri }), "github token");
    const h = { headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "Synchro" } };
    const u = await call<{ id: number; login: string; name?: string; avatar_url?: string }>(`${GH_API}/user`, h, "github user");
    const emails = await call<{ email: string; primary: boolean; verified: boolean }[]>(`${GH_API}/user/emails`, h, "github emails");
    const e = emails.find((x) => x.primary && x.verified) ?? emails.find((x) => x.verified);
    return { provider: p, subject: String(u.id), email: e?.email ?? null, emailVerified: !!e, name: u.name || u.login, avatar: u.avatar_url ?? null, token: t.access_token, login: u.login, scopes: t.scope ?? "",
      refresh: t.refresh_token, expiresIn: t.expires_in, refreshExpiresIn: t.refresh_token_expires_in };
  }

  const t = await call<{ id_token: string }>("https://appleid.apple.com/auth/token", form({ code, client_id: id, client_secret: appleSecret(), redirect_uri, grant_type: "authorization_code" }), "apple token");
  // id_token nhận trực tiếp từ Apple qua TLS bằng client secret, nên chỉ cần kiểm tra các claim.
  const c = JSON.parse(Buffer.from(t.id_token.split(".")[1] ?? "", "base64url").toString()) as { iss: string; aud: string; exp: number; sub: string; email?: string; email_verified?: boolean | string; nonce?: string };
  if (c.iss !== "https://appleid.apple.com" || c.aud !== id || c.exp * 1000 < Date.now() || !nonce || c.nonce !== nonce) throw new AuthError("Phản hồi từ Apple không hợp lệ.", 502);
  // Apple chỉ gửi tên ở lần đăng nhập đầu tiên, trong trường form "user".
  let name = "";
  try { const n = JSON.parse(params.get("user") ?? "{}").name ?? {}; name = [n.firstName, n.lastName].filter(Boolean).join(" "); } catch {}
  return { provider: p, subject: c.sub, email: c.email ?? null, emailVerified: c.email_verified === true || c.email_verified === "true", name, avatar: null };
}

// client_secret của Apple là JWT ES256 ký bằng khóa .p8, hiệu lực 5 phút.
function appleSecret() {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: "ES256", kid: env("APPLE_KEY_ID") })}.${b64({ iss: env("APPLE_TEAM_ID"), iat, exp: iat + 300, aud: "https://appleid.apple.com", sub: env("APPLE_CLIENT_ID") })}`;
  const key = env("APPLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  return `${data}.${crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
