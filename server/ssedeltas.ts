// Gom chữ model đang viết (delta) cho luồng SSE của một lượt (server/runs/stream.ts) khi trình duyệt nhận chậm.
// Trình duyệt chậm (desiredSize âm): giữ các delta lại rồi gửi gộp thành một khung, thay vì dồn nhiều khung nhỏ vào hàng đợi của luồng.
// Xả khi: có delta mới lúc luồng đã thông, trước mọi sự kiện khác (gọi flush, để chữ luôn tới trước bước), khi luồng báo đã đọc hết
// (pull của ReadableStream gọi flush), và bằng hẹn giờ ngắn (R10): model đang dừng giữa chừng thì chữ đã giữ không kẹt tới nhịp đồng hồ 15 giây.
import "server-only";
import type { Delta } from "./runs/types";

export type DeltaGate = { push: (d: Delta) => void; flush: () => void; stop: () => void; readonly pending: number };

/** desired: ctl.desiredSize của luồng (null khi luồng đã đóng); send: gửi một delta; retryMs: nhịp kiểm tra lại khi đang giữ chữ. */
export function deltaGate(o: { desired: () => number | null; send: (d: Delta) => void; retryMs?: number }): DeltaGate {
  const retryMs = o.retryMs ?? 50;
  let pend: Delta[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const slow = () => { const n = o.desired(); return n !== null && n < 0; };
  const flush = () => {
    clear();
    if (!pend.length) return;
    const merged: Delta[] = [];
    for (const d of pend) {
      const last = merged[merged.length - 1];
      if (d.t !== undefined && !d.reset && last && last.t !== undefined && !last.reset && last.s === d.s) last.t += d.t;
      else merged.push({ ...d });
    }
    pend = [];
    for (const d of merged) o.send(d);
  };
  // Đang giữ chữ: hỏi lại sau retryMs; luồng đã thông (desiredSize ≥ 0) thì xả dù không có delta mới.
  const arm = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; if (!pend.length) return; if (slow()) arm(); else flush(); }, retryMs);
    (timer as { unref?: () => void }).unref?.();
  };
  return {
    push(d) {
      if (slow()) { pend.push(d); arm(); return; }
      flush();
      o.send(d);
    },
    flush,
    stop() { clear(); pend = []; },
    get pending() { return pend.length; },
  };
}
