import { appUrl, clientIp, current, handle, sameOrigin, requestPasswordReset } from "../../../authstore";
import { requireTurnstile } from "../../../turnstile";

export const runtime = "nodejs";

// { email, lang, turnstile }: gửi email đặt lại mật khẩu. Luôn trả lời giống nhau, có tài khoản hay không: không để lộ email nào đã đăng ký.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { email, lang, turnstile } = await req.json();
  // Chỉ chủ tài khoản đang đăng nhập mới biết thư bị giới hạn (Cài đặt không được nói "đã gửi" khi chưa gửi); người lạ vẫn nhận câu trả lời như nhau.
  const mine = current(req)?.user.email.toLowerCase() === String(email ?? "").trim().toLowerCase();
  // Turnstile (khi đã bật) cho người chưa đăng nhập: không biến Synchro thành máy gửi thư hàng loạt. Chủ tài khoản xin từ Cài đặt thì không hỏi.
  if (!mine) {
    const ip = clientIp(req);
    await requireTurnstile(turnstile, "reset", ip, new URL(appUrl(req)).hostname);
  }
  const r = requestPasswordReset(req, email, lang);
  return Response.json(r === "limited" && mine ? { ok: true, limited: true } : { ok: true });
});
