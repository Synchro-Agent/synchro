import { handle, sameOrigin, requestPasswordReset } from "../../../authstore";

export const runtime = "nodejs";

// { email, lang }: gửi email đặt lại mật khẩu. Luôn trả lời giống nhau, có tài khoản hay không: không để lộ email nào đã đăng ký.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { email, lang } = await req.json();
  requestPasswordReset(req, email, lang);
  return Response.json({ ok: true });
});
