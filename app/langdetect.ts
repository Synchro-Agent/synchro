// Ngôn ngữ giao diện lần đầu mở Synchro: theo ngôn ngữ của trình duyệt (tiếng Việt, còn lại tiếng Anh). Người đã dùng Synchro từ trước
// (đã có dữ liệu trong trình duyệt) mà chưa từng chọn ngôn ngữ thì giữ tiếng Việt như họ vẫn thấy. Chạy trong <head> trước khi vẽ (layout.tsx).
// Hàm viết bằng JavaScript thuần để chép nguyên vào thẻ <script>; kiểm thử ở tests/api/lang-detect.test.mjs.
export const firstLang = (keys: string[], nav: string): "vi" | "en" =>
  keys.some((k) => (k.indexOf("u:") === 0 && k.indexOf("u:anon:") !== 0) || k === "chats" || k === "theme" || k.indexOf("p:") === 0) || /^vi\b/i.test(nav || "") ? "vi" : "en";

/** fixed: ép một ngôn ngữ (máy thử nghiệm: Chrome ẩn của bộ kiểm thử luôn là en-US). */
export const langScript = (fixed?: string) => `try{var t=localStorage.getItem('theme')||'light';if(t==='auto')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;if(localStorage.getItem('signedIn'))document.documentElement.dataset.sess='1';var s=localStorage.getItem('p:uilang'),u;if(s===null){u=${fixed ? JSON.stringify(fixed) : `(${firstLang.toString().replace(/\s+/g, " ")})(Object.keys(localStorage),navigator.language)`};localStorage.setItem('p:uilang',JSON.stringify(u))}else u=JSON.parse(s);document.documentElement.lang=u==='en'?'en':'vi'}catch(e){}`;
