import { current } from "../../authstore";
import { modelsFor, prewarmLater } from "../../modelslist";
import { timed } from "../../servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Danh sách model cho bộ chọn model: chỉ những model quản trị viên cho hiện ở màn hình chính, kèm quyền của tài khoản (app/modelslist.ts).
// Lần mở trang đầu đã nhận danh sách này trong lệnh khởi động (/api/bootstrap, trang chủ dựng sẵn ở máy chủ); route này cho các lần hỏi lại.
export const GET = timed(async (req: Request) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const res = Response.json(await modelsFor(c.user));
  // Lần hỏi lại nền của tab để mở lâu (bg=1, mỗi 15 phút) không khởi động sẵn: tiến trình chờ tự tắt sau 10 phút, khởi động lại mỗi lần hỏi chỉ tốn máy.
  if (new URL(req.url).searchParams.get("bg") !== "1") prewarmLater(c.user);
  return res;
});
