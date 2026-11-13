import { AuthError, handle, publicUser, reauthPassword, requireUser, sameOrigin, withCookies } from "../../../authstore";
import { authenticationOptions, deletePasskey, listPasskeys, loginWithPasskey, registerPasskey, registrationOptions, renamePasskey } from "../../../passkeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Khóa truy cập của tài khoản đang đăng nhập (Cài đặt → Tài khoản → Bảo mật).
export const GET = handle(async (req) => Response.json({ passkeys: listPasskeys(requireUser(req).user.id) }));

// login-options, login: trang đăng nhập (chưa có phiên). reg-options, register, rename, delete: tài khoản đang đăng nhập.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const b = (await req.json().catch(() => ({}))) as { op?: unknown; response?: unknown; id?: unknown; name?: unknown; password?: unknown };
  if (b.op === "login-options") return Response.json(await authenticationOptions(req));
  if (b.op === "login") {
    const { user, cookie, mfa } = await loginWithPasskey(req, b.response);
    // Khóa không xác minh người dùng và tài khoản bật xác minh hai bước: hỏi mã như sau mật khẩu.
    if (mfa) return withCookies(Response.json({ mfa: true }), cookie);
    return withCookies(Response.json({ user: publicUser(user) }), cookie);
  }
  const { user } = requireUser(req);
  // Thêm khóa truy cập cần vừa xác minh lại: gửi kèm mật khẩu hiện tại thì xác minh ngay (nếu chưa xác minh lại gần đây).
  if ((b.op === "reg-options" || b.op === "register") && b.password !== undefined) await reauthPassword(user, b.password);
  if (b.op === "reg-options") return Response.json(await registrationOptions(req, user));
  if (b.op === "register") return Response.json({ passkeys: await registerPasskey(req, user, b.response, b.name) });
  if (b.op === "rename") return Response.json({ passkeys: renamePasskey(req, user, b.id, b.name) });
  if (b.op === "delete") return Response.json({ passkeys: deletePasskey(req, user, b.id) });
  throw new AuthError("Yêu cầu không hợp lệ.", 400);
});
