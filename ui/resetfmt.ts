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

/**
 * Giờ đặt lại tuyệt đối: "Resets Thu 9:55 PM" / "Đặt lại T5 21:55". Không đếm ngược, nên không cũ đi — dùng chung cho bảng Mức dùng
 * và thẻ báo hết hạn mức dưới câu trả lời (MsgRow là memo(), không có đồng hồ, nên chuỗi đếm ngược tương đối sẽ cũ và lệch với bảng).
 */
// Giữ ngôn ngữ truyền vào thay cho tf: hàm thuần, không cần từ điển (kiểm thử chạy không cần trình duyệt, nạp được qua tests/lib/ts.mjs).
export function resetAt(t: number, lang: ResetLang): string {
  return lang === "en" ? `Resets ${resetClock(t, lang)}` : `Đặt lại ${resetClock(t, lang)}`;
}
