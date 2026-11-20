// Đường nhanh (câu không cần công cụ, chat/routing.ts fastTurn): dấu model dùng để xin lượt đầy đủ, và cách nhận
// ra câu trả lời của đường nhanh cần chạy lại ở lượt đầy đủ. Tách khỏi prompt.ts để kiểm thử gọi thẳng được, không
// kéo theo cơ sở dữ liệu.
import "server-only";

export const NEED_TOOLS = "[[CAN_CONG_CU]]";
// Model nhanh ở nỗ lực thấp không phải lúc nào cũng làm theo FAST_RULES: lượt "Dùng connector Google Docs: tạo tài
// liệu…" từng nhận câu giải thích "mình không có công cụ…", hoặc vài câu rồi mới tới dấu NEED_TOOLS. Nhận cả hai kiểu
// để Synchro chạy lại lượt đầy đủ (một lần: lượt đầy đủ không đi đường nhanh nữa).
const ME = "(?<![\\p{L}\\p{N}])(?:mình|tôi|em)\\s+(?:hiện\\s+|hiện tại\\s+|ở đây\\s+)?";
const NO_TOOL_VI = new RegExp(`${ME}(?:không|chưa|ko)\\s+(?:có|được cấp|được kết nối|được trang bị|có quyền)`
  + "(?:\\s+\\p{L}+){0,3}\\s+(?:công cụ|connector|quyền truy cập|khả năng truy cập|truy cập|kết nối)", "iu");
const NO_TOOL_VI_ACT = new RegExp(`${ME}(?:không thể|chưa thể|không có khả năng)\\s+(?:trực tiếp\\s+)?`
  + "(?:tạo|truy cập|mở|gửi|đọc|kết nối|tìm trên|duyệt|thao tác|chạy|lấy|đăng|lưu)(?![\\p{L}\\p{N}])", "iu");
const NO_TOOL_EN = new RegExp("\\bI\\s+(?:currently\\s+)?(?:don't|do not|can't|cannot|am unable to|am not able to)"
  + "\\s+(?:have\\s+)?(?:directly\\s+)?(?:access|create|open|send|browse|connect|run|execute|search the|any tools?"
  + "|tools?|the ability)\\b", "i");
// Lời từ chối chỉ nói tới công cụ khi câu đó nhắc công cụ, connector, tài khoản hay một ứng dụng. Bản dịch, câu sửa
// ngữ pháp, thư người dùng nhờ viết hay có "Tôi không thể gửi hàng…", "I cannot access the building…": đó là câu
// trả lời đúng, chạy lại sẽ bỏ nó và tốn thêm một lượt đầy đủ của gói.
const TOOL_WORD = new RegExp("(?<![\\p{L}\\p{N}])(?:công cụ|connector|tài khoản|ứng dụng|trình duyệt|tool|tools"
  + "|account|browser|google\\s+\\p{L}+|drive|gmail|notion|slack|composio|mcp|internet|web)(?![\\p{L}\\p{N}])", "iu");
// Nội dung trong ngoặc kép và phần sau dấu hai chấm ("Bản dịch: …", "Câu đúng là: …") là thứ người dùng nhờ làm,
// không phải lời của model về chính nó.
const QUOTED = /"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|「[^」\n]*」/g;
const SORRY = /^(?:xin lỗi|rất tiếc|tiếc là|sorry|unfortunately|i'?m sorry)[\s\p{P}]*$/iu;
/** Câu đầu (bỏ câu xin lỗi đứng riêng) mà model nói bằng giọng của chính nó. */
function ownLead(t: string): string {
  const sents = t.split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const lead = sents.find((x) => !SORRY.test(x)) ?? "";
  return lead.replace(QUOTED, " ").split(":")[0];
}
/** Câu trả lời ở đường nhanh cho thấy lượt cần công cụ: dấu NEED_TOOLS ở bất cứ đâu, hoặc câu đầu là lời model nói
 *  nó không có công cụ / không truy cập được một ứng dụng. Câu trả lời dài đã là câu trả lời thật, không chạy lại. */
export function fastNeedsTools(text: string): boolean {
  const t = text.trim();
  if (t.includes(NEED_TOOLS)) return true;
  if (t.length > 1500) return false;
  const lead = ownLead(t);
  if (!TOOL_WORD.test(lead)) return false;
  return NO_TOOL_VI.test(lead) || NO_TOOL_VI_ACT.test(lead) || NO_TOOL_EN.test(lead);
}
/**
 * Bộ lọc chữ của đường nhanh: dấu NEED_TOOLS không bao giờ tới người dùng, dù model viết nó ở đầu hay sau vài câu.
 * Giữ lại khoảng trắng mở đầu và đuôi có thể là phần đầu của dấu ("[[CAN_") cho tới đoạn chữ sau. Câu đã hiện trước
 * dấu được deltaStep() xóa khi Synchro chạy lại lượt đầy đủ.
 */
export function holdNeedTools(out?: (t: string) => void) {
  let buf = "", started = false;
  return (t: string) => {
    buf = (buf + t).split(NEED_TOOLS).join("");
    let keep = 0;
    for (let n = Math.min(buf.length, NEED_TOOLS.length - 1); n > 0 && !keep; n--) {
      if (NEED_TOOLS.startsWith(buf.slice(-n))) keep = n;
    }
    const send = buf.slice(0, buf.length - keep);
    if (!started && !send.trim()) return;
    buf = buf.slice(buf.length - keep);
    if (!send) return;
    started = true;
    out?.(send);
  };
}
