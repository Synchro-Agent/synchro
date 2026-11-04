import { checkResetLink, handle, sameOrigin, redeemResetLink } from "../../../authstore";
import { removeUserDevices } from "../../../browserext";
import { afterClaim } from "../../../claim";

export const runtime = "nodejs";

// { token, password, lang }: đặt lại mật khẩu bằng đường dẫn trong email hoặc do quản trị viên tạo. Không tự đăng nhập: người dùng đăng nhập lại bằng mật khẩu mới.
// { token, check: true }: chỉ kiểm tra đường dẫn còn dùng được không.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { token, password, check, lang } = await req.json();
  if (check === true) { checkResetLink(req, token); return Response.json({ ok: true }); }
  const { user: u, fresh } = await redeemResetLink(req, token, password, lang);
  await removeUserDevices(u.id).catch((e) => console.error("[reset]", e));
  // Chủ thật của email vừa giành lại tài khoản chưa từng được xác minh.
  if (fresh) await afterClaim(u.id, true, "reset").catch((e) => console.error("[reset]", e));
  return Response.json({ ok: true });
});
