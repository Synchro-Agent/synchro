import { AppError } from "../../../../appstore";
import { handle, requireUser, sameOrigin } from "../../../../authstore";
import { updateComment } from "../../../../collab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const err = (e: unknown) => { if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status }); throw e; };

// Đánh dấu đã xử lý / mở lại: { resolved: true | false }. Người viết hoặc chủ ứng dụng.
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ cid: string }> }) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = await req.json().catch(() => ({}));
  try { return Response.json({ comment: updateComment(user, (await ctx.params).cid, { resolved: b.resolved }) }); } catch (e) { return err(e); }
});
export const DELETE = handle(async (req: Request, ctx: { params: Promise<{ cid: string }> }) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  try { updateComment(user, (await ctx.params).cid, { delete: true }); return Response.json({ ok: true }); } catch (e) { return err(e); }
});
