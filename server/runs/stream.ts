// Định dạng luồng duy nhất của RunService: SSE (text/event-stream) cho mọi loại lượt.
//   retry: 2000
//   event: run       {id, kind, status, running, count, node?}   mở đầu: lượt nào, đang chạy không, đã có bao nhiêu bước
//   event: clock     {now}                                        lúc mở và mỗi 15 giây (giờ máy chủ, thay cho dòng ping trống)
//   id: <seq>        event: step  <dữ liệu bước>                  RunEvent của lượt chat / tác vụ, AgentEvent của lượt Code
//   event: delta     {s, t?, reset?}                              chữ đang viết (chỉ lượt chat / tác vụ; gom lại khi trình duyệt nhận chậm)
//   event: snapshot  {s, text}                                    phần chữ đã viết, một lần khi (nối lại) giữa chừng
//   event: done      {status, …}                                  kết thúc; luồng đóng sau khung này
// Nối lại bằng Last-Event-ID hoặc ?after=<seq>: chỉ gửi bước sau mốc đó. Lượt chat đọc bằng EventSource (ui/llm.ts), lượt Code đọc bằng
// fetch (POST bắt đầu lượt) qua shared/runstream.ts. Khung lạ với một bên (EventSource bỏ qua "run") không làm hỏng bên đó.
// Chuyển tiếp một bản phát hành (deploy xanh/lam): /api/agent vẫn trả NDJSON kiểu cũ cho yêu cầu không xin text/event-stream, để thẻ mở
// trước khi deploy (wsclient cũ) theo tiếp được lượt trên bản mới. Bản phát hành sau bỏ nhánh NDJSON.
import "server-only";
import { deltaGate } from "../ssedeltas";
import type { Delta } from "./types";

export type Wire = "sse" | "ndjson";
export type Step = { seq: number; data: Record<string, unknown> };
export type Head = { id: string; kind: string; status: string; running: boolean; count: number; node?: unknown };
/** Dữ liệu khung done; NDJSON kiểu cũ chỉ dùng s và stopped. */
export type End = Record<string, unknown> & { s?: number; stopped?: boolean };
export type Sink = { step: (s: Step) => void; delta: (d: Delta) => void; done: (e: End) => void };
/** Một lượt nhìn từ luồng. Luồng đăng ký trước rồi mới đọc lại (head → replay → snapshot → ended), nên không lỡ bước nào ở giữa. */
export type RunSource = {
  subscribe: (sink: Sink) => () => void;
  head: () => Head;
  replay: () => Iterable<Step>;
  /** Chữ đang viết; null khi lượt không chạy trong tiến trình này (khi đó luồng hỏi poll nếu có). */
  snapshot?: () => { s: number; text: string } | null;
  ended: () => End | null;
  /** Lượt chạy ở tiến trình khác: đọc lại kho dùng chung mỗi pollMs (bước, kết quả cuối). null: lượt không còn. */
  poll?: () => { steps: Iterable<Step>; ended: End | null } | null;
};

const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" };
const NDJSON_HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" };
const PING_MS = 15_000;

/** Một khung SSE. */
export const sseFrame = (event: string, data: unknown, id?: number) => `${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
/** Trình duyệt xin luồng SSE (Accept: text/event-stream); không xin thì là thẻ mở trước khi deploy, trả NDJSON kiểu cũ. */
export const wireOf = (req: Request): Wire => (/text\/event-stream/.test(req.headers.get("accept") ?? "") ? "sse" : "ndjson");
/** Mốc nối lại: Last-Event-ID (EventSource tự gửi) hoặc ?after=. */
export const afterOf = (req: Request, url = new URL(req.url)) => Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;

/** Luồng của một lượt từ sau bước after. Đóng kết nối chỉ thôi nghe, lượt vẫn chạy. */
export function runResponse(src: RunSource, o: { after: number; signal: AbortSignal; wire?: Wire; pollMs?: number }): Response {
  const sse = (o.wire ?? "sse") === "sse";
  const enc = new TextEncoder();
  let stop = () => {}, drained = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      // ended tách khỏi closed: ghi lỗi (người xem đã đi) từng chỉ đặt closed, end() thấy closed thì bỏ qua nên hẹn giờ ping và người theo dõi ở lại mãi.
      let closed = false, ended = false, unsub = () => {}, poll: ReturnType<typeof setInterval> | undefined, sent = o.after;
      const end = () => { if (ended) return; ended = closed = true; clearInterval(ping); clearInterval(poll); gate.stop(); unsub(); try { ctl.close(); } catch {} };
      const send = (s: string) => { if (!closed) try { ctl.enqueue(enc.encode(s)); } catch { end(); } };
      const line = (v: unknown) => send(JSON.stringify(v) + "\n");
      // Trình duyệt nhận chậm (ctl.desiredSize âm): gom các delta chữ của cùng một bước lại rồi gửi một khung (server/ssedeltas.ts). Phải xả trước
      // mọi sự kiện khác (step/done/clock) để giữ đúng thứ tự chữ rồi mới tới bước; luồng thông lại (pull, hẹn giờ ngắn) thì xả ngay (R10).
      const gate = deltaGate({ desired: () => ctl.desiredSize, send: (d: Delta) => send(`event: delta\ndata: ${JSON.stringify(d)}\n\n`) });
      const flushDeltas = gate.flush;
      drained = gate.flush;
      // sent: bước đã gửi (theo seq) — sự kiện trực tiếp, lần đọc lại và vòng hỏi cơ sở dữ liệu (lượt ở tiến trình khác) không gửi trùng.
      const step = (st: Step) => { if (st.seq <= sent) return; sent = st.seq; flushDeltas(); if (sse) send(sseFrame("step", st.data, st.seq)); else line({ ...st.data, s: st.seq }); };
      const delta = (d: Delta) => { if (sse) gate.push(d); };
      const done = (e: End) => { flushDeltas(); if (sse) send(sseFrame("done", e)); else line({ t: "end", s: e.s, stopped: e.stopped }); end(); };
      // Giờ máy chủ lúc mở luồng và mỗi 15 giây: đồng hồ trong khung chat theo giờ máy chủ (ui/clock.ts). NDJSON kiểu cũ: dòng trống giữ kết nối.
      const clock = () => { flushDeltas(); send(sse ? `event: clock\ndata: {"now":${Date.now()}}\n\n` : "\n"); };
      const ping = setInterval(clock, PING_MS);
      // Đăng ký trước rồi mới đọc lại trạng thái, để không lỡ bước nào xảy ra ở giữa.
      unsub = src.subscribe({ step, delta, done });
      stop = end;
      const head = src.head();
      if (sse) { send("retry: 2000\n\n"); send(sseFrame("run", head)); clock(); }
      else line({ t: "run", node: head.node ?? null, running: head.running, count: head.count });
      for (const st of src.replay()) step(st);
      const snap = src.snapshot?.() ?? null;
      if (snap?.text && sse) send(sseFrame("snapshot", snap));
      const fin = src.ended();
      if (fin) done(fin);
      if (ended) return;
      // Lượt đang chạy ở tiến trình khác (deploy xanh/lam: bản cũ đang chạy nốt lượt, nginx đã đưa kết nối này sang bản mới): tiến trình này
      // không nhận được sự kiện của nó, nên đọc cơ sở dữ liệu dùng chung định kỳ cho tới khi lượt xong (bước, kết quả cuối; chữ đang viết thì không).
      if (src.poll && !snap) poll = setInterval(() => {
        const r = src.poll!();
        if (!r) { end(); return; }
        for (const st of r.steps) step(st);
        if (r.ended) done(r.ended);
      }, o.pollMs ?? 1500);
      o.signal.addEventListener("abort", end);
    },
    // Trình duyệt vừa đọc hết hàng đợi của luồng: xả chữ đang giữ ngay, không chờ delta kế tiếp hay nhịp đồng hồ.
    pull() { drained(); },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: sse ? SSE_HEADERS : NDJSON_HEADERS });
}
