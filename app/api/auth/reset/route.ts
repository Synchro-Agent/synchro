import { handle, sameOrigin, redeemResetLink } from "../../../authstore";
import { removeUserDevices } from "../../../browserext";

export const runtime = "nodejs";

// { token, password }: đặt lại mật khẩu bằng đường dẫn quản trị viên tạo. Không tự đăng nhập: người dùng đăng nhập lại bằng mật khẩu mới.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { token, password } = await req.json();
  const u = await redeemResetLink(req, token, password);
  await removeUserDevices(u.id).catch((e) => console.error("[reset]", e));
  return Response.json({ ok: true });
});
