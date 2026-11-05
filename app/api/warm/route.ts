import { current } from "../../authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Người dùng quay lại tab hoặc bắt đầu thao tác: khởi động sẵn tiến trình cho câu kế tiếp (mỗi người tối đa một lần mỗi phút, không tốn lượt nào của gói).
export async function POST(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  void import("../../chatengine").then((m) => m.prewarmChat(c.user)).catch(() => {});
  return new Response(null, { status: 204 });
}
