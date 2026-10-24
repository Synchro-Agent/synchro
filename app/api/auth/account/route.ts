import { clearSessionCookie, deleteOwnAccount, handle, requireUser, sameOrigin, withCookies } from "../../../authstore";
import { removeUserSkillFiles } from "../../../skillstore";
import { removeUserConnectors } from "../../../connectors";
import { destroyWorkspace } from "../../../workspace";

export const runtime = "nodejs";

export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const { password } = await req.json();
  await deleteOwnAccount(req, user, password);
  await removeUserSkillFiles(user.id);
  removeUserConnectors(user.id);
  await destroyWorkspace(user.id);
  return withCookies(Response.json({ ok: true }), clearSessionCookie(req));
});
