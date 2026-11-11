// Theo dõi bộ nhớ của máy chủ Next: máy chủ từng hết 2 GB heap sau ~56 giờ mà không ai thấy nó lớn dần. Mỗi 30 phút ghi một dòng [timing] mem
// vào nhật ký, giữ 48 mẫu gần nhất (24 giờ) cho Cài đặt → Sức khỏe hệ thống. Các bộ đệm lớn tự đăng ký số liệu của mình ở đây (không import ngược
// mô-đun nào, để route sức khỏe không kéo cả chatengine vào).
import { getHeapStatistics } from "node:v8";
export type MemSample = { at: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; rss: number };
type Stat = () => Record<string, number>;
const g = globalThis as unknown as { __synchroMemStats?: Map<string, Stat>; __synchroMemHist?: MemSample[] };
const stats = (g.__synchroMemStats ??= new Map());
const hist = (g.__synchroMemHist ??= []);
const HIST = 48;
const mb = (n: number) => Math.round(n / 1048576);

/** Bộ đệm đăng ký số liệu của mình (số mục, số byte…), gọi một lần lúc nạp mô-đun. */
export const registerMemStat = (name: string, f: Stat) => { stats.set(name, f); };
export function memNow(): MemSample {
  const m = process.memoryUsage();
  return { at: Date.now(), heapUsed: mb(m.heapUsed), heapTotal: mb(m.heapTotal), external: mb(m.external), arrayBuffers: mb(m.arrayBuffers), rss: mb(m.rss) };
}
export function cacheStats(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [k, f] of stats) try { out[k] = f(); } catch { /* bộ đệm lỗi không làm hỏng cả bảng */ }
  return out;
}
/** Lấy một mẫu, ghi nhật ký và giữ trong lịch sử. */
export function sampleMem(log = true): MemSample {
  const s = memNow();
  hist.push(s);
  if (hist.length > HIST) hist.splice(0, hist.length - HIST);
  if (log) {
    const c = Object.entries(cacheStats()).map(([k, v]) => `${k}=${Object.entries(v).map(([a, b]) => `${a}:${b}`).join("/")}`).join(" ");
    console.log(`[timing] mem heapUsed=${s.heapUsed}MB heapTotal=${s.heapTotal}MB external=${s.external}MB arrayBuffers=${s.arrayBuffers}MB rss=${s.rss}MB${c ? ` ${c}` : ""}`);
  }
  return s;
}
/** Số liệu cho trang sức khỏe: hiện tại, 48 mẫu gần nhất (mỗi 30 phút), bộ đệm. */
export const memReport = () => ({ now: memNow(), history: [...hist], caches: cacheStats(), heapLimit: mb(getHeapStatistics().heap_size_limit) });
