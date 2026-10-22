import { audit, clearSessionCookie, clientIp, current, db, handle, sameOrigin, withCookies } from "../../../authstore";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  sameOrigin(req);
  const c = current(req);
  if (c) {
    db().prepare("DELETE FROM sessions WHERE id = ?").run(c.session.id);
    audit("logout", { actor: c.user, ip: clientIp(req) });
  }
  return withCookies(Response.json({ ok: true }), clearSessionCookie(req));
});
