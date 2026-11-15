// Lỗi đăng nhập qua Google / GitHub / Apple. URL chỉ mang mã, trang đăng nhập tự tra câu cố định: nếu hiện nguyên chữ trên URL,
// ai cũng tạo được đường dẫn khiến trang thật của Synchro hiện "Tài khoản bị khóa, hãy gọi số này".
const AUTH_ERRORS: Record<string, string> = {
  cancelled: "Bạn đã hủy đăng nhập.",
  expired: "Phiên đăng nhập đã hết hạn. Vui lòng thử lại.",
  provider: "Nhà cung cấp đăng nhập báo lỗi. Vui lòng thử lại.",
  verify: "Không xác thực được với nhà cung cấp đăng nhập. Vui lòng thử lại.",
  apple: "Phản hồi từ Apple không hợp lệ.",
  unverified: "Tài khoản này chưa có email đã xác minh, không thể dùng để đăng nhập.",
  closed: "Synchro hiện tạm ngừng nhận đăng ký mới.",
  locked: "Tài khoản này đã bị khóa. Hãy liên hệ quản trị viên.",
  unsupported: "Không hỗ trợ cách đăng nhập này.",
  setup: "Cách đăng nhập này chưa được cấu hình trên máy chủ.",
  failed: "Lỗi máy chủ. Vui lòng thử lại.",
};
/** Máy chủ: câu lỗi thành mã đưa lên URL. */
export function authErrorCode(msg: string) {
  if (/chưa được cấu hình/.test(msg)) return "setup";
  return Object.keys(AUTH_ERRORS).find((k) => AUTH_ERRORS[k] === msg) ?? "failed";
}
/** Trang đăng nhập: mã thành câu cố định; mã lạ (đường dẫn bị sửa, chữ tự do) chỉ ra câu chung. */
export const authErrorText = (code: string) => (Object.prototype.hasOwnProperty.call(AUTH_ERRORS, code) ? AUTH_ERRORS[code] : AUTH_ERRORS.failed);
