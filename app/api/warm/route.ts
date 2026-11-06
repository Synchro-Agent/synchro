import { handle, requireUser, sameOrigin } from "../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Người dùng quay lại tab hoặc bắt đầu thao tác: khởi động sẵn tiến trình cho câu kế tiếp (mỗi người tối đa một lần mỗi phút, không tốn lượt nào của gói).
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  // Model, nỗ lực, nút Bộ nhớ đang chọn: tiến trình đợi sẵn phải khớp đúng các lựa chọn đó thì lượt sau mới dùng được.
  const b = (await req.json().catch(() => ({}))) as { model?: unknown; effort?: unknown; memory?: unknown };
  void import("../../chatengine").then((m) => m.prewarmChat(user, { model: b.model, effort: b.effort, memory: b.memory })).catch(() => {});
  return new Response(null, { status: 204 });
});
