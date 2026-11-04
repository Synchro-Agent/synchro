import { current, sameOrigin } from "../../../authstore";
import { cancelRun, getRun, liveText, pushInbox, watch, type Delta, type PublicRun, type RunEvent } from "../../../runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Theo dõi một lượt chạy. Mặc định là SSE: gửi lại mọi bước sau Last-Event-ID (hoặc ?after=), rồi bước mới
// cho tới khi xong ("event: done" kèm kết quả). ?json=1 trả trạng thái hiện tại một lần (dùng khi không mở được SSE).
// Chữ model đang viết đến qua "event: delta"; mở (lại) kết nối giữa chừng thì nhận trước "event: snapshot" với phần đã viết.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const { id } = await ctx.params;
  const run = getRun(id, c.user.id);
  if (!run) return Response.json({ error: "Không tìm thấy lượt trả lời này." }, { status: 404 });
  const url = new URL(req.url);
  // live: chữ đang viết, cho đoạn chat theo dõi bằng cách hỏi định kỳ (quá nhiều kết nối SSE cùng lúc, xem llm.ts).
  if (url.searchParams.get("json")) return Response.json({ run, live: liveText(id) });
  const after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      let closed = false;
      const send = (s: string) => { if (!closed) try { ctl.enqueue(enc.encode(s)); } catch { closed = true; } };
      const ev = (e: RunEvent) => send(`id: ${e.seq}\nevent: step\ndata: ${JSON.stringify(e)}\n\n`);
      const dl = (d: Delta) => send(`event: delta\ndata: ${JSON.stringify(d)}\n\n`);
      const done = (r: PublicRun) => { send(`event: done\ndata: ${JSON.stringify({ status: r.status, http: r.http, result: r.result })}\n\n`); end(); };
      const ping = setInterval(() => send(": ping\n\n"), 15_000);
      const end = () => { if (closed) return; closed = true; clearInterval(ping); unwatch(); try { ctl.close(); } catch {} };
      // Đăng ký trước rồi mới đọc lại trạng thái, để không lỡ bước nào xảy ra ở giữa.
      const unwatch = watch(id, (m) => { if (m.event && m.event.seq > after) ev(m.event); if (m.delta) dl(m.delta); if (m.done) done(m.done); });
      stop = end;
      send("retry: 2000\n\n");
      const now = getRun(id)!;
      for (const e of now.events) if (e.seq > after) ev(e);
      const lt = liveText(id);
      if (lt?.text) send(`event: snapshot\ndata: ${JSON.stringify(lt)}\n\n`);
      if (now.status !== "running") done(now);
      req.signal.addEventListener("abort", end);
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" } });
}

// Dừng lượt đang chạy (nút Dừng): hủy lời gọi model, connector, chạy code đang dở; lượt kết thúc với phần đã viết được.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  const { id } = await ctx.params;
  const run = getRun(id, c.user.id);
  if (!run) return Response.json({ error: "Không tìm thấy lượt trả lời này." }, { status: 404 });
  return Response.json({ ok: true, cancelled: run.status === "running" && cancelRun(id, c.user.id) });
}

// Nhắn thêm khi lượt đang chạy: không ngắt việc đang làm; model nhận tin ở bước kế tiếp. Lượt đã xong (hoặc đang ở bước
// trả lời cuối) thì trình duyệt gửi tin thành lượt mới ngay sau đó — trả queued: false để trình duyệt biết.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  const { id } = await ctx.params;
  const run = getRun(id, c.user.id);
  if (!run) return Response.json({ error: "Không tìm thấy lượt trả lời này." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return Response.json({ error: "Tin nhắn trống." }, { status: 400 });
  return Response.json({ queued: run.status === "running" && pushInbox(id, c.user.id, text) });
}
