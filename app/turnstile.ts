// Chống đăng ký ảo và dò mật khẩu: Cloudflare Turnstile (miễn phí) và danh sách tên miền email dùng một lần. Chỉ chạy ở máy chủ.
// Turnstile tắt cho tới khi quản trị viên dán khóa site và khóa bí mật ở Cài đặt → Quản trị viên. Khóa bí mật mã hóa như khóa API (providers.ts),
// không bao giờ gửi xuống trình duyệt; khóa site là công khai (trình duyệt cần nó để vẽ ô kiểm tra).
// Khi bật: đăng ký luôn cần mã Turnstile; đăng nhập cần sau N lần sai mật khẩu (theo IP, hoặc theo email từ nhiều IP); xin đặt lại mật khẩu khi chưa đăng nhập.
// Kiểm tra mã ở https://challenges.cloudflare.com/turnstile/v0/siteverify (TURNSTILE_VERIFY_URL để kiểm thử với máy chủ giả).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AuthError, getSetting, limit, setSetting } from "./authstore";
import { openSecret, sealSecret } from "./providers";

const MIN = 60_000;
const VERIFY_URL = () => process.env.TURNSTILE_VERIFY_URL || "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export type TurnstileAction = "signup" | "login" | "reset";

type Stored = { siteKey: string; secret: string; loginAfter: number };
function stored(): Stored | null {
  try { const s = JSON.parse(getSetting("turnstile", "null")); return s?.siteKey && s?.secret ? { loginAfter: 3, ...s } : null; } catch { return null; }
}
/** Khóa site cho trình duyệt (null: chưa bật, trang đăng nhập không tải gì của Cloudflare). */
export const turnstileSiteKey = () => stored()?.siteKey ?? null;
export const turnstileOn = () => !!stored();
/** Trạng thái cho trang quản trị: không có khóa bí mật, chỉ biết đã có hay chưa. */
export function turnstileAdmin() {
  const s = stored();
  let raw: Partial<Stored> = {};
  try { raw = JSON.parse(getSetting("turnstile", "null")) ?? {}; } catch {}
  return { on: !!s, siteKey: raw.siteKey ?? "", hasSecret: !!raw.secret, loginAfter: raw.loginAfter ?? 3, blockDisposable: blockDisposableOn() };
}
// Khóa site của Cloudflare: 0x… (thật) hoặc 1x/2x/3x… (khóa thử của Cloudflare). Khóa bí mật cùng dạng nhưng dài hơn.
const KEY_RE = /^[0-9a-zA-Z_-]{10,100}$/;
/** Quản trị viên dán khóa. secret "" giữ khóa cũ; clear xóa hết (tắt Turnstile). */
export function saveTurnstile(v: { siteKey?: unknown; secret?: unknown; loginAfter?: unknown; clear?: unknown }) {
  if (v.clear === true) { setSetting("turnstile", "null"); return; }
  let cur: Partial<Stored> = {};
  try { cur = JSON.parse(getSetting("turnstile", "null")) ?? {}; } catch {}
  const next = { ...cur };
  if (v.siteKey !== undefined) {
    const k = String(v.siteKey ?? "").trim();
    if (k && !KEY_RE.test(k)) throw new AuthError("Khóa site Turnstile không hợp lệ.", 400);
    next.siteKey = k;
  }
  if (typeof v.secret === "string" && v.secret.trim()) {
    const k = v.secret.trim();
    if (!KEY_RE.test(k)) throw new AuthError("Khóa bí mật Turnstile không hợp lệ.", 400);
    next.secret = sealSecret(k);
  }
  if (v.loginAfter !== undefined) {
    const n = Number(v.loginAfter);
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new AuthError("Số lần sai phải từ 1 đến 20.", 400);
    next.loginAfter = n;
  }
  setSetting("turnstile", JSON.stringify(next));
}

// ---- đếm lần đăng nhập sai (bộ nhớ trong, 15 phút) ----
const fails = ((globalThis as { __synchroLoginFails?: Map<string, { n: number; t: number }> }).__synchroLoginFails ??= new Map());
const bump = (k: string) => {
  const now = Date.now(), h = fails.get(k);
  if (fails.size > 50_000) for (const [x, v] of fails) if (v.t < now) fails.delete(x);
  if (!h || h.t < now) fails.set(k, { n: 1, t: now + 15 * MIN }); else h.n++;
};
const count = (k: string) => { const h = fails.get(k); return h && h.t >= Date.now() ? h.n : 0; };
export function noteLoginFailure(ip: string, email: string) { bump("ip:" + ip); bump("em:" + email); }
/** Đăng nhập lần này có cần mã Turnstile không: N lần sai từ IP này, hoặc 3N lần sai vào email này từ bất kỳ đâu (dò từ nhiều IP). */
export function loginNeedsCaptcha(ip: string, email: string) {
  const s = stored();
  return !!s && (count("ip:" + ip) >= s.loginAfter || count("em:" + email) >= s.loginAfter * 3);
}

export const CAPTCHA_NEEDED = "Hãy hoàn tất bước kiểm tra bạn không phải máy rồi thử lại.";
/** Cloudflare không trả lời khi đăng ký hoặc xin đặt lại mật khẩu (đăng nhập vẫn cho qua). */
export const VERIFY_DOWN = "Không xác minh được, thử lại sau ít phút.";
/** Kiểm tra mã Turnstile của trình duyệt. Chưa bật thì luôn qua. Sai, hết hạn, đã dùng, sai hành động hoặc tên miền thì ném lỗi có cờ captcha để trang hiện lại ô kiểm tra. */
export async function requireTurnstile(token: unknown, action: TurnstileAction, ip: string, host: string) {
  const s = stored();
  if (!s) return;
  // Giới hạn trước khi gọi Cloudflare: gửi mã rác liên tục không bắt máy chủ gọi ra ngoài vô hạn.
  limit("captcha:" + ip, 60, 15 * MIN);
  const bad = (why: string) => { console.warn(`[turnstile] từ chối ${action}: ${why}`); return new AuthError(CAPTCHA_NEEDED, 400, { captcha: true }); };
  if (typeof token !== "string" || !token || token.length > 2048) throw bad("no-token");
  let j: { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };
  try {
    const body = new URLSearchParams({ secret: openSecret(s.secret), response: token, idempotency_key: crypto.randomUUID(), ...(ip && ip !== "local" ? { remoteip: ip } : {}) });
    const r = await fetch(VERIFY_URL(), { method: "POST", body, signal: AbortSignal.timeout(8000) });
    j = await r.json();
  } catch (e) {
    // Cloudflare không trả lời (lỗi mạng, quá 8 giây, trả về không phải JSON). Đăng nhập vẫn cho qua: chủ tài khoản không bị khóa ngoài cửa
    // vì Cloudflare lỗi (giới hạn tần suất của authstore vẫn áp dụng). Đăng ký mới và xin đặt lại mật khẩu thì từ chối (fail-closed):
    // kẻ tạo tài khoản hàng loạt hoặc gửi thư hàng loạt không được lợi dụng lúc Cloudflare chập chờn để đi qua mà không bị kiểm tra.
    console.error(`[turnstile] không gọi được siteverify (${action}):`, (e as Error).message);
    if (action === "login") return;
    throw new AuthError(VERIFY_DOWN, 503, { captcha: true });
  }
  if (!j.success) throw bad((j["error-codes"] ?? []).join(",") || "failed");
  if (j.action && j.action !== action) throw bad(`action ${j.action}`);
  // Mã lấy ở trang khác (dùng khóa site của ta ở tên miền lạ): khóa thử của Cloudflare trả "example.com", nên chỉ so khi có APP_URL.
  const want = (() => { try { return new URL(process.env.APP_URL || "").hostname; } catch { return ""; } })() || host.split(":")[0];
  if (j.hostname && want && j.hostname !== want && j.hostname !== "example.com") throw bad(`hostname ${j.hostname}`);
}

// ---- email dùng một lần ----
const blockDisposableOn = () => getSetting("signup_block_disposable", "1") === "1";
export const setBlockDisposable = (on: boolean) => setSetting("signup_block_disposable", on ? "1" : "0");
let domains: Set<string> | null = null;
function list() {
  if (domains) return domains;
  try {
    domains = new Set(fs.readFileSync(path.join(process.cwd(), "db", "disposable-email-domains.txt"), "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")));
  } catch (e) { console.error("[signup] không đọc được danh sách email dùng một lần:", (e as Error).message); domains = new Set(); }
  return domains;
}
/** Tên miền (hoặc tên miền cha của nó) nằm trong danh sách email dùng một lần. */
export function isDisposable(email: string) {
  const parts = email.slice(email.lastIndexOf("@") + 1).toLowerCase().split(".");
  for (let i = 0; i < parts.length - 1; i++) if (list().has(parts.slice(i).join("."))) return true;
  return false;
}
export const DISPOSABLE = "Synchro không nhận email dùng một lần. Hãy đăng ký bằng địa chỉ email bạn dùng thường xuyên.";
export function checkDisposable(email: string) { if (blockDisposableOn() && isDisposable(email)) throw new AuthError(DISPOSABLE, 400); }
