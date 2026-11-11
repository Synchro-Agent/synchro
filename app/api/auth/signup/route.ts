import { appUrl, clientIp, handle, normEmail, publicUser, sameOrigin, signup, withCookies } from "../../../authstore";
import { checkDisposable, requireTurnstile } from "../../../turnstile";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { email, password, profile, lang, turnstile } = await req.json();
  const ip = clientIp(req);
  // Turnstile (khi đã bật) trước mọi thứ khác: máy tạo tài khoản hàng loạt dừng ở đây.
  await requireTurnstile(turnstile, "signup", ip, new URL(appUrl(req)).hostname);
  checkDisposable(normEmail(email));
  const { user, cookie, pending } = await signup(req, email, password, profile ?? {}, lang);
  if (pending) return Response.json({ pending: true });
  return withCookies(Response.json({ user: publicUser(user) }), cookie);
});
