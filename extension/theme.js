// Tài liệu ẩn (chrome.offscreen, lý do MATCH_MEDIA): service worker không đọc được theme sáng / tối của trình duyệt,
// trang này đọc rồi báo về để background.js đổi logo Synchro trên thanh công cụ cho hợp theme.
// Trang ẩn không vẽ nên có lúc không nhận sự kiện "change" của matchMedia: hỏi lại mỗi 2 giây (chỉ báo khi theme đổi).
const q = matchMedia("(prefers-color-scheme: dark)");
let last = null;
const tell = () => {
  if (q.matches === last) return;
  last = q.matches;
  chrome.runtime.sendMessage({ op: "theme", dark: q.matches }).catch(() => { last = null; });
};
q.addEventListener("change", tell);
setInterval(tell, 2000);
tell();
