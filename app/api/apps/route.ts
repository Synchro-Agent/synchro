import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { AppError, listApps, publishApp } from "../../appstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ứng dụng nội bộ: của mình và của cả tổ chức.
export const GET = handle(async (req: Request) => Response.json({ apps: listApps(requireUser(req).user.id) }));

// Xuất bản artifact thành ứng dụng: { conv, ident, title, type, content, visibility: "private" | "org" } → { id, created }.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("app-pub:" + user.id, 60, 10 * 60_000);
  try { return Response.json(publishApp(user.id, await req.json().catch(() => ({})))); }
  catch (e) { if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
