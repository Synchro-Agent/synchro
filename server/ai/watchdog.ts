// Bộ canh lượt treo của CLI. Thời gian tính tới hoạt động thật của model (chữ, đang nghĩ, gọi công cụ), không tính sự kiện khởi động của CLI
// (init, thread.started): hai sự kiện đó luôn tới trong 1–3 giây dù model treo, nên bộ canh cũ tắt ngay và người dùng nhìn vòng xoay tới 40 phút.
// Hai mức: chưa có hoạt động nào (first), và đã có rồi nhưng im lặng (idle). Mức idle nới theo effort: Opus nghĩ lâu ở mức cao có thể không
// in gì nhiều phút. Công cụ đang chạy (cầu nối MCP) và CLI báo đang thử lại đều dời mốc tính.
import "server-only";
const MIN = 60_000;
const IDLE: Record<string, number> = { minimal: 5, low: 5, medium: 8, high: 15, xhigh: 25, extra: 25, max: 30, ultra: 30 };
// Codex chỉ báo mục "reasoning" khi nghĩ xong và không có sự kiện nào giữa chừng: nghĩ kỹ thì câu đầu đến muộn, phải chờ lâu hơn.
const CODEX_FIRST: Record<string, number> = { minimal: 2, low: 2, medium: 3, high: 5, xhigh: 10, extra: 10, max: 15, ultra: 15 };
// Antigravity in kết quả một lần khi xong: mức first chính là giới hạn im lặng của cả lượt (không gọi công cụ nào).
const AGY_SILENT: Record<string, number> = { minimal: 3, low: 3, medium: 5, high: 10, xhigh: 20, extra: 20, max: 20, ultra: 20 };

export type WatchLimits = { first: number; idle: number };
/** Giới hạn của lượt theo CLI và effort (không rõ effort thì coi như "medium"). */
export function watchLimits(cli: string, effort?: string): WatchLimits {
  const e = effort && effort in IDLE ? effort : "medium";
  // SYNCHRO_WATCH_SEC: rút ngắn cả hai mức (kiểm thử, hoặc chỉnh nhanh trên máy chủ mà không cần build lại).
  const force = Number(process.env.SYNCHRO_WATCH_SEC) * 1000;
  if (force > 0) return { first: force, idle: force };
  return {
    // Nỗ lực thấp thường có chữ trong vài giây: treo thì chuyển model sớm hơn.
    first: cli === "agy" ? AGY_SILENT[e] * MIN : cli === "codex" ? CODEX_FIRST[e] * MIN : e === "low" || e === "minimal" ? 60_000 : 90_000,
    idle: IDLE[e] * MIN,
  };
}
export type WatchState = {
  /** Mốc bắt đầu tính: lúc mở lượt, hết chờ lượt khác của tài khoản, hoặc lần gần nhất CLI báo đang thử lại. */
  start: number;
  /** Lần gần nhất model có hoạt động thật (0: chưa có). */
  last: number;
  /** Lần gần nhất công cụ của Synchro chạy trong lượt này (0: chưa có; đang chạy thì là "bây giờ"). */
  alive: number;
  /** Đang chờ lượt khác của tài khoản: CLI chưa chạy nên không tính. */
  waiting: boolean;
};
/** "first": chưa có hoạt động nào sau mức first; "idle": có rồi nhưng im lặng quá mức idle; null: còn chờ được. */
export function stallOf(s: WatchState, lim: WatchLimits, now = Date.now()): "first" | "idle" | null {
  if (s.waiting) return null;
  const active = Math.max(s.last, s.alive);
  if (!active) return now - s.start > lim.first ? "first" : null;
  return now - Math.max(active, s.start) > lim.idle ? "idle" : null;
}
/** Câu báo lỗi có đơn vị đọc được (90 giây, 8 phút). */
export const waitText = (ms: number) => (ms < 120_000 ? `${Math.round(ms / 1000)} giây` : `${Math.round(ms / MIN)} phút`);
