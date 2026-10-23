import { adminAudit, adminStats, adminUsers, ADMIN_EMAILS, defaultPerms, handle, requireAdmin, signupOpen } from "../../authstore";
import { providerStatus } from "../../oauth";

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
    settings: { signupOpen: signupOpen(), defaultPerms: defaultPerms() },
    providers: providerStatus(),
    admins: [...ADMIN_EMAILS],
  });
});
