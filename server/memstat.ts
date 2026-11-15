// Theo dõi bộ nhớ của máy chủ Next: máy chủ từng hết 2 GB heap sau ~56 giờ mà không ai thấy nó lớn dần. Mỗi 30 phút ghi một dòng [timing] mem
// vào nhật ký, giữ 48 mẫu gần nhất (24 giờ) cho Cài đặt → Sức khỏe hệ thống. Các bộ đệm lớn tự đăng ký số liệu của mình ở đây (không import ngược
// mô-đun nào, để route sức khỏe không kéo cả chatengine vào).
import "server-only";
import { getHeapStatistics } from "node:v8";
// Kiểu dùng chung với phía bên kia: shared/types/health.ts.
import type { MemSample } from "../shared/types/health";
export type { MemSample } from "../shared/types/health";
type Stat = () => Record<string, number>;
type Probe = () => Promise<Record<string, number>>;
const g = globalThis as unknown as { __synchroMemStats?: Map<string, Stat>; __synchroMemProbes?: Map<string, Probe>; __synchroMemHist?: MemSample[] };
const stats = (g.__synchroMemStats ??= new Map());
const probes = (g.__synchroMemProbes ??= new Map());
const hist = (g.__synchroMemHist ??= []);
const HIST = 48;
const mb = (n: number) => Math.round(n / 1048576);

/** Bộ đệm đăng ký số liệu của mình (số mục, số byte…), gọi một lần lúc nạp mô-đun. */
export const registerMemStat = (name: string, f: Stat) => { stats.set(name, f); };
/** Số liệu phải đo bất đồng bộ (vd. RSS cây tiến trình CLI qua ps, Blueprint G3.4): chỉ đo khi ghi dòng [timing] mem, chậm quá PROBE_MS thì bỏ. */
export const registerMemProbe = (name: string, f: Probe) => { probes.set(name, f); };
const PROBE_MS = 5000;
async function probeStats(): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  await Promise.all([...probes].map(async ([k, f]) => {
    let t: NodeJS.Timeout | undefined;
    try { const v = await Promise.race([f(), new Promise<null>((ok) => { t = setTimeout(() => ok(null), PROBE_MS); })]); if (v) out[k] = v; }
    catch { /* đo lỗi không làm mất cả dòng */ }
    finally { clearTimeout(t); }
  }));
  return out;
}
const fmt = (o: Record<string, Record<string, number>>) => Object.entries(o).map(([k, v]) => `${k}=${Object.entries(v).map(([a, b]) => `${a}:${b}`).join("/")}`).join(" ");
export function memNow(): MemSample {
  const m = process.memoryUsage();
  return { at: Date.now(), heapUsed: mb(m.heapUsed), heapTotal: mb(m.heapTotal), external: mb(m.external), arrayBuffers: mb(m.arrayBuffers), rss: mb(m.rss) };
}
export function cacheStats(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [k, f] of stats) try { out[k] = f(); } catch { /* bộ đệm lỗi không làm hỏng cả bảng */ }
  return out;
}
/** Dòng [timing] mem của một mẫu: số liệu bộ đệm (đồng bộ) rồi số liệu đo bất đồng bộ (cli=n:…/sumMB:…/maxMB:…). */
export async function memLine(s: MemSample): Promise<string> {
  const c = [fmt(cacheStats()), fmt(await probeStats())].filter(Boolean).join(" ");
  return `[timing] mem heapUsed=${s.heapUsed}MB heapTotal=${s.heapTotal}MB external=${s.external}MB arrayBuffers=${s.arrayBuffers}MB rss=${s.rss}MB${c ? ` ${c}` : ""}`;
}
/** Lấy một mẫu, ghi nhật ký (sau khi đo xong số liệu bất đồng bộ) và giữ trong lịch sử. */
export function sampleMem(log = true): MemSample {
  const s = memNow();
  hist.push(s);
  if (hist.length > HIST) hist.splice(0, hist.length - HIST);
  if (log) void memLine(s).then((l) => console.log(l), () => {});
  return s;
}
/** Số liệu cho trang sức khỏe: hiện tại, 48 mẫu gần nhất (mỗi 30 phút), bộ đệm. */
export const memReport = () => ({ now: memNow(), history: [...hist], caches: cacheStats(), heapLimit: mb(getHeapStatistics().heap_size_limit) });
