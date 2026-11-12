// Lỗi công cụ trong một lượt trả lời (worklog.tsx): model hay gọi lại công cụ sau một lần lỗi (sai tham số, trang chặn…) rồi vẫn trả lời đúng.
// Lỗi đã được thử lại như thế không phải "lỗi" của câu trả lời: chỉ tô đỏ khi lượt kết thúc bằng lỗi (lỗi ảnh hưởng tới kết quả cuối).
//   - lượt lỗi (failed): "N lỗi", đỏ;
//   - đang chạy, hoặc bị dừng giữa chừng: "N lỗi", màu thường (chưa biết có ảnh hưởng tới kết quả hay không);
//   - lượt xong bình thường: "N bước đã thử lại", màu thường.
export type ToolErrNote = { text: string; tone: "bad" | "soft" };

/** Chuỗi gốc tiếng Việt (nơi hiện tự gọi tr), null khi không có lỗi. */
export function toolErrNote(bad: number, o: { live?: boolean; failed?: boolean; stopped?: boolean }): ToolErrNote | null {
  if (!(bad > 0)) return null;
  if (o.failed) return { text: `${bad} lỗi`, tone: "bad" };
  if (o.live || o.stopped) return { text: `${bad} lỗi`, tone: "soft" };
  return { text: `${bad} bước đã thử lại`, tone: "soft" };
}
