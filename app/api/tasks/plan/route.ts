import { handle, limit, requireUser, sameOrigin } from "../../../authstore";
import { planAutomation } from "../../../automate";
import { TaskError } from "../../../tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lời giao việc bằng câu thường → kế hoạch việc tự động (tên, lịch, trình duyệt, hướng dẫn chi tiết). POST { text, tz } → { plan, model }.
// Chỉ lên kế hoạch, chưa tạo việc: người dùng xem / sửa rồi tạo bằng POST /api/tasks.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("task-plan:" + user.id, 40, 10 * 60_000);
  const b = (await req.json().catch(() => ({}))) as { text?: unknown; tz?: unknown };
  try { return Response.json(await planAutomation(user, typeof b.text === "string" ? b.text : "", typeof b.tz === "string" ? b.tz : "Asia/Ho_Chi_Minh")); }
  catch (e) { if (e instanceof TaskError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
