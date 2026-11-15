import { current, sameOrigin } from "../../../../server/authstore";
import { RunService } from "../../../../server/runs/service";
import { liveText } from "../../../../server/runs/live";
import { timed } from "../../../../server/servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Theo dõi một lượt chạy. Mặc định là SSE (định dạng luồng chung của RunService, server/runs/stream.ts): gửi lại mọi bước sau
// Last-Event-ID (hoặc ?after=), rồi bước mới cho tới khi xong ("event: done" kèm kết quả). ?json=1 trả trạng thái hiện tại một lần
// (dùng khi không mở được SSE). Chữ model đang viết đến qua "event: delta"; mở (lại) kết nối giữa chừng thì nhận trước "event: snapshot".
export const GET = timed(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const { id } = await ctx.params;
  const run = RunService.get(id, c.user.id);
  if (!run) return Response.json({ error: "Không tìm thấy lượt trả lời này." }, { status: 404 });
  const url = new URL(req.url);
  // live: chữ đang viết, cho đoạn chat theo dõi bằng cách hỏi định kỳ (quá nhiều kết nối SSE cùng lúc, xem llm.ts).
  // now: giờ máy chủ, để trình duyệt tính đồng hồ công cụ / đếm ngược theo giờ máy chủ dù đồng hồ máy người dùng lệch (ui/clock.ts).
  if (url.searchParams.get("json")) return Response.json({ run, live: liveText(id), now: Date.now() });
  return RunService.stream(id, req, url);
});

// Dừng lượt đang chạy (nút Dừng): hủy lời gọi model, connector, chạy code đang dở; lượt kết thúc với phần đã viết được.
export const DELETE = timed(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  const { id } = await ctx.params;
  const run = RunService.get(id, c.user.id);
  if (!run) return Response.json({ error: "Không tìm thấy lượt trả lời này." }, { status: 404 });
  return Response.json({ ok: true, cancelled: run.status === "running" && RunService.cancel(id, c.user.id) });
});

// Nhắn thêm khi lượt đang chạy: không ngắt việc đang làm; model nhận tin ở bước kế tiếp. Lượt đã xong (hoặc đang ở bước
// trả lời cuối) thì trình duyệt gửi tin thành lượt mới ngay sau đó — trả queued: false để trình duyệt biết.
export const POST = timed(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  const { id } = await ctx.params;
  const run = RunService.get(id, c.user.id);
  if (!run) return Response.json({ error: "Không tìm thấy lượt trả lời này." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return Response.json({ error: "Tin nhắn trống." }, { status: 400 });
  return Response.json({ queued: run.status === "running" && RunService.steer(id, c.user.id, text) });
});
