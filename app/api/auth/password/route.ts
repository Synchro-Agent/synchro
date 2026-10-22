import { changePassword, getUser, handle, publicUser, requireUser, sameOrigin } from "../../../authstore";

export const runtime = "nodejs";

// Đặt hoặc đổi mật khẩu. Tài khoản chỉ dùng Google/GitHub/Apple được đặt mật khẩu lần đầu không cần mật khẩu cũ.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const { current, password } = await req.json();
  await changePassword(req, user, current, password);
  return Response.json({ user: publicUser(getUser(user.id)!) });
});
