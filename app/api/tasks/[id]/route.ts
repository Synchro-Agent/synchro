import { handle, requireUser, sameOrigin } from "../../../authstore";
import { deleteTask, TaskError, updateTask } from "../../../tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Sửa tên, yêu cầu, lịch chạy, bật / tắt.
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  try { return Response.json({ task: updateTask(user.id, (await ctx.params).id, await req.json().catch(() => ({}))) }); }
  catch (e) { if (e instanceof TaskError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  return deleteTask(user.id, (await ctx.params).id) ? Response.json({ ok: true }) : Response.json({ error: "Không tìm thấy tác vụ." }, { status: 404 });
});
