// Đăng nhập CLI chính chủ theo từng tài khoản Synchro (ADR 0001, bước 4).
// - Mỗi tài khoản một thư mục cấu hình quyền 0700: <home>/logins/<cli>/<scope> (scope = id người dùng).
//   claude → CLAUDE_CONFIG_DIR, codex → CODEX_HOME, agy → HOME (agy lưu đăng nhập trong thư mục nhà).
// - Claude: `claude setup-token` (mặc định; token lưu mã hóa, chỉ truyền cho CLI qua CLAUDE_CODE_OAUTH_TOKEN)
//   hoặc `claude auth login --claudeai`. Cả hai in link, người dùng dán mã trả về.
// - Codex: `codex login --device-auth` in link và mã một lần; người dùng nhập mã trên trang của OpenAI, CLI tự thoát khi xong.
// - Antigravity: `agy` không có lệnh login, lần chạy đầu đòi đăng nhập trong terminal: chạy qua pty, chọn Google OAuth, dán mã.
// - Grok: `grok login --device-auth` in link và mã thiết bị (ra stderr); người dùng xác nhận trên trang của xAI, CLI tự thoát khi xong.
//   Đăng nhập lưu ở GROK_HOME/auth.json (GROK_HOME = <thư mục của tài khoản>/.grok).
// - status() nhớ kết quả 60 giây. Đầu ra CLI gửi về trình duyệt luôn qua redact().
import fs from "node:fs";
import path from "node:path";
import { openSecret, sealSecret } from "../providers";
import { DATA_DIR } from "../authstore";
import { opsEvent } from "../ops";
import { type Cli, engineHome, find, makeDir, removeDir, runCli, spawnCli, stripAnsi, type Proc, version } from "./cli_runtime";
import { dropAccount } from "./cli_pool";
import { redact } from "./errors";

export type Method = "token" | "oauth" | "chatgpt" | "apikey" | "google" | "grok" | null;
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
/** Lúc tài khoản đăng nhập CLI gần nhất (để đọc lại danh sách model sau khi đăng nhập lại), hoặc 0. */
export const loginTime = (cli: Cli, scope: string) => { try { return fs.statSync(marker(cli, scope)).mtimeMs; } catch { return 0; } };

/** Biến môi trường cho CLI của tài khoản này (đi qua bộ lọc của cli_runtime khi spawn). */
export function engineEnv(cli: Cli, scope: string): Record<string, string> {
  const dir = scopeDir(cli, scope);
  if (cli === "claude") {
    const t = readToken(scope);
    // SYNCHRO_CLAUDE_QUIET=1: CLI không gọi các dịch vụ phụ (đo lường, tự cập nhật) lúc khởi động. Mặc định tắt: chưa đo trên CLI thật nên chưa biết có nhanh hơn không và tên model viết tắt có còn đúng không.
    return { CLAUDE_CONFIG_DIR: dir, ...(t ? { CLAUDE_CODE_OAUTH_TOKEN: t } : {}), ...(process.env.SYNCHRO_CLAUDE_QUIET === "1" ? { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } : {}) };
  }
  if (cli === "codex") return { CODEX_HOME: dir };
  if (cli === "grok") return { HOME: dir, GROK_HOME: path.join(dir, ".grok"), GROK_DISABLE_AUTOUPDATER: "1" };
  return { HOME: dir };
}

/** Ký ức riêng CLI tự ghi cho tài khoản (Claude Code: projects/<thư mục làm việc>/memory; Antigravity: .gemini/GEMINI.md).
 *  Xóa cùng bộ não để không model nào còn nhớ gì về người dùng; phiên đăng nhập và lịch sử từng đoạn chat giữ nguyên. */
/** Bỏ danh sách model và gói CLI tự nhớ trên đĩa, để lần đọc sau hỏi lại hãng. Chỉ xóa tệp đệm đã biết, không đụng tệp đăng nhập. */
export async function refreshVendorCache(cli: Cli, scope: string) {
  const dir = scopeDir(cli, scope), files = cli === "codex" ? ["models_cache.json"] : cli === "grok" ? [".grok/models_cache.json", ".grok/settings_cache.json"] : [];
  forget(cli, scope);
  if (files.length) await runCli("/bin/rm", ["-f", ...files.map((f) => path.join(dir, f))], { env: engineEnv(cli, scope), cwd: dir, timeoutMs: 10_000 }).catch(() => {});
}

export async function forgetCliMemory(scope: string) {
  const root = path.join(engineHome(), "logins"), s = safeScope(scope);
  // Thư mục của CLI thuộc user riêng của engine (Synchro không ghi được): xóa bằng chính user đó, như lúc chạy CLI.
  await runCli("/bin/sh", ["-c", 'rm -rf "$1"/*/memory; rm -f "$2"', "sh", path.join(root, "claude", s, "projects"), path.join(root, "agy", s, ".gemini", "GEMINI.md")], { timeoutMs: 20_000 }).catch(() => null);
}

// ---------------------------------------------------------------- trạng thái
type G = { cache: Map<string, Status>; pending: Map<string, Pending>; relogin: Set<string>; reloginAt: Map<string, number>; probing: Map<string, Promise<Status>> };
const g: G = ((globalThis as { __synchroCliAuth?: G }).__synchroCliAuth ??= { cache: new Map(), pending: new Map(), relogin: new Set(), reloginAt: new Map(), probing: new Map() });
g.relogin ??= new Set();
g.reloginAt ??= new Map();
g.probing ??= new Map();
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
  if (cli === "grok") {
    // `grok models` in "You are logged in with …." (hoặc "You are not authenticated.") rồi danh sách "  * mã (default)" / "  - mã".
    const r = await runCli(bin, ["models"], { env, cwd, timeoutMs: 30_000 });
    const g = grokModels(stripAnsi(r.stdout + r.stderr));
    return g.loggedIn ? { loggedIn: true, method: "grok", plan: g.plan, models: g.models } : { loggedIn: false, method: null };
  }
  // agy không có lệnh status: `agy models` liệt kê model khi đã đăng nhập, ngược lại nhắc đăng nhập.
  const r = await runCli(bin, ["models"], { env, cwd, timeoutMs: 30_000 });
  const out = stripAnsi(r.stdout + r.stderr);
  if (r.code !== 0 || /sign in|not signed in|authentication required/i.test(out)) return { loggedIn: false, method: null };
  // Mỗi dòng "mã<TAB>Tên"; bỏ dòng "Fetching available models..." và các dòng thông báo.
  const models = out.split("\n").map((l) => l.trim()).filter((l) => /^[a-z][\w.-]*(\t|$)/i.test(l) && !/^(fetching|error|warning|please)\b/i.test(l) && l.length < 160);
  return { loggedIn: true, method: "google", models };
}

/** Đầu ra `grok models`: đã đăng nhập gói chưa, tên gói (khi CLI ghi rõ, vd. SuperGrok) và mã các model (model mặc định trước). */
export function grokModels(out: string): { loggedIn: boolean; plan: string | null; models: string[] } {
  const who = /You are logged in with ([^\n]+?)\.?\s*$/im.exec(out)?.[1]?.trim() ?? "";
  const plan = /(SuperGrok(?: Heavy)?|X Premium\+?|Premium\+?|Grok (?:Pro|Business|Enterprise))/i.exec(who)?.[1] ?? null;
  const ids: string[] = [];
  for (const m of out.matchAll(/^\s*([*-])\s+([A-Za-z0-9][\w.:-]*)(\s+\(default\))?\s*$/gm)) { if (m[1] === "*" || m[3]) ids.unshift(m[2]); else ids.push(m[2]); }
  return { loggedIn: !!who && !/not authenticated/i.test(out), plan, models: [...new Set(ids)] };
}

/** Hãng từ chối đăng nhập trong lượt chat (401/403): đánh dấu cần đăng nhập lại cho tới khi đăng nhập xong hoặc đăng xuất. */
// Một lần 401 có thể chỉ là trục trặc tạm thời phía hãng: báo động tự hết sau RELOGIN_TTL để chế độ Tự động thử lại gói đó (từng biến mất khỏi Tự động tới khi dùng tay hoặc khởi động lại).
// Token hỏng thật thì lượt thử kế tiếp lại đánh dấu, Tự động chuyển model ngay, người dùng không phải chờ.
const RELOGIN_TTL = 10 * 60_000;
const reloginOn = (k: string) => { const at = g.reloginAt.get(k); if (g.relogin.has(k) && at && Date.now() - at > RELOGIN_TTL) { g.relogin.delete(k); g.reloginAt.delete(k); return false; } return g.relogin.has(k); };
export const markRelogin = (cli: Cli, scope: string) => { const k = key(cli, scope); g.relogin.add(k); g.reloginAt.set(k, Date.now()); forget(cli, scope); if (cli === "claude") dropAccount(scopeDir(cli, scope)); opsEvent("cli_auth", cli, "", scope); };
export const needsRelogin = (cli: Cli, scope: string) => reloginOn(key(cli, scope));
/** Một lượt chat vừa chạy được: hãng đã nhận đăng nhập, báo động trước đó (nếu có) không còn đúng. */
export const clearRelogin = (cli: Cli, scope: string) => { g.relogin.delete(key(cli, scope)); };

/** stale: có kết quả cũ thì trả ngay và kiểm tra lại ở nền (bộ chọn model không phải chờ CLI). */
export async function status(cli: Cli, scope: string, o: { fresh?: boolean; stale?: boolean } = {}): Promise<Status> {
  const k = key(cli, scope), hit = g.cache.get(k), login = loginState(cli, scope), relogin = reloginOn(k);
  if (!o.fresh && hit && Date.now() - hit.checkedAt < STATUS_TTL_MS) return { ...hit, login, relogin };
  if (o.stale && hit && !o.fresh) { void status(cli, scope, { fresh: true }).catch(() => null); return { ...hit, login, relogin }; }
  // Nhiều lời gọi cùng lúc (bộ chọn model của mọi thẻ đang mở, lượt chat) dùng chung một lần chạy CLI.
  let run = g.probing.get(k);
  if (!run) {
    run = (async (): Promise<Status> => {
      const bin = find(cli);
      if (!bin) return { cli, installed: false, version: null, loggedIn: false, method: null, login, checkedAt: Date.now() };
      const [v, p] = await Promise.all([version(cli), probe(cli, scope, bin).catch((e) => ({ loggedIn: false, method: null, detail: redact(String((e as Error).message)) }))]);
      return { cli, installed: true, version: v, ...p, login, checkedAt: Date.now() };
    })().then((s) => { g.cache.set(k, s); return s; }).finally(() => g.probing.delete(k));
    g.probing.set(k, run);
  }
  const s = await run;
  // agy, grok đọc danh sách model từ hãng: đọc được là đăng nhập còn hiệu lực (báo động nhầm tự hết). claude, codex chỉ đọc tệp đăng nhập trên
  // máy (token bị thu hồi vẫn báo "đã đăng nhập") nên chỉ tin một lượt chat chạy được (xem subTurn) hoặc đăng nhập lại.
  if (relogin && s.loggedIn && s.models?.length) { g.relogin.delete(k); return { ...s, login, relogin: false }; }
  return { ...s, login, relogin };
}

/**
 * Kiểm tra sẵn trạng thái đăng nhập CLI của mọi tài khoản từng đăng nhập, ngay khi máy chủ khởi động. Lần kiểm tra đầu chạy CLI
 * (`auth status`, `models`…) mất tới 20–30 giây khi máy vừa build xong; không làm sẵn thì bộ chọn model của người mở trang đầu tiên sau
 * deploy chờ trống chừng ấy. Chạy lần lượt từng cái để không dồn tải.
 */
export async function warmStatuses() {
  let names: string[] = [];
  try { names = fs.readdirSync(path.join(DATA_DIR, "engine-tokens")); } catch { return; }
  for (const n of names) {
    const m = /^(claude|codex|agy|grok)-([A-Za-z0-9_-]+)\.login$/.exec(n);
    if (m) await status(m[1] as Cli, m[2]).catch(() => null);
  }
}

// ---------------------------------------------------------------- đăng nhập
/** pastedAt: độ dài đầu ra lúc dán mã (chỉ xét lỗi in ra sau đó); tokenSeen: lúc thấy đầu token. */
type Pending = { cli: Cli; scope: string; proc: Proc; raw: string; st: LoginState; timer: NodeJS.Timeout; onChange: Set<() => void>; hide: string[]; pastedAt: number; tokenSeen: number };

// Link đăng nhập của từng hãng; thêm trang đăng nhập giả lập ở máy cục bộ (scripts/mock-cli, chỉ có khi chạy dev:mock).
const mock = (cli: Cli) => String.raw`|http:\/\/(?:127\.0\.0\.1|localhost):\d+\/mock-login\/${cli}\S*`;
const URL_RE: Record<Cli, RegExp> = {
  claude: new RegExp(String.raw`https:\/\/(?:claude\.(?:ai|com)|platform\.claude\.com|console\.anthropic\.com)\/\S*oauth\S*` + mock("claude"), "g"),
  codex: new RegExp(String.raw`https:\/\/auth\.openai\.com\/\S+` + mock("codex"), "g"),
  agy: new RegExp(String.raw`https:\/\/accounts\.google\.com\/o\/oauth2\/\S+` + mock("agy"), "g"),
  grok: new RegExp(String.raw`https:\/\/(?:[\w-]+\.)*(?:x\.ai|grok\.com)\/\S+` + mock("grok"), "g"),
};
const CODE_RE = /\b[A-Z0-9]{4,5}-[A-Z0-9]{4,6}\b/;
// Token Claude Code in ra sau "Your OAuth token (valid for …):" và trước "Store this token securely…". Chỉ lấy khi đã in xong
// (có câu "Store this token" phía sau, hoặc đã quá 2 giây), bỏ khoảng trắng / viền khung nếu bị xuống dòng.
// Giao diện terminal của Claude Code có lúc in liền không dấu cách ("Storethistokensecurely"): so khớp bỏ qua khoảng trắng.
const TOKEN_END = /Store\s*this\s*token|Use\s*this\s*token|won'?t\s*be\s*able\s*to\s*see/i;
export function extractToken(text: string, settled = false): string | null {
  const i = text.search(/sk-ant-oat/);
  if (i < 0) return null;
  const rest = text.slice(i, i + 1200);
  const end = rest.search(TOKEN_END);
  if (end < 0 && !settled) return null;
  const tok = (end < 0 ? rest : rest.slice(0, end)).replace(/[\s│┃|]+/g, "").match(/^sk-ant-oat[0-9A-Za-z_-]+/)?.[0];
  return tok && tok.length >= 40 ? tok : null;
}
// Lỗi CLI in ra sau khi dán mã (mã sai, hết hạn, không khớp link đang mở…): báo ngay thay vì chờ hết giờ.
const CODE_ERROR = /(OAuth\s*error[^\n]*|Invalid\s*code[^\n]*|invalid\s*authorization\s*code[^\n]*|Login\s*failed[^\n]*|Authentication\s*failed[^\n]*)/i;

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
  if (cli === "grok") return { args: ["login", "--device-auth"], pty: false, needsCode: false, method: "grok" };
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
  const p: Pending = { cli, scope, proc, raw: "", st: { state: "starting", method: a.method, needsCode: a.needsCode, startedAt: Date.now() }, timer: setTimeout(() => cancelLogin(cli, scope), LOGIN_TTL_MS), onChange: new Set(), hide: [], pastedAt: -1, tokenSeen: 0 };
  g.pending.set(key(cli, scope), p);
  let pressed = false;
  const onData = (d: Buffer) => {
    p.raw = (p.raw + d.toString()).slice(-200_000);
    const text = stripAnsi(p.raw);
    // agy: màn hình chọn cách đăng nhập → Enter chọn "Google OAuth" (mục đầu tiên).
    if (cli === "agy" && !pressed && /enter\s+Select/i.test(text) && /Google OAuth/i.test(text)) { pressed = true; setTimeout(() => proc.write("\r"), 300); }
    const patch: Partial<LoginState> = {};
    const url = pickUrl(cli, text);
    if (url && p.st.url !== url) patch.url = url;
    // Mã thiết bị của codex / grok in ngay sau link (grok: dòng sau "enter this code:" / "Confirm this code in your browser:").
    const at = url ? text.indexOf(url) : -1;
    if ((cli === "codex" || cli === "grok") && at >= 0) {
      const after = text.slice(at + url!.length);
      const c = CODE_RE.exec(after)?.[0] ?? (cli === "grok" ? /this code[^:\n]*:\s*\n\s*([A-Za-z0-9-]{4,24})\s*$/m.exec(after)?.[1] : undefined);
      if (c && c !== p.st.userCode) patch.userCode = c;
    }
    if (p.st.state === "starting" && (patch.url ?? p.st.url)) patch.state = "open_url";
    if (cli === "claude" && a.method === "token" && p.st.state !== "done") {
      if (!p.tokenSeen && /sk-ant-oat/.test(text)) {
        p.tokenSeen = Date.now();
        setTimeout(() => { const t = extractToken(stripAnsi(p.raw), true); if (t && p.st.state !== "done") { saveToken(scope, t); p.raw = p.raw.split(t).join("[đã che]"); finish(p, true); } }, 2000);
      }
      const tok = extractToken(text);
      if (tok) { saveToken(scope, tok); p.raw = p.raw.split(tok).join("[đã che]"); finish(p, true); return; }
    }
    // Sau khi dán mã: CLI báo mã sai / hết hạn rồi đứng chờ ("Press Enter to retry") → báo ngay cho người dùng.
    if (p.pastedAt >= 0 && p.st.state === "verifying") {
      const err = CODE_ERROR.exec(stripAnsi(p.raw.slice(p.pastedAt)))?.[1];
      if (err) {
        finish(p, false, `${err.replace(/Press Enter to retry\.?/i, "").trim()} — mã không đúng, đã hết hạn hoặc là mã của một lần đăng nhập trước. Bấm Đăng nhập để lấy link mới rồi dán mã của đúng trang đó.`);
        return;
      }
    }
    if (Object.keys(patch).length) update(p, patch);
  };
  proc.child.stdout!.on("data", onData);
  // Grok in link và mã đăng nhập ra stderr.
  if (cli === "grok") proc.child.stderr!.on("data", onData);
  void proc.done.then((e) => {
    if (g.pending.get(key(cli, scope)) !== p || p.st.state === "done" || p.st.state === "error") return;
    // setup-token in token xong là thoát ngay: đọc token lần cuối trước khi kết luận.
    if (cli === "claude" && a.method === "token") {
      const t = extractToken(stripAnsi(p.raw), true);
      if (t) { saveToken(scope, t); p.raw = p.raw.split(t).join("[đã che]"); finish(p, true); return; }
    }
    // agy: submitCode tự cho tiến trình thoát rồi mới kiểm tra đăng nhập bằng một tiến trình mới.
    if (cli === "agy" && p.st.state === "verifying") return;
    // codex, grok và `claude auth login` thoát 0 khi đăng nhập xong; setup-token chỉ thành công khi đã đọc được token (xử lý ở trên).
    const ok = e.code === 0 && (cli === "codex" || cli === "grok" || a.method === "oauth");
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
  // Ghi lại đoạn cuối đầu ra (đã che token, mã dán vào) để chẩn đoán khi đăng nhập không thành công.
  if (!ok) console.warn(`[engine-login] ${p.cli} không thành công: ${message ?? ""}\n${tail(p)}`);
  forget(p.cli, p.scope);
  // Đăng nhập mới: tiến trình đang đợi sẵn của tài khoản giữ đăng nhập cũ.
  if (ok && p.cli === "claude") dropAccount(scopeDir(p.cli, p.scope));
  if (ok) { g.relogin.delete(key(p.cli, p.scope)); fs.writeFileSync(marker(p.cli, p.scope), String(Date.now()), { mode: 0o600 }); }
  update(p, ok ? { state: "done", message: undefined } : { state: "error", message: message ?? (tail(p) || "Đăng nhập không thành công.") });
  p.proc.kill();
  // Giữ trạng thái cuối một lúc để giao diện đọc được, rồi dọn.
  setTimeout(() => { if (g.pending.get(key(p.cli, p.scope)) === p) g.pending.delete(key(p.cli, p.scope)); }, 60_000).unref?.();
}

/** Dán mã trang đăng nhập trả về (claude, agy) rồi chờ CLI xác nhận. */
export async function submitCode(cli: Cli, scope: string, code: string): Promise<LoginState> {
  const p = g.pending.get(key(cli, scope));
  if (!p || p.st.state !== "open_url" || !p.st.needsCode) throw new Error("Lượt đăng nhập này không còn (máy chủ vừa khởi động lại hoặc đã hết hạn). Hãy bấm Đăng nhập lại.");
  const c = code.trim();
  if (!c || c.length > 2048 || /[\x00-\x1f\x7f]/.test(c)) throw new Error("Mã không hợp lệ.");
  // Trạng thái đổi trong lúc chờ (đầu ra CLI, tiến trình thoát): đọc lại mỗi lần.
  const state = (): LoginState["state"] => p.st.state;
  update(p, { state: "verifying" });
  p.hide.push(c);
  p.pastedAt = p.raw.length;
  // Gõ mã rồi mới nhấn Enter (giao diện terminal coi chuỗi gõ liền là dán, Enter dính vào chuỗi dán có thể bị bỏ qua).
  p.proc.write(c);
  await new Promise((r) => setTimeout(r, 400));
  p.proc.write("\r");
  if (cli === "agy") {
    // agy không tự thoát sau khi đăng nhập (vào màn hình làm quen hoặc màn hình chat), và chỉ lưu phiên đăng nhập xuống đĩa khi đăng nhập
    // xong hẳn: kiểm tra bằng `agy models` lúc tiến trình đăng nhập còn chạy có thể báo nhầm. Chờ màn hình đứng yên, cho agy thoát
    // (/exit ở màn hình chat; màn hình làm quen thì không gõ phím nào vì đó là lựa chọn của người dùng), rồi kiểm tra bằng tiến trình mới.
    const bin = find("agy")!;
    let size = -1, still = 0;
    for (let t = 0; t < 30_000 && still < 2500 && p.proc.child.exitCode === null && state() === "verifying"; t += 250) {
      await new Promise((r) => setTimeout(r, 250));
      if (p.raw.length === size) still += 250; else { size = p.raw.length; still = 0; }
    }
    // Đã báo lỗi mã (mã sai, hết hạn) trong lúc chờ: dừng ở đây.
    if (state() !== "verifying") return { ...p.st };
    if (p.proc.child.exitCode === null) {
      const text = stripAnsi(p.raw);
      const onboarding = /Choose your color scheme|Terms of Service|I agree to help improve/i.test(text);
      if (!onboarding && !/invalid|error/i.test(text.slice(-300))) { p.proc.write("\x1b"); p.proc.write("/exit\r"); }
      const exited = !onboarding && (await Promise.race([p.proc.done.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]));
      if (!exited) { p.proc.kill(); await p.proc.done; }
    }
    const s = await probe("agy", scope, bin).catch(() => null);
    if (s?.loggedIn) finish(p, true);
    else finish(p, false, tail(p) || "Antigravity chưa lưu được phiên đăng nhập. Kiểm tra mã rồi thử lại.");
  } else await waitFor(p, () => state() !== "verifying", 45_000);
  if (state() === "verifying") finish(p, false, "CLI không phản hồi sau khi dán mã. Bấm Đăng nhập để thử lại với link mới.");
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
  if (cli === "claude") dropAccount(scopeDir(cli, scope));
  const bin = find(cli), dir = scopeDir(cli, scope), env = engineEnv(cli, scope);
  if (bin && cli !== "agy") await runCli(bin, cli === "claude" ? ["auth", "logout"] : ["logout"], { env, cwd: dir, timeoutMs: 20_000 }).catch(() => null);
  removeDir(dir);
  if (cli === "claude") fs.rmSync(tokenFile(scope), { force: true });
  g.relogin.delete(key(cli, scope));
  fs.rmSync(marker(cli, scope), { force: true });
  forget(cli, scope);
}
