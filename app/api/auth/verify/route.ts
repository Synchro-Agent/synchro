import { checkEmailChange, checkVerifyLink, confirmEmailChange, confirmVerify, denyVerify, handle, requireUser, resendVerify, sameOrigin } from "../../../../server/authstore";
import { purgeUser } from "../../../../server/purge";

export const runtime = "nodejs";

// { resend: true, lang }: gửi lại thư xác minh cho tài khoản đang đăng nhập.
// { token, action: "check" | "confirm" | "deny" }: trang /verify (không cần đăng nhập: có đường dẫn trong thư nghĩa là có hộp thư).
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { token, action, resend, lang } = await req.json();
  if (resend === true) { resendVerify(req, requireUser(req).user, lang); return Response.json({ ok: true }); }
  // Đổi email: đường dẫn gửi tới địa chỉ mới, cũng không cần đăng nhập (có hộp thư nghĩa là có địa chỉ đó).
  if (action === "change-check") return Response.json({ ok: true, ...checkEmailChange(req, token) });
  if (action === "change-confirm") { confirmEmailChange(req, token); return Response.json({ ok: true }); }
  if (action === "check") return Response.json({ ok: true, ...checkVerifyLink(req, token) });
  else if (action === "deny") { const u = denyVerify(req, token); await purgeUser(u.id); }
  else if (action === "confirm") confirmVerify(req, token);
  else return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
  return Response.json({ ok: true });
});
