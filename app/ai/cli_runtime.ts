// Tầng chạy CLI chính chủ (ADR 0001): thư mục nhà riêng của engine, cài đặt, tìm, và chạy tiến trình con an toàn.
// - Thư mục nhà: SYNCHRO_ENGINE_HOME, mặc định <DATA_DIR>/engine. CLI nằm trong <home>/.local/bin và chỉ nhận CLI ở đó.
// - Biến môi trường lọc theo danh sách cho phép (không lọt khóa API, DATA_KEY… của Synchro sang CLI).
// - Mỗi tiến trình là một process group riêng: bấm Dừng, CLI im lặng quá lâu (treo) hoặc chạm mức trần của lượt thì kill cả nhóm.
// - SYNCHRO_ENGINE_USER: chạy CLI bằng user hệ thống riêng qua `sudo -n -u` (xem scripts/setup-engine-user.sh).
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

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
/** Chạy lệnh hệ thống ngắn bằng user của engine (khi có), để thư mục engine luôn thuộc về user đó. */
function asEngine(cmd: string, args: string[]) {
  const u = engineUser();
  const r = u ? spawnSync("sudo", ["-n", "-u", u, "--", "env", "-i", "PATH=/usr/bin:/bin", cmd, ...args], { encoding: "utf8" }) : spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Không ${cmd === "mkdir" ? "tạo" : "xóa"} được thư mục của engine: ${(r.stderr || r.error?.message || "").trim().slice(0, 200)}`);
}
/** Mọi tiến trình con cháu của một tiến trình (đọc cây tiến trình qua ps). */
export function descendants(root: number): number[] {
  const r = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  const kids = new Map<number, number[]>();
  for (const l of (r.stdout ?? "").split("\n")) {
    const [p, pp] = l.trim().split(/\s+/).map(Number);
    if (p && pp) { const k = kids.get(pp) ?? []; k.push(p); kids.set(pp, k); }
  }
  const out: number[] = [], stack = [root];
  while (stack.length) for (const k of kids.get(stack.pop()!) ?? []) { out.push(k); stack.push(k); }
  return out;
}

/** Tạo thư mục (quyền 0700) trong nhà engine. */
export function makeDir(dir: string) {
  if (!engineUser()) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); return; }
  if (!fs.existsSync(dir)) asEngine("mkdir", ["-p", "-m", "700", dir]);
}
/** Ghi một tệp (quyền 0600) trong nhà engine bằng user của engine, tạo thư mục cha nếu chưa có (tệp đính kèm cho CLI đọc). */
export function writeEngineFile(file: string, data: Buffer) {
  const home = path.resolve(engineHome());
  if (!path.resolve(file).startsWith(home + path.sep)) throw new Error("Đường dẫn nằm ngoài thư mục engine.");
  const u = engineUser();
  if (!u) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, data, { mode: 0o600 }); return; }
  const r = spawnSync("sudo", ["-n", "-u", u, "--", "env", "-i", "PATH=/usr/bin:/bin", "sh", "-c", 'umask 077 && mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", file], { input: data });
  if (r.status !== 0) throw new Error(`Không ghi được tệp đính kèm cho engine: ${String(r.stderr ?? r.error?.message ?? "").trim().slice(0, 200)}`);
}
/** Tên các mục trong một thư mục của nhà engine (rỗng nếu chưa có). */
export function listEngineDir(dir: string): string[] {
  const u = engineUser();
  if (!u) { try { return fs.readdirSync(dir); } catch { return []; } }
  const r = spawnSync("sudo", ["-n", "-u", u, "--", "env", "-i", "PATH=/usr/bin:/bin", "ls", "-1", dir], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
}
/** Xóa hẳn một thư mục trong nhà engine (chỉ nhận đường dẫn nằm trong nhà engine). */
export function removeDir(dir: string) {
  const home = path.resolve(engineHome());
  if (!path.resolve(dir).startsWith(home + path.sep)) throw new Error("Đường dẫn nằm ngoài thư mục engine.");
  if (!engineUser()) { fs.rmSync(dir, { recursive: true, force: true }); return; }
  asEngine("rm", ["-rf", "--", dir]);
}

/** Dọn tệp tạm của các lượt bị dừng đột ngột (máy chủ khởi động lại, CLI bị giết): prompt, hướng dẫn và nhật ký .synchro-* có cả lịch sử chat, tệp đính kèm trong att/.
 *  Chạy bằng một lệnh find ở nền của user engine, không chặn Node dù có nhiều tài khoản. Tệp còn dùng không thể cũ hơn trần của một lượt. */
export function sweepEngineTemp(): Promise<void> {
  const work = path.join(engineHome(), "work"), u = engineUser();
  const run = (args: string[]) => new Promise<void>((ok) => {
    execFile(u ? "sudo" : "find", u ? ["-n", "-u", u, "--", "env", "-i", "PATH=/usr/bin:/bin", "find", ...args] : args, { timeout: 120_000 }, (e) => { if (e && e.code !== 1) console.warn("[engines] dọn tệp tạm:", String(e.message).slice(0, 200)); ok(); });
  });
  return run([work, "-mindepth", "1", "-maxdepth", "2", "-type", "f", "-name", ".synchro-*", "-mmin", `+${Math.ceil(MAX_TURN_MS / 60_000) + 60}`, "-delete"])
    .then(() => run([work, "-mindepth", "3", "-maxdepth", "3", "-type", "d", "-path", "*/att/*", "-mtime", "+7", "-exec", "rm", "-rf", "{}", "+"]));
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
export const ENV_ALLOW = ["LANG", "TZ", "HOME", "PATH", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_HOME", "MCP_TOOL_TIMEOUT", "GROK_HOME", "GROK_DISABLE_AUTOUPDATER", "GROK_BIN_DIR"] as const;
const basePath = () => [noBrowserDir(), binDir(), path.dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"].join(":");

/** Môi trường cho tiến trình CLI: chỉ các biến trong ENV_ALLOW; biến khác (kể cả truyền vào) bị bỏ. */
export function cleanEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string | undefined> = { LANG: process.env.LANG || "C.UTF-8", TZ: process.env.TZ, HOME: engineHome(), PATH: basePath() };
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
export function isolate(file: string, argv: string[], env: Record<string, string>, cwd: string): { file: string; argv: string[]; env: Record<string, string> } {
  const logins = path.join(engineHome(), "logins"), work = path.join(engineHome(), "work");
  const scope = [env.CLAUDE_CONFIG_DIR, env.CODEX_HOME, env.HOME].filter((d): d is string => !!d && inside(logins, d));
  if (process.env.SYNCHRO_ENGINE_BWRAP !== "1" || !scope.length) return { file, argv, env };
  const app = process.cwd();
  const binds = [...new Set([...scope, ...(inside(work, cwd) ? [cwd] : [])])].flatMap((d) => ["--bind", d, d]);
  return { file: "bwrap", argv: ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--unshare-pid", "--unshare-ipc", "--new-session", "--die-with-parent",
    ...(inside(app, engineHome()) ? [] : ["--tmpfs", app]), "--tmpfs", logins, "--tmpfs", work, ...binds, "--chdir", cwd, "--", file, ...argv],
    // HOME mặc định là nhà engine (chỉ đọc trong hộp): CLI ghi tệp phụ vào thư mục của tài khoản.
    env: { ...env, HOME: inside(logins, env.HOME ?? "") ? env.HOME : scope[0] } };
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

export function spawnCli(bin: string, args: string[], o: RunOpts = {}): Proc {
  // Trong pty, chương trình terminal cần TERM để vẽ giao diện đăng nhập (chỉ thêm khi chạy pty).
  ensureNoBrowser();
  const env = { ...cleanEnv(o.env), ...(o.pty ? { TERM: "xterm-256color" } : {}) };
  const c = command(bin, args, env, !!o.pty, o.cwd ?? engineHome());
  const child = spawn(c.file, c.argv, { cwd: c.cwd, env: c.env as NodeJS.ProcessEnv, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let err = "", timedOut = false, aborted = false, idle = false, killer: NodeJS.Timeout | null = null, lastOut = Date.now();
  child.stderr!.on("data", (d) => { lastOut = Date.now(); err = (err + d.toString()).slice(-20_000); });
  child.stdout!.on("data", () => { lastOut = Date.now(); });
  // Chạy bằng user riêng: Synchro không gửi tín hiệu được cho tiến trình của user khác, nên ghi nhớ mọi tiến trình con cháu của sudo
  // (kể cả khi sudo đã thoát, chúng không còn trong cây) và kill chúng bằng chính user của engine.
  const owned = new Set<number>();
  const killGroup = (sig: NodeJS.Signals) => {
    try { if (child.pid) process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} }
    const user = engineUser();
    if (!user || !child.pid) return;
    for (const p of descendants(child.pid)) owned.add(p);
    if (owned.size) spawnSync("sudo", ["-n", "-u", user, "--", "env", "-i", "PATH=/usr/bin:/bin", "kill", `-${sig.replace(/^SIG/, "")}`, ...[...owned].map(String)], { stdio: "ignore" });
  };
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    killGroup("SIGTERM");
    killer ??= setTimeout(() => killGroup("SIGKILL"), 3000);
  };
  const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs ?? MAX_TURN_MS);
  const idleMs = o.idleMs;
  const idler = idleMs ? setInterval(() => { if (Date.now() - Math.max(lastOut, o.alive?.() ?? 0) > idleMs) { timedOut = idle = true; kill(); } }, Math.min(15_000, idleMs / 4)) : null;
  const onAbort = () => { aborted = true; kill(); };
  if (o.signal) { if (o.signal.aborted) onAbort(); else o.signal.addEventListener("abort", onAbort, { once: true }); }
  const done = new Promise<Exit>((ok) => child.on("close", (code, signal) => {
    clearTimeout(timer); if (idler) clearInterval(idler); if (killer) clearTimeout(killer); o.signal?.removeEventListener("abort", onAbort);
    // Tiến trình chính đã thoát nhưng con cháu có thể còn: dọn cả nhóm.
    killGroup("SIGKILL");
    ok({ code, signal, timedOut, aborted, ...(idle ? { idle } : {}) });
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
const NPM_PKG: Partial<Record<Cli, string>> = { claude: "@anthropic-ai/claude-code", codex: "@openai/codex" };
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
