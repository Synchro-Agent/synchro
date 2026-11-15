// Tắt êm khi deploy xanh/lam (docs/van-hanh.md, "Deploy xanh/lam"). Mô-đun thuần để kiểm thử không cần máy chủ.
// Tiến trình cũ nhận SIGTERM (pm2 stop, kill_timeout 30 giây) sau khi nginx đã chuyển sang bản mới:
// 1. Ngừng nhận lượt mới: các route bắt đầu lượt trả 503 kèm Retry-After: 5 (trình duyệt gửi lại, tới bản mới).
// 2. Dừng việc nền (bộ hẹn giờ…), rồi chờ tối đa 25 giây cho các lượt đang chạy xong (bản đồ lượt sống trống).
// 3. Dừng litestream, bỏ khóa primary, thoát. Lượt chưa xong vẫn ở trạng thái "đang chạy" trong cơ sở dữ liệu: bản mới chạy lại khi nhận vai primary.
// Chỉ khi NEXT_MANUAL_SIG_HANDLE được đặt (ecosystem.config.cjs): không có thì Next tự đóng máy chủ khi nhận tín hiệu như trước.

import "server-only";
export const RETRY_AFTER_S = 5;
export const DRAIN_MS = 25_000;
type State = { draining: boolean; since: number; installed: boolean; hooks: (() => void)[] };
const g = globalThis as unknown as { __synchroDrain?: State; __synchroStopping?: boolean };
const st = (g.__synchroDrain ??= { draining: false, since: 0, installed: false, hooks: [] });

export const isDraining = () => st.draining;
/** Từ đây lỗi 5xx của lượt là do máy chủ tắt: giữ lượt ở "đang chạy" để tiến trình sau chạy lại (runs.ts đọc cờ này). */
export const markStopping = () => { g.__synchroStopping = true; };
export const isStopping = () => g.__synchroStopping === true;

/** Việc cần dừng ngay khi bắt đầu tắt (bộ hẹn giờ tác vụ nền, theo dõi PR…): không bắt đầu lượt mới trong lúc chờ. */
export function onDrain(f: () => void) { st.hooks.push(f); if (st.draining) try { f(); } catch (e) { console.error("[drain]", e); } }

/** Route bắt đầu lượt mới gọi đầu tiên: đang tắt thì trả 503 + Retry-After, không thì null. */
export function drainingResponse(): Response | null {
  if (!st.draining) return null;
  return Response.json({ error: "Synchro đang chuyển sang phiên bản mới. Lượt này sẽ được gửi lại sau vài giây.", draining: true, retryAfter: RETRY_AFTER_S },
    { status: 503, headers: { "Retry-After": String(RETRY_AFTER_S), "Cache-Control": "no-store" } });
}

const sleep = (ms: number) => new Promise<void>((ok) => { setTimeout(ok, ms); });

/** Bắt đầu tắt: chặn lượt mới, chạy các hook, chờ busy() về 0 tối đa timeoutMs. Trả số lượt còn lại khi thôi chờ. */
export async function drain(o: { busy: () => number; timeoutMs?: number; pollMs?: number; now?: () => number }): Promise<{ left: number; waitedMs: number }> {
  const now = o.now ?? Date.now, timeout = o.timeoutMs ?? DRAIN_MS, poll = o.pollMs ?? 250;
  if (!st.draining) {
    st.draining = true; st.since = now();
    for (const f of st.hooks) try { f(); } catch (e) { console.error("[drain]", e); }
  }
  const t0 = now();
  let left = o.busy();
  while (left > 0 && now() - t0 < timeout) { await sleep(poll); left = o.busy(); }
  return { left, waitedMs: now() - t0 };
}

export type ShutdownOpts = {
  busy: () => number;
  /** Mô tả số lượt còn lại cho nhật ký (lượt chat chạy lại được, lượt Code thì không). */
  describe?: () => string;
  /** Sau khi chờ: dừng litestream, bỏ khóa primary… Có hạn giờ riêng để tổng không quá kill_timeout của pm2. */
  stop?: () => Promise<void>;
  exit?: (code: number) => void;
  timeoutMs?: number; pollMs?: number; stopMs?: number; graceMs?: number;
  log?: (s: string) => void;
};

/** Toàn bộ trình tự tắt êm; gọi khi nhận SIGTERM / SIGINT. Gọi lần hai (tín hiệu lặp) không làm gì. */
export async function shutdown(o: ShutdownOpts): Promise<{ left: number; waitedMs: number }> {
  const log = o.log ?? ((s: string) => console.log(s));
  const what = () => (o.describe ? o.describe() : `${o.busy()} lượt`);
  log(`[deploy] nhận tín hiệu tắt: ngừng nhận lượt mới, chờ ${what()} đang chạy (tối đa ${Math.round((o.timeoutMs ?? DRAIN_MS) / 1000)} giây)`);
  const r = await drain(o);
  // Để sự kiện "done" cuối cùng của luồng SSE kịp ra khỏi máy chủ trước khi thoát.
  if (!r.left) await sleep(o.graceMs ?? 500);
  markStopping();
  // Lượt chat (runs.ts) giữ "đang chạy" để bản mới chạy lại; lượt Code (agentruns.ts) chỉ ở trong bộ nhớ nên dừng hẳn (phần đã làm vẫn ở workspace).
  if (r.left) console.error(`[deploy] hết giờ chờ, còn ${what()}: lượt chat được bản mới chạy lại, lượt Code dừng hẳn`);
  else log(`[deploy] các lượt đã xong sau ${Math.round(r.waitedMs / 100) / 10} giây`);
  if (o.stop) await Promise.race([o.stop().catch((e) => console.error("[deploy]", e)), sleep(o.stopMs ?? 3000)]);
  (o.exit ?? ((c: number) => process.exit(c)))(0);
  return r;
}

/** Cài trình xử lý tín hiệu một lần (instrumentation.ts), chỉ khi tiến trình tự lo việc tắt (NEXT_MANUAL_SIG_HANDLE). */
export function installShutdown(o: ShutdownOpts, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.NEXT_MANUAL_SIG_HANDLE || st.installed) return false;
  st.installed = true;
  let started = false;
  const on = () => { if (started) return; started = true; void shutdown(o).catch((e) => { console.error("[deploy]", e); (o.exit ?? ((c: number) => process.exit(c)))(0); }); };
  process.on("SIGTERM", on);
  process.on("SIGINT", on);
  return true;
}

/** Chỉ cho kiểm thử. */
export function resetDrainForTest() { st.draining = false; st.since = 0; st.installed = false; st.hooks = []; g.__synchroStopping = false; }
