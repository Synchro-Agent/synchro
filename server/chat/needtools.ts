// Đường nhanh (câu không cần công cụ, chat/routing.ts fastTurn): dấu model dùng để xin lượt đầy đủ, và cách nhận
// ra câu trả lời của đường nhanh cần chạy lại ở lượt đầy đủ. Tách khỏi prompt.ts để kiểm thử gọi thẳng được, không
// kéo theo cơ sở dữ liệu.
import "server-only";

export const NEED_TOOLS = "[[CAN_CONG_CU]]";
// Model nhanh ở nỗ lực thấp không phải lúc nào cũng làm theo FAST_RULES: lượt "Dùng connector Google Docs: tạo tài
// liệu…" từng nhận câu giải thích "mình không có công cụ…", hoặc vài câu rồi mới tới dấu NEED_TOOLS, trong khi lượt
// chỉ chạy lại khi câu trả lời MỞ ĐẦU bằng dấu đó. Nhận cả hai kiểu để Synchro chạy lại lượt đầy đủ (một lần: lượt
// đầy đủ không đi đường nhanh nữa).
const ME = "(?<![\\p{L}\\p{N}])(?:mình|tôi|em)\\s+(?:hiện\\s+|hiện tại\\s+|ở đây\\s+)?";
const NO_TOOL_VI = new RegExp(`${ME}(?:không|chưa|ko)\\s+(?:có|được cấp|được kết nối|được trang bị|có quyền)`
  + "(?:\\s+\\p{L}+){0,3}\\s+(?:công cụ|connector|quyền truy cập|khả năng truy cập|truy cập|kết nối)", "iu");
const NO_TOOL_VI_ACT = new RegExp(`${ME}(?:không thể|chưa thể|không có khả năng)\\s+(?:trực tiếp\\s+)?`
  + "(?:tạo|truy cập|mở|gửi|đọc|kết nối|tìm trên|duyệt|thao tác|chạy|lấy|đăng|lưu)(?![\\p{L}\\p{N}])", "iu");
const NO_TOOL_EN = new RegExp("\\bI\\s+(?:currently\\s+)?(?:don't|do not|can't|cannot|am unable to|am not able to)"
  + "\\s+(?:have\\s+)?(?:directly\\s+)?(?:access|create|open|send|browse|connect|run|execute|search the|any tools?"
  + "|tools?|the ability)\\b", "i");
/** Câu trả lời ở đường nhanh cho thấy lượt cần công cụ: dấu NEED_TOOLS ở bất cứ đâu, hoặc model nói ngay đầu là
 *  không có công cụ / không truy cập được. Câu trả lời dài đã là câu trả lời thật, không chạy lại. */
export function fastNeedsTools(text: string): boolean {
  const t = text.trim();
  if (t.includes(NEED_TOOLS)) return true;
  if (t.length > 1500) return false;
  const head = t.slice(0, 600);
  return NO_TOOL_VI.test(head) || NO_TOOL_VI_ACT.test(head) || NO_TOOL_EN.test(head);
}
/** Giữ chữ đầu của đường nhanh tới khi chắc đó không phải NEED_TOOLS (dấu hiệu này không được hiện cho người dùng). */
export function holdNeedTools(out?: (t: string) => void) {
  let buf = "", open = false;
  return (t: string) => {
    if (open) {
      out?.(t);
      return;
    }
    buf += t;
    const s = buf.trimStart();
    if (NEED_TOOLS.startsWith(s) || s.startsWith(NEED_TOOLS)) return;
    open = true;
    out?.(buf);
  };
}
