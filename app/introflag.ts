// Tài khoản này còn cần xem phim giới thiệu không: tách khỏi introfilm.tsx (nặng) vì trang chính cần hỏi ngay lúc đăng nhập xong.
export const SEEN = (uid: string) => `synchro:intro-seen:${uid}`;

/** Tài khoản vừa tạo (đăng ký bằng email, hoặc vừa điền hồ sơ lần đầu sau khi đăng nhập Google / GitHub / Apple) và chưa xem phim trên máy này. */
export function wantsIntro(u: { id: string; createdAt: number }, kind: string) {
  const fresh = kind === "signup" || (kind === "profile" && Date.now() - u.createdAt < 2 * 3600_000);
  try { return fresh && !localStorage.getItem(SEEN(u.id)); } catch { return fresh; }
}
