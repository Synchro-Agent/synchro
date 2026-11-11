// Lượt agent của Synchro Code chạy tách khỏi kết nối HTTP, như lượt chat: rời trang, tải lại, mất mạng đều không dừng việc đang làm.
// Chỉ nút Dừng mới dừng. Trình duyệt nối lại bất cứ lúc nào và nhận lại toàn bộ sự kiện của lượt (đánh số s).
// Máy chủ tự lưu lượt vào phiên (khi bật đồng bộ) nên kết quả vẫn còn khi trình duyệt không quay lại.
import type { AgentEvent } from "./agentcore";
import { closeFolded, foldAgentEvent } from "./agentfold";
import { getUser } from "./authstore";
import { getPrefs, patchSession, saveTurn, type TurnNode } from "./codestore";

type Line = { s: number; e: AgentEvent };
type Listener = { line: (l: Line) => void; end: () => void };
export type AgentRun = { uid: string; sid: string; node: TurnNode | null; ac: AbortController; lines: Line[]; bytes: number; listeners: Set<Listener>; started: number; ended: number; purged?: boolean; saved?: boolean };

const g = globalThis as unknown as { __synchroAgentRuns?: Map<string, AgentRun> };
const runs = (g.__synchroAgentRuns ??= new Map());
const keyOf = (uid: string, sid: string) => `${uid}:${sid}`;
// Giữ lượt đã xong một giờ để trình duyệt quay lại còn thấy. Lượt quá dài và lượt chờ duyệt không ai trả lời thì tự dừng, không chiếm máy chủ mãi.
// Lượt đã lưu trọn vào phiên (bật đồng bộ) chỉ giữ thêm SAVED_KEEP_MS cho trình duyệt đang nối lại giữa chừng: sau đó trình duyệt mở phiên thấy máy chủ
// không còn lượt (gone) thì lấy kết quả đã lưu, không cần cả bộ đệm sự kiện (tới 16 MB mỗi lượt) nằm trong bộ nhớ thêm một giờ.
const KEEP_MS = Number(process.env.SYNCHRO_AGENT_KEEP_MS) || 3_600_000, SAVED_KEEP_MS = Number(process.env.SYNCHRO_AGENT_SAVED_KEEP_MS) || 5 * 60_000, MAX_RUN_MS = 2 * 3_600_000, ASK_WAIT_MS = Number(process.env.SYNCHRO_ASK_WAIT_MS) || 30 * 60_000, SAVE_MS = 10_000;
/** Lần lưu tiếp cách lần trước bao lâu. Mỗi lần lưu đọc và ghi cả phiên, chặn tiến trình duy nhất của mọi người: giữ dưới khoảng 1% thời gian, phiên lớn thì lưu thưa đi (kết quả cuối lượt vẫn luôn được lưu). */
export const saveGap = (costMs: number) => Math.min(300_000, costMs * 100);
// Bộ đệm nhiều tối đa ~16 MB mỗi lượt (đếm đúng số byte đã giữ): quá thì bỏ phần output chi tiết của công cụ, vẫn giữ tóm tắt.
const MAX_BUF = 16_000_000, MAX_LIVE = 5;
const keepOf = (r: AgentRun) => (r.saved ? SAVED_KEEP_MS : KEEP_MS);

function sweep() {
  const now = Date.now();
  for (const [k, r] of runs) if (r.ended && now - r.ended > keepOf(r)) runs.delete(k);
}
/** Số lượt đang giữ trong bộ nhớ và tổng byte bộ đệm (theo dõi bộ nhớ). */
export const runStats = () => { let n = 0, bytes = 0; for (const r of runs.values()) { n++; bytes += r.bytes; } return { runs: n, bytes }; };
export const latestRun = (uid: string, sid: string) => { sweep(); return runs.get(keyOf(uid, sid)) ?? null; };
// Lượt vừa bấm Dừng coi như đã hết dù CLI còn đang thoát: người dùng gửi tiếp ngay được, không phải đợi.
export const activeRun = (uid: string, sid: string) => { const r = runs.get(keyOf(uid, sid)); return r && !r.ended && !r.ac.signal.aborted ? r : null; };
export const liveCount = (uid: string) => { let n = 0; for (const r of runs.values()) if (r.uid === uid && !r.ended && !r.ac.signal.aborted) n++; return n; };
export const MAX_LIVE_RUNS = MAX_LIVE;
/** Nút Dừng (hoặc xóa phiên). */
export function stopAgentRun(uid: string, sid: string) { const r = activeRun(uid, sid); if (!r) return false; r.ac.abort(); return true; }

/** Xóa tài khoản: dừng mọi lượt và quên ngay nội dung trong bộ nhớ, đừng đợi một giờ. CLI đang chạy thoát sau đó nên phần lưu cuối lượt phải biết là không được ghi (cờ purged). */
export function stopUserAgentRuns(uid: string) {
  for (const [k, r] of runs) if (r.uid === uid) { r.purged = true; r.ac.abort(); runs.delete(k); }
}

/** Bắt đầu lượt. work chạy tới khi xong, không phụ thuộc kết nối nào. */
export function startAgentRun(o: { uid: string; sid: string; node?: TurnNode | null; title?: string }, work: (emit: (e: AgentEvent) => void, signal: AbortSignal) => Promise<void>): AgentRun {
  sweep();
  const run: AgentRun = { uid: o.uid, sid: o.sid, node: o.node ?? null, ac: new AbortController(), lines: [], bytes: 0, listeners: new Set(), started: Date.now(), ended: 0 };
  runs.set(keyOf(o.uid, o.sid), run);
  const numSid = Number(o.sid);
  // Tài khoản đã xóa: getPrefs trả mặc định (đồng bộ bật) và bảng phiên không có khóa ngoại tới users, nên nếu không chặn thì lượt ghi lại prompt và kết quả sau khi đã xóa.
  const sync = () => !run.purged && Number.isSafeInteger(numSid) && !!getUser(o.uid) && getPrefs(o.uid).sync;
  // Sự kiện nào cũng có thể làm đổi trạng thái lưu, nên chỉ ghi định kỳ; ghi lỗi không được làm hỏng lượt.
  let dirty = false, nextSave = 0;
  const save = (force = false) => {
    if (!dirty || !run.node || !sync()) return;
    const t0 = Date.now();
    if (!force && t0 < nextSave) return;
    dirty = false;
    try { saveTurn(o.uid, numSid, run.node, o.title); if (force && run.ended) run.saved = true; } catch (e) { console.warn("[agent] lưu lượt", (e as Error).message); }
    nextSave = Date.now() + saveGap(Date.now() - t0);
  };
  const saver = setInterval(() => save(), SAVE_MS);
  const hardStop = setTimeout(() => run.ac.abort(), MAX_RUN_MS);
  let askTimer: ReturnType<typeof setTimeout> | null = null;
  // CLI gọi công cụ song song thì có thể có nhiều câu hỏi duyệt cùng lúc: trả lời một câu mà tắt hẹn giờ thì câu còn lại giữ lượt và chỗ chạy tới 2 giờ.
  const openAsks = new Set<string>();
  const clearAsk = () => { if (askTimer) clearTimeout(askTimer); askTimer = null; };
  const armAsk = () => { clearAsk(); askTimer = setTimeout(() => { emit({ t: "error", error: "Không có ai duyệt sau 30 phút nên lượt này đã dừng." }); run.ac.abort(); }, ASK_WAIT_MS); };
  const emit = (e: AgentEvent) => {
    // Quá bộ đệm thì lượt trong bộ nhớ cũng bỏ đầu ra chi tiết, không lớn mãi theo số lần gọi công cụ.
    if (run.node) { const img = e.t === "result" ? { ...e, image: undefined, ...(run.bytes > MAX_BUF ? { output: undefined } : {}) } : e; run.node = foldAgentEvent(run.node, img); dirty = true; }
    // Ảnh chụp màn hình chỉ tới người đang xem, không giữ trong bộ đệm (cũng không lưu ở phiên).
    let kept: AgentEvent = e.t === "result" && e.image ? { ...e, image: undefined } : e;
    let size = JSON.stringify(kept).length;
    if (run.bytes + size > MAX_BUF && kept.t === "result" && kept.output) { kept = { ...kept, output: undefined }; size = JSON.stringify(kept).length; }
    run.bytes += size;
    const s = run.lines.length + 1;
    run.lines.push({ s, e: kept });
    for (const l of run.listeners) l.line({ s, e });
    if (e.t === "ask") {
      if (sync()) try { patchSession(o.uid, numSid, { state: "blocked", reason: `Chờ bạn duyệt: ${e.title}` }); } catch {}
      openAsks.add(e.id);
      armAsk();
    } else if (e.t === "asked") {
      openAsks.delete(e.id);
      if (openAsks.size) armAsk();
      else {
        clearAsk();
        if (sync()) try { patchSession(o.uid, numSid, { state: null, reason: null }); } catch {}
      }
    }
  };
  if (sync()) { try { patchSession(o.uid, numSid, { running: true, state: null, reason: null }); if (run.node) { dirty = true; save(); } } catch {} }
  void work(emit, run.ac.signal).catch((e) => emit({ t: "error", error: (e as Error).message || "Lỗi máy chủ" })).finally(() => {
    clearInterval(saver); clearTimeout(hardStop); clearAsk();
    run.ended = Date.now();
    if (run.node) { run.node = closeFolded({ ...run.node, done: true, ...(run.ac.signal.aborted ? { stopped: true } : {}) }); dirty = true; }
    save(true);
    // Bấm Dừng rồi gửi tiếp ngay: lượt mới đã chạy, lượt cũ thoát muộn không được báo phiên đã xong.
    if (sync() && runs.get(keyOf(o.uid, o.sid)) === run) try { patchSession(o.uid, numSid, { running: false }); } catch {}
    for (const l of run.listeners) l.end();
    run.listeners.clear();
    // Không đợi tới lần sweep sau (chỉ chạy khi có lượt mới hay có người hỏi): tự bỏ lượt khỏi bộ nhớ khi hết hạn giữ.
    const key = keyOf(o.uid, o.sid);
    setTimeout(() => { if (runs.get(key) === run) runs.delete(key); }, keepOf(run)).unref?.();
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
