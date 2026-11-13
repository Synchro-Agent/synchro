// Chờ theo điều kiện thay cho chờ cố định (H2.3): chờ cố định (sleep 1,5 giây) rồi mới kiểm thì chậm khi máy nhanh và hụt khi máy chậm (CI).
// waitFor(cond, timeout) gọi cond lặp lại tới khi nó trả giá trị truthy (trả luôn giá trị đó) hoặc hết giờ (trả false, không ném lỗi:
// dòng ok(...) sau đó báo lỗi như cũ). cond có thể là hàm đồng bộ / async; cond ném lỗi được coi là "chưa được" (trang đang tải lại…).
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @template T
 * @param {() => T | Promise<T>} cond
 * @param {number} [timeout] ms, mặc định 10 giây
 * @param {{ every?: number }} [o] khoảng giữa hai lần thử (mặc định 100 ms)
 * @returns {Promise<T | false>}
 */
export async function waitFor(cond, timeout = 10_000, o = {}) {
  const every = o.every ?? 100, end = Date.now() + timeout;
  for (;;) {
    let v;
    try { v = await cond(); } catch { v = undefined; }
    if (v) return v;
    if (Date.now() >= end) return false;
    await sleep(Math.min(every, Math.max(0, end - Date.now())));
  }
}

/**
 * Chờ tới khi giá trị đứng yên: `read` trả cùng một kết quả (so bằng JSON) trong `quiet` ms liên tiếp. Dùng thay cho "chờ hoạt ảnh / bố cục xong"
 * trước khi đo vị trí hay chụp ảnh. Hết `timeout` thì trả giá trị cuối cùng đọc được.
 * @template T
 * @param {() => T | Promise<T>} read
 * @param {number} [quiet]
 * @param {number} [timeout]
 * @returns {Promise<T | undefined>}
 */
export async function settle(read, quiet = 300, timeout = 5_000) {
  const end = Date.now() + timeout;
  let last, lastKey, since = Date.now();
  for (;;) {
    let v;
    try { v = await read(); } catch { v = undefined; }
    const key = JSON.stringify(v);
    if (key !== lastKey) { lastKey = key; last = v; since = Date.now(); }
    else if (Date.now() - since >= quiet) return last;
    if (Date.now() >= end) return last;
    await sleep(50);
  }
}
