// Tiến trình đọc tệp: tệp văn phòng, tệp nén, PDF và MarkItDown tốn CPU và bộ nhớ theo nội dung do người dùng quyết định.
// - Giới hạn số việc chạy cùng lúc trên cả máy chủ và theo từng người: một script gửi hàng loạt tệp không làm chậm người khác.
// - Chạy ưu tiên thấp, giới hạn bộ nhớ và thời gian; chết thì chỉ mất lần đọc đó. Biến môi trường (khóa bí mật) không truyền sang tiến trình con.
import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileError, MAX_FILES_PER_MESSAGE } from "../../shared/fileproc/types";

const MAX_RUN = Number(process.env.SYNCHRO_PARSE_MAX) || 2;
const MAX_WAIT = 30, MAX_USER = 4, WAIT_MS = Number(process.env.SYNCHRO_PARSE_WAIT_MS) || 90_000;
const HEAP_MB = Number(process.env.SYNCHRO_PARSE_HEAP_MB) || 1024;
const RUN_MS = Number(process.env.SYNCHRO_PARSE_MS) || 120_000;
const OUT_MAX = 128 * 1048576;
const BUSY = "Máy chủ đang đọc nhiều tệp cùng lúc. Hãy thử lại sau ít phút.";
// Một người gửi nhiều tệp cùng lúc (hai tệp ghi âm trong một tin nhắn, PDF scan nhiều trang): xếp hàng theo lượt của chính họ thay vì báo bận.
// Có giới hạn: số tệp chờ mỗi người và thời gian chờ; quá thì nói đúng lý do (tệp trước của họ còn đang đọc), không phải "máy chủ đang bận".
const USER_FULL = "Bạn đang có nhiều tệp chờ đọc cùng lúc. Synchro đọc lần lượt từng tệp; hãy gửi lại tệp này khi các tệp trước đọc xong.";
const USER_SLOW = "Các tệp trước của bạn đọc lâu quá nên tệp này chưa tới lượt. Hãy bấm Thử lại khi chúng đọc xong.";
// Người gửi đã bỏ tệp (gỡ thẻ tệp, đóng tab, trình duyệt hết giờ chờ): không đọc / chép lời tệp đó nữa (chép lời tốn credit giọng nói).
const GONE = "Đã hủy đọc tệp vì người gửi không còn chờ.";

// Giữ ở globalThis: mỗi route của Next có thể nạp module riêng, đếm riêng thì giới hạn không còn ý nghĩa.
// userQ: người đã dùng hết số việc chạy cùng lúc của mình thì chờ ở đây (theo thứ tự gửi); xong một việc thì chỗ đó chuyển thẳng cho người chờ đầu.
type Pool = { running: number; queue: (() => void)[]; perUser: Map<string, number>; userQ?: Map<string, (() => void)[]> };
const pools = ((globalThis as unknown as { __synchroParse?: Record<string, Pool> }).__synchroParse ??= {});
const poolOf = (name: string) => (pools[name] ??= { running: 0, queue: [], perUser: new Map() });
// userWait: số tệp chờ tối đa của một người; allWait: tổng số tệp đang chờ theo lượt riêng của mọi người trong hàng (mỗi tệp chờ giữ nguyên bộ
// nhớ của nó tới 30 MB, nên có trần chung: quá thì báo máy chủ bận như trước).
type Lim = { run: number; wait: number; user: number; userWait: number; allWait: number; waitMs: number };
const userWaiting = (p: Pool) => { let n = 0; for (const q of p.userQ?.values() ?? []) n += q.length; return n; };

/** Số việc đang chờ và đang chạy của một người trong một hàng (kiểm thử, theo dõi). */
export const slotState = (name: string, uid: string) => { const p = poolOf(name); return { running: p.perUser.get(uid) ?? 0, waiting: p.userQ?.get(uid)?.length ?? 0, global: p.running, globalWaiting: p.queue.length }; };

/** Chờ tới lượt rồi chạy fn. Hàng chung đầy hay chờ quá lâu thì báo bận; một người gửi nhiều hơn số việc chạy cùng lúc của mình thì chờ lượt của họ.
 *  lim.waitMs là tổng thời gian chờ (hàng riêng của người đó + hàng chung), không phải mỗi hàng một lần. signal: người gửi bỏ đi thì rời hàng ngay
 *  và không chạy fn. */
async function withSlot<T>(name: string, lim: Lim, uid: string | undefined, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const p = poolOf(name), who = uid ?? "", until = Date.now() + lim.waitMs;
  if (signal?.aborted) throw new FileError(GONE);
  if (p.queue.length >= lim.wait) throw new FileError(BUSY);
  // Chờ trong hàng q tới khi được gọi, hết giờ (lỗi slow) hoặc người gửi bỏ đi (GONE); cả hai trường hợp sau đều rời hàng.
  const wait = (q: (() => void)[], slow: string, onLeave?: () => void) => new Promise<void>((ok, no) => {
    const leave = (e: FileError) => { clearTimeout(t); signal?.removeEventListener("abort", gone); const i = q.indexOf(go); if (i >= 0) q.splice(i, 1); onLeave?.(); no(e); };
    const go = () => { clearTimeout(t); signal?.removeEventListener("abort", gone); ok(); };
    const gone = () => leave(new FileError(GONE));
    const t = setTimeout(() => leave(new FileError(slow)), Math.max(0, until - Date.now()));
    signal?.addEventListener("abort", gone, { once: true });
    q.push(go);
  });
  if (who && (p.perUser.get(who) ?? 0) >= lim.user) {
    const uq = ((p.userQ ??= new Map()).get(who) ?? []);
    if (uq.length >= lim.userWait) throw new FileError(USER_FULL);
    if (userWaiting(p) >= lim.allWait) throw new FileError(BUSY);
    p.userQ.set(who, uq);
    // Tới lượt thì chỗ của việc vừa xong được giao thẳng (perUser không giảm rồi tăng lại): không ai chen vào giữa.
    await wait(uq, USER_SLOW, () => { if (!uq.length && p.userQ?.get(who) === uq) p.userQ?.delete(who); });
  } else p.perUser.set(who, (p.perUser.get(who) ?? 0) + 1);
  try {
    if (p.running >= lim.run) {
      // Tệp vừa tới lượt riêng cũng không vượt trần hàng chung (lần kiểm ở đầu là trước khi chờ lượt riêng).
      if (p.queue.length >= lim.wait) throw new FileError(BUSY);
      await wait(p.queue, BUSY);
    }
    // Người gửi bỏ đi đúng lúc vừa tới lượt: nhường chỗ, không chạy (chép lời tốn credit).
    if (signal?.aborted) { p.queue.shift()?.(); throw new FileError(GONE); }
    p.running++;
    try { return await fn(); } finally { p.running--; p.queue.shift()?.(); }
  } finally {
    const uq = p.userQ?.get(who), next = uq?.shift();
    if (uq && !uq.length) p.userQ?.delete(who);
    if (next) next();
    else { const n = (p.perUser.get(who) ?? 1) - 1; if (n > 0) p.perUser.set(who, n); else p.perUser.delete(who); }
  }
}
export const withParseSlot = <T>(uid: string | undefined, fn: () => Promise<T>, signal?: AbortSignal) => withSlot("parse", { run: MAX_RUN, wait: MAX_WAIT, user: MAX_USER, userWait: MAX_FILES_PER_MESSAGE, allWait: MAX_WAIT, waitMs: WAIT_MS }, uid, fn, signal);
/** MarkItDown, OCR, Office cũ và chép lời chạy tới hàng chục phút: hàng riêng, mỗi người một việc chạy cùng lúc (các tệp sau của họ xếp hàng),
 *  để không chiếm chỗ của tệp đính kèm trong chat. Chờ tối đa WAIT_MS (90 giây, như trước: trình duyệt chỉ chờ tệp thường 2 phút); riêng tệp ghi âm /
 *  video (long, khung soạn chờ AV_TIMEOUT_MS = 16 phút) chờ tối đa CONVERT_WAIT_MS cho cả hai hàng, cộng một lần chép lời (tối đa ~5 phút) vẫn
 *  dưới 16 phút. */
export const CONVERT_WAIT_MS = Number(process.env.SYNCHRO_CONVERT_WAIT_MS) || 10 * 60_000;
const CONVERT_ALL_WAIT = Number(process.env.SYNCHRO_CONVERT_ALL_WAIT) || 24;
export const withConvertSlot = <T>(uid: string | undefined, fn: () => Promise<T>, o: { long?: boolean; signal?: AbortSignal } = {}) =>
  withSlot("convert", { run: Number(process.env.SYNCHRO_CONVERT_MAX) || 2, wait: 6, user: 1, userWait: MAX_FILES_PER_MESSAGE, allWait: CONVERT_ALL_WAIT, waitMs: o.long ? CONVERT_WAIT_MS : WAIT_MS }, uid, fn, o.signal);

/** Nhường CPU cho web và các lượt chat. Không đặt được cũng không sao. */
export function lowPriority(pid?: number) {
  try { if (pid) os.setPriority(pid, 10); } catch { /* không có quyền */ }
}

/** Môi trường tối thiểu cho tiến trình đọc tệp: không có khóa OAuth, WS_AGENT_SECRET hay đường dẫn dữ liệu. */
export const parserEnv = () => ({ PATH: process.env.PATH ?? "", LANG: process.env.LANG ?? "C.UTF-8", NODE_ENV: "production", HOME: os.tmpdir(), TMPDIR: os.tmpdir() } as NodeJS.ProcessEnv);

// Mô hình quyền của Node: tiến trình đọc tệp chỉ đọc được mã của chính nó, không ghi được đĩa, không mở được tiến trình con, kể cả khi thư viện có lỗi.
export function permArgs(root: string) {
  const flag = ["--permission", "--experimental-permission"].find((f) => process.allowedNodeEnvironmentFlags.has(f));
  if (!flag) return [];
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return p; } };
  // Cả đường dẫn thật lẫn đường dẫn qua liên kết: Node kiểm tra theo đường dẫn đang tra, node_modules có thể là liên kết.
  const dirs = [path.join(root, "scripts"), path.join(root, "node_modules"), real(path.join(root, "scripts")), real(path.join(root, "node_modules"))];
  return [flag, ...[...new Set(dirs)].map((d) => `--allow-fs-read=${d}${path.sep}*`), `--allow-fs-read=${path.join(root, "package.json")}`];
}

/** Đọc tệp trong tiến trình riêng (scripts/extract-worker.mjs), trả về chữ trích được. */
export function parseInWorker(kind: string, buf: Buffer, name: string, uid?: string) {
  return withParseSlot(uid, () => new Promise<string>((ok, no) => {
    const root = process.cwd();
    const child = spawn(process.execPath, [`--max-old-space-size=${HEAP_MB}`, ...permArgs(root), path.join(root, "scripts", "extract-worker.mjs"), kind, name.slice(0, 200)], { stdio: ["pipe", "pipe", "ignore"], env: parserEnv() });
    lowPriority(child.pid);
    const out: Buffer[] = [];
    let size = 0, overflow = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_MS);
    const tooHard = () => new FileError(`"${name}" quá lớn hoặc quá phức tạp để đọc. Hãy chia nhỏ tệp rồi tải lên lại.`);
    child.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > OUT_MAX) { overflow = true; child.kill("SIGKILL"); return; }
      out.push(c);
    });
    child.stdin.on("error", () => { /* tiến trình đã dừng trước khi đọc hết: kết quả xử lý ở close */ });
    child.on("error", (e) => { clearTimeout(timer); console.error("[fileproc] không mở được tiến trình đọc tệp", e); no(new FileError(`Không xử lý được "${name}". Hãy thử lại.`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let r: { text?: string; error?: string } | null = null;
      try { r = !overflow && code === 0 ? JSON.parse(Buffer.concat(out).toString("utf8")) : null; } catch { /* kết quả dở dang */ }
      if (!r) return no(tooHard());
      if (typeof r.text === "string") return ok(r.text);
      no(r.error === "too_big" ? new FileError(`"${name}" giải nén ra quá lớn (trên 200 MB) nên Synchro không đọc. Hãy chia nhỏ tệp rồi tải lên lại.`) : new FileError(`"${name}" bị hỏng hoặc không đúng định dạng, không mở được.`));
    });
    child.stdin.end(buf);
  }));
}
