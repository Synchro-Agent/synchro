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
