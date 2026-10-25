import { AppError } from "../../../../appstore";
import { current } from "../../../../authstore";
import { checkApp, join } from "../../../../collab";
import type { LiveEvent } from "../../../../live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kênh trực tiếp (SSE) của một ứng dụng: ai đang mở, dữ liệu chung vừa đổi, bình luận mới / đã xử lý.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const { id } = await ctx.params;
  const enc = new TextEncoder();
  let stop = () => {};
  let leave: (() => void) | null = null;
  try { checkApp(c.user, id); } catch (e) { if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
  const stream = new ReadableStream({
    start(ctl) {
      let closed = false;
      const send = (s: string) => { if (!closed) try { ctl.enqueue(enc.encode(s)); } catch { closed = true; } };
      const ping = setInterval(() => send(": ping\n\n"), 20_000);
      const end = () => { if (closed) return; closed = true; clearInterval(ping); leave?.(); try { ctl.close(); } catch {} };
      stop = end;
      send("retry: 3000\n\n");
      leave = join(c.user, id, (e: LiveEvent) => send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      req.signal.addEventListener("abort", end);
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" } });
}
