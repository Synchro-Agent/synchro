import { audit, clientIp, defaultPerms, handle, requireAdmin, sameOrigin, setSetting, setVerifyGate, signupOpen, verifyGateOn } from "../../../authstore";
import { normPerms } from "../../../catalog";

export const runtime = "nodejs";

export const PATCH = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const { signupOpen: open, defaultPerms: dp, verifyGate } = await req.json();
  if (typeof verifyGate === "boolean" && verifyGate !== verifyGateOn()) {
    setVerifyGate(verifyGate);
    audit("admin_verify_gate", { actor: user, ip: clientIp(req), detail: verifyGate ? "on" : "off" });
  }
  if (dp !== undefined) {
    setSetting("default_perms", JSON.stringify(normPerms(dp)));
    audit("admin_default_perms", { actor: user, ip: clientIp(req) });
  }
  if (typeof open === "boolean" && open !== signupOpen()) {
    setSetting("signup_open", open ? "1" : "0");
    audit(open ? "admin_signup_open" : "admin_signup_closed", { actor: user, ip: clientIp(req) });
  }
  return Response.json({ settings: { signupOpen: signupOpen(), defaultPerms: defaultPerms(), verifyGate: verifyGateOn() } });
});
