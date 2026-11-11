import { audit, clientIp, defaultPerms, handle, requireAdmin, sameOrigin, setSetting, setVerifyGate, signupOpen, verifyGateOn } from "../../../authstore";
import { normPerms } from "../../../catalog";
import { setSpeechBudget, speechBudget, spentToday } from "../../../speechapi";

import { repBudget, repToday, setRepBudget } from "../../../ai/replicate";
import { serviceKey } from "../../../providers";

/** Hạn mức ảnh Replicate (khóa của chủ máy chủ, tính tiền thật): hiện ở Quản trị viên cả khi chưa có khóa, kèm cờ chờ khóa. */
const repSettings = () => ({ replicateBudget: repBudget(), replicateToday: repToday(), replicateKey: !!serviceKey("replicate") });

export const runtime = "nodejs";

export const PATCH = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const { signupOpen: open, defaultPerms: dp, verifyGate, speechBudget: sb, replicateBudget: rb } = await req.json();
  if (rb && typeof rb === "object") {
    setRepBudget(rb);
    audit("admin_replicate_budget", { actor: user, ip: clientIp(req) });
  }
  if (sb && typeof sb === "object") {
    setSpeechBudget(sb);
    audit("admin_speech_budget", { actor: user, ip: clientIp(req) });
  }
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
  return Response.json({ settings: { signupOpen: signupOpen(), defaultPerms: defaultPerms(), verifyGate: verifyGateOn(), speechBudget: speechBudget(), speechToday: spentToday(), ...repSettings() } });
});
