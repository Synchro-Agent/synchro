import { AuthError, handle, publicUser, requireUser, sameOrigin, stepUp, withCookies } from "../../../authstore";
import { authenticationOptions, deletePasskey, listPasskeys, loginWithPasskey, reauthOptions, reauthWithPasskey, registerPasskey, registrationOptions, renamePasskey } from "../../../passkeys";

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
  const { user, session } = requireUser(req);
  // Thêm khóa truy cập cần vừa xác minh lại: gửi kèm mật khẩu hiện tại thì xác minh ngay (sai thì báo sai), không thì cổng trong passkeys.ts trả { reauth: true }.
  if (b.op === "reg-options" || b.op === "register") await stepUp(user, session, b.password);
  // Xác minh lại bằng một khóa đã có của tài khoản (tài khoản không có mật khẩu); dùng chung cho bật xác minh hai bước.
  if (b.op === "reauth-options") return Response.json(await reauthOptions(req, user));
  if (b.op === "reauth") { await reauthWithPasskey(req, user, session, b.response); return Response.json({ ok: true }); }
  if (b.op === "reg-options") return Response.json(await registrationOptions(req, user, session));
  if (b.op === "register") return Response.json({ passkeys: await registerPasskey(req, user, session, b.response, b.name) });
  if (b.op === "rename") return Response.json({ passkeys: renamePasskey(req, user, b.id, b.name) });
  if (b.op === "delete") return Response.json({ passkeys: deletePasskey(req, user, b.id) });
  throw new AuthError("Yêu cầu không hợp lệ.", 400);
});
