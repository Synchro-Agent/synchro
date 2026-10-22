import { adminRevokeSession, handle, requireAdmin, sameOrigin } from "../../../../authstore";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  adminRevokeSession(req, user, (await params).id);
  return Response.json({ ok: true });
});
