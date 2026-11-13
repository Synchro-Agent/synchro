import { appUrl, clientIp, handle, normEmail, sameOrigin, signup } from "../../../authstore";
import { checkDisposable, requireTurnstile } from "../../../turnstile";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { email, password, profile, lang, turnstile } = await req.json();
  const ip = clientIp(req);
  // Turnstile (khi đã bật) trước mọi thứ khác: máy tạo tài khoản hàng loạt dừng ở đây.
  await requireTurnstile(turnstile, "signup", ip, new URL(appUrl(req)).hostname);
  checkDisposable(normEmail(email));
  // Blueprint F2.4: email mới và email đã có tài khoản nhận cùng một câu trả lời, cùng mã 200, không cookie phiên. Người dùng mới bấm đường
  // dẫn trong thư rồi mới đăng nhập được (trước đó login trả lời như sai mật khẩu, authstore.login), nên đăng ký rồi đăng nhập thử cũng không
  // cho biết email nào đã có tài khoản, trừ khi quản trị viên tắt yêu cầu xác minh. Người đã có tài khoản nhận thư hướng dẫn trong hộp thư.
  await signup(req, email, password, profile ?? {}, lang);
  return Response.json({ pending: true });
});
