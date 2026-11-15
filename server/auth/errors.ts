// Lỗi của luồng tài khoản (trả về trang kèm mã HTTP). Tệp lá: mọi nơi dùng chung đúng một lớp nên instanceof AuthError luôn khớp.
import "server-only";

export class AuthError extends Error {
  /** extra: thêm vào JSON lỗi cho trang (vd. { captcha: true }: hiện ô kiểm tra Turnstile rồi gửi lại). */
  constructor(msg: string, public status = 400, public extra?: Record<string, unknown>) { super(msg); }
}
