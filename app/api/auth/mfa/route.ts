import { AuthError, audit, clientIp, clearMfaCookie, createSession, handle, limit, mfaTicketUser, publicUser, requireUser, sameOrigin, stepUp, withCookies } from "../../../authstore";
import { confirmMfa, disableMfa, mfaStatus, startMfa, verifyMfa } from "../../../mfa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => Response.json(mfaStatus(requireUser(req).user.id)));

// verify: bước hai của đăng nhập, chưa có phiên, chỉ có vé trong cookie. start, confirm, disable: của tài khoản đang đăng nhập.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const b = (await req.json().catch(() => ({}))) as { op?: unknown; code?: unknown; password?: unknown };
  if (b.op === "verify") {
    limit("mfa-ip:" + clientIp(req), 30, 15 * 60_000);
    const t = mfaTicketUser(req);
    if (!t) throw new AuthError("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.", 401);
    if (!verifyMfa(t.user.id, b.code)) { audit("login_failed", { target: t.user, ip: clientIp(req), detail: "mfa" }); throw new AuthError("Mã không đúng. Hãy nhập mã đang hiện trong ứng dụng.", 400); }
    audit("login", { actor: t.user, ip: clientIp(req), detail: `${t.method}+mfa` });
    return withCookies(Response.json({ user: publicUser(t.user) }), createSession(t.user, req, t.method), clearMfaCookie(req));
  }
  const { user } = requireUser(req);
  // Bật xác minh hai bước cần vừa xác minh lại: gửi kèm mật khẩu hiện tại thì xác minh ngay (sai thì báo sai), không thì startMfa trả { reauth: true }.
  if (b.op === "start") await stepUp(user, b.password);
  if (b.op === "start") return Response.json(startMfa(user));
  if (b.op === "confirm") return Response.json(confirmMfa(user, b.code));
  if (b.op === "disable") { disableMfa(user, b.code); return Response.json({ ok: true }); }
  throw new AuthError("Yêu cầu không hợp lệ.", 400);
});
