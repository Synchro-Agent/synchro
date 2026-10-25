import { current } from "../../../authstore";
import { getRun, watch, type PublicRun, type RunEvent } from "../../../runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Theo dõi một lượt chạy. Mặc định là SSE: gửi lại mọi bước sau Last-Event-ID (hoặc ?after=), rồi bước mới
// cho tới khi xong ("event: done" kèm kết quả). ?json=1 trả trạng thái hiện tại một lần (dùng khi không mở được SSE).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const { id } = await ctx.params;
  const run = getRun(id, c.user.id);
  if (!run) return Response.json({ error: "Không tìm thấy lượt trả lời này." }, { status: 404 });
  const url = new URL(req.url);
  if (url.searchParams.get("json")) return Response.json({ run });
  const after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      let closed = false;
      const send = (s: string) => { if (!closed) try { ctl.enqueue(enc.encode(s)); } catch { closed = true; } };
      const ev = (e: RunEvent) => send(`id: ${e.seq}\nevent: step\ndata: ${JSON.stringify(e)}\n\n`);
      const done = (r: PublicRun) => { send(`event: done\ndata: ${JSON.stringify({ status: r.status, http: r.http, result: r.result })}\n\n`); end(); };
      const ping = setInterval(() => send(": ping\n\n"), 15_000);
      const end = () => { if (closed) return; closed = true; clearInterval(ping); unwatch(); try { ctl.close(); } catch {} };
      // Đăng ký trước rồi mới đọc lại trạng thái, để không lỡ bước nào xảy ra ở giữa.
      const unwatch = watch(id, (m) => { if (m.event && m.event.seq > after) ev(m.event); if (m.done) done(m.done); });
      stop = end;
      send("retry: 2000\n\n");
      const now = getRun(id)!;
      for (const e of now.events) if (e.seq > after) ev(e);
      if (now.status !== "running") done(now);
      req.signal.addEventListener("abort", end);
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" } });
}
