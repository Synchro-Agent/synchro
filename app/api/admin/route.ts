import { adminAudit, adminStats, adminUsers, ADMIN_EMAILS, defaultPerms, handle, OWNER_EMAILS, requireAdmin, roleOf, signupOpen, verifyGateOn } from "../../authstore";
import { providerFailures, providerStatus } from "../../oauth";
import { speechBudget, spentToday } from "../../speechapi";
import { turnstileAdmin } from "../../turnstile";

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
    settings: { signupOpen: signupOpen(), defaultPerms: defaultPerms(), verifyGate: verifyGateOn(), speechBudget: speechBudget(), speechToday: spentToday(), turnstile: turnstileAdmin() },
    providers: providerStatus(),
    providerFailures: providerFailures(),
    admins: [...ADMIN_EMAILS],
  });
});
