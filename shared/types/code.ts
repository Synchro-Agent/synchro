// Cài đặt Synchro Code của từng người (server/codestore.ts lưu, ui/codesync.ts và ui/codeview.tsx đọc).
// Chỉ có kiểu (xóa khi biên dịch): mô-đun gốc xuất lại các kiểu này nên mã đang nhập từ đó không đổi.
import type { CodeStyle } from "../codestyle";

// Từ server/codestore.ts.
export type PermMode = "ask" | "edits" | "auto";
export type CookieMode = "keep" | "until-stop" | "session";
export type CodePrefs = {
  /** Tự phân loại phiên: cần bạn / chờ xem lại / xong. */
  classify: boolean;
  /** Đồng bộ phiên Code lên máy chủ để mở tiếp ở thiết bị khác. */
  sync: boolean;
  /** Cho phép chế độ "Tự động" (không hỏi trước khi sửa tệp hay chạy lệnh). */
  allowBypass: boolean;
  /** Chế độ quyền của phiên mới. */
  permMode: PermMode;
  /** Gợi ý câu nhắn tiếp theo sau mỗi câu trả lời. */
  suggest: boolean;
  /** Tự lưu trữ phiên không hoạt động sau số ngày này (0 = không bao giờ). */
  archiveAfter: number;
  /** Kiểu trả lời của phiên mới. */
  style: CodeStyle;
  /** Cookie và đăng nhập của trình duyệt Synchro. */
  cookies: CookieMode;
  /** Hỏi trước khi dùng trình duyệt trên trang chưa có trong danh sách cho phép. */
  siteAsk: boolean;
  sites: string[];
  blocked: string[];
  branchPrefix: string;
  autoPr: boolean;
  autoFix: boolean;
  autoArchivePr: boolean;
};
