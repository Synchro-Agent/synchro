"use client";

import { useEffect } from "react";
import { reportError } from "../ui/errorreport";

// Lỗi ở chính khung trang (layout): không có CSS và bộ dịch của app nên tự mang kiểu và tự chọn ngôn ngữ.
const CSS = `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EEECE5;color:#111210;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){body{background:#111210;color:#EEECE5}a{color:#EEECE5!important;box-shadow:inset 0 0 0 1px #5F6058!important}button{background:#EEECE5!important;color:#111210!important}}
main{max-width:440px;padding:32px;text-align:center}h1{font-size:20px;font-weight:600;margin:0 0 8px}p{margin:0 0 20px;color:inherit;opacity:.78}
button,a{display:inline-flex;align-items:center;height:36px;padding:0 16px;margin:0 4px;border-radius:999px;border:0;font:inherit;cursor:pointer;text-decoration:none}
button{background:#111210;color:#EEECE5}a{color:#111210;box-shadow:inset 0 0 0 1px #CFCCC1}`;

const isEn = () => {
  try {
    const s = localStorage.getItem("p:uilang");
    return s ? JSON.parse(s) === "en" : !/^vi\b/i.test(navigator.language || "");
  } catch { return false; }
};

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { console.error(error); reportError(error, "layout"); }, [error]);
  const en = isEn();
  return (
    <html lang={en ? "en" : "vi"}>
      <head><title>Synchro</title><style dangerouslySetInnerHTML={{ __html: CSS }} /></head>
      <body>
        <main role="alert">
          <h1>{en ? "Synchro hit an error" : "Synchro gặp lỗi"}</h1>
          <p>{en ? "Your chats and what you were typing are still here. Reload the page to continue." : "Đoạn chat và phần bạn đang gõ vẫn còn. Tải lại trang để dùng tiếp."}</p>
          <button onClick={() => location.reload()}>{en ? "Reload page" : "Tải lại trang"}</button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- global-error tự dựng <html>, router của Next không còn: chỉ tải lại toàn trang mới chắc chắn */}
          <a href="/">{en ? "New chat" : "Đoạn chat mới"}</a>
        </main>
      </body>
    </html>
  );
}
