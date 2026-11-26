// Đọc bản chụp sơ đồ tổ chức của Orchestra từ sự kiện "orch" của lượt chạy (kiểu ở shared/orchestra.ts). Tách riêng
// để khung chat đọc được sự kiện mà không kéo nhãn vai / giai đoạn vào phần tải đầu.
import type { OrchState } from "./orchestra";

/** Đọc bản chụp từ sự kiện của lượt chạy (chuỗi JSON từ máy chủ); hỏng thì null. */
export function parseOrch(text: string): OrchState | null {
  try {
    const j = JSON.parse(text) as Partial<OrchState>;
    if (j?.v !== 1 || !Array.isArray(j.members) || !Array.isArray(j.tasks) || typeof j.phase !== "string") return null;
    return j as OrchState;
  } catch {
    // Sự kiện bị cắt hay hỏng giữa chừng: giữ bản chụp trước đó, không làm vỡ nhật ký của lượt.
    return null;
  }
}
