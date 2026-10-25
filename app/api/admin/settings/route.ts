import { audit, clientIp, defaultPerms, handle, requireAdmin, sameOrigin, setSetting, signupOpen } from "../../../authstore";
import { normPerms } from "../../../catalog";

export const runtime = "nodejs";

export const PATCH = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const { signupOpen: open, defaultPerms: dp } = await req.json();
  if (dp !== undefined) {
    setSetting("default_perms", JSON.stringify(normPerms(dp)));
    audit("admin_default_perms", { actor: user, ip: clientIp(req) });
  }
  if (typeof open === "boolean" && open !== signupOpen()) {
    setSetting("signup_open", open ? "1" : "0");
    audit(open ? "admin_signup_open" : "admin_signup_closed", { actor: user, ip: clientIp(req) });
  }
  return Response.json({ settings: { signupOpen: signupOpen(), defaultPerms: defaultPerms() } });
});
