import { handle, limit, requireUser, sameOrigin } from "../../../../server/authstore";
import { AppError, storeOp } from "../../../../server/appstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kho dữ liệu của ứng dụng (window.storage trong artifact): { ref: { app } | { art: { conv, ident } }, op: get|set|delete|list, key, value, shared, prefix }.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("appdata:" + user.id, 600, 60_000);
  try { return Response.json({ result: storeOp(user, await req.json().catch(() => ({}))) }); }
  catch (e) { if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
