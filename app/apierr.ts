// Lỗi gọi API từ trình duyệt, dùng chung cho các trang. Mất mạng hay máy chủ đang khởi động lại: không để lộ "Failed to fetch" của trình duyệt.
export const NO_SERVER = "Không kết nối được tới Synchro. Kiểm tra mạng rồi thử lại.";
/** fetch của trang: không tới được máy chủ thì báo câu dễ hiểu (giao diện dịch bằng tr). Người dùng tự hủy (AbortError) thì để nguyên. */
export const apiFetch = (url: string, init?: RequestInit) => fetch(url, init).catch((e: Error) => { if (e?.name === "AbortError") throw e; throw new Error(NO_SERVER); });
/** Câu báo khi máy chủ không kèm lời giải thích: proxy trả 502/503 lúc Synchro đang khởi động lại, 504 khi phản hồi quá lâu. */
export const statusText = (s: number) => (s === 502 || s === 503 ? "Synchro đang khởi động lại để cập nhật. Thử lại sau vài giây." : s === 504 ? "Máy chủ phản hồi quá lâu. Thử lại sau ít phút." : s >= 500 ? "Lỗi máy chủ. Vui lòng thử lại." : `Lỗi ${s}`);
/** Lý do thật khi terminal không nối lại được, theo tình trạng máy chủ báo (null: không hỏi được máy chủ). */
export const termDown = (j: { available?: boolean; reason?: string; running?: boolean } | null, online: boolean) =>
  !j ? (online ? "Không hỏi được máy chủ Synchro. Thử lại sau ít phút." : "Trình duyệt đang mất mạng. Có mạng lại thì bấm Kết nối lại.")
  : j.available === false ? j.reason || "Workspace chưa dùng được."
  : !j.running ? "Workspace đang tắt. Bấm Kết nối lại để bật."
  : "Workspace vẫn chạy nhưng terminal chưa nối được. Bấm Kết nối lại, nếu vẫn lỗi thì báo quản trị viên.";
