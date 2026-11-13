// Tầng chạy CLI chính chủ (ADR 0001): thư mục nhà riêng của engine, cài đặt, tìm, và chạy tiến trình con an toàn.
// - Thư mục nhà: SYNCHRO_ENGINE_HOME, mặc định <DATA_DIR>/engine. CLI nằm trong <home>/.local/bin và chỉ nhận CLI ở đó.
// - Biến môi trường lọc theo danh sách cho phép (không lọt khóa API, DATA_KEY… của Synchro sang CLI).
// - Mỗi tiến trình là một process group riêng: bấm Dừng, CLI im lặng quá lâu (treo) hoặc chạm mức trần của lượt thì kill cả nhóm.
// - SYNCHRO_ENGINE_USER: chạy CLI bằng user hệ thống riêng qua `sudo -n -u` (xem scripts/setup-engine-user.sh).
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { registerMemProbe } from "../memstat";

export type Cli = "claude" | "codex" | "agy" | "grok";
export const CLIS: Cli[] = ["claude", "codex", "agy", "grok"];
// Lượt làm việc dài (dựng cả bộ nhận diện, sửa nhiều tệp) chạy tới khi xong: chỉ dừng khi CLI im lặng IDLE_MS (không in gì, không gọi công cụ
// của Synchro — có thể đã treo; một công cụ được chờ tới 30 phút) hoặc chạm mức trần MAX_TURN_MS. Đổi bằng SYNCHRO_TURN_MAX_MIN / SYNCHRO_TURN_IDLE_MIN.
const envMin = (k: string, d: number) => { const n = Number(process.env[k]); return (Number.isFinite(n) && n > 0 ? n : d) * 60_000; };
export const MAX_TURN_MS = envMin("SYNCHRO_TURN_MAX_MIN", 180);
export const IDLE_MS = envMin("SYNCHRO_TURN_IDLE_MIN", 40);

export const engineHome = () => path.resolve(process.env.SYNCHRO_ENGINE_HOME ?? path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "engine"));
export const binDir = () => path.join(engineHome(), ".local", "bin");
// Lệnh "mở trình duyệt" giả (open, xdg-open…): CLI trên máy chủ không được tự mở trình duyệt; link đăng nhập đọc từ đầu ra và hiện trên giao diện.
const noBrowserDir = () => path.join(engineHome(), ".local", "nobrowser");
const BROWSER_CMDS = ["open", "xdg-open", "x-www-browser", "www-browser", "sensible-browser", "gio", "wslview"];
function ensureNoBrowser() {
  const d = noBrowserDir();
  if (fs.existsSync(path.join(d, "xdg-open"))) return;
  // Có user hệ thống riêng thì scripts/setup-engine-user.sh đã tạo sẵn (Synchro không ghi được vào thư mục nhà engine).
  try {
    fs.mkdirSync(d, { recursive: true });
    for (const b of BROWSER_CMDS) fs.writeFileSync(path.join(d, b), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  } catch {}
}

// ---------------------------------------------------------------- thư mục trong nhà engine
const engineUser = () => process.env.SYNCHRO_ENGINE_USER || "";
const execFileP = promisify(execFile);
const sudoArgs = (u: string, cmd: string, args: string[]) => ["-n", "-u", u, "--", "env", "-i", "PATH=/usr/bin:/bin", cmd, ...args];
/**
 * Chạy lệnh hệ thống ngắn mà không chặn vòng sự kiện (trước đây spawnSync("sudo", …): mỗi lần chờ sudo là cả máy chủ đứng).
 * Giữ đúng như spawnSync: stdin là input (hoặc đóng ngay), ok khi mã thoát 0; err là stderr, không có thì lỗi khởi chạy (ENOENT…), mã thoát khác 0
 * mà không in gì thì rỗng.
 */
async function runCmd(cmd: string, args: string[], input?: Buffer): Promise<{ ok: boolean; stdout: string; err: string }> {
  const p = execFileP(cmd, args, { encoding: "utf8" });
  const stdin = p.child.stdin;
  // Tiến trình thoát trước khi đọc hết input (EPIPE): lỗi nằm ở mã thoát, không để lỗi luồng làm sập máy chủ.
  if (stdin) { stdin.on("error", () => {}); stdin.end(input); }
  try { const r = await p; return { ok: true, stdout: r.stdout, err: r.stderr }; }
  catch (e) {
    const x = e as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    return { ok: false, stdout: x.stdout ?? "", err: x.stderr || (typeof x.code === "number" ? "" : x.message ?? "") };
  }
}
/** Chạy lệnh hệ thống ngắn bằng user của engine (khi có), để thư mục engine luôn thuộc về user đó. */
async function asEngine(cmd: string, args: string[]): Promise<void> {
  const u = engineUser();
  const r = u ? await runCmd("sudo", sudoArgs(u, cmd, args)) : await runCmd(cmd, args);
  if (!r.ok) throw new Error(`Không ${cmd === "mkdir" ? "tạo" : "xóa"} được thư mục của engine: ${r.err.trim().slice(0, 200)}`);
}
/** Mọi con cháu của root trong danh sách "pid ppid [...]" của ps. */
export function treeOf(listing: string, root: number): number[] {
  const kids = new Map<number, number[]>();
  for (const l of listing.split("\n")) {
    const [p, pp] = l.trim().split(/\s+/).map(Number);
    if (p && pp) { const k = kids.get(pp) ?? []; k.push(p); kids.set(pp, k); }
  }
  const out: number[] = [], stack = [root];
  while (stack.length) for (const k of kids.get(stack.pop()!) ?? []) { out.push(k); stack.push(k); }
  return out;
}
/** Mọi tiến trình con cháu của một tiến trình (đọc cây tiến trình qua ps, bất đồng bộ: không chặn vòng sự kiện lúc bấm Dừng). */
export async function descendants(root: number): Promise<number[]> {
  return treeOf((await runCmd("ps", ["-A", "-o", "pid=,ppid="])).stdout, root);
}

// CLI đang chạy (gốc mỗi cây tiến trình): đo RSS thật cho dòng [timing] mem (Blueprint G3.4) để đặt lại ngân sách 400 MB / lượt ở turngate.
const liveClis = new Set<number>();
export type CliRss = { n: number; sumMB: number; maxMB: number };
/** RSS (MB) theo cây tiến trình của từng CLI trong danh sách "pid ppid rss(KB)" của ps: số cây còn sống, tổng và cây lớn nhất. */
export function treeRss(listing: string, roots: number[]): CliRss {
  const rss = new Map<number, number>();
  for (const l of listing.split("\n")) {
    const [p, , kb] = l.trim().split(/\s+/).map(Number);
    if (p && Number.isFinite(kb)) rss.set(p, kb);
  }
  let n = 0, sum = 0, max = 0;
  for (const r of roots) {
    if (!rss.has(r)) continue;
    const kb = [r, ...treeOf(listing, r)].reduce((a, p) => a + (rss.get(p) ?? 0), 0);
    n++; sum += kb; max = Math.max(max, kb);
  }
  return { n, sumMB: Math.round(sum / 1024), maxMB: Math.round(max / 1024) };
}
/** RSS các CLI đang chạy (một lần ps, bất đồng bộ). Không có CLI nào thì không gọi ps. */
export async function cliRss(): Promise<CliRss> {
  if (!liveClis.size) return { n: 0, sumMB: 0, maxMB: 0 };
  const r = await runCmd("ps", ["-A", "-o", "pid=,ppid=,rss="]);
  return treeRss(r.stdout, [...liveClis]);
}
registerMemProbe("cli", cliRss);

/** Tạo thư mục (quyền 0700) trong nhà engine. */
export async function makeDir(dir: string): Promise<void> {
  if (!engineUser()) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); return; }
  if (!fs.existsSync(dir)) await asEngine("mkdir", ["-p", "-m", "700", dir]);
}
/** Ghi một tệp (quyền 0600) trong nhà engine bằng user của engine, tạo thư mục cha nếu chưa có (tệp đính kèm cho CLI đọc). */
export async function writeEngineFile(file: string, data: Buffer): Promise<void> {
  const home = path.resolve(engineHome());
  if (!path.resolve(file).startsWith(home + path.sep)) throw new Error("Đường dẫn nằm ngoài thư mục engine.");
  const u = engineUser();
  if (!u) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, data, { mode: 0o600 }); return; }
  const r = await runCmd("sudo", sudoArgs(u, "sh", ["-c", 'umask 077 && mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", file]), data);
  if (!r.ok) throw new Error(`Không ghi được tệp đính kèm cho engine: ${r.err.trim().slice(0, 200)}`);
}
/** Tên các mục trong một thư mục của nhà engine (rỗng nếu chưa có). */
export async function listEngineDir(dir: string): Promise<string[]> {
  const u = engineUser();
  if (!u) { try { return fs.readdirSync(dir); } catch { return []; } }
  const r = await runCmd("sudo", sudoArgs(u, "ls", ["-1", dir]));
  return r.ok ? r.stdout.split("\n").filter(Boolean) : [];
}
/** Xóa hẳn một thư mục trong nhà engine (chỉ nhận đường dẫn nằm trong nhà engine). */
export async function removeDir(dir: string): Promise<void> {
  const home = path.resolve(engineHome());
  if (!path.resolve(dir).startsWith(home + path.sep)) throw new Error("Đường dẫn nằm ngoài thư mục engine.");
  if (!engineUser()) { fs.rmSync(dir, { recursive: true, force: true }); return; }
  await asEngine("rm", ["-rf", "--", dir]);
}

/** Xóa tệp và thư mục có tên chứa mã phiên trong thư mục đăng nhập của một CLI: lịch sử phiên chứa nguyên văn đoạn chat. Tìm theo tên thay vì đoán cấu trúc của từng hãng
 *  (Claude Code: projects/<thư mục làm việc>/<mã>.jsonl; Codex: sessions/<ngày>/rollout-…-<mã>.jsonl), cấu trúc đổi theo phiên bản CLI. Chạy nền: xóa nhiều đoạn chat không được chặn máy chủ. */
export function removeSessionFiles(dir: string, id: string): Promise<void> {
  const home = path.resolve(engineHome());
  // Mã do CLI trả về: chỉ nhận dạng an toàn, đủ dài để không khớp nhầm tệp khác (kể cả tệp đăng nhập).
  if (!/^[\w-]{8,100}$/.test(id) || !path.resolve(dir).startsWith(home + path.sep)) return Promise.resolve();
  const args = [dir, "-maxdepth", "10", "-name", `*${id}*`, "-prune", "-exec", "rm", "-rf", "--", "{}", "+"];
  const u = engineUser();
  return new Promise((ok) => execFile(u ? "sudo" : "find", u ? ["-n", "-u", u, "--", "env", "-i", "PATH=/usr/bin:/bin", "find", ...args] : args, { timeout: 60_000 }, (e, _o, err) => {
    if (e && !/No such file/i.test(String(err))) console.error("[engine] không xóa được lịch sử phiên", String(err || e.message).slice(0, 200));
    ok();
  }));
}

// Antigravity, Grok chỉ báo mã phiên khi xong lượt: bấm Dừng, quá giờ hay CLI chết thì không có mã để xóa, câu lệnh và ảnh dở nằm lại trong thư mục đăng nhập mà không ai quét lại.
// Lượt tạo ảnh chụp danh sách mã phiên trước khi chạy rồi xóa các mã mới xuất hiện. Cùng tài khoản có thể có lượt chat chạy song song, phiên đó dùng để nối tiếp đoạn chat nên không được
// xóa: còn lượt nào đang chạy thì chờ nó xong, mã lượt khác báo về (sessionSeen) được giữ lại. Lượt chat bị giết trước khi báo mã thì không ai nối tiếp được, xóa cũng không mất gì.
// "Đang chạy" gồm cả lượt đang theo dõi mà chưa xong việc (busy), không chỉ tiến trình CLI còn sống: lượt tạo ảnh của Antigravity chỉ đọc ảnh trong brain/<mã> SAU khi CLI thoát,
// nên lượt nền (bộ não, bộ nhớ chạy bằng Antigravity sau mỗi lượt chat) dọn đúng lúc đó sẽ xóa mất thư mục ảnh vừa tạo ("CLI báo xong nhưng không có tệp ảnh nào").
// Lượt nào cũng hết busy ngay khi gọi sweep() (đã đọc xong tệp của mình) nên các lượt chờ nhau không bao giờ kẹt.
type Watch = { live: number; watching: number; busy: number; seen: Set<string>; idle: (() => void)[] };
const watches: Map<string, Watch> = ((globalThis as { __synchroSessionWatch?: Map<string, Watch> }).__synchroSessionWatch ??= new Map());
const watchOf = (dir: string) => { let w = watches.get(dir); if (!w) watches.set(dir, (w = { live: 0, watching: 0, busy: 0, seen: new Set(), idle: [] })); w.busy ??= 0; return w; };
const quiet = (w: Watch) => !w.live && !w.busy;
const flush = (w: Watch) => { if (quiet(w)) for (const f of w.idle.splice(0)) f(); };
/** Một tiến trình CLI chạy trên thư mục đăng nhập này cho tới khi xong. */
export function cliRunning(dir: string, p: { done: Promise<unknown> }) {
  const w = watchOf(dir);
  w.live++;
  void p.done.finally(() => { w.live--; flush(w); });
}
/** Lượt khác báo mã phiên của nó: phiên đó không phải rác của lượt tạo ảnh. */
export function sessionSeen(dir: string, id: string) { const w = watches.get(dir); if (w?.watching) w.seen.add(id); }
const SESSION_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Tệp đăng nhập có thể mang mã cùng dạng: không bao giờ là phiên.
const NOT_SESSION = /auth|token|credential|account/i;
function sessionIds(dir: string): Promise<{ ids: Set<string>; ok: boolean }> {
  const u = engineUser(), args = [dir, "-maxdepth", "10", "-name", "*-*-*-*-*"];
  return new Promise((done) => execFile(u ? "sudo" : "find", u ? ["-n", "-u", u, "--", "env", "-i", "PATH=/usr/bin:/bin", "find", ...args] : args, { timeout: 60_000, maxBuffer: 32 * 1048576 }, (e, out) => {
    const ids = new Set<string>();
    for (const l of String(out ?? "").split("\n")) if (l && !NOT_SESSION.test(path.relative(dir, l))) for (const m of path.basename(l).match(SESSION_ID) ?? []) ids.add(m);
    done({ ids, ok: !e });
  }));
}
/** Chụp mã phiên trước lượt; sweep(): xóa các mã mới, ngay nếu không còn lượt nào chạy, không thì khi lượt cuối xong (chạy nền, không bắt người dùng chờ). */
export async function watchSessions(dir: string) {
  const w = watchOf(dir);
  w.watching++; w.busy++;
  // Lưới an toàn: lượt nào quên gọi sweep (lỗi giữa chừng) cũng chỉ giữ busy tới trần thời gian của một lượt, việc dọn của các lượt khác không bị treo mãi.
  let held = true;
  const unhold = () => { if (held) { held = false; w.busy--; } };
  const timer = setTimeout(() => { unhold(); flush(w); }, MAX_TURN_MS + 60_000);
  timer.unref?.();
  const before = await sessionIds(dir);
  const close = () => { if (--w.watching <= 0) w.seen.clear(); };
  let swept = false;
  return {
    sweep: async () => {
      if (swept) return;
      swept = true;
      clearTimeout(timer); unhold();
      // Không chụp được danh sách trước lượt thì không biết mã nào là mới: để sót còn hơn xóa nhầm phiên của đoạn chat.
      if (!before.ok) { close(); flush(w); return; }
      const run = async (): Promise<void> => {
        const now = await sessionIds(dir);
        // Kiểm lại sau khi chờ find: lượt khác có thể vừa bắt đầu (mã phiên của nó đã nằm trong now).
        if (!quiet(w)) { w.idle.push(() => void run()); return; }
        for (const id of now.ids) if (!before.ids.has(id) && !w.seen.has(id)) await removeSessionFiles(dir, id);
        close();
      };
      if (!quiet(w)) w.idle.push(() => void run());
      else { const others = w.idle.splice(0); await run(); for (const f of others) f(); }
    },
  };
}

/** Dọn tệp tạm của các lượt bị dừng đột ngột (máy chủ khởi động lại, CLI bị giết): prompt, hướng dẫn và nhật ký .synchro-* có cả lịch sử chat, tệp đính kèm trong att/.
 *  Chạy bằng một lệnh find ở nền của user engine, không chặn Node dù có nhiều tài khoản. Tệp còn dùng không thể cũ hơn trần của một lượt. */
export function sweepEngineTemp(): Promise<void> {
  const work = path.join(engineHome(), "work"), u = engineUser();
  const run = (args: string[]) => new Promise<void>((ok) => {
    execFile(u ? "sudo" : "find", u ? ["-n", "-u", u, "--", "env", "-i", "PATH=/usr/bin:/bin", "find", ...args] : args, { timeout: 120_000 }, (e) => { if (e && e.code !== 1) console.warn("[engines] dọn tệp tạm:", String(e.message).slice(0, 200)); ok(); });
  });
  return run([work, "-mindepth", "1", "-maxdepth", "2", "-type", "f", "-name", ".synchro-*", "-mmin", `+${Math.ceil(MAX_TURN_MS / 60_000) + 60}`, "-delete"])
    .then(() => run([work, "-mindepth", "3", "-maxdepth", "3", "-type", "d", "-path", "*/att/*", "-mtime", "+7", "-exec", "rm", "-rf", "{}", "+"]))
    // Thư mục tạm của lượt tạo ảnh bị bỏ dở (ảnh gốc, câu lệnh của người dùng). Lượt tạo ảnh chỉ vài phút nên 2 giờ là chắc chắn đã xong.
    .then(() => run([work, "-mindepth", "2", "-maxdepth", "2", "-type", "d", "-name", ".synchro-img-*", "-mmin", "+120", "-exec", "rm", "-rf", "{}", "+"]))
    // CODEX_HOME riêng của lượt Codex bị bỏ dở (config.toml có địa chỉ cầu nối MCP của lượt). rm -rf không đi theo liên kết nên thư mục đăng nhập không bị đụng.
    .then(() => run([path.join(engineHome(), "logins", "codex"), "-mindepth", "2", "-maxdepth", "2", "-type", "d", "-name", `${CODEX_TURN_PREFIX}*`, "-mmin", `+${Math.ceil(MAX_TURN_MS / 60_000) + 60}`, "-exec", "rm", "-rf", "{}", "+"]))
    // HOME riêng của lượt Antigravity / Grok bị bỏ dở (máy chủ tắt giữa lượt): có cầu nối MCP của lượt và bản sao tệp đăng nhập. rm -rf không đi theo liên kết.
    .then(() => run([path.join(engineHome(), "logins", "agy"), path.join(engineHome(), "logins", "grok"), "-mindepth", "2", "-maxdepth", "2", "-type", "d", "-name", `${TURN_HOME_PREFIX}*`, "-mmin", `+${Math.ceil(MAX_TURN_MS / 60_000) + 60}`, "-exec", "rm", "-rf", "{}", "+"]));
}

/** Đường dẫn CLI nếu đã cài trong <home>/.local/bin (kể cả liên kết tới gói npm, miễn là vẫn nằm trong thư mục nhà engine). */
export function find(cli: Cli): string | null {
  const p = path.join(binDir(), cli);
  try {
    fs.accessSync(p, fs.constants.X_OK);
    const real = fs.realpathSync(p), home = fs.realpathSync(engineHome());
    return real.startsWith(home + path.sep) ? p : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- biến môi trường
// MCP_TOOL_TIMEOUT: thời gian chờ một lời gọi công cụ qua cầu nối MCP của Claude Code (lệnh trong workspace chạy tới 10 phút).
// GROK_HOME: thư mục cấu hình / đăng nhập của Grok CLI; GROK_DISABLE_AUTOUPDATER: Grok CLI không tự tải bản mới vào thư mục của từng tài khoản;
// GROK_BIN_DIR: nơi script cài của xAI đặt lệnh grok (chỉ dùng khi cài).
// DISABLE_AUTOUPDATER: Claude Code không tự tải bản mới đè lên bản Synchro đã kiểm tra (app/ai/cliupdate.ts cập nhật hằng tuần, có kiểm tra
// và trả lại); SYNCHRO_CLI_AUTOUPDATE=0 tắt bộ cập nhật của Synchro thì để Claude Code tự cập nhật như trước.
export const ENV_ALLOW = ["SYNCHRO_CLI_OWNER", "LANG", "TZ", "HOME", "PATH", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "CODEX_HOME", "MCP_TOOL_TIMEOUT", "GROK_HOME", "GROK_DISABLE_AUTOUPDATER", "GROK_BIN_DIR", "DISABLE_AUTOUPDATER"] as const;
export const basePath = () => [noBrowserDir(), binDir(), path.dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"].join(":");

/** Môi trường cho tiến trình CLI: chỉ các biến trong ENV_ALLOW; biến khác (kể cả truyền vào) bị bỏ. */
export function cleanEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string | undefined> = { LANG: process.env.LANG || "C.UTF-8", TZ: process.env.TZ, HOME: engineHome(), PATH: basePath(), DISABLE_AUTOUPDATER: process.env.SYNCHRO_CLI_AUTOUPDATE === "0" ? undefined : "1" };
  const out: Record<string, string> = {};
  for (const k of ENV_ALLOW) {
    const v = Object.prototype.hasOwnProperty.call(extra, k) ? extra[k] : base[k];
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- cô lập theo tài khoản (tùy chọn)
// SYNCHRO_ENGINE_BWRAP=1 (cần gói bubblewrap, xem docs/van-hanh.md): mỗi tiến trình CLI của một tài khoản chỉ thấy thư mục đăng nhập và thư mục làm việc
// của chính tài khoản đó, /proc riêng (không đọc được biến môi trường của lượt khác), phần còn lại của đĩa chỉ đọc. Mọi thư mục đăng nhập thuộc cùng một
// user hệ thống nên quyền tệp không ngăn được chuyện này. Lệnh không gắn với tài khoản nào (cài CLI, dọn thư mục) không đi qua đây vì cần ghi trong nhà engine.
const inside = (root: string, p: string) => path.resolve(p).startsWith(path.resolve(root) + path.sep);
/** Tiền tố thư mục CODEX_HOME riêng của một lượt Codex có công cụ (cli_engines.codexTurnHome): nằm trong thư mục đăng nhập Codex của tài khoản. */
export const CODEX_TURN_PREFIX = ".synchro-codex-";
/** Thư mục đăng nhập chứa CODEX_HOME của lượt (liên kết trong đó trỏ về thư mục đăng nhập nên hộp phải gắn cả thư mục đăng nhập). */
export const codexLoginDir = (d: string) => (path.basename(d).startsWith(CODEX_TURN_PREFIX) ? path.dirname(d) : d);
/** Tiền tố HOME riêng của một lượt Antigravity / Grok có công cụ (turnhome.ts, Blueprint G1): thư mục con của thư mục đăng nhập. */
export const TURN_HOME_PREFIX = ".synchro-home-";
/** Thư mục đăng nhập của tài khoản khi HOME là HOME riêng của lượt (liên kết trong đó trỏ về thư mục đăng nhập), nguyên vẹn nếu không phải. */
export const turnHomeBase = (d: string) => (path.basename(d).startsWith(TURN_HOME_PREFIX) ? path.dirname(d) : d);
export function isolate(file: string, argv: string[], env: Record<string, string>, cwd: string): { file: string; argv: string[]; env: Record<string, string> } {
  const logins = path.join(engineHome(), "logins"), work = path.join(engineHome(), "work");
  const scope = [env.CLAUDE_CONFIG_DIR, env.CODEX_HOME && codexLoginDir(env.CODEX_HOME), env.HOME && turnHomeBase(env.HOME)].filter((d): d is string => !!d && inside(logins, d));
  if (process.env.SYNCHRO_ENGINE_BWRAP !== "1" || !scope.length) return { file, argv, env };
  const app = process.cwd();
  const binds = [...new Set([...scope, ...(inside(work, cwd) ? [cwd] : [])])].flatMap((d) => ["--bind", d, d]);
  return { file: "bwrap", argv: ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--unshare-pid", "--unshare-ipc", "--new-session", "--die-with-parent",
    ...(inside(app, engineHome()) ? [] : ["--tmpfs", app]), "--tmpfs", logins, "--tmpfs", work, ...binds, "--chdir", cwd, "--", file, ...argv],
    // HOME mặc định là nhà engine (chỉ đọc trong hộp): CLI ghi tệp phụ vào thư mục của tài khoản.
    env: { ...env, HOME: inside(logins, env.HOME ?? "") ? env.HOME : scope[0] } };
}

/**
 * Kiểm lúc máy chủ khởi động: trên production nên bật cô lập bwrap (SYNCHRO_ENGINE_BWRAP=1) để tiến trình CLI của một tài khoản
 * không đọc được thư mục đăng nhập của tài khoản khác (mọi login cùng một user hệ thống nên quyền tệp không ngăn được).
 * MẶC ĐỊNH chỉ CẢNH BÁO (không chặn khởi động) — để không làm sập VPS đang chạy chưa cài bubblewrap. Chỉ khi
 * SYNCHRO_REQUIRE_BWRAP=1 mới ném lỗi chặn khởi động production khi thiếu bwrap. Ngoài production thì bỏ qua.
 */
export function assertSandboxReady(): void {
  if (process.env.NODE_ENV !== "production" || process.env.SYNCHRO_ENGINE_BWRAP === "1") return;
  const msg = "Cô lập engine (bubblewrap) chưa bật: đặt SYNCHRO_ENGINE_BWRAP=1 (cần gói bubblewrap, xem docs/van-hanh.md). "
    + "Thiếu nó, tiến trình CLI của các tài khoản chia sẻ cùng một user hệ thống có thể đọc được đăng nhập của nhau.";
  if (process.env.SYNCHRO_REQUIRE_BWRAP === "1") throw new Error(`[cli] ${msg} (SYNCHRO_REQUIRE_BWRAP=1 nên chặn khởi động)`);
  console.warn(`[cli] CẢNH BÁO: ${msg}`);
}

// ---------------------------------------------------------------- chạy tiến trình
export type RunOpts = {
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** Nội dung đưa vào stdin rồi đóng stdin (prompt). Bỏ trống thì stdin để mở cho write() (đăng nhập). */
  stdin?: string;
  timeoutMs?: number;
  /** Dừng khi im lặng quá lâu: không có đầu ra (stdout / stderr) và alive() không mới hơn trong idleMs. */
  idleMs?: number;
  /** Lúc gần nhất lượt còn hoạt động ngoài đầu ra của CLI (đang / vừa chạy công cụ của Synchro). */
  alive?: () => number;
  signal?: AbortSignal;
  /** Chạy trong pseudo-terminal (qua lệnh `script`) cho CLI cần terminal khi đăng nhập. */
  pty?: boolean;
};
export type Exit = { code: number | null; signal: string | null; timedOut: boolean; aborted: boolean; idle?: boolean };
export type Proc = {
  child: ChildProcess;
  /** Từng dòng stdout (đã bỏ mã màu nếu chạy trong pty). */
  lines: AsyncIterable<string>;
  stderr: () => string;
  write: (s: string) => void;
  kill: () => void;
  done: Promise<Exit>;
};

const ANSI = /\x1b\[[0-9;?<=>!]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\|\x1b[()][0-9A-Za-z]|\x1b[=>78DEHMNOc]|\r/g;
// Giao diện terminal dùng "lùi con trỏ sang phải n ô" thay cho dấu cách: đổi lại thành dấu cách trước khi bỏ mã điều khiển.
export const stripAnsi = (s: string) => s.replace(/\x1b\[(\d*)C/g, (_, n) => " ".repeat(Math.min(Number(n) || 1, 200))).replace(ANSI, "");
const q = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;

// pty cho máy dev macOS: chép hai chiều giữa pipe và terminal giả, thoát ngay khi CLI thoát
// (pty.spawn của Python đợi cả stdin đóng mới thoát nên không dùng được).
const PY_PTY = [
  "import os,pty,sys,select",
  "pid,fd=pty.fork()",
  "if pid==0: os.execvp(sys.argv[1],sys.argv[1:])",
  "fds=[fd,0]",
  "while True:",
  " r=select.select(fds,[],[])[0]",
  " if fd in r:",
  "  try: d=os.read(fd,65536)",
  "  except OSError: d=b''",
  "  if not d: break",
  "  os.write(1,d)",
  " if 0 in r:",
  "  d=os.read(0,65536)",
  "  if d: os.write(fd,d)",
  "  else: fds.remove(0)",
  "st=os.waitpid(pid,0)[1]",
  "sys.exit(os.WEXITSTATUS(st) if os.WIFEXITED(st) else 128+os.WTERMSIG(st))",
].join("\n");

/**
 * Lệnh thật sẽ chạy: qua `script` nếu cần pty, qua `sudo -n -u <user> -- env -i -C <cwd> …` nếu có user hệ thống riêng.
 * Khi chạy bằng user riêng, thư mục làm việc (0700, của user đó) Synchro không vào được: tiến trình sudo chạy từ "/",
 * rồi `env -C` mới chuyển vào thư mục dưới quyền user của engine.
 */
const SECRET_ENV = ["CLAUDE_CODE_OAUTH_TOKEN"];
export function command(bin: string, args: string[], env: Record<string, string>, pty: boolean, cwd: string): { file: string; argv: string[]; env: Record<string, string>; cwd: string; stdinHead?: string } {
  let file = bin, argv = args;
  if (pty) {
    // Terminal rộng để link đăng nhập không bị xuống dòng. util-linux: script -qfec "<lệnh>" /dev/null;
    // `script` của macOS đòi stdin là terminal nên trên máy dev dùng pty của Python.
    const wide = `stty cols 1000 rows 50 2>/dev/null; exec ${[bin, ...args].map(q).join(" ")}`;
    if (process.platform === "darwin") { file = "/usr/bin/python3"; argv = ["-c", PY_PTY, "/bin/sh", "-c", wide]; }
    else { file = "script"; argv = ["-qfec", wide, "/dev/null"]; }
  }
  const box = isolate(file, argv, env, cwd);
  const user = process.env.SYNCHRO_ENGINE_USER;
  if (user) {
    // Tham số dòng lệnh thì ai trên máy cũng xem được bằng ps: token đi qua dòng đầu của stdin, `read` đọc từng byte nên phần còn lại (prompt) vẫn tới CLI.
    const plain = Object.entries(box.env).filter(([k]) => !SECRET_ENV.includes(k)), secret = SECRET_ENV.filter((k) => box.env[k]);
    const pre = secret.length ? ["/bin/sh", "-c", secret.map((k) => `IFS= read -r ${k} && export ${k}`).join(" && ") + ' && exec "$@"', "sh"] : [];
    return { file: "sudo", argv: ["-n", "-u", user, "--", "env", "-i", "-C", cwd, ...plain.map(([k, v]) => `${k}=${v}`), ...pre, box.file, ...box.argv], env: { PATH: env.PATH ?? basePath() }, cwd: "/", stdinHead: secret.map((k) => box.env[k] + "\n").join("") };
  }
  return { file: box.file, argv: box.argv, env: box.env, cwd };
}

// Mỗi tiến trình CLI mang mã tiến trình của máy chủ đã mở nó. Máy chủ tắt đột ngột giữa lượt thì CLI có thể còn chạy và tiêu hạn mức của gói bên cạnh lượt được chạy lại (instrumentation.ts).
// Lúc khởi động: tiến trình nào có chủ không còn sống là mồ côi. Không đụng tới tiến trình của máy chủ cũ còn sống: lúc triển khai, hai máy chủ có thể chạy song song.
const CLI_OWNER = "SYNCHRO_CLI_OWNER";
const LIST_OWNERS = `for d in /proc/[0-9]*; do o=$(tr '\\0' '\\n' < "$d/environ" 2>/dev/null | sed -n 's/^${CLI_OWNER}=//p'); [ -n "$o" ] && echo "\${d#/proc/} $o"; done; true`;
export function orphansOf(listing: string, alive: (pid: number) => boolean): number[] {
  const out: number[] = [];
  for (const l of listing.split("\n")) {
    const m = /^(\d+) (\d+)$/.exec(l.trim());
    if (m && !alive(Number(m[2]))) out.push(Number(m[1]));
  }
  return out;
}
const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
/** Dừng các CLI mồ côi (chỉ Linux: đọc /proc bằng đúng user của engine). Trả về số tiến trình đã dừng. */
export function sweepOrphanClis(): number {
  if (process.platform !== "linux") return 0;
  const user = engineUser();
  const r = user ? spawnSync("sudo", ["-n", "-u", user, "--", "env", "-i", "PATH=/usr/bin:/bin", "sh", "-c", LIST_OWNERS], { encoding: "utf8", timeout: 20_000 }) : spawnSync("sh", ["-c", LIST_OWNERS], { encoding: "utf8", timeout: 20_000 });
  const dead = orphansOf(r.stdout ?? "", pidAlive);
  if (!dead.length) return 0;
  if (user) spawnSync("sudo", ["-n", "-u", user, "--", "env", "-i", "PATH=/usr/bin:/bin", "kill", "-KILL", ...dead.map(String)], { stdio: "ignore" });
  else for (const p of dead) { try { process.kill(p, "SIGKILL"); } catch {} }
  return dead.length;
}

export function spawnCli(bin: string, args: string[], o: RunOpts = {}): Proc {
  // Trong pty, chương trình terminal cần TERM để vẽ giao diện đăng nhập (chỉ thêm khi chạy pty).
  ensureNoBrowser();
  const env = { ...cleanEnv(o.env), [CLI_OWNER]: String(process.pid), ...(o.pty ? { TERM: "xterm-256color" } : {}) };
  const c = command(bin, args, env, !!o.pty, o.cwd ?? engineHome());
  const child = spawn(c.file, c.argv, { cwd: c.cwd, env: c.env as NodeJS.ProcessEnv, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let err = "", timedOut = false, aborted = false, idle = false, killer: NodeJS.Timeout | null = null, lastOut = Date.now();
  child.stderr!.on("data", (d) => { lastOut = Date.now(); err = (err + d.toString()).slice(-20_000); });
  child.stdout!.on("data", () => { lastOut = Date.now(); });
  // Chạy bằng user riêng: Synchro không gửi tín hiệu được cho tiến trình của user khác, nên ghi nhớ mọi tiến trình con cháu của sudo
  // (kể cả khi sudo đã thoát, chúng không còn trong cây) và kill chúng bằng chính user của engine.
  // ps và sudo kill chạy bất đồng bộ (execFile, như A2.3): bấm Dừng hay hết giờ không làm đứng cả máy chủ.
  const owned = new Set<number>();
  const pid = child.pid;
  if (pid) liveClis.add(pid);
  const signalGroup = (sig: NodeJS.Signals) => { try { if (pid) process.kill(-pid, sig); } catch { try { child.kill(sig); } catch {} } };
  const killGroup = async (sig: NodeJS.Signals): Promise<void> => {
    const user = engineUser();
    if (!user || !pid) { signalGroup(sig); return; }
    // Đọc cây trước khi gửi tín hiệu: tiến trình chết trước lúc ps đọc thì mất dấu con cháu của nó.
    for (const p of await descendants(pid)) owned.add(p);
    signalGroup(sig);
    if (owned.size) await runCmd("sudo", sudoArgs(user, "kill", [`-${sig.replace(/^SIG/, "")}`, ...[...owned].map(String)]));
  };
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    void killGroup("SIGTERM");
    killer ??= setTimeout(() => void killGroup("SIGKILL"), 3000);
  };
  const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs ?? MAX_TURN_MS);
  const idleMs = o.idleMs;
  const idler = idleMs ? setInterval(() => { if (Date.now() - Math.max(lastOut, o.alive?.() ?? 0) > idleMs) { timedOut = idle = true; kill(); } }, Math.min(15_000, idleMs / 4)) : null;
  const onAbort = () => { aborted = true; kill(); };
  if (o.signal) { if (o.signal.aborted) onAbort(); else o.signal.addEventListener("abort", onAbort, { once: true }); }
  const done = new Promise<Exit>((ok) => child.on("close", (code, signal) => {
    clearTimeout(timer); if (idler) clearInterval(idler); if (killer) clearTimeout(killer); o.signal?.removeEventListener("abort", onAbort);
    if (pid) liveClis.delete(pid);
    // Tiến trình chính đã thoát nhưng con cháu có thể còn: dọn cả nhóm rồi mới báo xong (như khi còn gọi đồng bộ).
    const exit: Exit = { code, signal, timedOut, aborted, ...(idle ? { idle } : {}) };
    void killGroup("SIGKILL").catch(() => {}).then(() => ok(exit));
  }));
  child.on("error", (e) => { err += String(e.message); });
  child.stdin!.on("error", () => {});
  if (c.stdinHead) child.stdin!.write(c.stdinHead);
  if (o.stdin !== undefined) { child.stdin!.end(o.stdin); }
  const rl = readline.createInterface({ input: child.stdout! });
  const lines = (async function* () { for await (const l of rl) yield o.pty ? stripAnsi(l) : l; })();
  return { child, lines, stderr: () => (o.pty ? stripAnsi(err) : err), write: (s) => { try { child.stdin!.write(s); } catch {} }, kill, done };
}

/** Chạy tới khi xong, trả toàn bộ đầu ra (lệnh ngắn: --version, auth status…). */
export async function runCli(bin: string, args: string[], o: RunOpts = {}) {
  const p = spawnCli(bin, args, { timeoutMs: 60_000, stdin: "", ...o });
  let out = "";
  for await (const l of p.lines) out += l + "\n";
  const exit = await p.done;
  return { ...exit, stdout: out, stderr: p.stderr() };
}

// ---------------------------------------------------------------- cài đặt
export const NPM_PKG: Partial<Record<Cli, string>> = { claude: "@anthropic-ai/claude-code", codex: "@openai/codex" };
export const AGY_INSTALLER = "https://antigravity.google/cli/install.sh";
export const GROK_INSTALLER = "https://x.ai/cli/install.sh";

export async function version(cli: Cli): Promise<string | null> {
  const bin = find(cli);
  if (!bin) return null;
  const r = await runCli(bin, ["--version"], { timeoutMs: 30_000 }).catch(() => null);
  const line = r?.stdout.split("\n").map((l) => l.trim()).find(Boolean);
  return r && r.code === 0 && line ? line : null;
}

/**
 * Cài CLI chính chủ vào <home>/.local/bin: claude và codex qua npm (gói của Anthropic, OpenAI),
 * agy qua script cài của Google (tải bản build, kiểm SHA-512, chép vào --dir), grok qua script cài của xAI
 * (tải bản build vào <home>/.grok, liên kết lệnh grok vào GROK_BIN_DIR).
 */
export async function install(cli: Cli, log: (s: string) => void = () => {}): Promise<{ ok: boolean; version: string | null; output: string }> {
  const home = engineHome();
  if (!engineUser()) fs.mkdirSync(binDir(), { recursive: true });
  const env = { HOME: home, PATH: basePath(), LANG: process.env.LANG || "C.UTF-8" };
  let r: Awaited<ReturnType<typeof runCli>>;
  if (cli === "agy" || cli === "grok") {
    const res = await fetch(cli === "agy" ? AGY_INSTALLER : GROK_INSTALLER);
    if (!res.ok) return { ok: false, version: null, output: `Không tải được script cài (${res.status}).` };
    // Đưa script qua stdin (bash -s) để user riêng của engine chạy được mà không cần đọc tệp tạm của Synchro.
    // Grok: GROK_BIN_DIR là nơi đặt lệnh grok; PATH không có /usr/local/bin để script không đặt thêm liên kết ra ngoài nhà engine.
    const ver = process.env.SYNCHRO_GROK_VERSION;
    r = cli === "agy"
      ? await runCli("/bin/bash", ["-s", "--", "--dir", binDir()], { env, stdin: await res.text(), timeoutMs: 10 * 60_000 })
      : await runCli("/bin/bash", ["-s", "--", ...(ver ? [ver] : [])], { env: { ...env, PATH: [binDir(), path.dirname(process.execPath), "/usr/bin", "/bin"].join(":"), GROK_BIN_DIR: binDir(), GROK_DISABLE_AUTOUPDATER: "1" }, stdin: await res.text(), timeoutMs: 10 * 60_000 });
  } else {
    const pkg = `${NPM_PKG[cli]}@${process.env[`SYNCHRO_${cli.toUpperCase()}_VERSION`] || "latest"}`;
    const npm = path.join(path.dirname(process.execPath), "npm");
    r = await runCli(fs.existsSync(npm) ? npm : "npm", ["install", "-g", "--prefix", path.join(home, ".local"), "--no-audit", "--no-fund", pkg],
      { env, timeoutMs: 10 * 60_000 });
  }
  // Grok: bản build nằm trong <home>/.grok; mở quyền đi qua các thư mục đó cho user của Synchro (kiểm tra đã cài, phiên bản),
  // như thư mục .local/bin. Chỉ thư mục, không đụng tệp nào (đăng nhập của từng tài khoản nằm ở logins/, không ở đây).
  if (cli === "grok") await runCli("/bin/sh", ["-c", 'for d in "$HOME/.grok" "$HOME/.grok/bin" "$HOME/.grok/downloads"; do [ -d "$d" ] && chmod go+rx "$d"; done; true'], { env, timeoutMs: 20_000 }).catch(() => null);
  const output = `${r.stdout}${r.stderr}`.slice(-4000);
  log(output);
  const v = await version(cli);
  return { ok: r.code === 0 && !!v, version: v, output };
}
