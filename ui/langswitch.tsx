"use client";
// Đổi ngôn ngữ ở các trang không có Cài đặt: đăng nhập, liên kết chia sẻ, đặt lại mật khẩu, trang pháp lý. Người nhận liên kết không phải chịu thứ tiếng họ không đọc được.
import { LANG_NAMES, tr, useLangReady, type Lang } from "../app/i18n";
import { usePref } from "./store";

export function LangSwitch({ inline }: { inline?: boolean }) {
  const [lang, setLang] = usePref<Lang>("uilang", "vi");
  const [, setVlang] = usePref("vlang", "Vietnamese");
  // Vẽ lại khi từ điển của ngôn ngữ mới về: nhãn trợ năng dịch bằng tr (khối có data-notr nên bộ dịch DOM không đụng tới).
  useLangReady();
  return (
    <div className={`auth-lang${inline ? " inline" : ""}`} role="group" aria-label={tr("Ngôn ngữ")} data-notr>
      {(["vi", "en"] as Lang[]).map((k) => <button key={k} type="button" className={lang === k ? "on" : ""} aria-pressed={lang === k} lang={k} onClick={() => { setLang(k); setVlang(k === "en" ? "English" : "Vietnamese"); }}>{LANG_NAMES[k]}</button>)}
    </div>
  );
}
