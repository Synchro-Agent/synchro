// Lượt dừng ngay sau câu báo "Mình sẽ…" mà chưa dùng công cụ nào (model đổi ý, CLI tự chặn công cụ, model chờ người dùng xác nhận…):
// người dùng chỉ thấy một câu rồi im lặng. Mọi đường chạy (chat và Synchro Code, khóa API lẫn gói subscription) nhắc model làm tiếp
// bằng công cụ, tối đa MAX_NUDGE lần trong một lượt.
import "server-only";
export const MAX_NUDGE = 2;

export const NUDGE = `<synchro_continue>
Bạn vừa báo sẽ làm nhưng chưa dùng công cụ nào và lượt đã dừng. Làm ngay bằng công cụ đang có (trình duyệt của Synchro hoặc Chrome của người dùng qua tiện ích, chạy code / lệnh, skill, connector…) cho tới khi xong; đừng chỉ báo sẽ làm. Chỉ hỏi người dùng khi thật sự cần điều chỉ họ biết (mật khẩu, mã OTP, lựa chọn của họ).
</synchro_continue>`;

/** CLI tự chặn công cụ của chính nó (Antigravity -p: tìm / đọc web, đọc tệp, chạy lệnh trên máy chủ): lượt dừng sớm. Nhắc model
 *  làm tiếp bằng công cụ được phép thay vì báo lỗi (tin nhắn nào cũng phải chạy được). */
export const DENIED_NUDGE = (names: string[]) => `<synchro_continue>
Công cụ ${names.join(", ")} của Antigravity bị chặn ở đây nên lượt vừa rồi dừng sớm. Đừng gọi lại công cụ đó. Làm tiếp ngay bằng công cụ của Synchro (tên bắt đầu bằng mcp_synchro_, hoặc gọi qua CallMcpTool): mở / đọc trang web bằng browser_navigate, browser_read, browser_text; chạy code, skill, connector… cho tới khi xong việc người dùng yêu cầu.
</synchro_continue>`;

// Câu báo việc sắp làm ở đầu câu trả lời: "Mình sẽ…", "Để mình mở…", "Tôi vào…", "Let me…", "I'll…".
const WHO = String.raw`(?:để\s+)?(?:mình|tôi|em|minh|toi)`;
const VERB = String.raw`(?:sẽ|đang|bắt đầu|tiến hành|vào|mở|tìm|xem|kiểm tra|thử|truy cập|làm|bấm|ấn|nhấn|đăng nhập|chạy|gõ|đọc|lấy|tra|điều khiển|thao tác|chuyển)`;
const SOON = String.raw`(?:sẽ|đang|xin|giờ|bây giờ|ngay|đi|cùng|thử)`;
const START = new RegExp(String.raw`^(?:(?:ok|okay|được|vâng|dạ|rồi|sure|alright)[,!.\s]+)?(?:${WHO}\s+(?:${SOON}\s+){0,2}${VERB}|let me|i'll|i will|i'm going to|i am going to)(?=[\s,.:…]|$)`, "iu");

/** Câu trả lời chỉ là lời báo sắp làm: một đoạn ngắn (tối đa hai câu), không hỏi lại người dùng. Lời dẫn kèm luôn kết quả
 *  ("Mình sẽ tìm trên web.\n\nTheo kết quả…") là câu trả lời thật, không nhắc. */
export function stalled(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 260 || /\n\s*\n/.test(t) || /[?？]\s*$/.test(t) || /```|<artifact|\|/.test(t)) return false;
  if (t.split(/(?<=[.!…])\s+/).filter(Boolean).length > 2) return false;
  return START.test(t);
}
