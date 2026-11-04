import { changePassword, getUser, handle, publicUser, requireUser, sameOrigin } from "../../../authstore";
import { devicesOf, removeUserDevices } from "../../../browserext";

export const runtime = "nodejs";

// Đặt hoặc đổi mật khẩu. Tài khoản chỉ dùng Google/GitHub/Apple được đặt mật khẩu lần đầu không cần mật khẩu cũ.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user, session } = requireUser(req);
  const { current, password } = await req.json();
  const { signedOut } = await changePassword(req, user, current, password, session.id);
  // Tiện ích Synchro đã ghép nối điều khiển được Chrome của người dùng: cũng phải ghép lại, như đăng xuất các thiết bị khác.
  const devices = devicesOf(user.id).length;
  if (devices) await removeUserDevices(user.id);
  return Response.json({ user: publicUser(getUser(user.id)!), signedOut, devices });
});
