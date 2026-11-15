import { handle, requireUser, sameOrigin } from "../../../../server/authstore";
import { setTask } from "../../../../server/brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Đánh dấu việc dang dở là xong / chưa xong (bảng Việc dang dở).
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => ({}))) as { title?: unknown; task?: unknown; done?: unknown };
  try { return Response.json({ rows: setTask(user, String(b.title ?? ""), String(b.task ?? ""), b.done === true) }); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
});
