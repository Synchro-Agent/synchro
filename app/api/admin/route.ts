import { adminAudit, adminStats, adminUsers, ADMIN_EMAILS, defaultPerms, handle, requireAdmin, signupOpen, verifyGateOn } from "../../authstore";
import { providerFailures, providerStatus } from "../../oauth";
import { speechBudget, spentToday } from "../../speechapi";
import { turnstileAdmin } from "../../turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  requireAdmin(req);
  const before = Number(new URL(req.url).searchParams.get("before")) || undefined;
  if (before) return Response.json({ audit: adminAudit(100, before) });
  return Response.json({
    stats: adminStats(),
    users: adminUsers(),
    audit: adminAudit(100),
    settings: { signupOpen: signupOpen(), defaultPerms: defaultPerms(), verifyGate: verifyGateOn(), speechBudget: speechBudget(), speechToday: spentToday(), turnstile: turnstileAdmin() },
    providers: providerStatus(),
    providerFailures: providerFailures(),
    admins: [...ADMIN_EMAILS],
  });
});
