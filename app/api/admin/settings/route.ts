import { audit, clientIp, defaultPerms, handle, ownerOnly, requireAdmin, sameOrigin, setSetting, setVerifyGate, signupOpen, verifyGateOn } from "../../../../server/authstore";
import { normPerms } from "../../../../shared/catalog";
import { setSpeechBudget, speechBudget, spentToday } from "../../../../server/speechapi";
import { saveTurnstile, setBlockDisposable, turnstileAdmin } from "../../../../server/turnstile";

import { repBudget, repToday, setRepBudget } from "../../../../server/ai/replicate";
import { serviceKey } from "../../../../server/providers";

/** Hạn mức ảnh Replicate (khóa của chủ máy chủ, tính tiền thật): hiện ở Quản trị viên cả khi chưa có khóa, kèm cờ chờ khóa. */
const repSettings = () => ({ replicateBudget: repBudget(), replicateToday: repToday(), replicateKey: !!serviceKey("replicate") });

export const runtime = "nodejs";

export const PATCH = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const { signupOpen: open, defaultPerms: dp, verifyGate, speechBudget: sb, turnstile: ts, blockDisposable, replicateBudget: rb } = await req.json();
  // Khóa Turnstile, chặn email dùng một lần và hạn mức tiền thật (giọng ElevenLabs, ảnh Replicate): chỉ chủ sở hữu. Xét trước mọi thay đổi
  // để yêu cầu gộp nhiều mục của quản trị viên không lưu nửa chừng.
  if ((ts && typeof ts === "object") || typeof blockDisposable === "boolean" || (rb && typeof rb === "object") || (sb && typeof sb === "object")) ownerOnly(user);
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
  return Response.json({ settings: { signupOpen: signupOpen(), defaultPerms: defaultPerms(), verifyGate: verifyGateOn(), speechBudget: speechBudget(), speechToday: spentToday(), turnstile: turnstileAdmin(), ...repSettings() } });
});
