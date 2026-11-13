// Tài khoản này còn cần xem phim giới thiệu không: tách khỏi introfilm.tsx (nặng) vì trang chính cần hỏi ngay lúc đăng nhập xong.
export const SEEN = (uid: string) => `synchro:intro-seen:${uid}`;

/** Tài khoản vừa tạo và chưa xem phim trên máy này: vừa điền hồ sơ lần đầu sau khi đăng nhập Google / GitHub / Apple, hoặc lần đăng nhập
 *  đầu sau khi đăng ký bằng email (đăng ký không còn tự đăng nhập, blueprint F2.4: người mới đăng nhập bằng mật khẩu vừa đặt, có khi sau
 *  khi mở thư xác minh nên cho 24 giờ). */
export function wantsIntro(u: { id: string; createdAt: number }, kind: string) {
  const age = Date.now() - u.createdAt;
  const fresh = kind === "signup" || (kind === "profile" && age < 2 * 3600_000) || (kind === "login" && age < 24 * 3600_000);
  try { return fresh && !localStorage.getItem(SEEN(u.id)); } catch { return fresh; }
}
