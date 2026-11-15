import { AppError } from "../../../../../server/appstore";
import { current } from "../../../../../server/authstore";
import { checkApp, join } from "../../../../../server/collab";
import type { LiveEvent } from "../../../../../server/live";
import { timed } from "../../../../../server/servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kênh trực tiếp (SSE) của một ứng dụng: ai đang mở, dữ liệu chung vừa đổi, bình luận mới / đã xử lý.
export const GET = timed(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const { id } = await ctx.params;
  const enc = new TextEncoder();
  let stop = () => {};
  let leave: (() => void) | null = null;
  try { checkApp(c.user, id); } catch (e) { if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
  const stream = new ReadableStream({
    start(ctl) {
      // ended tách khỏi closed: ghi lỗi (người xem đã đi) từng chỉ đặt closed, end() thấy closed thì bỏ qua nên hẹn giờ ping và chỗ trong phòng ở lại mãi.
      let closed = false, ended = false;
      const end = () => { if (ended) return; ended = closed = true; clearInterval(ping); leave?.(); try { ctl.close(); } catch {} };
      const send = (s: string) => { if (!closed) try { ctl.enqueue(enc.encode(s)); } catch { end(); } };
      const ping = setInterval(() => send(": ping\n\n"), 20_000);
      stop = end;
      send("retry: 3000\n\n");
      if (ended) return;
      leave = join(c.user, id, (e: LiveEvent) => send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      // join gửi ngay danh sách người đang mở: ghi lỗi ở đó thì end() đã chạy trước khi có leave.
      if (ended) { leave(); return; }
      req.signal.addEventListener("abort", end);
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" } });
});
