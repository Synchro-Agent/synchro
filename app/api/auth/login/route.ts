import { AuthError, appUrl, clientIp, handle, login, publicUser, sameOrigin, withCookies } from "../../../authstore";
import { loginNeedsCaptcha, noteLoginFailure, requireTurnstile } from "../../../turnstile";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { email, password, turnstile } = await req.json();
  const ip = clientIp(req), em = typeof email === "string" ? email.trim().toLowerCase() : "";
  // Turnstile (khi quản trị viên đã bật): sau vài lần sai mật khẩu mới hỏi, người gõ đúng ngay không thấy gì.
  if (loginNeedsCaptcha(ip, em)) {
    await requireTurnstile(turnstile, "login", ip, new URL(appUrl(req)).hostname);
  }
  let r;
  try { r = await login(req, email, password); } catch (e) {
    if (e instanceof AuthError && e.status === 401) {
      noteLoginFailure(ip, em);
      if (loginNeedsCaptcha(ip, em)) throw new AuthError(e.message, 401, { captcha: true });
    }
    throw e;
  }
  const { user, cookie, mfa } = r;
  // Bật xác minh hai bước: chưa trả thông tin tài khoản nào trước khi nhập đúng mã.
  if (mfa) return withCookies(Response.json({ mfa: true }), cookie);
  return withCookies(Response.json({ user: publicUser(user) }), cookie);
});
