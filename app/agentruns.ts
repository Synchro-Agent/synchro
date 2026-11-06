// Lượt agent của Synchro Code chạy tách khỏi kết nối HTTP, như lượt chat: rời trang, tải lại, mất mạng đều không dừng việc đang làm.
// Chỉ nút Dừng mới dừng. Trình duyệt nối lại bất cứ lúc nào và nhận lại toàn bộ sự kiện của lượt (đánh số s).
// Máy chủ tự lưu lượt vào phiên (khi bật đồng bộ) nên kết quả vẫn còn khi trình duyệt không quay lại.
import type { AgentEvent } from "./agentcore";
import { closeFolded, foldAgentEvent } from "./agentfold";
import { getPrefs, patchSession, saveTurn, type TurnNode } from "./codestore";

type Line = { s: number; e: AgentEvent };
type Listener = { line: (l: Line) => void; end: () => void };
export type AgentRun = { uid: string; sid: string; node: TurnNode | null; ac: AbortController; lines: Line[]; bytes: number; listeners: Set<Listener>; started: number; ended: number };

const g = globalThis as unknown as { __synchroAgentRuns?: Map<string, AgentRun> };
const runs = (g.__synchroAgentRuns ??= new Map());
const keyOf = (uid: string, sid: string) => `${uid}:${sid}`;
// Giữ lượt đã xong một giờ để trình duyệt quay lại còn thấy. Lượt quá dài và lượt chờ duyệt không ai trả lời thì tự dừng, không chiếm máy chủ mãi.
const KEEP_MS = 3_600_000, MAX_RUN_MS = 2 * 3_600_000, ASK_WAIT_MS = 30 * 60_000, SAVE_MS = 10_000;
// Bộ đệm nhiều tối đa ~16 MB mỗi lượt: quá thì bỏ phần output chi tiết của công cụ, vẫn giữ tóm tắt.
const MAX_BUF = 16_000_000, MAX_LIVE = 5;

function sweep() {
  const now = Date.now();
  for (const [k, r] of runs) if (r.ended && now - r.ended > KEEP_MS) runs.delete(k);
}
export const latestRun = (uid: string, sid: string) => { sweep(); return runs.get(keyOf(uid, sid)) ?? null; };
// Lượt vừa bấm Dừng coi như đã hết dù CLI còn đang thoát: người dùng gửi tiếp ngay được, không phải đợi.
export const activeRun = (uid: string, sid: string) => { const r = runs.get(keyOf(uid, sid)); return r && !r.ended && !r.ac.signal.aborted ? r : null; };
export const liveCount = (uid: string) => { let n = 0; for (const r of runs.values()) if (r.uid === uid && !r.ended && !r.ac.signal.aborted) n++; return n; };
export const MAX_LIVE_RUNS = MAX_LIVE;
/** Nút Dừng (hoặc xóa phiên). */
export function stopAgentRun(uid: string, sid: string) { const r = activeRun(uid, sid); if (!r) return false; r.ac.abort(); return true; }

/** Bắt đầu lượt. work chạy tới khi xong, không phụ thuộc kết nối nào. */
export function startAgentRun(o: { uid: string; sid: string; node?: TurnNode | null; title?: string }, work: (emit: (e: AgentEvent) => void, signal: AbortSignal) => Promise<void>): AgentRun {
  sweep();
  const run: AgentRun = { uid: o.uid, sid: o.sid, node: o.node ?? null, ac: new AbortController(), lines: [], bytes: 0, listeners: new Set(), started: Date.now(), ended: 0 };
  runs.set(keyOf(o.uid, o.sid), run);
  const numSid = Number(o.sid);
  const sync = () => Number.isSafeInteger(numSid) && getPrefs(o.uid).sync;
  // Sự kiện nào cũng có thể làm đổi trạng thái lưu, nên chỉ ghi định kỳ; ghi lỗi không được làm hỏng lượt.
  let dirty = false;
  const save = () => { if (!dirty || !run.node || !sync()) return; dirty = false; try { saveTurn(o.uid, numSid, run.node, o.title); } catch (e) { console.warn("[agent] lưu lượt", (e as Error).message); } };
  const saver = setInterval(save, SAVE_MS);
  const hardStop = setTimeout(() => run.ac.abort(), MAX_RUN_MS);
  let askTimer: ReturnType<typeof setTimeout> | null = null;
  const clearAsk = () => { if (askTimer) clearTimeout(askTimer); askTimer = null; };
  const emit = (e: AgentEvent) => {
    if (run.node) { const img = e.t === "result" ? { ...e, image: undefined } : e; run.node = foldAgentEvent(run.node, img); dirty = true; }
    // Ảnh chụp màn hình chỉ tới người đang xem, không giữ trong bộ đệm (cũng không lưu ở phiên).
    let kept: AgentEvent = e.t === "result" && e.image ? { ...e, image: undefined } : e;
    const size = JSON.stringify(kept).length;
    if (run.bytes + size > MAX_BUF && kept.t === "result") kept = { ...kept, output: undefined };
    run.bytes += Math.min(size, 200_000);
    const s = run.lines.length + 1;
    run.lines.push({ s, e: kept });
    for (const l of run.listeners) l.line({ s, e });
    if (e.t === "ask") {
      if (sync()) try { patchSession(o.uid, numSid, { state: "blocked", reason: `Chờ bạn duyệt: ${e.title}` }); } catch {}
      clearAsk();
      askTimer = setTimeout(() => { emit({ t: "error", error: "Không có ai duyệt sau 30 phút nên lượt này đã dừng." }); run.ac.abort(); }, ASK_WAIT_MS);
    } else if (e.t === "asked") {
      clearAsk();
      if (sync()) try { patchSession(o.uid, numSid, { state: null, reason: null }); } catch {}
    }
  };
  if (sync()) { try { patchSession(o.uid, numSid, { running: true, state: null, reason: null }); if (run.node) { dirty = true; save(); } } catch {} }
  void work(emit, run.ac.signal).catch((e) => emit({ t: "error", error: (e as Error).message || "Lỗi máy chủ" })).finally(() => {
    clearInterval(saver); clearTimeout(hardStop); clearAsk();
    run.ended = Date.now();
    if (run.node) { run.node = closeFolded({ ...run.node, done: true, ...(run.ac.signal.aborted ? { stopped: true } : {}) }); dirty = true; }
    save();
    if (sync()) try { patchSession(o.uid, numSid, { running: false }); } catch {}
    for (const l of run.listeners) l.end();
    run.listeners.clear();
  });
  return run;
}

/** NDJSON của một lượt từ sau sự kiện after: dòng đầu { t: "run" }, sau đó các sự kiện (kèm s), cuối cùng { t: "end" } khi lượt xong.
 *  Đóng kết nối chỉ thôi nghe, lượt vẫn chạy. */
export function runStream(run: AgentRun, after: number, signal: AbortSignal): Response {
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      let closed = false;
      const send = (o: unknown) => { if (!closed) try { ctl.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { closed = true; } };
      const ping = setInterval(() => { if (!closed) try { ctl.enqueue(enc.encode("\n")); } catch { closed = true; } }, 15_000);
      const finish = () => { if (closed) return; closed = true; clearInterval(ping); run.listeners.delete(me); try { ctl.close(); } catch {} };
      const me: Listener = { line: ({ s, e }) => { if (s > after) send({ ...e, s }); }, end: () => { send({ t: "end", s: run.lines.length, stopped: run.ac.signal.aborted }); finish(); } };
      stop = () => { closed = true; clearInterval(ping); run.listeners.delete(me); };
      send({ t: "run", node: run.node ? { ...run.node, steps: undefined, ai: "" } : null, running: !run.ended, count: run.lines.length });
      for (const l of run.lines) if (l.s > after) send({ ...l.e, s: l.s });
      if (run.ended) { me.end(); return; }
      run.listeners.add(me);
      signal.addEventListener("abort", () => stop());
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
