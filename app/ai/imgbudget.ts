// G4: mỗi lệnh tạo / sửa ảnh có ngân sách thời gian cho CHÍNH lời gọi công cụ (mặc định 90 giây). Quá ngân sách thì ảnh vẫn dựng tiếp ở chế độ nền,
// còn công cụ trả kết quả ngay để model dựng slide / artifact / sản phẩm luôn với ảnh giữ chỗ tại một địa chỉ ổn định. Khi ảnh dựng xong, byte thật được
// thay vào đúng địa chỉ đó (cùng id tệp đã tạo), nên không phải gọi lại generate_image; model chỉ cần báo người dùng một dòng.
// Thuần (không DB, không mạng): tests/api/imgbudget.test.mjs.

/** Ngân sách thời gian (ms) cho lời gọi generate_image trước khi chuyển sang chế độ nền. */
export const IMG_BUDGET_MS = () => Math.max(5_000, (Number(process.env.SYNCHRO_IMAGE_BUDGET_SEC) || 90) * 1000);

/** Kết quả công cụ khi quá ngân sách: bảo model dựng ngay với ảnh giữ chỗ, ảnh sẽ tự thay vào khi dựng xong; nhắc model báo người dùng đúng một dòng. */
export function placeholderNote(o: { urls: string[]; names: string[]; by: string }): string {
  const n = o.urls.length;
  const sec = Math.round(IMG_BUDGET_MS() / 1000);
  return `Ảnh đang được dựng ở chế độ nền bằng ${o.by} (quá ${sec} giây nên chưa trả ảnh ngay). Đừng chờ, đừng gọi lại generate_image.
Hãy dựng slide / artifact / sản phẩm ngay bây giờ với ${n === 1 ? "ảnh giữ chỗ" : `${n} ảnh giữ chỗ`} tại địa chỉ ${o.urls.join(", ")} — đặt đúng địa chỉ này vào src / url(...) của HTML, React, SVG, slide. Khi ảnh dựng xong, Synchro tự thay ảnh thật vào đúng các địa chỉ đó (cùng id), bạn không phải làm gì thêm.
run_code (Word, PowerPoint, PDF, video, ghép ảnh) đọc ảnh tại inputs/${o.names.join(", inputs/")} — nếu chạy ngay thì có thể vẫn là ảnh giữ chỗ cho tới khi ảnh dựng xong.
Nói với người dùng đúng MỘT dòng ngắn rằng ảnh đang được hoàn thiện và sẽ tự hiện khi xong, rồi tiếp tục làm phần còn lại.`;
}
