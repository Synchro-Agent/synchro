// Vòng mức dùng của chế độ Tự động: phần trăm của nguồn sẽ chạy lượt kế tiếp, không phải của hãng gần chạm nhất. Tài
// khoản miễn phí từng thấy "100%" màu đỏ (gói Gemini đã hết) trong khi khóa API chung vẫn chạy lượt sau và mới dùng 2%.
// Hàm thuần: máy chủ (app/api/usage) tính, kiểm thử không cần máy chủ.

export type WinLite = { usedPct?: number; status?: string; group?: string };
export type LimitLite = { pct: number; limit: number | null };
/** Nguồn chạy lượt kế tiếp: model Tự động sẽ chọn, gói hay khóa API, phần trăm đã dùng của đúng nguồn đó. */
export type NextSource = { model: string; vendor: string; mode: "plan" | "api"; pct: number; group?: string };

// Gói Google chia hạn mức theo hai nhóm model (server/ai/subs.ts agyWindows).
export const AGY_GROUPS = { gemini: "Gemini models", other: "Claude and GPT models" } as const;

/**
 * Phần trăm đã dùng của gói cho một nhóm model: cửa sổ gần chạm nhất của nhóm, cửa sổ đã bị từ chối là 100. group: nhóm
 * của model sẽ chạy (gói Google); cửa sổ không ghi nhóm của gói Google là dòng "Hạn mức gói" khi Gemini bị chặn, nên
 * chỉ tính cho nhóm Gemini. Không có group: mọi cửa sổ.
 */
export function planPct(windows: WinLite[], group?: string): number {
  const own = group ? windows.filter((w) => (w.group ? w.group === group : group === AGY_GROUPS.gemini)) : windows;
  return Math.max(0, ...own.map((w) => (w.status === "rejected" ? 100 : w.usedPct ?? 0)));
}

/**
 * Phần trăm đã dùng khi chạy bằng khóa API: hạn mức chi phí của Synchro (phiên, tuần, ngày), hạn mức gọi và số dư của
 * hãng.
 */
export function apiPct(limits: LimitLite[], rate?: { pct: number } | null, credit?: { pct: number } | null): number {
  return Math.max(0, ...limits.filter((l) => l.limit !== null).map((l) => l.pct), rate?.pct ?? 0, credit?.pct ?? 0);
}
