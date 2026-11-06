// Cổng lượt model (chỉ chạy ở máy chủ): mỗi lượt là một CLI chạy trên máy chủ, không có cổng thì một tài khoản gửi hàng trăm lượt là hết RAM và cả trang sập cho mọi người.
// Hai mức: mỗi tài khoản giữ vài lượt cùng lúc, cả máy theo RAM. Quá mức thì xếp hàng (bấm Dừng được), khi có chỗ thì tài khoản đang chạy ít lượt nhất được trước, nên một tài khoản gửi dồn không chặn người khác.
import os from "node:os";

export type Lane = "run" | "quick" | "code";
export type WaitWhy = "account" | "server";
export type Slot = () => void;
type Waiter = { uid: string; lane: Lane; limit: number; go: (s: Slot) => void };
type State = { busy: Map<string, number>; total: number; waiting: Waiter[]; timer: ReturnType<typeof setTimeout> | null; peak: number; waited: number; refused: number };

// Dev-mock chạy nhiều bộ kiểm thử song song trên cùng tài khoản: nới như limit() ở authstore.
const RELAX = process.env.SYNCHRO_RELAX_LIMITS === "1" ? 50 : 1;
const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
/** Số lượt chạy cùng lúc của một tài khoản. */
export const accountLimit = () => num("SYNCHRO_TURNS_PER_ACCOUNT", 4) * RELAX;
/** Số lượt được chờ của một tài khoản; quá nữa thì từ chối ngay, không giữ yêu cầu (có thể tới vài MB) trong RAM. */
export const queueLimit = () => num("SYNCHRO_TURN_QUEUE", 8) * RELAX;
// Ước lượng 400 MB cho mỗi CLI (chưa đo RSS thật trên máy chủ), chỉ dùng 70% RAM. Máy khác cấu hình thì đặt SYNCHRO_TURNS_GLOBAL.
export const globalLimit = () => num("SYNCHRO_TURNS_GLOBAL", Math.max(4, Math.floor((os.totalmem() * 0.7) / (400 * 1048576)))) * RELAX;
// Sàn RAM trống. os.freemem trên macOS không tính bộ nhớ đệm nên quá thấp: chỉ tin trên Linux (MemAvailable).
const memOk = () => process.platform !== "linux" || os.freemem() / 1048576 >= num("SYNCHRO_MIN_FREE_RAM_MB", 300);

const g = globalThis as unknown as { __synchroTurnGate?: State };
const st: State = (g.__synchroTurnGate ??= { busy: new Map(), total: 0, waiting: [], timer: null, peak: 0, waited: 0, refused: 0 });
const key = (lane: Lane, uid: string) => `${lane}:${uid}`;
const count = (k: string) => st.busy.get(k) ?? 0;
const userTotal = (uid: string) => (["run", "quick", "code"] as Lane[]).reduce((n, l) => n + count(key(l, uid)), 0);

function take(w: Pick<Waiter, "uid" | "lane">): Slot {
  const k = key(w.lane, w.uid);
  st.busy.set(k, count(k) + 1);
  st.total++;
  st.peak = Math.max(st.peak, st.total);
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    const n = count(k) - 1;
    if (n > 0) st.busy.set(k, n); else st.busy.delete(k);
    st.total--;
    pump();
  };
}
// Ai được chạy tiếp: tài khoản đang giữ ít lượt nhất, cùng số lượt thì ai chờ lâu hơn.
function pump() {
  for (;;) {
    if (!st.waiting.length) { if (st.timer) { clearTimeout(st.timer); st.timer = null; } return; }
    // Không còn lượt nào chạy thì luôn cho đi: đo RAM sai không được làm kẹt cả hàng.
    if (st.total >= globalLimit() || (st.total > 0 && !memOk())) break;
    let best: Waiter | null = null;
    for (const w of st.waiting) {
      if (count(key(w.lane, w.uid)) >= w.limit) continue;
      if (!best || userTotal(w.uid) < userTotal(best.uid)) best = w;
    }
    if (!best) break;
    st.waiting.splice(st.waiting.indexOf(best), 1);
    best.go(take(best));
  }
  // RAM trống lại không kèm sự kiện nào: thử lại định kỳ khi còn người chờ.
  if (!st.timer) { st.timer = setTimeout(() => { st.timer = null; pump(); }, 2000); st.timer.unref?.(); }
}

/** Số lượt đang chờ của tài khoản trên một làn. */
export const queuedOf = (uid: string, lane: Lane = "run") => st.waiting.filter((w) => w.uid === uid && w.lane === lane).length;
export const runningOf = (uid: string, lane: Lane = "run") => count(key(lane, uid));
/** Ghi nhận một lần từ chối vì đầy (hiện ở trang Sức khỏe). */
export const noteRefused = () => { st.refused++; };
/** Số liệu cho trang Sức khỏe. */
export const gateStats = () => ({ running: st.total, waiting: st.waiting.length, peak: st.peak, waited: st.waited, refused: st.refused, limit: globalLimit(), perAccount: accountLimit() });

/** Xin chỗ chạy. Trả về hàm trả chỗ; "cancelled" khi người dùng dừng lúc đang chờ; "timeout" khi chờ quá maxWaitMs. */
export function acquire(o: { uid: string; lane: Lane; limit?: number; signal?: AbortSignal; maxWaitMs?: number; onWait?: (w: WaitWhy) => void }): Promise<Slot | "cancelled" | "timeout"> {
  const limit = o.limit ?? accountLimit();
  if (o.signal?.aborted) return Promise.resolve("cancelled");
  // Có người đang chờ cùng tài khoản thì không chen lên trước; hàng của tài khoản khác không làm chậm tài khoản này khi cả máy còn chỗ.
  const ahead = st.waiting.some((w) => w.uid === o.uid && w.lane === o.lane);
  if (!ahead && count(key(o.lane, o.uid)) < limit && st.total < globalLimit() && (st.total === 0 || memOk())) return Promise.resolve(take(o));
  st.waited++;
  return new Promise((done) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const leave = () => { const i = st.waiting.indexOf(w); if (i >= 0) st.waiting.splice(i, 1); if (timer) clearTimeout(timer); o.signal?.removeEventListener("abort", onAbort); };
    const onAbort = () => { leave(); done("cancelled"); };
    const w: Waiter = { uid: o.uid, lane: o.lane, limit, go: (s) => { leave(); done(s); } };
    st.waiting.push(w);
    o.signal?.addEventListener("abort", onAbort, { once: true });
    if (o.maxWaitMs) { timer = setTimeout(() => { leave(); done("timeout"); }, o.maxWaitMs); timer.unref?.(); }
    pump();
    if (st.waiting.includes(w)) o.onWait?.(count(key(o.lane, o.uid)) >= limit ? "account" : "server");
  });
}
