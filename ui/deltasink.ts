// Chữ đang chảy về (lượt đang gửi và lượt nối lại sau khi tải lại trang): giữ mẩu mới nhất, vẽ tối đa mỗi khung hình và cách nhau
// ít nhất 45 ms (khoảng 20 lần mỗi giây): mắt không thấy khác, trang không phải dựng lại theo từng mẩu chữ. mine(): lần theo dõi còn hiệu lực.
// drop(): bỏ mẩu đang chờ (lời dẫn chuyển sang nhật ký làm việc, chữ bắt đầu lại từ đầu); pending(): mẩu chưa kịp vẽ.
// Lượt lỗi / dừng: nơi gọi đọc pending() TRƯỚC cancel() rồi dùng làm chữ dự phòng. Tab nền không chạy requestAnimationFrame nên có thể
// chưa vẽ mẩu nào: bỏ pending() là mất cả câu đã chảy về (thẻ lỗi trống). Tệp riêng để tests/api/deltasink.test.mjs nạp được.
export function deltaSink(mine: () => boolean, write: (t: string) => void) {
  let pend: string | null = null, raf = 0, lastPaint = 0;
  const flush = () => {
    raf = 0;
    if (pend === null || !mine()) return;
    const now = performance.now();
    if (now - lastPaint < 45) { raf = requestAnimationFrame(flush); return; }
    lastPaint = now;
    const t = pend;
    pend = null;
    write(t);
  };
  return {
    push: (t: string) => { pend = t; if (!raf) raf = requestAnimationFrame(flush); },
    drop: () => { pend = null; },
    pending: () => pend,
    cancel: () => { if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}
