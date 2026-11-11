// Giờ máy chủ ở trình duyệt: đồng hồ giây của công cụ đang chạy và đồng hồ đếm ngược 429 (worklog.tsx) so với mốc giờ máy chủ ghi (RunEvent.at, until).
// Đồng hồ máy người dùng lệch (nhanh 15 giây…) thì trừ thẳng Date.now() sẽ ra số sai: công cụ vừa chạy đã hiện 15s và lời nhắn "dữ liệu lớn".
// Luồng theo dõi lượt chạy (/api/runs/<id>) gửi giờ máy chủ lúc mở và mỗi lần ping; ở đây giữ độ lệch đó. Chưa nhận được thì coi như không lệch.
let skew = 0;
/** Ghi nhận giờ máy chủ vừa nhận (ms). Độ trễ mạng làm giờ nhận được hơi cũ, nên lấy độ lệch lớn nhất trong vài lần gần nhất. */
const recent: number[] = [];
export function noteServerNow(ms: unknown) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return;
  recent.push(ms - Date.now());
  if (recent.length > 5) recent.shift();
  skew = Math.max(...recent);
}
/** Giờ hiện tại theo đồng hồ máy chủ (ms). */
export const serverNow = () => Date.now() + skew;
