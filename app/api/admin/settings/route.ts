import { audit, clientIp, defaultPerms, handle, requireAdmin, sameOrigin, setSetting, setVerifyGate, signupOpen, verifyGateOn } from "../../../authstore";
import { normPerms } from "../../../catalog";
import { setSpeechBudget, speechBudget, spentToday } from "../../../speechapi";
import { saveTurnstile, setBlockDisposable, turnstileAdmin } from "../../../turnstile";

export const runtime = "nodejs";

export const PATCH = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const { signupOpen: open, defaultPerms: dp, verifyGate, speechBudget: sb, turnstile: ts, blockDisposable } = await req.json();
  // Turnstile: khóa bí mật mã hóa trước khi lưu, không trả lại trình duyệt; nhật ký chỉ ghi bật / tắt.
  if (ts && typeof ts === "object") {
    const was = turnstileAdmin().on;
    saveTurnstile(ts);
    const now = turnstileAdmin().on;
    audit(was === now ? "admin_turnstile" : now ? "admin_turnstile_on" : "admin_turnstile_off", { actor: user, ip: clientIp(req) });
  }
  if (typeof blockDisposable === "boolean" && blockDisposable !== turnstileAdmin().blockDisposable) {
    setBlockDisposable(blockDisposable);
    audit("admin_block_disposable", { actor: user, ip: clientIp(req), detail: blockDisposable ? "on" : "off" });
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
  return Response.json({ settings: { signupOpen: signupOpen(), defaultPerms: defaultPerms(), verifyGate: verifyGateOn(), speechBudget: speechBudget(), speechToday: spentToday(), turnstile: turnstileAdmin() } });
});
