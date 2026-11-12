// Giờ đặt lại hạn mức: một nguồn, một định dạng cho bảng Mức dùng (usageui.tsx), thẻ báo hết hạn mức dưới câu trả lời (page.tsx),
// hộp hỏi chuyển sang khóa API và ghi chú gói ở bộ chọn model, trang Providers. Trước đây bảng Mức dùng ghi "Đặt lại T5 12:15" còn thẻ
// lỗi ghi "Thu 09:55 PM" (mỗi nơi tự gọi toLocaleString với tùy chọn khác nhau). Giờ theo đồng hồ máy người dùng.
export type ResetLang = "vi" | "en";
const VI_DAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Thứ và giờ: "Thu 9:55 PM" / "T5 21:55". */
export function resetClock(t: number, lang: ResetLang): string {
  const d = new Date(t);
  return lang === "en"
    ? d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })
    : `${VI_DAYS[d.getDay()]} ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

/** Dưới 24 giờ: đếm ngược ("Resets in 3 hr 5 min" / "Đặt lại sau 3 giờ 5 phút"); xa hơn: thứ và giờ ("Resets Thu 9:55 PM" / "Đặt lại T5 21:55"). */
export function resetWhen(t: number, lang: ResetLang, now = Date.now()): string {
  const ms = t - now;
  if (ms < 24 * 3600_000) {
    const m = Math.max(1, Math.ceil(ms / 60_000)), h = Math.floor(m / 60), mm = m % 60;
    return lang === "en" ? `Resets in ${h ? `${h} hr ` : ""}${h && !mm ? "" : `${mm} min`}`.trim() : `Đặt lại sau ${h ? `${h} giờ ` : ""}${h && !mm ? "" : `${mm} phút`}`.trim();
  }
  return lang === "en" ? `Resets ${resetClock(t, lang)}` : `Đặt lại ${resetClock(t, lang)}`;
}
