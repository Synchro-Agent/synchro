// Sơ đồ D2 (d2lang.com, MPL-2.0) dựng thành SVG trong sandbox run_code: tệp chạy d2 v0.9.0 ghim mã băm trong workspace/Dockerfile, không cài gì lên máy chủ Synchro.
// Chạy không mạng, tối đa 20 giây, bố cục elk (dagre, elk đi kèm D2 và mở; TALA là phần mềm thương mại nên không dùng). Kết quả nhớ theo mã băm của nguồn: vẽ lại cùng sơ đồ
// (tải lại trang, chia sẻ) không chạy lại sandbox. SVG hiện bằng <img> nên không chạy được mã nào trong đó.
import crypto from "node:crypto";
import { execRun, RunError, runner } from "./coderun";

export const D2_MAX = 20_000;
const SVG_MAX = 3 * 1048576;
const cache: Map<string, string> = ((globalThis as { __synchroD2?: Map<string, string> }).__synchroD2 ??= new Map());
const keyOf = (code: string, dark: boolean) => crypto.createHash("sha256").update(`${dark ? 1 : 0}\n${code}`).digest("hex");
export const cachedD2 = (code: string, dark: boolean) => cache.get(keyOf(code, dark)) ?? null;
// Chủ đề có sẵn của D2: 0 (Neutral default) cho nền sáng, 200 (Dark Mauve) cho nền tối.
export async function renderD2(uid: string, code: string, dark: boolean): Promise<{ svg: string } | { error: string }> {
  if (!code.trim()) return { error: "Sơ đồ trống." };
  if (code.length > D2_MAX) return { error: `Sơ đồ quá dài (tối đa ${D2_MAX} ký tự).` };
  if (/^\s*layout-engine\s*:\s*tala/m.test(code) || /\btala\b/.test(code.match(/vars\s*:\s*\{[\s\S]*?\}/)?.[0] ?? "")) return { error: "Bố cục TALA là phần mềm thương mại, Synchro dùng elk hoặc dagre." };
  const key = keyOf(code, dark);
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return { svg: hit }; }
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
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(svg)) return { error: "Kết quả không phải SVG." };
    cache.set(key, svg);
    while (cache.size > 200) cache.delete(cache.keys().next().value!);
    return { svg };
  } catch (e) {
    return { error: e instanceof RunError ? e.message : "Không vẽ được sơ đồ D2." };
  }
}
