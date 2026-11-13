// Lỗi công cụ trong một lượt trả lời (worklog.tsx): model hay gọi lại công cụ sau một lần lỗi (sai tham số, trang chặn…) rồi vẫn trả lời đúng.
// Chỉ coi một lần lỗi là "đã thử lại" khi về SAU đó, trong CÙNG lượt, có một lần gọi CÙNG LOẠI công cụ kết thúc ok===true — tức lần gọi lại đã bù
// lại lỗi đó. Cùng loại, không phải cùng nhãn: nhãn mang tham số ("tìm trên web: <câu>", "đọc trang web: <url>"), mà cách gọi lại hay gặp nhất là
// đổi tham số (sửa câu tìm, trang A bị chặn thì đọc trang B).
// Lỗi không có lần gọi lại thành công như thế là lỗi CÒN LẠI (có thể đã ảnh hưởng tới kết quả) → tô đỏ "N lỗi", kể cả khi lượt kết thúc bình thường.
//   - còn lỗi khi lượt đã xong (hoặc lượt kết thúc bằng lỗi): "N lỗi", đỏ;
//   - còn lỗi nhưng đang chạy / bị dừng giữa chừng: "N lỗi", màu thường (model còn có thể gọi lại; chưa chắc ảnh hưởng kết quả);
//   - mọi lỗi đều đã được gọi lại thành công: "N bước đã thử lại", màu thường.
export type ToolErrNote = { text: string; tone: "bad" | "soft" };
// Một mục công cụ cần để xét lỗi: thứ tự (seq), nhãn/tên công cụ (label) và kết quả (ok === false là lỗi, true là xong, undefined là đang chạy).
// name: tên công cụ khi nơi gọi có (ưu tiên hơn việc đoán loại từ nhãn).
export type ToolLike = { seq?: number; label: string; ok?: boolean; name?: string };

// Nhãn có tham số nhưng không có dấu ":" / " · " (nhãn bước trình duyệt, tệp dự án, skill…): phần đầu cố định là loại công cụ.
// Cụm dài đứng trước cụm ngắn cùng đầu ("mở thư viện" trước "mở", "đọc tài liệu của skill" trước "đọc").
const KIND_HEADS = [
  "đọc tài liệu của skill", "chạy script của skill", "đọc tệp dự án", "mở thư viện", "đọc ghi chú", "đọc skill", "chạy code", "dùng công cụ",
  "đọc trang web", "đọc trang", "đọc tệp", "tải tệp", "rê chuột lên", "chờ trang", "mở", "bấm", "gõ", "nhấn", "chọn",
];
/** Loại công cụ của một mục: tên công cụ nếu có, không thì phần nhãn trước tham số. */
export function toolKind(t: ToolLike): string {
  if (t.name) return t.name;
  // Chữ trong ngoặc “…” là tham số ("tìm “giá” trên trang" và "tìm “vé” trên trang" cùng một loại).
  const head = t.label.split(/:| · /)[0].replace(/“[^”]*”/g, "…").replace(/\s+/g, " ").trim().toLowerCase();
  return KIND_HEADS.find((h) => head === h || head.startsWith(h + " ")) ?? head;
}

/**
 * Tách lỗi của một lượt thành: còn lại (chưa được gọi lại thành công) và đã thử lại (có mục cùng loại công cụ, về sau, ok===true).
 * group: các mục của dòng đang xét; turn: toàn bộ mục công cụ của cả lượt, để tìm lần gọi lại ở dòng sau (mặc định = group).
 */
export function splitToolErrs(group: ToolLike[], turn: ToolLike[] = group): { remaining: number; recovered: number } {
  let remaining = 0, recovered = 0;
  for (const x of group) {
    if (x.ok !== false) continue;
    const kind = toolKind(x);
    const retried = turn.some((y) => y !== x && (y.seq ?? 0) > (x.seq ?? 0) && y.ok === true && toolKind(y) === kind);
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
