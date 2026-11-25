// Vòng quay chờ dùng chung cho mọi chỗ cần báo "đang tải / đang làm" (nút đang lưu, tải tệp, dòng công cụ, thẻ
// đang chạy…): một vòng tròn trung tính theo màu chữ xung quanh. Chỉ dòng trạng thái "đang trả lời / đang suy nghĩ"
// của đoạn chat dùng FluidDots (fluiddots.tsx); logo Synchro không còn được xoay làm vòng chờ ở bất cứ đâu.
// className: lớp cũ của chỗ đặt (wl-spin, art-spin sm…) chỉ còn quyết định cỡ và màu theo ngữ cảnh; hình và chuyển
// động là của .spinner.
export function Spinner({ className = "", size, label }: { className?: string; size?: number; label?: string }) {
  return (
    <span className={`spinner ${className}`.trim()} style={size ? { width: size, height: size } : undefined}
      role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
}
