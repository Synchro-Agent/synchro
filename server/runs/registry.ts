// Bản đồ lượt sống duy nhất của tiến trình (RunService): lượt chat / tác vụ (kho SQLite, khóa là mã lượt "run_…") và lượt Code
// (kho bộ nhớ, khóa "agent:<uid>:<sid>") nằm chung một Map. Toàn cục để sống qua lần nạp lại module khi phát triển và để mọi gói route
// của Next thấy cùng một bản đồ. Mỗi kho đọc qua một StoreView chỉ thấy lượt của mình, nên mã cũ dùng Map vẫn chạy như trước.
import "server-only";

export type Store = "sqlite" | "memory";
type Tagged = { store: Store };
const g = globalThis as unknown as { __synchroRuns?: Map<string, Tagged> };
const all = (g.__synchroRuns ??= new Map<string, Tagged>());

/** Phần của bản đồ chung thuộc một kho. Giống Map (get / has / set / delete / size / duyệt) nhưng chỉ thấy lượt của kho đó. */
export class StoreView<T extends Tagged> {
  constructor(readonly store: T["store"]) {}
  get(k: string): T | undefined { const v = all.get(k); return v && v.store === this.store ? (v as T) : undefined; }
  has(k: string) { return this.get(k) !== undefined; }
  set(k: string, v: T) { all.set(k, v); return this; }
  delete(k: string) { return this.has(k) && all.delete(k); }
  *entries(): IterableIterator<[string, T]> { for (const [k, v] of all) if (v.store === this.store) yield [k, v as T]; }
  *keys(): IterableIterator<string> { for (const [k] of this.entries()) yield k; }
  *values(): IterableIterator<T> { for (const [, v] of this.entries()) yield v; }
  [Symbol.iterator]() { return this.entries(); }
  get size() { let n = 0; for (const v of all.values()) if (v.store === this.store) n++; return n; }
}

// Lượt chat / tác vụ rời bản đồ ngay khi xong; lượt Code ở lại tới hết hạn giữ (để trình duyệt nối lại) nên chỉ tính khi chưa xong
// và chưa bấm Dừng (CLI đang thoát sau nút Dừng không giữ việc tắt êm).
type MemoryLike = Tagged & { ended?: number; ac?: AbortController };
const isActive = (v: Tagged) => v.store === "sqlite" || (!(v as MemoryLike).ended && !(v as MemoryLike).ac?.signal.aborted);
/** Số lượt đang chạy trong tiến trình này (một kho, hoặc cả hai). Tắt êm chờ số này về 0. */
export function activeCount(store?: Store): number {
  let n = 0;
  for (const v of all.values()) if ((!store || v.store === store) && isActive(v)) n++;
  return n;
}
