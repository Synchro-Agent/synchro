import { clearSessionCookie, deleteOwnAccount, handle, requireUser, sameOrigin, withCookies } from "../../../../server/authstore";
import { purgeUser } from "../../../../server/purge";

export const runtime = "nodejs";

export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const { password } = await req.json();
  await deleteOwnAccount(req, user, password);
  await purgeUser(user.id);
  return withCookies(Response.json({ ok: true }), clearSessionCookie(req));
});
