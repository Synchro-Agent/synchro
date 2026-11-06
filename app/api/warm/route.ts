import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { isEffort } from "../../catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Người dùng quay lại tab, đổi model hoặc bắt đầu thao tác: khởi động sẵn tiến trình cho câu kế tiếp (không tốn lượt nào của gói). Khoảng dãn 1,2 giây ở giao diện không bảo vệ được route này:
// lặp POST qua các tổ hợp model, nỗ lực là mỗi lần một CLI mới trên máy chung, nên giới hạn ở đây và giãn cách trong prewarmChat.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("warm:" + user.id, 30, 60_000);
  // Model, nỗ lực, nút Bộ nhớ đang chọn: tiến trình đợi sẵn phải khớp đúng các lựa chọn đó thì lượt sau mới dùng được.
  const b = (await req.json().catch(() => ({}))) as { model?: unknown; effort?: unknown; memory?: unknown };
  // Giá trị lạ không được nằm lại trong lựa chọn đã biết của người dùng.
  const pick = { model: typeof b.model === "string" && b.model.length <= 128 ? b.model : undefined, effort: b.effort === "auto" || isEffort(b.effort) ? b.effort : undefined, memory: typeof b.memory === "boolean" ? b.memory : undefined };
  void import("../../chatengine").then((m) => m.prewarmChat(user, pick)).catch(() => {});
  return new Response(null, { status: 204 });
});
