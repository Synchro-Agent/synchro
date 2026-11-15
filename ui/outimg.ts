// Ảnh trong tin nhắn tải lỗi thì làm gì, theo kết quả hỏi lại máy chủ. Thuần dữ liệu để kiểm thử không cần trình duyệt.
// status null: không gọi được máy chủ. tries: số lần đã thử lại.
export const IMG_RETRIES = 2;
export function imgVerdict(status: number | null, tries: number): "gone" | "retry" | "fail" {
  if (status === 404 || status === 410) return "gone"; // Chỉ máy chủ nói không còn tệp mới được báo hết hạn.
  return tries < IMG_RETRIES ? "retry" : "fail";
}

/** Thẻ ảnh vừa tải được ảnh 1×1 (có thể là ảnh giữ chỗ của ảnh dựng nền, W23-2) rồi hỏi lại máy chủ (HEAD): làm gì tiếp.
 *  wait: còn đang dựng, hỏi lại sau; failed: dựng hỏng, thôi chờ; reload: ảnh thật đã thay vào, tải lại ảnh bằng địa chỉ mới (bỏ bản 1×1 trình duyệt đã giữ);
 *  real: chưa từng thấy "đang chờ" nên đây là ảnh 1×1 thật, không tải lại (tránh vòng lặp). */
export function genVerdict(h: { pending: boolean; failed: boolean }, sawPending: boolean): "wait" | "failed" | "reload" | "real" {
  if (h.failed) return "failed";
  if (h.pending) return "wait";
  return sawPending ? "reload" : "real";
}
