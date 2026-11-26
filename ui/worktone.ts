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
// name: loại công cụ do máy chủ gửi kèm kết quả (chatengine.ts → kindOf: tên công cụ thật, Composio kèm ứng dụng · thao tác); ưu tiên hơn đoán từ nhãn.
export type ToolLike = { seq?: number; label: string; ok?: boolean; name?: string };

// Nhãn "<loại>: <tham số>" mà phần trước dấu ":" là loại công cụ cố định (chatengine.ts → describe, taskagent.ts).
// "gửi đề xuất vào hộp thư" là nhãn cũ của autopilot_propose: các bước đã lưu từ trước khi đổi tên vẫn gộp đúng loại.
const PARAM_HEADS = [
  "tìm trên web", "đọc trang web", "tạo ảnh", "nhớ lại", "ghi vào bộ não", "tìm công cụ connector", "chạy lệnh",
  "trình duyệt", "gửi đề xuất vào mục cần duyệt của autopilot", "gửi đề xuất vào hộp thư",
];
// Nhãn có tham số nhưng không có dấu ":" (nhãn bước trình duyệt, tệp dự án, skill…): phần đầu cố định là loại công cụ.
// Cụm dài đứng trước cụm ngắn cùng đầu ("mở thư viện" trước "mở", "đọc tài liệu của skill" trước "đọc").
const KIND_HEADS = [
  "đọc tài liệu của skill", "chạy script của skill", "đọc tệp dự án", "mở thư viện", "đọc ghi chú", "đọc skill", "chạy code",
  "đọc trang", "đọc tệp", "tải tệp", "rê chuột lên", "chờ trang", "mở", "bấm", "gõ", "nhấn", "chọn",
];
/**
 * Loại công cụ của một mục: tên/loại máy chủ gửi nếu có, không thì đoán từ nhãn (bản ghi cũ, bước tìm web của CLI).
 * Nhãn connector ("dùng Gmail · gửi thư", "Notion: Create page") và nhãn không nhận ra: cả nhãn là loại — thao tác khác của cùng ứng dụng
 * (tìm thư) thành công không được che lỗi của thao tác ghi (gửi thư). Gộp nhầm thì giấu lỗi thật, nên chỉ gộp các loại biết chắc.
 */
export function toolKind(t: ToolLike): string {
  if (t.name) return t.name;
  // Chữ trong ngoặc “…” là tham số ("tìm “giá” trên trang" và "tìm “vé” trên trang" cùng một loại).
  const lab = t.label.replace(/“[^”]*”/g, "…").replace(/\s+/g, " ").trim().toLowerCase();
  const colon = lab.indexOf(":");
  const pre = colon > 0 ? lab.slice(0, colon).trim() : "";
  if (pre && PARAM_HEADS.includes(pre)) return pre;
  if (lab.includes(" · ") || lab.startsWith("dùng ")) return lab;
  return KIND_HEADS.find((h) => lab === h || lab.startsWith(h + " ")) ?? lab;
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
