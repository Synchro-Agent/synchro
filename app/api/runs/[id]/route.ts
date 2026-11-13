import { current, sameOrigin } from "../../../authstore";
import { cancelRun, getRun, liveText, pushInbox, watch, type Delta, type PublicRun, type RunEvent } from "../../../runs";
import { timed } from "../../../servertiming";
import { deltaGate } from "../../../ssedeltas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Theo dõi một lượt chạy. Mặc định là SSE: gửi lại mọi bước sau Last-Event-ID (hoặc ?after=), rồi bước mới
// cho tới khi xong ("event: done" kèm kết quả). ?json=1 trả trạng thái hiện tại một lần (dùng khi không mở được SSE).
// Chữ model đang viết đến qua "event: delta"; mở (lại) kết nối giữa chừng thì nhận trước "event: snapshot" với phần đã viết.
export const GET = timed(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const { id } = await ctx.params;
  const run = getRun(id, c.user.id);
  if (!run) return Response.json({ error: "Không tìm thấy lượt trả lời này." }, { status: 404 });
  const url = new URL(req.url);
  // live: chữ đang viết, cho đoạn chat theo dõi bằng cách hỏi định kỳ (quá nhiều kết nối SSE cùng lúc, xem llm.ts).
  // now: giờ máy chủ, để trình duyệt tính đồng hồ công cụ / đếm ngược theo giờ máy chủ dù đồng hồ máy người dùng lệch (app/clock.ts).
  if (url.searchParams.get("json")) return Response.json({ run, live: liveText(id), now: Date.now() });
  const after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const enc = new TextEncoder();
  let stop = () => {}, drained = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      // ended tách khỏi closed: ghi lỗi (người xem đã đi) từng chỉ đặt closed, end() thấy closed thì bỏ qua nên hẹn giờ ping và người theo dõi ở lại mãi.
      let closed = false, ended = false, unwatch = () => {};
      const end = () => { if (ended) return; ended = closed = true; clearInterval(ping); gate.stop(); unwatch(); try { ctl.close(); } catch {} };
      const send = (s: string) => { if (!closed) try { ctl.enqueue(enc.encode(s)); } catch { end(); } };
      // Trình duyệt nhận chậm (ctl.desiredSize âm): gom các delta chữ của cùng một bước lại rồi gửi một khung (app/ssedeltas.ts). Phải xả trước
      // mọi sự kiện khác (step/done/clock) để giữ đúng thứ tự chữ rồi mới tới bước; luồng thông lại (pull, hẹn giờ ngắn) thì xả ngay (R10).
      const gate = deltaGate({ desired: () => ctl.desiredSize, send: (d: Delta) => send(`event: delta\ndata: ${JSON.stringify(d)}\n\n`) });
      const flushDeltas = gate.flush;
      drained = gate.flush;
      const ev = (e: RunEvent) => { flushDeltas(); send(`id: ${e.seq}\nevent: step\ndata: ${JSON.stringify(e)}\n\n`); };
      const dl = gate.push;
      const done = (r: PublicRun) => { flushDeltas(); send(`event: done\ndata: ${JSON.stringify({ status: r.status, http: r.http, result: r.result })}\n\n`); end(); };
      // Giờ máy chủ lúc mở luồng và mỗi 15 giây (thay cho dòng ping trống): đồng hồ trong khung chat theo giờ máy chủ (app/clock.ts).
      const clock = () => { flushDeltas(); send(`event: clock\ndata: {"now":${Date.now()}}\n\n`); };
      const ping = setInterval(clock, 15_000);
      // Đăng ký trước rồi mới đọc lại trạng thái, để không lỡ bước nào xảy ra ở giữa.
      unwatch = watch(id, (m) => { if (m.event && m.event.seq > after) ev(m.event); if (m.delta) dl(m.delta); if (m.done) done(m.done); });
      stop = end;
      send("retry: 2000\n\n");
      clock();
      const now = getRun(id)!;
      for (const e of now.events) if (e.seq > after) ev(e);
      const lt = liveText(id);
      if (lt?.text) send(`event: snapshot\ndata: ${JSON.stringify(lt)}\n\n`);
      if (now.status !== "running") done(now);
      if (ended) return;
      req.signal.addEventListener("abort", end);
    },
    // Trình duyệt vừa đọc hết hàng đợi của luồng: xả chữ đang giữ ngay, không chờ delta kế tiếp hay nhịp đồng hồ.
    pull() { drained(); },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" } });
});

// Dừng lượt đang chạy (nút Dừng): hủy lời gọi model, connector, chạy code đang dở; lượt kết thúc với phần đã viết được.
export const DELETE = timed(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  const { id } = await ctx.params;
  const run = getRun(id, c.user.id);
  if (!run) return Response.json({ error: "Không tìm thấy lượt trả lời này." }, { status: 404 });
  return Response.json({ ok: true, cancelled: run.status === "running" && cancelRun(id, c.user.id) });
});

// Nhắn thêm khi lượt đang chạy: không ngắt việc đang làm; model nhận tin ở bước kế tiếp. Lượt đã xong (hoặc đang ở bước
// trả lời cuối) thì trình duyệt gửi tin thành lượt mới ngay sau đó — trả queued: false để trình duyệt biết.
export const POST = timed(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
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
});
