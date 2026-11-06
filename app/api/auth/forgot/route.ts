import { current, handle, sameOrigin, requestPasswordReset } from "../../../authstore";

export const runtime = "nodejs";

// { email, lang }: gửi email đặt lại mật khẩu. Luôn trả lời giống nhau, có tài khoản hay không: không để lộ email nào đã đăng ký.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { email, lang } = await req.json();
  const r = requestPasswordReset(req, email, lang);
  // Chỉ chủ tài khoản đang đăng nhập mới biết thư bị giới hạn (Cài đặt không được nói "đã gửi" khi chưa gửi); người lạ vẫn nhận câu trả lời như nhau.
  const mine = current(req)?.user.email.toLowerCase() === String(email ?? "").trim().toLowerCase();
  return Response.json(r === "limited" && mine ? { ok: true, limited: true } : { ok: true });
});
