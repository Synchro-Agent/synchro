// Tầng chạy CLI chính chủ (ADR 0001): thư mục nhà riêng của engine, cài đặt, tìm, và chạy tiến trình con an toàn.
// - Thư mục nhà: SYNCHRO_ENGINE_HOME, mặc định <DATA_DIR>/engine. CLI nằm trong <home>/.local/bin và chỉ nhận CLI ở đó.
// - Biến môi trường lọc theo danh sách cho phép (không lọt khóa API, DATA_KEY… của Synchro sang CLI).
// - Mỗi tiến trình là một process group riêng: bấm Dừng hoặc quá 30 phút thì kill cả nhóm.
// - SYNCHRO_ENGINE_USER: chạy CLI bằng user hệ thống riêng qua `sudo -n -u` (xem scripts/setup-engine-user.sh).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

export type Cli = "claude" | "codex" | "agy";
export const CLIS: Cli[] = ["claude", "codex", "agy"];
export const MAX_TURN_MS = 30 * 60_000;

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
/** Xóa hẳn một thư mục trong nhà engine (chỉ nhận đường dẫn nằm trong nhà engine). */
export function removeDir(dir: string) {
  const home = path.resolve(engineHome());
  if (!path.resolve(dir).startsWith(home + path.sep)) throw new Error("Đường dẫn nằm ngoài thư mục engine.");
  if (!engineUser()) { fs.rmSync(dir, { recursive: true, force: true }); return; }
  asEngine("rm", ["-rf", "--", dir]);
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
export const ENV_ALLOW = ["LANG", "TZ", "HOME", "PATH", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_HOME", "MCP_TOOL_TIMEOUT"] as const;
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

// ---------------------------------------------------------------- chạy tiến trình
export type RunOpts = {
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** Nội dung đưa vào stdin rồi đóng stdin (prompt). Bỏ trống thì stdin để mở cho write() (đăng nhập). */
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Chạy trong pseudo-terminal (qua lệnh `script`) cho CLI cần terminal khi đăng nhập. */
  pty?: boolean;
};
export type Exit = { code: number | null; signal: string | null; timedOut: boolean; aborted: boolean };
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
export function command(bin: string, args: string[], env: Record<string, string>, pty: boolean, cwd: string): { file: string; argv: string[]; env: Record<string, string>; cwd: string } {
  let file = bin, argv = args;
  if (pty) {
    // Terminal rộng để link đăng nhập không bị xuống dòng. util-linux: script -qfec "<lệnh>" /dev/null;
    // `script` của macOS đòi stdin là terminal nên trên máy dev dùng pty của Python.
    const wide = `stty cols 1000 rows 50 2>/dev/null; exec ${[bin, ...args].map(q).join(" ")}`;
    if (process.platform === "darwin") { file = "/usr/bin/python3"; argv = ["-c", PY_PTY, "/bin/sh", "-c", wide]; }
    else { file = "script"; argv = ["-qfec", wide, "/dev/null"]; }
  }
  const user = process.env.SYNCHRO_ENGINE_USER;
  if (user) return { file: "sudo", argv: ["-n", "-u", user, "--", "env", "-i", "-C", cwd, ...Object.entries(env).map(([k, v]) => `${k}=${v}`), file, ...argv], env: { PATH: env.PATH ?? basePath() }, cwd: "/" };
  return { file, argv, env, cwd };
}

export function spawnCli(bin: string, args: string[], o: RunOpts = {}): Proc {
  // Trong pty, chương trình terminal cần TERM để vẽ giao diện đăng nhập (chỉ thêm khi chạy pty).
  ensureNoBrowser();
  const env = { ...cleanEnv(o.env), ...(o.pty ? { TERM: "xterm-256color" } : {}) };
  const c = command(bin, args, env, !!o.pty, o.cwd ?? engineHome());
  const child = spawn(c.file, c.argv, { cwd: c.cwd, env: c.env as NodeJS.ProcessEnv, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let err = "", timedOut = false, aborted = false, killer: NodeJS.Timeout | null = null;
  child.stderr!.on("data", (d) => { err = (err + d.toString()).slice(-20_000); });
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
  const onAbort = () => { aborted = true; kill(); };
  if (o.signal) { if (o.signal.aborted) onAbort(); else o.signal.addEventListener("abort", onAbort, { once: true }); }
  const done = new Promise<Exit>((ok) => child.on("close", (code, signal) => {
    clearTimeout(timer); if (killer) clearTimeout(killer); o.signal?.removeEventListener("abort", onAbort);
    // Tiến trình chính đã thoát nhưng con cháu có thể còn: dọn cả nhóm.
    killGroup("SIGKILL");
    ok({ code, signal, timedOut, aborted });
  }));
  child.on("error", (e) => { err += String(e.message); });
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

export async function version(cli: Cli): Promise<string | null> {
  const bin = find(cli);
  if (!bin) return null;
  const r = await runCli(bin, ["--version"], { timeoutMs: 30_000 }).catch(() => null);
  const line = r?.stdout.split("\n").map((l) => l.trim()).find(Boolean);
  return r && r.code === 0 && line ? line : null;
}

/**
 * Cài CLI chính chủ vào <home>/.local/bin: claude và codex qua npm (gói của Anthropic, OpenAI),
 * agy qua script cài của Google (tải bản build, kiểm SHA-512, chép vào --dir).
 */
export async function install(cli: Cli, log: (s: string) => void = () => {}): Promise<{ ok: boolean; version: string | null; output: string }> {
  const home = engineHome();
  if (!engineUser()) fs.mkdirSync(binDir(), { recursive: true });
  const env = { HOME: home, PATH: basePath(), LANG: process.env.LANG || "C.UTF-8" };
  let r: Awaited<ReturnType<typeof runCli>>;
  if (cli === "agy") {
    const res = await fetch(AGY_INSTALLER);
    if (!res.ok) return { ok: false, version: null, output: `Không tải được script cài (${res.status}).` };
    // Đưa script qua stdin (bash -s) để user riêng của engine chạy được mà không cần đọc tệp tạm của Synchro.
    r = await runCli("/bin/bash", ["-s", "--", "--dir", binDir()], { env, stdin: await res.text(), timeoutMs: 10 * 60_000 });
  } else {
    const pkg = `${NPM_PKG[cli]}@${process.env[`SYNCHRO_${cli.toUpperCase()}_VERSION`] || "latest"}`;
    const npm = path.join(path.dirname(process.execPath), "npm");
    r = await runCli(fs.existsSync(npm) ? npm : "npm", ["install", "-g", "--prefix", path.join(home, ".local"), "--no-audit", "--no-fund", pkg],
      { env, timeoutMs: 10 * 60_000 });
  }
  const output = `${r.stdout}${r.stderr}`.slice(-4000);
  log(output);
  const v = await version(cli);
  return { ok: r.code === 0 && !!v, version: v, output };
}
