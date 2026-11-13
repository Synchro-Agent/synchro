// Lỗi công cụ trong một lượt trả lời (worklog.tsx): model hay gọi lại công cụ sau một lần lỗi (sai tham số, trang chặn…) rồi vẫn trả lời đúng.
// Chỉ coi một lần lỗi là "đã thử lại" khi về SAU đó, trong CÙNG lượt, có một công cụ CÙNG tên kết thúc ok===true — tức đúng lần gọi lại đã bù lại lỗi đó.
// Lỗi không có lần gọi lại thành công như thế là lỗi CÒN LẠI (có thể đã ảnh hưởng tới kết quả) → tô đỏ "N lỗi", kể cả khi lượt kết thúc bình thường.
//   - còn lỗi khi lượt đã xong (hoặc lượt kết thúc bằng lỗi): "N lỗi", đỏ;
//   - còn lỗi nhưng đang chạy / bị dừng giữa chừng: "N lỗi", màu thường (model còn có thể gọi lại; chưa chắc ảnh hưởng kết quả);
//   - mọi lỗi đều đã được gọi lại thành công: "N bước đã thử lại", màu thường.
export type ToolErrNote = { text: string; tone: "bad" | "soft" };
// Một mục công cụ cần để xét lỗi: thứ tự (seq), nhãn/tên công cụ (label) và kết quả (ok === false là lỗi, true là xong, undefined là đang chạy).
export type ToolLike = { seq?: number; label: string; ok?: boolean };

/**
 * Tách lỗi của một lượt thành: còn lại (chưa được gọi lại thành công) và đã thử lại (có mục cùng tên, về sau, ok===true).
 * group: các mục của dòng đang xét; turn: toàn bộ mục công cụ của cả lượt, để tìm lần gọi lại ở dòng sau (mặc định = group).
 */
export function splitToolErrs(group: ToolLike[], turn: ToolLike[] = group): { remaining: number; recovered: number } {
  let remaining = 0, recovered = 0;
  for (const x of group) {
    if (x.ok !== false) continue;
    const retried = turn.some((y) => y !== x && (y.seq ?? 0) > (x.seq ?? 0) && y.label === x.label && y.ok === true);
    if (retried) recovered++; else remaining++;
  }
  return { remaining, recovered };
}

/** Chuỗi gốc tiếng Việt (nơi hiện tự gọi tr), null khi không có lỗi. Xét theo từng lỗi, không theo cả lượt. */
export function toolErrNote(group: ToolLike[], turn: ToolLike[], o: { live?: boolean; failed?: boolean; stopped?: boolean }): ToolErrNote | null {
  const { remaining, recovered } = splitToolErrs(group, turn);
  // Lỗi chưa được gọi lại thành công: đỏ khi lượt đã xong hoặc kết thúc bằng lỗi; đang chạy / bị dừng thì để màu thường (chưa chắc ảnh hưởng kết quả).
  if (remaining > 0) return { text: `${remaining} lỗi`, tone: (o.live || o.stopped) && !o.failed ? "soft" : "bad" };
  if (recovered > 0) return { text: `${recovered} bước đã thử lại`, tone: "soft" };
  return null;
}
