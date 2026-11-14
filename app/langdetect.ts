// Ngôn ngữ giao diện lần đầu mở Synchro: theo ngôn ngữ của trình duyệt (tiếng Việt, còn lại tiếng Anh). Người đã dùng Synchro từ trước
// (đã có dữ liệu trong trình duyệt) mà chưa từng chọn ngôn ngữ thì giữ tiếng Việt như họ vẫn thấy. Chạy trong <head> trước khi vẽ (layout.tsx).
// Hàm viết bằng JavaScript thuần để chép nguyên vào thẻ <script>; kiểm thử ở tests/api/lang-detect.test.mjs.
export const firstLang = (keys: string[], nav: string): "vi" | "en" =>
  keys.some((k) => (k.indexOf("u:") === 0 && k.indexOf("u:anon:") !== 0) || k === "chats" || k === "theme" || k.indexOf("p:") === 0) || /^vi\b/i.test(nav || "") ? "vi" : "en";

/** fixed: ép một ngôn ngữ (máy thử nghiệm: Chrome ẩn của bộ kiểm thử luôn là en-US).
 *  Chống nháy chữ gốc (Blueprint B6 bước 10): giao diện tiếng Anh ở trang không phải trang chủ (điều khoản, quyền riêng tư, xác minh, đặt lại
 *  mật khẩu, tải ứng dụng, app, chia sẻ, 404) dựng ở máy chủ bằng chữ tiếng Việt và chỉ dịch khi từ điển về. html[data-trwait] ẩn <body>
 *  (globals.css) tới lúc bộ dịch duyệt xong lần đầu (i18n.tsx); quá TRWAIT_MS mà chưa xong (hỏng mạng, lỗi tải mã) thì tự hiện lại.
 *  Trang chủ "/" không cần: Home giữ khung chờ không chữ tới khi từ điển về (useLangReady), ẩn <body> sẽ làm mất khung chờ đó. */
export const TRWAIT_MS = 2500;
/** Đường dẫn cần chờ bộ dịch khi giao diện là tiếng Anh. */
export const needsTrWait = (path: string) => path !== "/";
export const langScript = (fixed?: string) => `try{var t=localStorage.getItem('theme')||'light';if(t==='auto')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;if(localStorage.getItem('signedIn'))document.documentElement.dataset.sess='1';var s=localStorage.getItem('p:uilang'),u;if(s===null){u=${fixed ? JSON.stringify(fixed) : `(${firstLang.toString().replace(/\s+/g, " ")})(Object.keys(localStorage),navigator.language)`};localStorage.setItem('p:uilang',JSON.stringify(u))}else u=JSON.parse(s);document.documentElement.lang=u==='en'?'en':'vi';if(u==='en'&&(${needsTrWait.toString().replace(/\s+/g, " ")})(location.pathname)){document.documentElement.dataset.trwait='1';setTimeout(function(){delete document.documentElement.dataset.trwait},${TRWAIT_MS})}}catch(e){}`;
