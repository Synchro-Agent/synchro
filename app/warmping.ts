// Giữ sẵn tiến trình cho câu kế tiếp khi người dùng còn ở trang: tiến trình rảnh bị dọn sau 10 phút, còn /api/models (khởi động sẵn) chỉ chạy lúc đăng nhập và mở bộ chọn model,
// nên mở tab lâu rồi mới gõ thì câu đầu phải khởi động lại từ đầu (đo: 2,4 giây so với 1,1 giây). Máy chủ còn chặn thêm mỗi người một lần mỗi phút.
const EVERY_MS = 4 * 60_000;
export function startWarmPing() {
  let last = Date.now();
  const ping = () => {
    if (document.hidden || Date.now() - last < EVERY_MS) return;
    last = Date.now();
    fetch("/api/warm", { method: "POST" }).catch(() => {});
  };
  const on = ["focus", "keydown", "pointerdown"] as const;
  for (const e of on) window.addEventListener(e, ping, { passive: true });
  document.addEventListener("visibilitychange", ping);
  return () => { for (const e of on) window.removeEventListener(e, ping); document.removeEventListener("visibilitychange", ping); };
}
