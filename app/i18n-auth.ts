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
  // Turnstile, email dùng một lần (turnstile.ts)
  "Khóa site Turnstile không hợp lệ.": "The Turnstile site key isn't valid.",
  "Khóa bí mật Turnstile không hợp lệ.": "The Turnstile secret key isn't valid.",
  "Số lần sai phải từ 1 đến 20.": "The number of failed attempts must be between 1 and 20.",
  "Hãy hoàn tất bước kiểm tra bạn không phải máy rồi thử lại.": "Complete the human check, then try again.",
  "Synchro không nhận email dùng một lần. Hãy đăng ký bằng địa chỉ email bạn dùng thường xuyên.": "Synchro doesn't accept disposable email addresses. Sign up with an address you use regularly.",
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
  // Chống bot (botadmin.tsx, turnstilebox.tsx)
  "Changed bot protection keys": "Đã đổi khóa chống bot", "Turned on bot protection": "Đã bật chống bot", "Turned off bot protection": "Đã tắt chống bot", "Changed disposable email blocking": "Đã đổi chặn email dùng một lần",
  "Checking that you're human…": "Đang kiểm tra bạn không phải máy…",
  "Bot protection saved": "Đã lưu chống bot", "Bot protection turned off": "Đã tắt chống bot", "Bot protection (Cloudflare Turnstile)": "Chống bot (Cloudflare Turnstile)",
  "Free from Cloudflare. Asks for a quick human check when someone signs up, requests a password reset, or keeps entering the wrong password. Most people see nothing. In the Cloudflare dashboard, open Turnstile, add a widget for this domain in Managed or Invisible mode, then paste both keys here. Until both are saved, nothing changes.": "Miễn phí từ Cloudflare. Hỏi một bước kiểm tra nhanh khi có người đăng ký, xin đặt lại mật khẩu, hoặc nhập sai mật khẩu nhiều lần. Đa số người dùng không thấy gì. Trong trang quản lý Cloudflare, mở Turnstile, thêm widget cho tên miền này ở chế độ Managed hoặc Invisible, rồi dán cả hai khóa vào đây. Chưa lưu đủ hai khóa thì không gì thay đổi.",
  "Site key": "Khóa site", "Secret key": "Khóa bí mật", "Saved. Paste a new key to replace it.": "Đã lưu. Dán khóa mới để thay.",
  "Ask at sign-in after": "Hỏi khi đăng nhập sau", "Failed password attempts from one address within 15 minutes.": "Số lần nhập sai mật khẩu từ một địa chỉ trong 15 phút.",
  "Turn off and remove keys": "Tắt và xóa khóa", "Block disposable email addresses": "Chặn email dùng một lần",
  "Refuse sign-ups from throwaway inbox services (about 10,000 domains, public-domain list bundled with Synchro). Sign-in with Google, GitHub or Apple isn't affected.": "Từ chối đăng ký bằng hộp thư dùng một lần (khoảng 10.000 tên miền, danh sách công cộng đi kèm Synchro). Đăng nhập bằng Google, GitHub hoặc Apple không bị ảnh hưởng.",
  "Couldn't load the human check. Check your connection or turn off content blockers, then reload the page.": "Không tải được bước kiểm tra. Hãy kiểm tra mạng hoặc tắt trình chặn nội dung, rồi tải lại trang.",
};
