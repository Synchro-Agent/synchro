import { clearSessionCookie, deleteOwnAccount, handle, requireUser, sameOrigin, withCookies } from "../../../authstore";
import { removeUserSkillFiles } from "../../../skillstore";
import { removeUserConnectors } from "../../../connectors";
import { removeUserCaps } from "../../../caps";
import { removeUserOutputs } from "../../../outputs";
import { removeUserArtifacts } from "../../../artifactstore";
import { removeUserApps } from "../../../appstore";
import { removeUserTasks } from "../../../tasks";
import { removeUserUsage } from "../../../usage";
import { removeUserPlugins } from "../../../plugins";
import { destroyWorkspace } from "../../../workspace";

export const runtime = "nodejs";

export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const { password } = await req.json();
  await deleteOwnAccount(req, user, password);
  await removeUserSkillFiles(user.id);
  removeUserConnectors(user.id);
  removeUserCaps(user.id);
  removeUserOutputs(user.id);
  removeUserArtifacts(user.id);
  removeUserApps(user.id);
  removeUserTasks(user.id);
  removeUserUsage(user.id);
  await removeUserPlugins(user.id);
  await destroyWorkspace(user.id);
  return withCookies(Response.json({ ok: true }), clearSessionCookie(req));
});
