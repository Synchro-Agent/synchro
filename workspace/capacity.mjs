// Sức chứa của dịch vụ workspace theo RAM thật (Blueprint G3) và hàng chờ có vị trí (G3.2). Hàm thuần, không đụng Docker, để kiểm thử
// được mà không cần bật cả workspace/agent.mjs (tests/api/ws-capacity.test.mjs).
import fs from "node:fs";
import os from "node:os";

/** Tổng RAM thật của máy (MB): MemTotal trong /proc/meminfo trên Linux (máy chủ thật), nơi khác os.totalmem (máy dev); 0 khi không đo được. */
export function readTotalMB() {
  try { const m = /MemTotal:\s+(\d+)\s+kB/.exec(fs.readFileSync("/proc/meminfo", "utf8")); if (m) return Math.round(Number(m[1]) / 1024); } catch { /* không phải Linux */ }
  const t = Math.round(os.totalmem() / 1048576);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/** Đổi "2g", "1536m", "512" (MB) ra MB; sai định dạng thì trả d. */
export const memMB = (s, d) => { const m = /^(\d+)\s*([gm])?/i.exec(String(s ?? "")); return m ? Math.round(Number(m[1]) * (/(g)/i.test(m[2] ?? "") ? 1024 : 1)) : d; };

/**
 * Số việc chạy cùng lúc của MỘT hồ theo G3.1: floor((tổng RAM − chừa) × 0,5 / perMB), mỗi hồ tính RIÊNG (không chia ngân sách chung giữa các hồ).
 * raw: biến môi trường đặt tay (số > 0 thì theo luôn). Kẹp [min, max]; không đo được RAM (total = 0) thì về fallback (mặc định cũ).
 */
export function ramSlots({ raw, total, reserve = 2560, perMB, fallback, min, max }) {
  if (raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) && Number(raw) > 0) return Number(raw);
  if (!total) return fallback;
  return Math.max(min, Math.min(max, Math.floor(((total - reserve) * 0.5) / perMB)));
}

/**
 * Số lần dựng video cùng lúc (INT-1): mỗi lần dựng cần ~3,5 GB nên floor((tổng − chừa) × 0,5 / 3584), lấy từ cùng RAM thật như RUN_MAX; mỗi lần
 * dựng còn giữ thêm một chỗ chạy chung nên không bao giờ vượt RUN_MAX; trần cap (WS_MEDIA_CAP); ít nhất 1. raw (WS_MEDIA_MAX > 0) đặt tay thì theo.
 */
export function mediaSlots({ raw, cap, total, reserve = 2560, runMax, perMB = 3584 }) {
  if (raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) && Number(raw) > 0) return Number(raw);
  const byRam = total ? Math.floor(((total - reserve) * 0.5) / perMB) : 1;
  const c = Number.isFinite(Number(cap)) && Number(cap) > 0 ? Number(cap) : 4;
  return Math.max(1, Math.min(c, runMax, byRam));
}

/**
 * Hàng chờ có thứ tự cho những thứ không tự báo khi rảnh (RAM khả dụng, chỗ workspace): chỉ người đứng đầu được thử check(), người sau chờ tới lượt,
 * nên biết được vị trí (1-based) để báo cho người dùng thay vì trả 503 ngay. wait() trả { ok: true | false | "aborted", pos }: được đi thì pos là
 * vị trí lúc vào hàng (0 khi đi ngay, không phải chờ); ok = false khi quá deadlineMs, lúc đó pos là vị trí hiện tại. onPos(pos) mỗi khi vị trí đổi.
 */
export function createWaitLine({ pollMs = 500, now = () => Date.now(), sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) } = {}) {
  const line = [];
  return {
    async wait(check, { signal, deadlineMs = 60_000, onPos } = {}) {
      if (signal?.aborted) return { ok: "aborted", pos: 0 };
      if (!line.length && (await check())) return { ok: true, pos: 0 };
      const me = {};
      line.push(me);
      const pos0 = line.indexOf(me) + 1;
      let last = 0;
      const end = now() + deadlineMs;
      try {
        for (;;) {
          const pos = line.indexOf(me) + 1;
          if (pos !== last) { last = pos; try { onPos?.(pos); } catch { /* bỏ */ } }
          if (signal?.aborted) return { ok: "aborted", pos: pos0 };
          if (pos === 1 && (await check())) return { ok: true, pos: pos0 };
          if (now() >= end) return { ok: false, pos: Math.max(pos, 1) };
          await sleep(pollMs);
        }
      } finally { const i = line.indexOf(me); if (i >= 0) line.splice(i, 1); }
    },
    get length() { return line.length; },
  };
}
