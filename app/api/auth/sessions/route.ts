import { audit, clientIp, db, handle, publicSession, requireUser, sameOrigin, sessionsOf } from "../../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const { user, session } = requireUser(req);
  return Response.json({ sessions: sessionsOf(user.id).map((s) => publicSession(s, session.id)) });
});

// { id } đăng xuất một phiên; { others: true } đăng xuất mọi phiên khác phiên hiện tại.
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user, session } = requireUser(req);
  const { id, others } = await req.json();
  if (others) db().prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(user.id, session.id);
  else if (typeof id === "string") db().prepare("DELETE FROM sessions WHERE user_id = ? AND id = ?").run(user.id, id);
  audit(others ? "sessions_revoked" : "session_revoked", { actor: user, ip: clientIp(req) });
  return Response.json({ sessions: sessionsOf(user.id).map((s) => publicSession(s, session.id)) });
});
