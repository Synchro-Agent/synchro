import { adminAct, adminDelete, AuthError, db, getUser, handle, publicSession, requireAdmin, requireOwner, sameOrigin, sessionsOf } from "../../../../../server/authstore";
import { purgeUser } from "../../../../../server/purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Chi tiết: các phiên đang hoạt động + tài khoản liên kết.
export const GET = handle(async (req, { params }: Ctx) => {
  requireAdmin(req);
  const u = getUser((await params).id);
  if (!u) throw new AuthError("Không tìm thấy người dùng.", 404);
  const identities = db().prepare("SELECT provider, email, created_at createdAt FROM identities WHERE user_id = ? ORDER BY created_at").all(u.id);
  return Response.json({ sessions: sessionsOf(u.id).map((s) => publicSession(s)), identities });
});

// { action: "suspend" | "restore" | "signout" | "set_password" (password, signOut) | "set_perms" (perms | null) | "reset_link" (→ resetUrl)
//   | "set_role" (role: "admin" | "member", chỉ chủ sở hữu) }
export const PATCH = handle(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const body = await req.json();
  const r = await adminAct(req, user, (await params).id, body.action, body);
  return Response.json({ ok: true, ...(r ?? {}) });
});

// { confirm: "<email người dùng>" } để tránh xóa nhầm. Xóa vĩnh viễn tài khoản và dữ liệu: chỉ chủ sở hữu.
export const DELETE = handle(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const { user } = requireOwner(req);
  const { confirm } = await req.json();
  const id = (await params).id;
  adminDelete(req, user, id, confirm);
  await purgeUser(id);
  return Response.json({ ok: true });
});
