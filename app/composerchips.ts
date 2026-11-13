// Dải thẻ đính kèm của ô soạn tin (tệp + chip skill đã chọn).
// Trước đây dải chỉ cuộn ngang: thẻ thứ 6 bị cắt, thứ 7 trở đi khuất hẳn mà không có dấu hiệu nào.
// Giờ dải một hàng chỉ hiện tối đa CHIP_LIMIT thẻ rồi một nút "+N"; bấm vào thì trải ra lưới nhiều hàng.
export const CHIP_LIMIT = 5;

/**
 * Số thẻ bị ẩn sau nút "+N" khi dải thẻ ở chế độ một hàng.
 * total = số tệp + số chip skill đã chọn (gọi chung là "mục").
 * expanded = true khi đã trải lưới (hiện hết, không còn "+N").
 * Trả về 0 khi vừa đủ chỗ (total ≤ limit) hoặc đã trải lưới.
 */
export function hiddenCards(total: number, expanded = false, limit: number = CHIP_LIMIT): number {
  if (expanded || total <= limit) return 0;
  return total - limit;
}
