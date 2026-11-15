// Độ trễ vòng lặp sự kiện của máy chủ Next: một việc đồng bộ nặng (SQLite lớn, JSON lớn, regex…) chặn mọi người dùng cùng lúc.
// perf_hooks.monitorEventLoopDelay lấy mẫu mỗi 20 ms; mỗi 60 giây ghi một dòng "[timing] loop p50=… p99=… max=…" (ms) rồi đặt lại,
// giữ mẫu gần nhất cho Cài đặt → Sức khỏe hệ thống. Giá trị là phần trễ thêm, đã trừ chu kỳ lấy mẫu 20 ms (máy rảnh ≈ 0–2 ms).
// Trạng thái nằm trên globalThis: instrumentation.ts và các route được đóng gói riêng nhưng chạy chung một tiến trình.
import "server-only";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

// Kiểu dùng chung với phía bên kia: shared/types/health.ts.
import type { LoopSample } from "../shared/types/health";
export type { LoopSample } from "../shared/types/health";
const RESOLUTION = 20;
type State = { h: IntervalHistogram; since: number; last: LoopSample | null; timer: ReturnType<typeof setInterval> | null };
const g = globalThis as unknown as { __synchroLoop?: State };

const ms = (ns: number) => Math.round(Math.max(0, ns / 1e6 - RESOLUTION) * 10) / 10;
function read(s: State): LoopSample {
  const h = s.h, now = Date.now();
  const empty = !h.count;
  return { at: now, p50: empty ? 0 : ms(h.percentile(50)), p99: empty ? 0 : ms(h.percentile(99)), max: empty ? 0 : ms(h.max), windowSec: Math.round((now - s.since) / 1000) };
}

/** Lấy mẫu của khoảng vừa qua, ghi nhật ký, giữ lại và đặt lại bộ đếm. */
export function sampleLoop(log = true): LoopSample | null {
  const s = g.__synchroLoop;
  if (!s) return null;
  const v = read(s);
  s.last = v;
  s.h.reset();
  s.since = v.at;
  if (log) console.log(`[timing] loop p50=${v.p50} p99=${v.p99} max=${v.max}`);
  return v;
}

/** Bật đo một lần cho cả tiến trình (gọi từ instrumentation.ts); gọi lại thì không làm gì. */
export function startLoopMonitor(everyMs = 60_000) {
  if (g.__synchroLoop) return;
  const h = monitorEventLoopDelay({ resolution: RESOLUTION });
  h.enable();
  const s: State = { h, since: Date.now(), last: null, timer: null };
  g.__synchroLoop = s;
  s.timer = setInterval(() => sampleLoop(), everyMs);
  s.timer.unref?.();
}

/** Cho trang sức khỏe: mẫu 60 giây gần nhất; trong phút đầu sau khởi động (chưa có mẫu) thì số đo từ lúc khởi động tới giờ. */
export function loopReport(): (LoopSample & { live: boolean }) | null {
  const s = g.__synchroLoop;
  if (!s) return null;
  return s.last ? { ...s.last, live: false } : { ...read(s), live: true };
}
