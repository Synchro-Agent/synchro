// G4: mỗi lệnh tạo / sửa ảnh có ngân sách thời gian cho CHÍNH lời gọi công cụ (mặc định 90 giây). Quá ngân sách thì ảnh vẫn dựng tiếp ở chế độ nền,
// còn công cụ trả kết quả ngay để model dựng slide / artifact / sản phẩm luôn với ảnh giữ chỗ tại một địa chỉ ổn định. Khi ảnh dựng xong, byte thật được
// thay vào đúng địa chỉ đó (cùng id tệp đã tạo), nên không phải gọi lại generate_image; model chỉ cần báo người dùng một dòng.
// Thuần (không DB, không mạng): tests/api/imgbudget.test.mjs.

/** Ngân sách thời gian (ms) cho lời gọi generate_image trước khi chuyển sang chế độ nền. */
import "server-only";
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

/** Ảnh dựng nền đã có kết quả (W23-2): thay byte thật vào từng ảnh giữ chỗ theo thứ tự; ảnh nào không có byte (dựng hỏng, trả thiếu ảnh)
 *  hoặc không thay được thì đánh dấu hỏng. Trả về đúng MỘT dòng báo người dùng (blueprint G4.2 "khi ảnh về thì thay vào artifact và báo một dòng"). */
export function settleBackground<T>(o: { ids: string[]; names: string[]; files: T[] | null; replace: (id: string, data: T) => boolean; failed: (id: string) => void }): { ok: boolean; line: string; done: string[]; lost: string[] } {
  const done: string[] = [], lost: string[] = [];
  o.ids.forEach((id, i) => {
    const f = o.files?.[i];
    let put = false;
    if (f !== undefined) try { put = o.replace(id, f); } catch { put = false; }
    if (put) done.push(o.names[i] ?? id); else { o.failed(id); lost.push(o.names[i] ?? id); }
  });
  const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(", ")} +${xs.length - 3}` : xs.join(", "));
  const line = !lost.length ? `Ảnh ${list(done)} đã xong, đã thay vào artifact`
    : !done.length ? `Không dựng được ảnh ${list(lost)}, artifact vẫn giữ khung giữ chỗ`
    : `Ảnh ${list(done)} đã xong, đã thay vào artifact; không dựng được ${list(lost)}`;
  return { ok: !lost.length, line, done, lost };
}
