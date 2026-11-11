// Bản dịch cho đăng nhập, bảo mật và vận hành: khóa truy cập, Turnstile, sao lưu liên tục, đo độ trễ từng chặng (bổ sung vào i18n-dict.ts và i18n-vi.ts).
export const AUTH_VI2EN: Record<string, string> = {
  // Khóa truy cập (passkeys.ts)
  "Yêu cầu khóa truy cập đã hết hạn hoặc đã được dùng. Hãy thử lại.": "This passkey request expired or was already used. Please try again.",
  "Mỗi tài khoản có tối đa 20 khóa truy cập. Hãy xóa bớt khóa không dùng nữa.": "Each account can have up to 20 passkeys. Remove ones you no longer use.",
  "Không thêm được khóa truy cập. Hãy thử lại.": "Couldn't add the passkey. Please try again.",
  "Khóa truy cập này đã được thêm.": "This passkey was already added.",
  "Không tìm thấy khóa truy cập này.": "We can't find this passkey.",
  "Hãy đặt tên cho khóa truy cập.": "Give the passkey a name.",
  "Không xác minh được khóa truy cập. Hãy thử lại.": "Couldn't verify the passkey. Please try again.",
  "Khóa truy cập này không đăng nhập được. Có thể khóa đã bị xóa khỏi tài khoản. Hãy dùng cách đăng nhập khác.": "This passkey can't sign in. It may have been removed from the account. Use another way to sign in.",
  "Máy chủ đang bận. Hãy thử lại sau ít phút.": "The server is busy. Try again in a few minutes.",
};
export const AUTH_EN2VI: Record<string, string> = {
  "Passkey": "Khóa truy cập", "Passkeys": "Khóa truy cập", "Security": "Bảo mật",
  "Added a passkey": "Đã thêm khóa truy cập", "Renamed a passkey": "Đã đổi tên khóa truy cập", "Removed a passkey": "Đã xóa khóa truy cập", "Couldn't add a passkey": "Không thêm được khóa truy cập",
  "Couldn't sign in with a passkey. Try another way.": "Không đăng nhập được bằng khóa truy cập. Hãy dùng cách khác.",
  "Sign in with a passkey": "Đăng nhập bằng khóa truy cập",
  "Passkey added": "Đã thêm khóa truy cập", "This device already has a passkey for your account": "Thiết bị này đã có khóa truy cập cho tài khoản của bạn",
  "Couldn't add the passkey": "Không thêm được khóa truy cập", "Passkey renamed": "Đã đổi tên khóa truy cập", "Remove this passkey?": "Xóa khóa truy cập này?",
  "You won't be able to sign in with it anymore. The copy saved on your device stays until you delete it there.": "Bạn sẽ không đăng nhập bằng khóa này được nữa. Bản lưu trên thiết bị vẫn còn cho tới khi bạn xóa ở đó.",
  "Passkey removed": "Đã xóa khóa truy cập",
  "Sign in with your fingerprint, face or device PIN instead of a password. Passkeys can't be phished or reused on another site.": "Đăng nhập bằng vân tay, khuôn mặt hoặc mã PIN của thiết bị thay cho mật khẩu. Khóa truy cập không bị lừa lấy mất và không dùng được ở trang khác.",
  "This browser can't create passkeys. Try a recent version of Chrome, Safari, Edge or Firefox.": "Trình duyệt này chưa tạo được khóa truy cập. Hãy dùng Chrome, Safari, Edge hoặc Firefox bản mới.",
  "Add passkey": "Thêm khóa truy cập", "Synced": "Đồng bộ", "Added": "Thêm lúc", "Last used": "Dùng lần cuối", "Not used yet": "Chưa dùng lần nào",
  "Rename": "Đổi tên", "Rename passkey": "Đổi tên khóa truy cập", "Use a name that tells you which device or password manager holds it.": "Đặt tên cho biết thiết bị hay trình quản lý mật khẩu nào đang giữ khóa này.",
  "Passkey name": "Tên khóa truy cập",
};
