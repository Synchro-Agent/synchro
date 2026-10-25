import { handle, limit, requireUser, sameOrigin } from "../../../../authstore";
import { overLimit } from "../../../../usage";
import { runNow, TaskError } from "../../../../tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chạy tác vụ ngay (không đổi lịch): trả về mã lượt chạy để theo dõi, kết quả cũng vào Hộp thư.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("task-run:" + user.id, 30, 10 * 60_000);
  const over = overLimit(user);
  if (over) return Response.json({ error: over, usageLimit: true }, { status: 429 });
  try { return Response.json({ run: runNow(user.id, (await ctx.params).id) }); }
  catch (e) { if (e instanceof TaskError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
