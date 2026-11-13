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
  // CÒN SÓT (F2.4 — báo cáo cuối cho chủ web): thân phản hồi giống hệt cho email mới và email đã có tài khoản ({ pending }), nhưng
  // email MỚI vẫn được cấp cookie phiên (Set-Cookie: synchro_session=…) còn email ĐÃ CÓ thì không. Kẻ dò vẫn phân biệt được email
  // nào đã đăng ký qua kênh này. Theo blueprint, giữ nguyên luồng signup/session ở đây; không viết lại để vá chỗ này.
  return withCookies(Response.json({ user: publicUser(user) }), cookie);
});
