// Ảnh trong tin nhắn tải lỗi thì làm gì, theo kết quả hỏi lại máy chủ. Thuần dữ liệu để kiểm thử không cần trình duyệt.
// status null: không gọi được máy chủ. tries: số lần đã thử lại.
export const IMG_RETRIES = 2;
export function imgVerdict(status: number | null, tries: number): "gone" | "retry" | "fail" {
  if (status === 404 || status === 410) return "gone"; // Chỉ máy chủ nói không còn tệp mới được báo hết hạn.
  return tries < IMG_RETRIES ? "retry" : "fail";
}
