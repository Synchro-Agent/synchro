// Tự nâng cấp khi tìm / đọc web (blueprint D2): trang dựng bằng JavaScript phía client thường trả về rất ít chữ, hoặc chỉ một màn
// "đang cập nhật" / "enable JavaScript" / "loading" / "just a moment" khi lấy nhanh (fetch hay tóm tắt tìm kiếm). Khi đó Synchro nên
// MỞ LẠI trang trong trình duyệt của workspace (browser_navigate → browser_wait → browser_text) để đọc DOM đã dựng, thay vì trả lời "không chắc".
// Hàm thuần, không phụ thuộc máy chủ: dùng được cả ở nơi lấy trang (browsertools, searchWeb) lẫn trong kiểm thử.

// Màn chặn / chưa dựng xong hay gặp: chỉ xét khi phần chữ còn ngắn (dưới ngưỡng) để không nhầm một bài dài có lỡ chứa chữ "loading".
const STALL = /đang cập nhật|đang tải|vui lòng (?:chờ|đợi|bật javascript)|hãy bật javascript|enable javascript|javascript is (?:required|disabled)|please enable javascript|just a moment|checking your browser|one moment|loading\.{0,3}/i;
/** Ngưỡng chữ: dưới mức này coi là "mỏng". Màn chặn chỉ tính khi tổng chữ cũng còn ngắn (tránh báo nhầm bài dài). */
export const THIN_CHARS = 500;
const STALL_MAX = 2000;

/** Nội dung lấy về có quá mỏng hoặc là màn chưa dựng xong / chặn JavaScript không: nếu có thì nên mở trang trong trình duyệt và đọc DOM đã dựng. */
export function needsRenderEscalation(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (t.length < THIN_CHARS) return true;
  return t.length < STALL_MAX && STALL.test(t);
}

/** Lời nhắc để model tự mở lại trang và đọc DOM đã dựng (gắn vào kết quả lấy web khi nội dung mỏng). */
export const RENDER_ESCALATION_HINT =
  "Nội dung lấy được quá mỏng hoặc trang còn \"đang tải\" / cần bật JavaScript. Hãy mở trang này trong trình duyệt của Synchro " +
  "(browser_navigate → browser_wait → browser_text) để đọc DOM đã dựng; với số liệu trong ngày (tỷ giá, giá, kết quả), ưu tiên trang chính thức; " +
  "nếu vẫn chưa có con số, thử thêm một nguồn nữa trước khi trả lời \"không chắc\".";
