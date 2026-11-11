import { adminAudit, adminStats, adminUsers, ADMIN_EMAILS, defaultPerms, handle, OWNER_EMAILS, requireAdmin, roleOf, signupOpen, verifyGateOn } from "../../authstore";
import { providerFailures, providerStatus } from "../../oauth";
import { speechBudget, spentToday } from "../../speechapi";
import { turnstileAdmin } from "../../turnstile";

import { repBudget, repToday } from "../../ai/replicate";
import { serviceKey } from "../../providers";

/** Hạn mức ảnh Replicate (khóa của chủ máy chủ, tính tiền thật): hiện ở Quản trị viên cả khi chưa có khóa, kèm cờ chờ khóa. */
const repSettings = () => ({ replicateBudget: repBudget(), replicateToday: repToday(), replicateKey: !!serviceKey("replicate") });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const { user } = requireAdmin(req);
  const before = Number(new URL(req.url).searchParams.get("before")) || undefined;
  if (before) return Response.json({ audit: adminAudit(100, before) });
  return Response.json({
    stats: adminStats(),
    users: adminUsers(user),
    // Vai trò của người đang xem: giao diện ẩn / khóa các nút chỉ chủ sở hữu dùng được (máy chủ vẫn tự chặn).
    role: roleOf(user),
    owners: [...OWNER_EMAILS],
    audit: adminAudit(100),
    settings: { signupOpen: signupOpen(), defaultPerms: defaultPerms(), verifyGate: verifyGateOn(), speechBudget: speechBudget(), speechToday: spentToday(), turnstile: turnstileAdmin(), ...repSettings() },
    providers: providerStatus(),
    providerFailures: providerFailures(),
    admins: [...ADMIN_EMAILS],
  });
});
