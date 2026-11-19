// Ngân sách thời gian cho bước tự kiểm hiển thị của một lượt (check_artifact). Brief kiểu "xong thì tự kiểm từng
// trang" làm model chụp to từng slide một: bộ slide 8 trang còn chạy sau 9 phút. Phần lớn thời gian đó là của model
// (đọc ảnh, ghi nhận xét, viết bản sửa) giữa các lần gọi, nên ngân sách tính theo đồng hồ từ lần check_artifact đầu
// tiên của lượt chứ không cộng thời gian dựng ảnh. Tự kiểm có ích ở một hai vòng đầu; quá 2 phút thì giao bản hiện
// tại và nói rõ chỗ chưa kiểm được.
import "server-only";

export const SELF_CHECK_MS = 120_000;
export const SELF_CHECK_SPENT = `Đã dùng hết ${SELF_CHECK_MS / 60_000} phút tự kiểm hiển thị của lượt này nên không`
  + " kiểm tra thêm. Giao bản hiện tại cho người dùng; lỗi đã thấy mà chưa sửa được thì nói rõ là lỗi gì.";
// Lần Synchro tự đo bộ slide trước khi giao (artcheck.ts autoDeckCheck) có phần riêng, ngoài ngân sách của model:
// model dùng hết 2 phút để kiểm rồi sửa thì bản sửa cuối cùng vẫn phải được đo tràn khung trước khi tới người dùng.
export const AUTO_CHECK_MS = 30_000;
const started = new WeakMap<object, number>();

/** Thời gian đã trôi từ lần tự kiểm đầu tiên của lượt (ms); 0 khi lượt chưa tự kiểm lần nào. */
export const checkSpent = (turn: object) => {
  const t0 = started.get(turn);
  return t0 === undefined ? 0 : Date.now() - t0;
};

/** Chạy một lần tự kiểm trong phần ngân sách còn lại của lượt `turn`, tính từ lần tự kiểm đầu tiên. Hết ngân sách
 *  trước khi chạy, hoặc chạy quá phần còn lại (tín hiệu hủy truyền vào f), thì trả null; người dùng bấm Dừng
 *  (signal) thì trả đúng kết quả của f. */
export async function withinCheckBudget<T>(
  turn: object,
  signal: AbortSignal | undefined,
  f: (s: AbortSignal) => Promise<T>,
  budget = SELF_CHECK_MS,
): Promise<T | null> {
  if (!started.has(turn)) started.set(turn, Date.now());
  const left = budget - checkSpent(turn);
  if (left <= 0) return null;
  const cap = AbortSignal.timeout(left);
  const r = await f(signal ? AbortSignal.any([signal, cap]) : cap);
  return cap.aborted && !signal?.aborted ? null : r;
}

// Khóa riêng cho lần tự đo trước khi giao của mỗi lượt (không dùng chung khóa lượt với check_artifact của model).
const autoKeys = new WeakMap<object, object>();
/** Lần Synchro tự đo bộ slide trước khi giao: phần ngân sách riêng AUTO_CHECK_MS của lượt `turn`. */
export function withinAutoCheck<T>(turn: object, signal: AbortSignal | undefined, f: (s: AbortSignal) => Promise<T>) {
  let key = autoKeys.get(turn);
  if (!key) autoKeys.set(turn, (key = {}));
  return withinCheckBudget(key, signal, f, AUTO_CHECK_MS);
}
