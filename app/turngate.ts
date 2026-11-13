// Cổng lượt model (chỉ chạy ở máy chủ): mỗi lượt là một CLI chạy trên máy chủ, không có cổng thì một tài khoản gửi hàng trăm lượt là hết RAM và cả trang sập cho mọi người.
// Ba mức: mỗi làn của tài khoản, tổng mọi làn của tài khoản, cả máy theo RAM. Quá mức thì xếp hàng (bấm Dừng được), khi có chỗ thì tài khoản đang chạy ít lượt nhất được trước, nên một tài khoản gửi dồn không chặn người khác.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import os from "node:os";

export type Lane = "run" | "quick" | "code";
export type WaitWhy = "account" | "server";
export type Slot = () => void;
type Waiter = { uid: string; lane: Lane; limit: number; total: number; bg?: boolean; go: (s: Slot) => void };
type State = { busy: Map<string, number>; total: number; waiting: Waiter[]; timer: ReturnType<typeof setTimeout> | null; peak: number; waited: number; refused: number };

// Dev-mock chạy nhiều bộ kiểm thử song song trên cùng tài khoản: nới như limit() ở authstore.
const RELAX = process.env.SYNCHRO_RELAX_LIMITS === "1" ? 50 : 1;
const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
/** Số lượt chạy cùng lúc của một tài khoản. */
export const accountLimit = () => num("SYNCHRO_TURNS_PER_ACCOUNT", 4) * RELAX;
/** Số lượt được chờ của một tài khoản; quá nữa thì từ chối ngay, không giữ yêu cầu (có thể tới vài MB) trong RAM. */
export const queueLimit = () => num("SYNCHRO_TURN_QUEUE", 8) * RELAX;
// Tổng RAM thật của máy (MB): MemTotal trên Linux (máy chủ thật), nơi khác dùng os.totalmem (máy dev). Đọc một lần, nhớ lại.
let totalMbCached: number | null = null;
function realTotalMB(): number {
  if (totalMbCached !== null) return totalMbCached;
  try { const m = /MemTotal:\s+(\d+)\s+kB/.exec(fs.readFileSync("/proc/meminfo", "utf8")); if (m) { totalMbCached = Math.round(Number(m[1]) / 1024); return totalMbCached; } } catch { /* không phải Linux */ }
  const t = Math.round(os.totalmem() / 1048576);
  totalMbCached = Number.isFinite(t) && t > 0 ? t : 0;
  return totalMbCached;
}
// Mức cả máy tính theo RAM thật, không theo ước lượng 70% nữa: chừa SYNCHRO_SERVER_RESERVE_MB (mặc định 2,5 GB) cho hệ điều hành và
// máy chủ web (khớp dòng [timing] mem rss của Next ~1 GB cộng khoảng chạy), phần còn lại chia cho ngân sách RSS mỗi CLI (SYNCHRO_CLI_BUDGET_MB,
// mặc định 400 MB — con số ước lượng: dòng [timing] mem giờ ghi cả RSS cây tiến trình CLI (cli=…) để đo lại theo Blueprint G3.4 rồi đặt
// SYNCHRO_TURNS_GLOBAL). Workspace và chạy code tự tính trần riêng ở workspace/agent.mjs (G3.1), không chia ngân sách với hồ này; swap của máy chủ
// (4 GB, scripts/setup-swap.sh) chỉ là đệm, không tính vào ngân sách. Kẹp [4, 64]; đo RAM hỏng (= 0) thì về đúng công thức 70% cũ để không làm kẹt cả hàng.
let globalCached: number | null = null;
function globalDefault(): number {
  if (globalCached !== null) return globalCached;
  const total = realTotalMB();
  const reserve = num("SYNCHRO_SERVER_RESERVE_MB", 2560), per = num("SYNCHRO_CLI_BUDGET_MB", 400);
  const budget = total - reserve;
  globalCached = total > 0 ? Math.max(4, Math.min(64, Math.floor(budget / per))) : Math.max(4, Math.floor((os.totalmem() * 0.7) / (400 * 1048576)));
  console.log(`[timing] turngate: global=${globalCached} (RAM ${total || "?"} MB, chừa ${reserve} MB, ngân sách ${total > 0 ? budget : "?"} MB, ${per} MB/lượt)`);
  return globalCached;
}
// SYNCHRO_TURNS_GLOBAL ghi đè (trị không hợp lệ thì về 4 như trước); không đặt thì lấy mức theo RAM thật.
export const globalLimit = () => (process.env.SYNCHRO_TURNS_GLOBAL !== undefined ? num("SYNCHRO_TURNS_GLOBAL", 4) : globalDefault()) * RELAX;
/** Tổng số lượt một tài khoản giữ cùng lúc trên mọi làn. Trước đây mỗi làn đếm riêng: 4 + 6 + 5 = 15 CLI, hơn cả mức của máy (14), một tài khoản chiếm hết chỗ của mọi người. Không quá 60% cả máy. */
export const accountTotal = () => Math.max(1, Math.min(num("SYNCHRO_TURNS_ACCOUNT_TOTAL", 6) * RELAX, Math.ceil(globalLimit() * 0.6)));
// Việc phụ (đặt tên, tóm tắt) được thêm chút chỗ trên mức chung: đang chạy đủ lượt chat thì đoạn chat vẫn có tên, không phải chờ.
const QUICK_EXTRA = 2;
// Sàn RAM trống. os.freemem trên macOS không tính bộ nhớ đệm nên quá thấp: chỉ tin trên Linux (MemAvailable).
const memOk = () => process.platform !== "linux" || os.freemem() / 1048576 >= num("SYNCHRO_MIN_FREE_RAM_MB", 300);

type Idle = { count: () => number; evict: () => boolean };
const g = globalThis as unknown as { __synchroTurnGate?: State; __synchroTurnHeld?: AsyncLocalStorage<{ open: boolean }>; __synchroTurnIdle?: Idle };
const st: State = (g.__synchroTurnGate ??= { busy: new Map(), total: 0, waiting: [], timer: null, peak: 0, waited: 0, refused: 0 });
const held = (g.__synchroTurnHeld ??= new AsyncLocalStorage());
const key = (lane: Lane, uid: string) => `${lane}:${uid}`;
const count = (k: string) => st.busy.get(k) ?? 0;
const userTotal = (uid: string) => (["run", "quick", "code"] as Lane[]).reduce((n, l) => n + count(key(l, uid)), 0);

// Tiến trình khởi động sẵn đang rảnh (cli_pool.ts) cũng ăn RAM mà ngoài cổng: 14 lượt cộng 6 tiến trình rảnh là 8 GB trên máy 7,9 GB, chưa kể Next.js. Tính chung vào mức của máy; chúng chỉ để chạy nhanh hơn nên lượt thật cần chỗ thì chúng nhường.
/** Hồ tiến trình đăng ký cách đếm và cách bỏ tiến trình rảnh. */
export const registerIdle = (i: Idle) => { g.__synchroTurnIdle = i; };
const idleCount = () => g.__synchroTurnIdle?.count() ?? 0;
/** Còn chỗ khởi động sẵn thêm một tiến trình không (không đuổi ai, không chiếm chỗ của lượt thật). */
export const warmRoom = () => st.total + idleCount() < globalLimit() && memOk();
function yieldIdle() {
  while (idleCount() > 0 && ((st.total < globalLimit() && st.total + idleCount() >= globalLimit()) || (st.total > 0 && !memOk()))) if (!g.__synchroTurnIdle?.evict()) return;
}

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
    yieldIdle();
    // Không còn lượt nào chạy thì luôn cho đi: đo RAM sai không được làm kẹt cả hàng.
    if (st.total >= globalLimit() || (st.total > 0 && !memOk())) break;
    let best: Waiter | null = null;
    for (const w of st.waiting) {
      if (count(key(w.lane, w.uid)) >= w.limit || userTotal(w.uid) >= w.total) continue;
      // Cùng tài khoản: việc có người đang nhìn đi trước việc nền, dù việc nền chờ lâu hơn.
      if (!best || userTotal(w.uid) < userTotal(best.uid) || (best.uid === w.uid && best.bg && !w.bg)) best = w;
    }
    if (!best) break;
    st.waiting.splice(st.waiting.indexOf(best), 1);
    best.go(take(best));
  }
  // RAM trống lại không kèm sự kiện nào: thử lại định kỳ khi còn người chờ.
  if (!st.timer) { st.timer = setTimeout(() => { st.timer = null; pump(); }, 2000); st.timer.unref?.(); }
}

/** Số lượt đang chờ của tài khoản trên một làn. bg: chỉ đếm việc nền (true) hoặc chỉ việc có người chờ (false). */
export const queuedOf = (uid: string, lane: Lane = "run", bg?: boolean) => st.waiting.filter((w) => w.uid === uid && w.lane === lane && (bg === undefined || !!w.bg === bg)).length;
export const runningOf = (uid: string, lane: Lane = "run") => count(key(lane, uid));
/** Ghi nhận một lần từ chối vì đầy (hiện ở trang Sức khỏe). */
export const noteRefused = () => { st.refused++; };
/** Số liệu cho trang Sức khỏe. */
export const gateStats = () => ({ running: st.total, waiting: st.waiting.length, peak: st.peak, waited: st.waited, refused: st.refused, limit: globalLimit(), perAccount: accountLimit() });

/** Đoạn mã này đang chạy trong một lượt đã giữ chỗ. Lời gọi CLI lồng bên trong (lượt chat, lượt Code) không xin thêm: lượt đang giữ đủ chỗ mà chờ chỗ nữa là tự chặn mình. */
export const holdsSlot = () => !!held.getStore()?.open;
/** Chạy fn trong chỗ đã xin rồi trả chỗ. Việc nền tách ra từ fn mà chạy sau khi lượt xong (rút bộ nhớ, đánh giá phiên) không còn được tính là đang giữ. */
export function withSlot<T>(slot: Slot, fn: () => Promise<T>): Promise<T> {
  const mark = { open: true };
  return held.run(mark, fn).finally(() => { mark.open = false; slot(); });
}

/** Xin chỗ chạy. Trả về hàm trả chỗ; "cancelled" khi người dùng dừng lúc đang chờ; "timeout" khi chờ quá maxWaitMs. total: mức chung mọi làn của tài khoản. */
export function acquire(o: { uid: string; lane: Lane; limit?: number; total?: number; signal?: AbortSignal; maxWaitMs?: number; bg?: boolean; onWait?: (w: WaitWhy) => void }): Promise<Slot | "cancelled" | "timeout"> {
  const limit = o.limit ?? accountLimit();
  const total = (o.total ?? accountTotal()) + (o.lane === "quick" ? QUICK_EXTRA : 0);
  if (o.signal?.aborted) return Promise.resolve("cancelled");
  yieldIdle();
  // Có người đang chờ cùng tài khoản thì không chen lên trước; hàng của tài khoản khác không làm chậm tài khoản này khi cả máy còn chỗ.
  // Việc nền đang chờ (giới hạn riêng, chặt hơn) không bắt việc có người nhìn phải xếp sau.
  const ahead = st.waiting.some((w) => w.uid === o.uid && w.lane === o.lane && (o.bg || !w.bg));
  if (!ahead && count(key(o.lane, o.uid)) < limit && userTotal(o.uid) < total && st.total < globalLimit() && (st.total === 0 || memOk())) return Promise.resolve(take(o));
  st.waited++;
  return new Promise((done) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const leave = () => { const i = st.waiting.indexOf(w); if (i >= 0) st.waiting.splice(i, 1); if (timer) clearTimeout(timer); o.signal?.removeEventListener("abort", onAbort); };
    const onAbort = () => { leave(); done("cancelled"); };
    const w: Waiter = { uid: o.uid, lane: o.lane, limit, total, bg: o.bg, go: (s) => { leave(); done(s); } };
    st.waiting.push(w);
    o.signal?.addEventListener("abort", onAbort, { once: true });
    if (o.maxWaitMs) { timer = setTimeout(() => { leave(); done("timeout"); }, o.maxWaitMs); timer.unref?.(); }
    pump();
    if (st.waiting.includes(w)) o.onWait?.(count(key(o.lane, o.uid)) >= limit || userTotal(o.uid) >= total ? "account" : "server");
  });
}
