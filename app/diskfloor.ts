// Sàn đĩa trống của cả máy chủ (chỉ chạy ở máy chủ). Hạn mức từng tài khoản không chặn được nhiều tài khoản cùng lấp đĩa; đĩa đầy thì SQLite ngừng ghi và mọi người cùng hỏng.
// Từ chối tệp mới khi còn đủ chỗ cho cơ sở dữ liệu, thay vì đợi tới lúc không còn gì để xử lý.
import fs from "node:fs";

export const MIN_FREE_MB = () => Number(process.env.SYNCHRO_MIN_FREE_MB) || 2000;
export function freeMB(p: string): number | null {
  try { const v = fs.statfsSync(p); return Math.round((v.bavail * v.bsize) / 1048576); } catch { return null; }
}
/** Đĩa chứa p đã xuống dưới sàn. Không đọc được thì không kết luận: không được chặn người dùng vì lỗi đo. */
export const diskLow = (p: string) => { const f = freeMB(p); return f !== null && f < MIN_FREE_MB(); };
