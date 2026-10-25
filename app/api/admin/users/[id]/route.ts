import { adminAct, adminDelete, AuthError, db, getUser, handle, publicSession, requireAdmin, sameOrigin, sessionsOf } from "../../../../authstore";
import { removeUserSkillFiles } from "../../../../skillstore";
import { removeUserConnectors } from "../../../../connectors";
import { removeUserCaps } from "../../../../caps";
import { removeUserOutputs } from "../../../../outputs";
import { removeUserArtifacts } from "../../../../artifactstore";
import { removeUserApps } from "../../../../appstore";
import { removeUserTasks } from "../../../../tasks";
import { removeUserKb } from "../../../../kb";
import { removeUserMeetings } from "../../../../meetings";
import { removeUserUsage } from "../../../../usage";
import { removeUserPlugins } from "../../../../plugins";
import { destroyWorkspace } from "../../../../workspace";

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

// { action: "suspend" | "restore" | "signout" | "set_password" (password, signOut) | "set_perms" (perms | null) }
export const PATCH = handle(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const body = await req.json();
  await adminAct(req, user, (await params).id, body.action, body);
  return Response.json({ ok: true });
});

// { confirm: "<email người dùng>" } để tránh xóa nhầm
export const DELETE = handle(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const { confirm } = await req.json();
  const id = (await params).id;
  adminDelete(req, user, id, confirm);
  await removeUserSkillFiles(id);
  removeUserConnectors(id);
  removeUserCaps(id);
  removeUserOutputs(id);
  removeUserArtifacts(id);
  removeUserApps(id);
  removeUserTasks(id);
  removeUserKb(id);
  removeUserMeetings(id);
  removeUserUsage(id);
  await removeUserPlugins(id);
  await destroyWorkspace(id);
  return Response.json({ ok: true });
});
