import { handle, login, publicUser, sameOrigin, withCookies } from "../../../authstore";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { email, password } = await req.json();
  const { user, cookie, mfa } = await login(req, email, password);
  // Bật xác minh hai bước: chưa trả thông tin tài khoản nào trước khi nhập đúng mã.
  if (mfa) return withCookies(Response.json({ mfa: true }), cookie);
  return withCookies(Response.json({ user: publicUser(user) }), cookie);
});
