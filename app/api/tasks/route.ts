import { AuthError, handle, limit, requireUser, sameOrigin, VERIFY_FIRST, verifyLocked } from "../../authstore";
import { createTask, listTasks, TaskError } from "../../tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tác vụ nền của tài khoản; POST { title, prompt, schedule: { kind, time?, weekday?, tz }, model? } tạo tác vụ mới.
export const GET = handle(async (req: Request) => Response.json({ tasks: listTasks(requireUser(req).user.id) }));
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  if (verifyLocked(user)) throw new AuthError(VERIFY_FIRST, 403);
  limit("task-new:" + user.id, 60, 10 * 60_000);
  try { return Response.json({ task: createTask(user.id, await req.json().catch(() => ({}))) }); }
  catch (e) { if (e instanceof TaskError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
