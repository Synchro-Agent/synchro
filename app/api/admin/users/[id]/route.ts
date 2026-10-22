import { adminAct, adminDelete, AuthError, db, getUser, handle, publicSession, requireAdmin, sameOrigin, sessionsOf } from "../../../../authstore";

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

// { action: "suspend" | "restore" | "signout" }
export const PATCH = handle(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const { action } = await req.json();
  adminAct(req, user, (await params).id, action);
  return Response.json({ ok: true });
});

// { confirm: "<email người dùng>" } để tránh xóa nhầm
export const DELETE = handle(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const { confirm } = await req.json();
  adminDelete(req, user, (await params).id, confirm);
  return Response.json({ ok: true });
});
