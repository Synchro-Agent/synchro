// Sơ đồ D2 (d2lang.com, MPL-2.0) dựng thành SVG trong sandbox run_code: tệp chạy d2 v0.9.0 ghim mã băm trong workspace/Dockerfile, không cài gì lên máy chủ Synchro.
// Chạy không mạng, tối đa 20 giây, bố cục elk (dagre, elk đi kèm D2 và mở; TALA là phần mềm thương mại nên không dùng). Kết quả nhớ theo mã băm của nguồn: vẽ lại cùng sơ đồ
// (tải lại trang, chia sẻ) không chạy lại sandbox. SVG hiện bằng <img> nên không chạy được mã nào trong đó.
// Bộ nhớ đệm có hai lớp: 200 sơ đồ gần nhất trong bộ nhớ (tối đa khoảng 48 MB: mỗi SVG tới 3 MB nên chỉ đếm số mục thì có thể giữ cả 600 MB), và mọi sơ đồ đã vẽ trên đĩa (DATA_DIR/d2-cache, theo mã băm), nên trang chia sẻ công khai
// vẫn hiện sơ đồ sau khi máy chủ khởi động lại hay sau khi người khác vẽ thêm nhiều sơ đồ.
import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./authstore";
import { execRun, RunError, runner } from "./coderun";
import { registerMemStat } from "./memstat";

export const D2_MAX = 20_000;
const SVG_MAX = 3 * 1048576, DISK_MAX = Number(process.env.SYNCHRO_D2_DISK_MAX) || 5000;
const cache: Map<string, string> = ((globalThis as { __synchroD2?: Map<string, string> }).__synchroD2 ??= new Map());
const keyOf = (code: string, dark: boolean) => crypto.createHash("sha256").update(`${dark ? 1 : 0}\n${code}`).digest("hex");
const diskDir = () => path.join(DATA_DIR, "d2-cache");
const isSvg = (s: string) => /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(s);
// Cỡ trong bộ nhớ ước tính 2 byte / ký tự (chuỗi có chữ tiếng Việt là UTF-16).
const MEM_BYTES = () => Number(process.env.SYNCHRO_D2_MEM_MB || 48) * 1048576;
export const d2CacheStats = () => { let bytes = 0; for (const v of cache.values()) bytes += v.length * 2; return { n: cache.size, bytes }; };
registerMemStat("d2Svgs", () => { const s = d2CacheStats(); return { n: s.n, MB: Math.round(s.bytes / 1048576) }; });
function remember(key: string, svg: string) {
  cache.delete(key); cache.set(key, svg);
  let bytes = d2CacheStats().bytes;
  // Bỏ mục cũ nhất tới khi đủ cả hai trần; luôn giữ mục vừa vẽ (nằm cuối) dù riêng nó đã lớn.
  while (cache.size > 1 && (cache.size > 200 || bytes > MEM_BYTES())) { const k = cache.keys().next().value!; bytes -= (cache.get(k)?.length ?? 0) * 2; cache.delete(k); }
}
function fromDisk(key: string): string | null {
  try {
    const svg = fs.readFileSync(path.join(diskDir(), `${key}.svg`), "utf8");
    if (!isSvg(svg)) return null;
    remember(key, svg);
    return svg;
  } catch { return null; }
}
let writes = 0;
function toDisk(key: string, svg: string) {
  try {
    const dir = diskDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.${key}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, svg, { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, `${key}.svg`));
    // Giữ tối đa DISK_MAX sơ đồ: thỉnh thoảng bỏ các tệp lâu không dùng nhất.
    if (++writes % 50 === 0) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".svg"));
      if (files.length > DISK_MAX) files.map((f) => ({ f, t: fs.statSync(path.join(dir, f)).atimeMs })).sort((a, b) => a.t - b.t).slice(0, files.length - DISK_MAX).forEach((x) => fs.rmSync(path.join(dir, x.f), { force: true }));
    }
  } catch (e) { console.warn("[d2] lưu đĩa", (e as Error).message); }
}
const lookup = (key: string) => cache.get(key) ?? fromDisk(key);
/** SVG đã vẽ của sơ đồ (bộ nhớ rồi đĩa). other: không có bản đúng chủ đề thì trả bản của chủ đề kia (người xem nền tối, chủ vẽ ở nền sáng). */
export function cachedD2(code: string, dark: boolean, other = false): string | null {
  return lookup(keyOf(code, dark)) ?? (other ? lookup(keyOf(code, !dark)) : null);
}
// Chủ đề có sẵn của D2: 0 (Neutral default) cho nền sáng, 200 (Dark Mauve) cho nền tối.
export async function renderD2(uid: string, code: string, dark: boolean): Promise<{ svg: string } | { error: string }> {
  if (!code.trim()) return { error: "Sơ đồ trống." };
  if (code.length > D2_MAX) return { error: `Sơ đồ quá dài (tối đa ${D2_MAX} ký tự).` };
  if (/^\s*layout-engine\s*:\s*tala/m.test(code) || /\btala\b/.test(code.match(/vars\s*:\s*\{[\s\S]*?\}/)?.[0] ?? "")) return { error: "Bố cục TALA là phần mềm thương mại, Synchro dùng elk hoặc dagre." };
  const key = keyOf(code, dark);
  const hit = lookup(key);
  if (hit) { remember(key, hit); return { svg: hit }; }
  if (!runner()) return { error: "Máy chủ chưa có nơi chạy code nên chưa vẽ được sơ đồ D2." };
  const bin = process.env.SYNCHRO_D2_BIN || "d2";
  try {
    const r = await execRun({ uid, files: [{ path: "in.d2", data: Buffer.from(code) }], argv: [bin, "--layout=elk", `--theme=${dark ? 200 : 0}`, "--pad=24", "in.d2", "outputs/so-do.svg"], net: false, timeout: 20 });
    const f = r.files.find((x) => x.path === "so-do.svg");
    if (r.exit !== 0 || !f) {
      // Bỏ đường dẫn thư mục chạy (không để lộ cấu trúc máy chủ) và tiền tố lặp: "err: failed to compile in.d2: /tmp/…/in.d2:1:6: …" → "dòng 1:6: …".
      const why = [...new Set((r.stderr || r.stdout).replace(/\x1b\[[0-9;]*m/g, "").replace(/\S*in\.d2:(\d+):(\d+):\s*/g, "\ndòng $1:$2: ").replace(/err:\s*(?:failed to compile in\.d2:\s*)?/gi, "\n")
        .split("\n").map((l) => l.trim()).filter((l) => l && !/^\d{4}-|^success/i.test(l)))].slice(0, 3).join("; ").slice(0, 300);
      return { error: r.timedOut ? "Vẽ sơ đồ quá 20 giây." : (r.exit === 127 || /(?:command|executable file) not found|execvp\(\)|ENOENT/i.test(r.stderr)) ? "Sandbox chưa có D2 (cần image workspace mới)." : why || "Không vẽ được sơ đồ D2." };
    }
    if (f.data.length > SVG_MAX) return { error: "Sơ đồ quá lớn." };
    const svg = f.data.toString("utf8");
    if (!isSvg(svg)) return { error: "Kết quả không phải SVG." };
    remember(key, svg);
    toDisk(key, svg);
    return { svg };
  } catch (e) {
    return { error: e instanceof RunError ? e.message : "Không vẽ được sơ đồ D2." };
  }
}
