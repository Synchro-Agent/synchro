import { checkResetLink, handle, sameOrigin, redeemResetLink } from "../../../authstore";
import { removeUserDevices } from "../../../browserext";

export const runtime = "nodejs";

// { token, password, lang }: đặt lại mật khẩu bằng đường dẫn trong email hoặc do quản trị viên tạo. Không tự đăng nhập: người dùng đăng nhập lại bằng mật khẩu mới.
// { token, check: true }: chỉ kiểm tra đường dẫn còn dùng được không.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { token, password, check, lang } = await req.json();
  if (check === true) { checkResetLink(req, token); return Response.json({ ok: true }); }
  const u = await redeemResetLink(req, token, password, lang);
  await removeUserDevices(u.id).catch((e) => console.error("[reset]", e));
  return Response.json({ ok: true });
});
