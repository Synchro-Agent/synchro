// Lần chạy lỗi của việc tự động trong Hộp thư (H4.3): lý do ngắn ngay trên dòng (không phải mở ra mới thấy) và nút "Chạy lại" trên dòng.
// Hàm thuần, dùng chung cho tasksui.tsx và kiểm thử tests/api/task-fail-row.test.mjs.
import { chatError, type ChatErr } from "./chaterror";

type Row = { run: string; task: string; status: string; at: number; kind?: "task" | "notice" | "action"; error?: string };

/** Lỗi thô của lần chạy → câu người dùng đọc được (cùng cách thẻ lỗi của chat) và lỗi thô để ở phần chi tiết. */
export const failInfo = (raw: string | undefined, foreign?: (s: string) => boolean): ChatErr => chatError(raw, foreign);

/** Một dòng lý do cho dòng Hộp thư: câu đầu của lời giải thích (đã dịch), tối đa max ký tự. */
export function failLine(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  const first = /^(.+?[.!?])(?:\s|$)/.exec(t)?.[1] ?? t;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** Dòng lỗi còn nên có nút "Chạy lại": việc tự động còn tồn tại, là lần chạy theo lịch (không phải việc đã duyệt hay thông báo),
 *  và chưa có lần chạy nào mới hơn của cùng việc (đã chạy lại, đang chạy hay lịch đã chạy tiếp thì nút trên dòng cũ thừa). */
export function canRerun(x: Row, items: Row[], taskExists: boolean): boolean {
  if (!taskExists || x.status !== "error" || x.kind === "notice" || x.kind === "action" || !x.task) return false;
  return !items.some((y) => y.task === x.task && y.run !== x.run && y.kind !== "action" && y.kind !== "notice" && y.at > x.at);
}
