import { clearSessionCookie, deleteOwnAccount, handle, requireUser, sameOrigin, withCookies } from "../../../authstore";

export const runtime = "nodejs";

export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const { password } = await req.json();
  await deleteOwnAccount(req, user, password);
  return withCookies(Response.json({ ok: true }), clearSessionCookie(req));
});
