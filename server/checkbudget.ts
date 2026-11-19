// Ngân sách thời gian cho bước tự kiểm hiển thị của một lượt (check_artifact, kể cả lần Synchro tự kiểm bộ slide
// trước khi giao). Brief kiểu "xong thì tự kiểm từng trang" làm model chụp to từng slide một: bộ slide 8 trang còn
// chạy sau 9 phút. Tự kiểm có ích ở một hai vòng đầu; quá 2 phút thì giao bản hiện tại và nói rõ chỗ chưa kiểm được.
import "server-only";

export const SELF_CHECK_MS = 120_000;
export const SELF_CHECK_SPENT = `Đã dùng hết ${SELF_CHECK_MS / 60_000} phút tự kiểm hiển thị của lượt này nên không`
  + " kiểm tra thêm. Giao bản hiện tại cho người dùng; lỗi đã thấy mà chưa sửa được thì nói rõ là lỗi gì.";
const spent = new WeakMap<object, number>();

/** Thời gian tự kiểm đã dùng trong lượt (ms). */
export const checkSpent = (turn: object) => spent.get(turn) ?? 0;

/** Chạy một lần tự kiểm trong phần ngân sách còn lại của lượt `turn`. Hết ngân sách trước khi chạy, hoặc chạy quá
 *  phần còn lại (tín hiệu hủy truyền vào f), thì trả null; người dùng bấm Dừng (signal) thì trả đúng kết quả của f. */
export async function withinCheckBudget<T>(
  turn: object,
  signal: AbortSignal | undefined,
  f: (s: AbortSignal) => Promise<T>,
  budget = SELF_CHECK_MS,
): Promise<T | null> {
  const left = budget - checkSpent(turn);
  if (left <= 0) return null;
  const cap = AbortSignal.timeout(left), t0 = Date.now();
  try {
    const r = await f(signal ? AbortSignal.any([signal, cap]) : cap);
    return cap.aborted && !signal?.aborted ? null : r;
  } finally {
    spent.set(turn, checkSpent(turn) + Date.now() - t0);
  }
}
