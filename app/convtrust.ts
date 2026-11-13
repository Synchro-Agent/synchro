// D6: dấu "đã đọc skill chưa kiểm chứng" theo từng cuộc trò chuyện (chỉ chạy ở máy chủ). Một khi skill của danh mục Claude (cd:…, bên thứ ba)
// được load_skill trong một cuộc trò chuyện, hướng dẫn của nó nằm lại trong lịch sử và ảnh hưởng mọi lượt sau. Vì vậy thao tác ghi của connector
// và browser_* trên Chrome của người dùng giữ ở mức "hỏi" cho cả cuộc trò chuyện đó, không chỉ lượt đã đọc skill.
// Bảng nhỏ (user_id, conv): chỉ có dòng khi thật sự đọc skill danh mục; xóa tài khoản thì mất theo (ON DELETE CASCADE).
import { db } from "./authstore";

let ready = false;
function t() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS conv_untrusted (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, conv TEXT NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (user_id, conv))`);
    ready = true;
  }
  return d;
}
const okConv = (conv: string | undefined): conv is string => typeof conv === "string" && conv.length > 0 && conv.length <= 64;

/** Cuộc trò chuyện này đã từng đọc skill chưa kiểm chứng (lượt mới bắt đầu ở trạng thái hạ quyền). Không có mã cuộc trò chuyện: false. */
export function convUntrusted(uid: string, conv: string | undefined): boolean {
  if (!okConv(conv)) return false;
  return !!t().prepare("SELECT 1 FROM conv_untrusted WHERE user_id = ? AND conv = ?").get(uid, conv);
}
/** Ghi dấu cho cuộc trò chuyện (gọi lại nhiều lần không sao). Không có mã cuộc trò chuyện (lượt rời, việc nền không gắn chat): bỏ qua. */
export function markConvUntrusted(uid: string, conv: string | undefined): void {
  if (!okConv(conv)) return;
  t().prepare("INSERT OR IGNORE INTO conv_untrusted (user_id, conv, at) VALUES (?, ?, ?)").run(uid, conv, Date.now());
}
