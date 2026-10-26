// Đăng nhập CLI chính chủ theo từng tài khoản Synchro (ADR 0001, bước 4).
// - Mỗi tài khoản một thư mục cấu hình quyền 0700: <home>/logins/<cli>/<scope> (scope = id người dùng).
//   claude → CLAUDE_CONFIG_DIR, codex → CODEX_HOME, agy → HOME (agy lưu đăng nhập trong thư mục nhà).
// - Claude: `claude setup-token` (mặc định; token lưu mã hóa, chỉ truyền cho CLI qua CLAUDE_CODE_OAUTH_TOKEN)
//   hoặc `claude auth login --claudeai`. Cả hai in link, người dùng dán mã trả về.
// - Codex: `codex login --device-auth` in link và mã một lần; người dùng nhập mã trên trang của OpenAI, CLI tự thoát khi xong.
// - Antigravity: `agy` không có lệnh login, lần chạy đầu đòi đăng nhập trong terminal: chạy qua pty, chọn Google OAuth, dán mã.
// - status() nhớ kết quả 60 giây. Đầu ra CLI gửi về trình duyệt luôn qua redact().
import fs from "node:fs";
import path from "node:path";
import { openSecret, sealSecret } from "../providers";
import { DATA_DIR } from "../authstore";
import { type Cli, engineHome, find, makeDir, removeDir, runCli, spawnCli, stripAnsi, type Proc, version } from "./cli_runtime";
import { redact } from "./errors";

export type Method = "token" | "oauth" | "chatgpt" | "apikey" | "google" | null;
export type LoginState = {
  state: "starting" | "open_url" | "verifying" | "done" | "error";
  method: Method;
  url?: string;
  /** Mã một lần người dùng nhập trên trang của hãng (codex). */
  userCode?: string;
  /** Người dùng phải dán mã trang đăng nhập trả về (claude, agy). */
  needsCode: boolean;
  message?: string;
  startedAt: number;
};
/** plan: gói của tài khoản khi CLI cho biết (claude auth status: subscriptionType "pro" / "max"). */
/** relogin: lượt chat gần nhất bị hãng từ chối đăng nhập (token hết hạn, bị thu hồi): cần đăng nhập lại dù CLI vẫn báo đã đăng nhập. */
export type Status = { cli: Cli; installed: boolean; version: string | null; loggedIn: boolean; method: Method; plan?: string | null; models?: string[]; detail?: string; relogin?: boolean; login: LoginState | null; checkedAt: number };

export const LOGIN_TTL_MS = 15 * 60_000;
const STATUS_TTL_MS = 60_000;

export const safeScope = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "default";

/** Thư mục cấu hình riêng của tài khoản (tạo nếu chưa có, quyền 0700 từ logins/ trở xuống). */
export function scopeDir(cli: Cli, scope: string) {
  const root = path.join(engineHome(), "logins"), d = path.join(root, cli, safeScope(scope));
  for (const p of [root, path.join(root, cli), d]) makeDir(p);
  return d;
}

// ---------------------------------------------------------------- token Claude (mã hóa)
// Lưu trong thư mục dữ liệu của Synchro (không phải thư mục engine): chỉ Synchro đọc được, CLI chỉ nhận token qua biến môi trường.
const tokenFile = (scope: string) => {
  const d = path.join(DATA_DIR, "engine-tokens");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return path.join(d, `claude-${safeScope(scope)}.enc`);
};
function readToken(scope: string): string | null {
  try { return openSecret(fs.readFileSync(tokenFile(scope), "utf8").trim()); } catch { return null; }
}
function saveToken(scope: string, token: string) {
  fs.writeFileSync(tokenFile(scope), sealSecret(token), { mode: 0o600 });
}

// Dấu "tài khoản này đã đăng nhập CLI qua Synchro": để bộ chọn model không phải chạy CLI của những người chưa từng đăng nhập.
const marker = (cli: Cli, scope: string) => {
  const d = path.join(DATA_DIR, "engine-tokens");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return path.join(d, `${cli}-${safeScope(scope)}.login`);
};
export const everLoggedIn = (cli: Cli, scope: string) => fs.existsSync(marker(cli, scope));

/** Biến môi trường cho CLI của tài khoản này (đi qua bộ lọc của cli_runtime khi spawn). */
export function engineEnv(cli: Cli, scope: string): Record<string, string> {
  const dir = scopeDir(cli, scope);
  if (cli === "claude") {
    const t = readToken(scope);
    return { CLAUDE_CONFIG_DIR: dir, ...(t ? { CLAUDE_CODE_OAUTH_TOKEN: t } : {}) };
  }
  if (cli === "codex") return { CODEX_HOME: dir };
  return { HOME: dir };
}

// ---------------------------------------------------------------- trạng thái
type G = { cache: Map<string, Status>; pending: Map<string, Pending>; relogin: Set<string> };
const g: G = ((globalThis as { __synchroCliAuth?: G }).__synchroCliAuth ??= { cache: new Map(), pending: new Map(), relogin: new Set() });
g.relogin ??= new Set();
const key = (cli: Cli, scope: string) => `${cli}:${safeScope(scope)}`;
export const forget = (cli: Cli, scope?: string) => {
  if (scope !== undefined) g.cache.delete(key(cli, scope));
  else for (const k of g.cache.keys()) if (k.startsWith(`${cli}:`)) g.cache.delete(k);
};

async function probe(cli: Cli, scope: string, bin: string): Promise<Pick<Status, "loggedIn" | "method" | "plan" | "models" | "detail">> {
  const env = engineEnv(cli, scope), cwd = scopeDir(cli, scope);
  if (cli === "claude") {
    if (env.CLAUDE_CODE_OAUTH_TOKEN) return { loggedIn: true, method: "token" };
    const r = await runCli(bin, ["auth", "status"], { env, cwd, timeoutMs: 20_000 });
    try {
      const j = JSON.parse(r.stdout) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string | null };
      return { loggedIn: !!j.loggedIn, method: j.loggedIn ? (j.authMethod === "oauth_token" ? "token" : "oauth") : null, plan: typeof j.subscriptionType === "string" ? j.subscriptionType : null };
    } catch { return { loggedIn: false, method: null, detail: redact(stripAnsi(r.stdout + r.stderr)).slice(0, 300) }; }
  }
  if (cli === "codex") {
    const r = await runCli(bin, ["login", "status"], { env, cwd, timeoutMs: 20_000 });
    const out = r.stdout + r.stderr;
    if (r.code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out)) return { loggedIn: true, method: /api key/i.test(out) ? "apikey" : "chatgpt" };
    return { loggedIn: false, method: null };
  }
  // agy không có lệnh status: `agy models` liệt kê model khi đã đăng nhập, ngược lại nhắc đăng nhập.
  const r = await runCli(bin, ["models"], { env, cwd, timeoutMs: 30_000 });
  const out = stripAnsi(r.stdout + r.stderr);
  if (r.code !== 0 || /sign in|not signed in|authentication required/i.test(out)) return { loggedIn: false, method: null };
  const models = out.split("\n").map((l) => l.trim().replace(/^[-*•]\s*/, "")).filter((l) => l && !/:$/.test(l) && l.length < 80);
  return { loggedIn: true, method: "google", models };
}

/** Hãng từ chối đăng nhập trong lượt chat (401/403): đánh dấu cần đăng nhập lại cho tới khi đăng nhập xong hoặc đăng xuất. */
export const markRelogin = (cli: Cli, scope: string) => { g.relogin.add(key(cli, scope)); forget(cli, scope); };
export const needsRelogin = (cli: Cli, scope: string) => g.relogin.has(key(cli, scope));

/** stale: có kết quả cũ thì trả ngay và kiểm tra lại ở nền (bộ chọn model không phải chờ CLI). */
export async function status(cli: Cli, scope: string, o: { fresh?: boolean; stale?: boolean } = {}): Promise<Status> {
  const k = key(cli, scope), hit = g.cache.get(k), login = loginState(cli, scope), relogin = g.relogin.has(k);
  if (!o.fresh && hit && Date.now() - hit.checkedAt < STATUS_TTL_MS) return { ...hit, login, relogin };
  if (o.stale && hit && !o.fresh) { void status(cli, scope, { fresh: true }).catch(() => null); return { ...hit, login, relogin }; }
  const bin = find(cli);
  let s: Status;
  if (!bin) s = { cli, installed: false, version: null, loggedIn: false, method: null, login, checkedAt: Date.now() };
  else {
    const [v, p] = await Promise.all([version(cli), probe(cli, scope, bin).catch((e) => ({ loggedIn: false, method: null, detail: redact(String((e as Error).message)) }))]);
    s = { cli, installed: true, version: v, ...p, login, checkedAt: Date.now() };
  }
  g.cache.set(k, s);
  return { ...s, relogin };
}

// ---------------------------------------------------------------- đăng nhập
type Pending = { cli: Cli; scope: string; proc: Proc; raw: string; st: LoginState; timer: NodeJS.Timeout; onChange: Set<() => void>; hide: string[] };

// Link đăng nhập của từng hãng; thêm trang đăng nhập giả lập ở máy cục bộ (scripts/mock-cli, chỉ có khi chạy dev:mock).
const mock = (cli: Cli) => String.raw`|http:\/\/(?:127\.0\.0\.1|localhost):\d+\/mock-login\/${cli}\S*`;
const URL_RE: Record<Cli, RegExp> = {
  claude: new RegExp(String.raw`https:\/\/(?:claude\.(?:ai|com)|platform\.claude\.com|console\.anthropic\.com)\/\S*oauth\S*` + mock("claude"), "g"),
  codex: new RegExp(String.raw`https:\/\/auth\.openai\.com\/\S+` + mock("codex"), "g"),
  agy: new RegExp(String.raw`https:\/\/accounts\.google\.com\/o\/oauth2\/\S+` + mock("agy"), "g"),
};
const CODE_RE = /\b[A-Z0-9]{4,5}-[A-Z0-9]{4,6}\b/;
const TOKEN_RE = /sk-ant-oat[0-9A-Za-z_-]{20,}/;

function loginState(cli: Cli, scope: string): LoginState | null {
  const p = g.pending.get(key(cli, scope));
  return p ? { ...p.st } : null;
}

function update(p: Pending, patch: Partial<LoginState>) {
  Object.assign(p.st, patch);
  for (const f of p.onChange) f();
}

/** Chờ tới khi điều kiện đúng (theo dõi thay đổi trạng thái đăng nhập) hoặc hết thời gian. */
function waitFor(p: Pending, ok: () => boolean, ms: number) {
  return new Promise<void>((done) => {
    if (ok()) return done();
    const f = () => { if (ok()) { clearTimeout(t); p.onChange.delete(f); done(); } };
    const t = setTimeout(() => { p.onChange.delete(f); done(); }, ms);
    p.onChange.add(f);
  });
}

function argsFor(cli: Cli, method: Method): { args: string[]; pty: boolean; needsCode: boolean; method: Method } {
  if (cli === "claude") return method === "oauth"
    ? { args: ["auth", "login", "--claudeai"], pty: true, needsCode: true, method: "oauth" }
    : { args: ["setup-token"], pty: true, needsCode: true, method: "token" };
  if (cli === "codex") return { args: ["login", "--device-auth"], pty: false, needsCode: false, method: "chatgpt" };
  return { args: [], pty: true, needsCode: true, method: "google" };
}

/** Link đăng nhập đầu ra CLI in ra. Claude in cả link chuyển về localhost (cho máy có trình duyệt) và link thủ công: lấy link thủ công. */
function pickUrl(cli: Cli, text: string): string | undefined {
  const all = [...text.matchAll(URL_RE[cli])].map((m) => m[0].replace(/[)\].,'"]+$/, ""));
  return all.find((u) => !/redirect_uri=http%3A%2F%2Flocalhost/i.test(u)) ?? all[0];
}

export async function startLogin(cli: Cli, scope: string, method: Method = null): Promise<LoginState> {
  const bin = find(cli);
  if (!bin) throw new Error("CLI chưa được cài trên máy chủ.");
  cancelLogin(cli, scope);
  const a = argsFor(cli, method), dir = scopeDir(cli, scope);
  // Đăng nhập lại Claude bằng token mới: bỏ token cũ để CLI không dùng nó trong lúc đăng nhập.
  const env = engineEnv(cli, scope); delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const proc = spawnCli(bin, a.args, { env, cwd: dir, pty: a.pty, timeoutMs: LOGIN_TTL_MS });
  const p: Pending = { cli, scope, proc, raw: "", st: { state: "starting", method: a.method, needsCode: a.needsCode, startedAt: Date.now() }, timer: setTimeout(() => cancelLogin(cli, scope), LOGIN_TTL_MS), onChange: new Set(), hide: [] };
  g.pending.set(key(cli, scope), p);
  let pressed = false;
  proc.child.stdout!.on("data", (d: Buffer) => {
    p.raw = (p.raw + d.toString()).slice(-200_000);
    const text = stripAnsi(p.raw);
    // agy: màn hình chọn cách đăng nhập → Enter chọn "Google OAuth" (mục đầu tiên).
    if (cli === "agy" && !pressed && /enter\s+Select/i.test(text) && /Google OAuth/i.test(text)) { pressed = true; setTimeout(() => proc.write("\r"), 300); }
    const patch: Partial<LoginState> = {};
    const url = pickUrl(cli, text);
    if (url && p.st.url !== url) patch.url = url;
    // Mã thiết bị của codex in ngay sau link.
    const at = url ? text.indexOf(url) : -1;
    if (cli === "codex" && at >= 0) { const c = CODE_RE.exec(text.slice(at + url!.length))?.[0]; if (c && c !== p.st.userCode) patch.userCode = c; }
    if (p.st.state === "starting" && (patch.url ?? p.st.url)) patch.state = "open_url";
    const tok = cli === "claude" && a.method === "token" ? TOKEN_RE.exec(text)?.[0] : undefined;
    if (tok) { saveToken(scope, tok); p.raw = p.raw.replace(new RegExp(tok, "g"), "[đã che]"); finish(p, true); return; }
    if (Object.keys(patch).length) update(p, patch);
  });
  void proc.done.then((e) => {
    if (g.pending.get(key(cli, scope)) !== p || p.st.state === "done" || p.st.state === "error") return;
    // codex và `claude auth login` thoát 0 khi đăng nhập xong; setup-token chỉ thành công khi đã đọc được token (xử lý ở trên).
    const ok = e.code === 0 && (cli === "codex" || a.method === "oauth");
    finish(p, ok, e.timedOut ? "Hết thời gian đăng nhập (15 phút). Bắt đầu lại nhé." : undefined);
  });
  await waitFor(p, () => p.st.state !== "starting", 20_000);
  if (p.st.state === "starting") update(p, { state: "error", message: tail(p) || "CLI không in link đăng nhập." });
  return { ...p.st };
}

function tail(p: Pending) {
  // Terminal in lại (echo) mã người dùng dán: che đi trước khi gửi đoạn đầu ra về trình duyệt.
  let s = stripAnsi(p.raw + p.proc.stderr());
  for (const h of p.hide) s = s.split(h).join("[đã che]");
  return redact(s).split("\n").map((l) => l.trim()).filter(Boolean).slice(-6).join("\n").slice(-600);
}

function finish(p: Pending, ok: boolean, message?: string) {
  clearTimeout(p.timer);
  forget(p.cli, p.scope);
  if (ok) { g.relogin.delete(key(p.cli, p.scope)); fs.writeFileSync(marker(p.cli, p.scope), String(Date.now()), { mode: 0o600 }); }
  update(p, ok ? { state: "done", message: undefined } : { state: "error", message: message ?? (tail(p) || "Đăng nhập không thành công.") });
  p.proc.kill();
  // Giữ trạng thái cuối một lúc để giao diện đọc được, rồi dọn.
  setTimeout(() => { if (g.pending.get(key(p.cli, p.scope)) === p) g.pending.delete(key(p.cli, p.scope)); }, 60_000).unref?.();
}

/** Dán mã trang đăng nhập trả về (claude, agy) rồi chờ CLI xác nhận. */
export async function submitCode(cli: Cli, scope: string, code: string): Promise<LoginState> {
  const p = g.pending.get(key(cli, scope));
  if (!p || p.st.state !== "open_url" || !p.st.needsCode) throw new Error("Không có lượt đăng nhập nào đang chờ mã. Bắt đầu lại nhé.");
  const c = code.trim();
  if (!c || c.length > 2048 || /[\x00-\x1f\x7f]/.test(c)) throw new Error("Mã không hợp lệ.");
  // Trạng thái đổi trong lúc chờ (đầu ra CLI, tiến trình thoát): đọc lại mỗi lần.
  const state = (): LoginState["state"] => p.st.state;
  update(p, { state: "verifying" });
  p.hide.push(c);
  p.proc.write(c + "\r");
  if (cli === "agy") {
    // agy không tự thoát sau khi đăng nhập (vào luôn màn hình chat): kiểm tra bằng `agy models` cho tới khi thấy đã đăng nhập.
    const bin = find("agy")!;
    for (let i = 0; i < 15 && state() === "verifying"; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await probe("agy", scope, bin).catch(() => null);
      if (s?.loggedIn) { finish(p, true); break; }
    }
    if (state() === "verifying") finish(p, false, tail(p) || "Không xác nhận được đăng nhập. Kiểm tra mã rồi thử lại.");
  } else await waitFor(p, () => state() !== "verifying", 60_000);
  if (state() === "verifying") finish(p, false, "CLI không phản hồi sau khi dán mã.");
  return { ...p.st };
}

export function cancelLogin(cli: Cli, scope: string) {
  const p = g.pending.get(key(cli, scope));
  if (!p) return;
  clearTimeout(p.timer);
  p.proc.kill();
  g.pending.delete(key(cli, scope));
}

/** Đăng xuất: chạy lệnh đăng xuất của CLI (nếu có) rồi xóa hẳn thư mục cấu hình của tài khoản (kể cả token đã lưu). */
export async function logout(cli: Cli, scope: string) {
  cancelLogin(cli, scope);
  const bin = find(cli), dir = scopeDir(cli, scope), env = engineEnv(cli, scope);
  if (bin && cli !== "agy") await runCli(bin, cli === "claude" ? ["auth", "logout"] : ["logout"], { env, cwd: dir, timeoutMs: 20_000 }).catch(() => null);
  removeDir(dir);
  if (cli === "claude") fs.rmSync(tokenFile(scope), { force: true });
  g.relogin.delete(key(cli, scope));
  fs.rmSync(marker(cli, scope), { force: true });
  forget(cli, scope);
}
