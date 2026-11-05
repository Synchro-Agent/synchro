import { handle, requireUser, sameOrigin } from "../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Người dùng quay lại tab hoặc bắt đầu thao tác: khởi động sẵn tiến trình cho câu kế tiếp (mỗi người tối đa một lần mỗi phút, không tốn lượt nào của gói).
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  void import("../../chatengine").then((m) => m.prewarmChat(user)).catch(() => {});
  return new Response(null, { status: 204 });
});
