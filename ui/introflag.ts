// Tài khoản này còn cần xem phim giới thiệu không: tách khỏi introfilm.tsx (nặng) vì trang chính cần hỏi ngay lúc đăng nhập xong.
export const SEEN = (uid: string) => `synchro:intro-seen:${uid}`;

/** Tài khoản mới và chưa xem phim trên máy này: kind "signup" là lần đăng nhập đầu của tài khoản đăng ký bằng email (máy chủ báo firstLogin,
 *  auth.tsx: đăng ký không tự đăng nhập, blueprint F2.4, nên lần đầu có thể là hôm sau, khi người dùng mới mở thư xác minh), "profile" là vừa
 *  điền hồ sơ lần đầu sau khi đăng nhập Google / GitHub / Apple. Đăng nhập lại ("login") không phát, dù tài khoản tạo từ bao giờ. */
export function wantsIntro(u: { id: string; createdAt: number }, kind: string) {
  const fresh = kind === "signup" || (kind === "profile" && Date.now() - u.createdAt < 2 * 3600_000);
  try { return fresh && !localStorage.getItem(SEEN(u.id)); } catch { return fresh; }
}
/** Lần đăng nhập đầu của tài khoản (máy chủ báo firstLogin, dù đăng ký từ hôm nào) tính như vừa đăng ký: lời chào "Welcome to Synchro" và phim. */
export const firstKind = <K extends string>(kind: K, firstLogin: boolean | undefined): K | "signup" => (firstLogin && kind === "login" ? "signup" : kind);
