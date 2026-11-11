// Tự cập nhật CLI của các gói (Claude Code, Codex, Antigravity, Grok) mỗi tuần, có lưới an toàn (chủ sở hữu bật / tắt ở Cài đặt → Providers):
// - Cài bản mới cạnh bản đang chạy, mỗi bản một thư mục: <engine home>/.local/versions/<cli>/<bản>-<mốc>/bin/<cli>. Bản đang chạy không bị đụng tới.
// - Kiểm tra bản mới trước khi dùng: `--version`, rồi lệnh xem đăng nhập (auth status / login status / models) bằng chính đăng nhập sẵn có của
//   quản trị viên. Không gửi tin chat nào nên không tốn hạn mức của gói. Bản cũ đang đăng nhập được mà bản mới không thì không dùng.
// - Đạt thì đổi lối vào <engine home>/.local/bin/<cli> thành liên kết tới bản mới (đổi tên một lần, lượt đang chạy vẫn chạy bản cũ tới hết).
//   Bản trước được giữ để trả lại tức thì; các bản cũ hơn thì xóa.
// - Theo dõi các lượt chat thật đầu tiên: lỗi ngay từ đầu (CLI chết, không phản hồi, hãng không nhận đăng nhập) thì tự trả về bản trước và
//   không cài lại đúng bản đó nữa.
// - Thư mục đăng nhập của từng tài khoản (logins/, engine-tokens/) không bao giờ bị chép, chuyển hay xóa: chỉ lối vào của lệnh đổi.
// - Kết quả vào Hộp thư của quản trị viên. Tắt hẳn: SYNCHRO_CLI_AUTOUPDATE=0 (cả nút "Cập nhật ngay"), hoặc tắt "Cập nhật hằng tuần" ở Providers.
// - SYNCHRO_CLI_UPDATE_SOURCE=<thư mục> (chỉ máy giả lập / kiểm thử): lấy bản phát hành từ <thư mục>/<cli>/latest và <thư mục>/<cli>/<bản>/ thay vì npm
//   và script cài của hãng.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, db, getSetting, getUser, isAdmin, isOwner, setSetting, type UserRow } from "../authstore";
import { engineEnv, forget, scopeDir } from "./cli_auth";
import { retireAll } from "./cli_pool";
import { AGY_INSTALLER, basePath, binDir, CLIS, type Cli, engineHome, GROK_INSTALLER, NPM_PKG, runCli, stripAnsi } from "./cli_runtime";
import { redact } from "./errors";

export const CLI_NAME: Record<Cli, string> = { claude: "Claude Code", codex: "Codex", agy: "Antigravity", grok: "Grok CLI" };
const KEY = "cli_update";
const WEEK = 7 * 86_400_000;
const every = () => Number(process.env.SYNCHRO_CLI_UPDATE_EVERY_MS) || WEEK;
/** Tắt bằng biến môi trường: không hẹn giờ, nút "Cập nhật ngay" cũng không chạy. */
export const envOff = () => process.env.SYNCHRO_CLI_AUTOUPDATE === "0";

export type Outcome = "updated" | "same" | "failed" | "smoke_failed" | "skipped" | "rolled_back" | "not_installed";
export type CliResult = { cli: Cli; outcome: Outcome; from: string | null; to: string | null; detail: string; at: number };
type Rel = { target: string; version: string | null; at: number };
// loginOk: lần kiểm tra trước khi đổi bản đã thấy bản mới đọc được đăng nhập sẵn có. authUsers: tài khoản đã bị tính một lượt lỗi đăng nhập.
type Probation = { since: number; ok: number; fail: number; errors: string[]; loginOk?: boolean; authUsers?: string[] };
type CliState = { active: Rel | null; prev: Rel | null; probation: Probation | null; bad: string[]; last: CliResult | null };
type State = { on: boolean; lastRun: number | null; nextAt: number | null; running: boolean; clis: Partial<Record<Cli, CliState>> };

// ---------------------------------------------------------------- trạng thái (một bản trong bộ nhớ, ghi xuống settings mỗi khi đổi)
const g = globalThis as { __synchroCliUpdate?: { st: State | null; job: Promise<CliResult[]> | null; timer: NodeJS.Timeout | null } };
const mem = (g.__synchroCliUpdate ??= { st: null, job: null, timer: null });
function state(): State {
  if (!mem.st) {
    let j: Partial<State> = {};
    try { j = JSON.parse(getSetting(KEY, "{}")) as Partial<State>; } catch {}
    mem.st = { on: j.on !== false, lastRun: j.lastRun ?? null, nextAt: j.nextAt ?? null, running: false, clis: j.clis ?? {} };
  }
  return mem.st;
}
const save = () => { const s = state(); setSetting(KEY, JSON.stringify({ ...s, running: false })); };
const isBad = (c: CliState | undefined, v: string | null | undefined) => { const n = versionNum(v); return !!c && !!n && c.bad.includes(n); };
const cliState = (cli: Cli): CliState => (state().clis[cli] ??= { active: null, prev: null, probation: null, bad: [], last: null });
/** Bật cập nhật hằng tuần (mặc định bật; tắt ở Providers hoặc SYNCHRO_CLI_AUTOUPDATE=0). */
export const autoOn = () => !envOff() && state().on;

// ---------------------------------------------------------------- tệp trong nhà engine (ghi bằng user của engine khi có)
const versionsDir = (cli: Cli) => path.join(engineHome(), ".local", "versions", cli);
const entry = (cli: Cli) => path.join(binDir(), cli);
const env = () => ({ HOME: engineHome(), PATH: basePath(), LANG: process.env.LANG || "C.UTF-8" });
async function sh(script: string, args: string[], ms = 120_000) {
  const r = await runCli("/bin/sh", ["-c", script, "sh", ...args], { env: env(), timeoutMs: ms });
  return { ok: r.code === 0, out: stripAnsi(`${r.stdout}${r.stderr}`).trim() };
}
const inEngine = (p: string) => { const home = path.resolve(engineHome()); return path.resolve(p).startsWith(home + path.sep); };
/** Lối vào hiện tại: đích của liên kết (như readlink), hay chính tệp (bản cài cũ của agy là tệp thật). null: chưa cài. */
function currentTarget(cli: Cli): { kind: "link" | "file"; target: string } | null {
  try {
    const st = fs.lstatSync(entry(cli));
    return st.isSymbolicLink() ? { kind: "link", target: fs.readlinkSync(entry(cli)) } : { kind: "file", target: entry(cli) };
  } catch { return null; }
}
/** Đường dẫn thật của một đích liên kết (đích tương đối tính từ thư mục bin). */
const resolveTarget = (t: string) => (path.isAbsolute(t) ? t : path.resolve(binDir(), t));
/** Thư mục phiên bản chứa một đích (để biết bản nào còn dùng khi dọn). */
const versionRoot = (cli: Cli, t: string) => { const rel = path.relative(versionsDir(cli), resolveTarget(t)); return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? path.join(versionsDir(cli), rel.split(path.sep)[0]) : null; };

// ---------------------------------------------------------------- phiên bản
export const versionNum = (s: string | null | undefined) => /\d+(?:\.\d+)+(?:[-+][\w.]+)?/.exec(s ?? "")?.[0] ?? null;
async function versionOf(bin: string): Promise<{ ok: boolean; line: string; num: string | null }> {
  const r = await runCli(bin, ["--version"], { env: env(), timeoutMs: 30_000 }).catch((e) => ({ code: 1, stdout: "", stderr: String((e as Error).message) }));
  const line = stripAnsi(r.stdout).split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return { ok: r.code === 0 && !!line, line: line || stripAnsi(r.stderr).trim().slice(0, 200), num: versionNum(line) };
}
const liveVersions = new Map<Cli, { at: number; v: string | null }>();
/** Bản đang chạy (đọc bằng --version, nhớ 5 phút). */
export async function liveVersion(cli: Cli, fresh = false): Promise<string | null> {
  const hit = liveVersions.get(cli);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.v;
  const cur = currentTarget(cli);
  const v = cur ? (await versionOf(entry(cli))).line || null : null;
  liveVersions.set(cli, { at: Date.now(), v });
  return v;
}

// ---------------------------------------------------------------- nguồn bản mới
const SOURCE = () => process.env.SYNCHRO_CLI_UPDATE_SOURCE || "";
/** Bản mới nhất mà không phải cài (npm view, hoặc tệp latest của nguồn thử nghiệm). null: phải cài thử mới biết (agy, grok). */
async function latestKnown(cli: Cli): Promise<{ v: string | null; error?: string }> {
  if (SOURCE()) {
    try { return { v: fs.readFileSync(path.join(SOURCE(), cli, "latest"), "utf8").trim() || null }; } catch { return { v: null, error: "Nguồn thử nghiệm không có bản phát hành." }; }
  }
  const pkg = NPM_PKG[cli];
  if (!pkg) return { v: null };
  const npm = path.join(path.dirname(process.execPath), "npm");
  const r = await runCli(fs.existsSync(npm) ? npm : "npm", ["view", pkg, "time", "dist-tags", "--json", `--registry=${REGISTRY()}`], { env: env(), timeoutMs: 60_000 });
  let j: { time?: Record<string, string>; "dist-tags"?: { latest?: string } } = {};
  try { j = JSON.parse(r.stdout); } catch {}
  const v = r.code === 0 ? pickRelease(j.time ?? {}, j["dist-tags"]?.latest) : null;
  if (v) return { v };
  if (r.code === 0 && versionNum(j["dist-tags"]?.latest)) return { v: null, error: `npm ${pkg}: chưa có bản nào phát hành đủ ${Math.round(COOLDOWN_MS() / 3_600_000)} giờ; chờ lần sau.` };
  return { v: null, error: `npm view ${pkg}: ${redact(stripAnsi(r.stderr || r.stdout)).slice(0, 200) || "không đọc được bản mới nhất"}` };
}
// Kho npm chính thức ghi rõ (không theo .npmrc trong nhà engine). Chỉ nhận bản đã phát hành đủ lâu: bản bị chiếm quyền phát hành thường bị gỡ trong vài giờ / ngày,
// cài ngay khi vừa ra thì máy chủ chạy nó cả tuần với đăng nhập gói của mọi người.
const REGISTRY = () => process.env.SYNCHRO_NPM_REGISTRY || "https://registry.npmjs.org/";
const COOLDOWN_MS = () => (Number(process.env.SYNCHRO_CLI_UPDATE_COOLDOWN_H) || 72) * 3_600_000;
const semver = (v: string) => v.split(".").map(Number);
const newer = (a: string, b: string) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
/** Bản chính thức (x.y.z, không -beta…) mới nhất đã phát hành đủ COOLDOWN_MS và không mới hơn thẻ latest; time: trường "time" của npm view. */
export function pickRelease(time: Record<string, string>, latest: string | undefined, now = Date.now(), cooldown = COOLDOWN_MS()): string | null {
  let best: string | null = null;
  for (const [v, t] of Object.entries(time)) {
    if (!/^\d+\.\d+\.\d+$/.test(v) || !(Date.parse(t) <= now - cooldown)) continue;
    if (latest && /^\d+\.\d+\.\d+$/.test(latest) && newer(v, latest)) continue;
    if (!best || newer(v, best)) best = v;
  }
  return best;
}
/** Cài một bản vào thư mục riêng; trả đường dẫn lệnh trong thư mục đó. */
async function installTo(cli: Cli, dir: string, want: string | null): Promise<{ bin: string | null; output: string }> {
  const bin = path.join(dir, "bin", cli);
  const mk = await sh('umask 022; mkdir -p "$1/bin"', [dir]);
  if (!mk.ok) return { bin: null, output: mk.out };
  let out = "";
  if (SOURCE()) {
    const src = path.join(SOURCE(), cli, want ?? "");
    if (!want || !fs.existsSync(src)) return { bin: null, output: "Nguồn thử nghiệm không có bản này." };
    const r = await sh('cp -R "$1"/. "$2/bin/" && chmod 755 "$2/bin/$3"', [src, dir, cli]);
    out = r.out;
  } else if (cli === "claude" || cli === "codex") {
    const npm = path.join(path.dirname(process.execPath), "npm");
    // Codex không cần script cài (tệp chạy nằm trong gói theo nền tảng) nên không chạy script nào của gói; Claude Code cần postinstall để đặt tệp chạy gốc.
    const r = await runCli(fs.existsSync(npm) ? npm : "npm", ["install", "-g", "--prefix", dir, "--no-audit", "--no-fund", `--registry=${REGISTRY()}`, ...(cli === "codex" ? ["--ignore-scripts"] : []), `${NPM_PKG[cli]}@${want ?? "latest"}`], { env: env(), timeoutMs: 10 * 60_000 });
    out = `${r.stdout}${r.stderr}`;
  } else {
    const res = await fetch(cli === "agy" ? AGY_INSTALLER : GROK_INSTALLER, { signal: AbortSignal.timeout(60_000) }).catch((e) => ({ ok: false, status: String((e as Error).message) }) as const);
    if (!res.ok) return { bin: null, output: `Không tải được script cài (${"status" in res ? res.status : ""}).` };
    const script = await (res as Response).text();
    // agy: --dir là nơi đặt lệnh. grok: bản build tải về $HOME/.grok/downloads nên HOME trỏ vào thư mục của bản này (không đè bản đang chạy),
    // GROK_BIN_DIR là nơi đặt liên kết lệnh grok.
    const r = cli === "agy"
      ? await runCli("/bin/bash", ["-s", "--", "--dir", path.join(dir, "bin")], { env: env(), stdin: script, timeoutMs: 10 * 60_000 })
      : await runCli("/bin/bash", ["-s", "--"], { env: { ...env(), HOME: path.join(dir, "home"), PATH: [path.join(dir, "bin"), path.dirname(process.execPath), "/usr/bin", "/bin"].join(":"), GROK_BIN_DIR: path.join(dir, "bin"), GROK_DISABLE_AUTOUPDATER: "1" }, stdin: script, timeoutMs: 10 * 60_000 });
    out = `${r.stdout}${r.stderr}`;
  }
  // User của Synchro phải đi qua được để kiểm tra phiên bản và tìm lệnh (như thư mục .local/bin).
  await sh('chmod -R go+rX "$1" 2>/dev/null; true', [dir]);
  try { fs.accessSync(bin, fs.constants.X_OK); if (!inEngine(fs.realpathSync(bin))) return { bin: null, output: "Lệnh cài xong nằm ngoài thư mục engine." }; }
  catch { return { bin: null, output: redact(stripAnsi(out)).slice(-1500) || "Cài xong nhưng không thấy lệnh." }; }
  return { bin, output: out };
}

// ---------------------------------------------------------------- kiểm tra bản mới bằng đăng nhập sẵn có
/** Tài khoản quản trị đã đăng nhập gói này (chủ sở hữu trước): kiểm tra bằng chính đăng nhập đó. */
function checkScope(cli: Cli): UserRow | null {
  let names: string[] = [];
  try { names = fs.readdirSync(path.join(DATA_DIR, "engine-tokens")); } catch {}
  const users = names.map((n) => new RegExp(`^${cli}-([A-Za-z0-9_-]+)\\.login$`).exec(n)?.[1]).filter((x): x is string => !!x).map((id) => getUser(id)).filter((u): u is UserRow => !!u && isAdmin(u));
  return users.find(isOwner) ?? users[0] ?? null;
}
type Login = { sane: boolean; loggedIn: boolean; detail: string };
async function loginCheck(cli: Cli, bin: string, u: UserRow): Promise<Login> {
  const e = engineEnv(cli, u.id), cwd = scopeDir(cli, u.id);
  const args = cli === "claude" ? ["auth", "status"] : cli === "codex" ? ["login", "status"] : ["models"];
  const r = await runCli(bin, args, { env: e, cwd, timeoutMs: 45_000 }).catch((x) => ({ code: 1, stdout: "", stderr: String((x as Error).message) }));
  const out = stripAnsi(`${r.stdout}\n${r.stderr}`), detail = redact(out.trim()).slice(0, 300);
  if (cli === "claude") {
    try { const j = JSON.parse(r.stdout) as { loggedIn?: boolean }; return { sane: typeof j === "object" && j !== null && "loggedIn" in j, loggedIn: !!j.loggedIn, detail }; }
    catch { return { sane: false, loggedIn: false, detail }; }
  }
  if (cli === "codex") return { sane: /logged in/i.test(out), loggedIn: r.code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out), detail };
  if (cli === "grok") return { sane: /logged in|not authenticated|log in|sign in/i.test(out), loggedIn: /You are logged in with/i.test(out) && !/not authenticated/i.test(out), detail };
  const signIn = /sign in|not signed in|authentication required/i.test(out);
  return { sane: r.code === 0 || signIn, loggedIn: r.code === 0 && !signIn, detail };
}
/** Đạt khi: --version chạy, lệnh xem đăng nhập trả lời bình thường, và tài khoản đang đăng nhập được bằng bản cũ thì bản mới cũng vậy. */
async function smoke(cli: Cli, bin: string): Promise<{ ok: boolean; version: string | null; detail: string; loginOk?: boolean }> {
  const v = await versionOf(bin);
  if (!v.ok) return { ok: false, version: null, detail: `--version lỗi: ${redact(v.line).slice(0, 200)}` };
  const u = checkScope(cli);
  if (!u) return { ok: true, version: v.line, detail: "Chưa quản trị viên nào đăng nhập gói này: chỉ kiểm tra được --version." };
  // Lần lượt, không song song: hai bản cùng đọc một thư mục đăng nhập một lúc thì có thể giẫm lên nhau.
  const now = currentTarget(cli) ? await loginCheck(cli, entry(cli), u) : null;
  const next = await loginCheck(cli, bin, u);
  if (!next.sane) return { ok: false, version: v.line, detail: `Bản mới không trả lời được lệnh xem đăng nhập: ${next.detail || "không có đầu ra"}` };
  if (now?.loggedIn && !next.loggedIn) return { ok: false, version: v.line, detail: `Bản mới không đọc được đăng nhập sẵn có của quản trị viên: ${next.detail}` };
  return { ok: true, version: v.line, loginOk: next.loggedIn, detail: next.loggedIn ? "Đăng nhập sẵn có của quản trị viên vẫn dùng được." : "Tài khoản kiểm tra chưa đăng nhập: đã kiểm tra lệnh chạy được." };
}

// ---------------------------------------------------------------- đổi bản, trả lại, dọn
/** Đổi lối vào sang đích mới bằng một lần đổi tên. Lối vào cũ là tệp thật (bản cài cũ của agy, CLI giả lập): giữ nó cạnh đó làm bản trước. */
async function point(cli: Cli, target: string): Promise<{ ok: boolean; prev: string | null; out: string }> {
  const cur = currentTarget(cli);
  let prev = cur?.kind === "link" ? cur.target : null;
  if (cur?.kind === "file") {
    const keep = `${entry(cli)}.synchro-prev`;
    const r = await sh('mv -f "$1" "$2"', [entry(cli), keep]);
    if (!r.ok) return { ok: false, prev: null, out: r.out };
    prev = keep;
  }
  const r = await sh('ln -sfn "$1" "$2.synchro-new" && mv -f "$2.synchro-new" "$2"', [target, entry(cli)]);
  if (!r.ok && cur?.kind === "file" && prev) await sh('[ -e "$2" ] || mv -f "$1" "$2"', [prev, entry(cli)]);
  return { ok: r.ok, prev, out: r.out };
}
/** Xóa các bản cài cũ trong versions/<cli> không còn là bản đang chạy hay bản trước. Không bao giờ đụng ngoài thư mục đó. */
async function prune(cli: Cli) {
  const s = cliState(cli), keep = new Set([s.active?.target, s.prev?.target].filter((x): x is string => !!x).map((t) => versionRoot(cli, t)).filter(Boolean));
  let names: string[] = [];
  try { names = fs.readdirSync(versionsDir(cli)); } catch { return; }
  for (const n of names) {
    const d = path.join(versionsDir(cli), n);
    if (!keep.has(d) && inEngine(d)) await sh('rm -rf -- "$1"', [d]);
  }
  // Bản cài cũ để cạnh lối vào (.synchro-prev) mà không còn là bản trước: xóa.
  const old = `${entry(cli)}.synchro-prev`;
  if (s.prev?.target !== old && s.active?.target !== old && fs.existsSync(old)) await sh('rm -f -- "$1"', [old]);
}
/** Bản đổi lối vào: báo các phần khác (trạng thái đăng nhập, danh sách model của gói, tiến trình Claude Code dựng sẵn) đọc lại từ bản mới. */
async function afterSwitch(cli: Cli) {
  liveVersions.delete(cli);
  forget(cli);
  retireAll();
  try { (await import("./subs")).forgetAllSubModels(cli); } catch {}
}

/** Trả về bản trước (tự động khi lượt thật đầu tiên lỗi, hoặc chủ sở hữu bấm). */
export async function rollback(cli: Cli, why: string, by: "auto" | "owner" = "auto"): Promise<CliResult> {
  const s = cliState(cli), at = Date.now();
  if (!s.prev) return { cli, outcome: "failed", from: null, to: null, detail: "Không có bản trước để trả lại.", at };
  if (!fs.existsSync(resolveTarget(s.prev.target))) return { cli, outcome: "failed", from: null, to: null, detail: "Bản trước không còn trên máy.", at };
  if (isBad(s, s.prev.version)) return { cli, outcome: "failed", from: null, to: null, detail: "Bản trước đã bị trả lại vì lỗi.", at };
  const from = s.active?.version ?? null, to = s.prev.version;
  const r = await point(cli, s.prev.target);
  if (!r.ok) return { cli, outcome: "failed", from, to, detail: `Không trả lại được: ${r.out.slice(0, 200)}`, at };
  const bad = versionNum(from);
  const res: CliResult = { cli, outcome: "rolled_back", from, to, detail: why, at };
  // Bản bị trả lại không được cài lại ở lần cập nhật sau (chờ bản mới hơn); bản đó vẫn là "bản trước" để chuyển lại nếu cần.
  const [was, back] = [s.active, s.prev];
  s.bad = [...new Set([...(bad ? [bad] : []), ...s.bad])].slice(0, 20);
  s.active = back; s.prev = was; s.probation = null; s.last = res;
  save();
  await afterSwitch(cli);
  console.log(`[cli-update] ${cli}: trả về ${to ?? "?"} (${by}): ${why}`);
  await notify([res], by === "auto" ? "auto" : "owner");
  return res;
}

// ---------------------------------------------------------------- theo dõi lượt thật đầu tiên sau khi đổi bản
const PROBATION_MAX = 5, PROBATION_MS = 3 * 86_400_000;
/**
 * Kết quả một lượt chat thật bằng CLI này (subs.ts gọi sau mỗi lượt). Chỉ tính trong thời gian thử bản mới.
 * auth: lượt lỗi vì đăng nhập gói không còn hợp lệ. Đăng nhập của một người hết hạn hay bị thu hồi là chuyện của riêng người đó, không phải lỗi của bản CLI:
 * chỉ tính khi lần kiểm tra trước khi đổi bản chưa xác nhận được bản mới đọc đăng nhập sẵn có, và mỗi tài khoản tính tối đa một lần (một thành viên
 * có đăng nhập hết hạn gửi vài lượt không làm cả máy chủ trả về bản trước, rồi chặn luôn bản đó).
 */
export function noteCliOutcome(cli: Cli, ok: boolean, detail = "", o: { uid?: string; auth?: boolean } = {}) {
  const p = state().clis[cli]?.probation;
  if (!p) return;
  if (Date.now() - p.since > PROBATION_MS) { cliState(cli).probation = null; save(); return; }
  if (!ok && o.auth) {
    if (p.loginOk || !o.uid || (p.authUsers ?? []).includes(o.uid)) return;
    p.authUsers = [...(p.authUsers ?? []), o.uid].slice(-20);
  }
  if (ok) p.ok++; else { p.fail++; if (detail) p.errors = [...p.errors, redact(detail).slice(0, 200)].slice(-3); }
  // Hai lượt đầu đều lỗi, hoặc lỗi nhiều hơn chạy được sau 3 lượt: bản mới hỏng với lượt thật.
  if ((p.fail >= 2 && p.ok === 0) || (p.fail >= 3 && p.fail > p.ok)) {
    void rollback(cli, `Các lượt chat đầu tiên với bản mới bị lỗi (${p.fail} lỗi, ${p.ok} chạy được)${p.errors.length ? `: ${p.errors[p.errors.length - 1]}` : ""}.`).catch((e) => console.error("[cli-update]", e));
    return;
  }
  if (p.ok + p.fail >= PROBATION_MAX) cliState(cli).probation = null;
  save();
}
/** Phân loại kết quả của subTurn: lỗi do chính CLI (chết, không phản hồi, mất đăng nhập ngay sau khi đổi bản) thì tính; hết hạn mức, bị giới hạn tốc độ, người dùng dừng thì không. */
export function classifyTurn(r: { status: number; json: Record<string, unknown> }): boolean | null {
  if (r.status === 200) return r.json.cancelled ? null : true;
  if (r.status === 502) return false;
  if (r.status === 503 && (r.json.stalled || /chưa được cài/.test(String(r.json.error ?? "")))) return false;
  if (r.status === 409 && r.json.detail !== undefined) return false;
  return null;
}

// ---------------------------------------------------------------- một lần cập nhật
async function updateOne(cli: Cli): Promise<CliResult> {
  const at = Date.now(), s = cliState(cli), cur = currentTarget(cli);
  if (!cur) return { cli, outcome: "not_installed", from: null, to: null, detail: "CLI chưa được cài trên máy chủ (cài ở Providers trước).", at };
  const fromLine = await liveVersion(cli, true), from = versionNum(fromLine);
  const latest = await latestKnown(cli);
  if (latest.error && !latest.v) return { cli, outcome: SOURCE() ? "skipped" : "failed", from: fromLine, to: null, detail: latest.error, at };
  const want = latest.v;
  if (want && from && versionNum(want) === from) return { cli, outcome: "same", from: fromLine, to: fromLine, detail: "Đã là bản mới nhất.", at };
  // Bản đủ lâu mới nhất cũ hơn bản đang chạy (bản đang chạy cài tay ở Providers khi vừa ra): không bao giờ hạ cấp.
  if (want && from && /^\d+\.\d+\.\d+$/.test(want) && /^\d+\.\d+\.\d+$/.test(from) && !newer(want, from)) return { cli, outcome: "same", from: fromLine, to: fromLine, detail: "Đã là bản mới nhất.", at };
  if (want && s.bad.includes(versionNum(want) ?? want)) return { cli, outcome: "skipped", from: fromLine, to: want, detail: "Bản này đã bị trả lại trước đây vì lỗi; chờ bản sau.", at };
  const dir = path.join(versionsDir(cli), `${(want ?? "latest").replace(/[^\w.-]/g, "_")}-${at.toString(36)}`);
  const drop = () => sh('rm -rf -- "$1"', [dir]);
  const ins = await installTo(cli, dir, want);
  if (!ins.bin) { await drop(); return { cli, outcome: "failed", from: fromLine, to: want, detail: `Không cài được: ${redact(stripAnsi(ins.output)).slice(-300)}`, at }; }
  const sm = await smoke(cli, ins.bin);
  const toNum = versionNum(sm.version);
  if (sm.ok && toNum && from && toNum === from) { await drop(); return { cli, outcome: "same", from: fromLine, to: sm.version, detail: "Đã là bản mới nhất.", at }; }
  if (sm.ok && toNum && s.bad.includes(toNum)) { await drop(); return { cli, outcome: "skipped", from: fromLine, to: sm.version, detail: "Bản này đã bị trả lại trước đây vì lỗi; chờ bản sau.", at }; }
  if (!sm.ok) { await drop(); return { cli, outcome: "smoke_failed", from: fromLine, to: sm.version ?? want, detail: `${sm.detail.replace(/[\s.]*$/, ".")} Vẫn dùng bản đang chạy.`, at }; }
  const p = await point(cli, ins.bin);
  if (!p.ok) { await drop(); return { cli, outcome: "failed", from: fromLine, to: sm.version, detail: `Không đổi được sang bản mới: ${p.out.slice(0, 200)}`, at }; }
  const st = cliState(cli);
  st.prev = { target: p.prev ?? st.active?.target ?? "", version: fromLine, at: st.active?.at ?? at };
  st.active = { target: ins.bin, version: sm.version, at };
  st.probation = { since: at, ok: 0, fail: 0, errors: [], loginOk: !!sm.loginOk, authUsers: [] };
  if (!st.prev.target) st.prev = null;
  save();
  await afterSwitch(cli);
  await prune(cli);
  return { cli, outcome: "updated", from: fromLine, to: sm.version, detail: sm.detail, at };
}

/** Cập nhật mọi CLI đã cài (lần lượt từng cái). Đang chạy thì trả về lần đang chạy. */
export function runUpdate(reason: "timer" | "owner", only?: Cli): Promise<CliResult[]> {
  if (mem.job) return mem.job;
  const s = state();
  s.running = true;
  mem.job = (async () => {
    const out: CliResult[] = [];
    for (const cli of only ? [only] : CLIS) {
      let r: CliResult;
      try { r = await updateOne(cli); } catch (e) { r = { cli, outcome: "failed", from: null, to: null, detail: redact(String((e as Error).message)).slice(0, 300), at: Date.now() }; }
      cliState(cli).last = r;
      out.push(r);
      console.log(`[cli-update] ${cli}: ${r.outcome} ${r.from ?? "?"} → ${r.to ?? "?"} ${r.outcome === "same" ? "" : r.detail}`.trim());
    }
    s.lastRun = Date.now();
    s.nextAt = nextSlot(s.lastRun + every());
    save();
    await notify(out, reason);
    // Bản mới có thể đọc được model mới của gói: sổ model (app/modelreg.ts) dò lại ngay.
    if (out.some((r) => r.outcome === "updated")) void import("../modelreg").then((m) => m.discoverModels("timer")).catch((e) => console.error("[cli-update] sổ model:", e));
    return out;
  })().finally(() => { s.running = false; mem.job = null; });
  return mem.job;
}

// ---------------------------------------------------------------- báo quản trị viên
const LINE: Record<Outcome, (r: CliResult) => string> = {
  updated: (r) => `${CLI_NAME[r.cli]}: đã cập nhật ${r.from ?? "?"} → ${r.to ?? "?"}. ${r.detail} Bản trước được giữ để trả lại ngay nếu cần.`,
  same: (r) => `${CLI_NAME[r.cli]}: đã là bản mới nhất (${r.to ?? r.from ?? "?"}).`,
  failed: (r) => `${CLI_NAME[r.cli]}: chưa cập nhật được. ${r.detail}`,
  smoke_failed: (r) => `${CLI_NAME[r.cli]}: bản ${r.to ?? "mới"} không qua kiểm tra, vẫn dùng ${r.from ?? "bản đang chạy"}. ${r.detail}`,
  skipped: (r) => `${CLI_NAME[r.cli]}: bỏ qua. ${r.detail}`,
  rolled_back: (r) => `${CLI_NAME[r.cli]}: đã trả về ${r.to ?? "bản trước"} (bản ${r.from ?? "mới"} lỗi). ${r.detail}`,
  not_installed: (r) => `${CLI_NAME[r.cli]}: chưa cài trên máy chủ.`,
};
const adminIds = () => (db().prepare("SELECT * FROM users WHERE status = 'active' AND email_verified = 1").all() as UserRow[]).filter(isAdmin).map((u) => u.id);
async function notify(rs: CliResult[], reason: "timer" | "owner" | "auto") {
  const worth = rs.filter((r) => r.outcome !== "same" && r.outcome !== "not_installed" && !(r.outcome === "skipped" && SOURCE() && !r.to));
  // Lần hằng tuần mà mọi CLI đã mới nhất: không báo (khỏi một thư mỗi tuần). Chủ sở hữu tự bấm thì luôn báo.
  if (!worth.length && reason !== "owner") return;
  const changed = rs.filter((r) => r.outcome === "updated"), back = rs.filter((r) => r.outcome === "rolled_back"), bad = rs.filter((r) => r.outcome === "failed" || r.outcome === "smoke_failed");
  const title = back.length ? `Đã trả ${back.map((r) => CLI_NAME[r.cli]).join(", ")} về bản trước` : changed.length ? `Đã cập nhật ${changed.map((r) => CLI_NAME[r.cli]).join(", ")}${bad.length ? `; ${bad.map((r) => CLI_NAME[r.cli]).join(", ")} chưa cập nhật được` : ""}` : bad.length ? `Chưa cập nhật được ${bad.map((r) => CLI_NAME[r.cli]).join(", ")}` : "CLI của các gói đã là bản mới nhất";
  const head = reason === "auto" ? "Synchro tự trả về bản trước vì các lượt chat thật đầu tiên với bản mới bị lỗi. Đăng nhập gói của mọi người vẫn giữ nguyên." : reason === "owner" ? "Kết quả lần cập nhật CLI bạn vừa chạy:" : "Kết quả lần cập nhật CLI hằng tuần:";
  const text = `${head}\n${rs.map((r) => `- ${LINE[r.outcome](r)}`).join("\n")}`;
  try { const { addNotice } = await import("../tasks"); for (const id of adminIds()) addNotice(id, title, text, "settings:Providers"); } catch (e) { console.error("[cli-update] Hộp thư:", e); }
}

// ---------------------------------------------------------------- hẹn giờ
/** Mốc chạy: 04:00 giờ máy chủ của ngày đến hạn (ít người dùng), lệch ngẫu nhiên tới 40 phút. */
export function nextSlot(due: number, now = Date.now()) {
  const d = new Date(due);
  d.setHours(4, Math.floor(Math.random() * 40), 0, 0);
  if (d.getTime() < due - 12 * 3_600_000) d.setDate(d.getDate() + 1);
  // 04:xx của ngày đến hạn đã qua (khởi động hay bật lại lúc 09:00 thì hạn là 10:00 cùng ngày): sang 04:xx hôm sau, không cài lúc ban ngày.
  while (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
/** Bộ hẹn giờ (unref: không giữ tiến trình sống): xem mỗi 15 phút đã tới hạn chưa. */
export function startCliUpdates() {
  if (envOff() || mem.timer) return;
  const s = state();
  if (!s.nextAt) { s.nextAt = nextSlot(Date.now() + (s.lastRun ? Math.max(0, s.lastRun + every() - Date.now()) : 3_600_000)); save(); }
  const tick = () => {
    const st = state();
    if (!st.on || mem.job || !st.nextAt || Date.now() < st.nextAt) return;
    void runUpdate("timer").catch((e) => console.error("[cli-update]", e));
  };
  mem.timer = setInterval(tick, Number(process.env.SYNCHRO_CLI_UPDATE_TICK_MS) || 15 * 60_000);
  mem.timer.unref?.();
}

// ---------------------------------------------------------------- cho Cài đặt → Providers
export type CliView = { cli: Cli; name: string; installed: boolean; version: string | null; managed: boolean; prev: string | null; canRollback: boolean; probation: { ok: number; fail: number } | null; last: CliResult | null; bad: string[] };
export async function cliUpdateView(): Promise<{ on: boolean; envOff: boolean; running: boolean; lastRun: number | null; nextAt: number | null; clis: CliView[] }> {
  const s = state();
  const clis = await Promise.all(CLIS.map(async (cli): Promise<CliView> => {
    const c = s.clis[cli], cur = currentTarget(cli);
    return {
      cli, name: CLI_NAME[cli], installed: !!cur, version: cur ? await liveVersion(cli) : null, managed: !!cur && cur.kind === "link" && !!versionRoot(cli, cur.target),
      // Bản trước là bản vừa bị trả lại vì lỗi: không hiện như một bản để quay về.
      prev: c?.prev && !isBad(c, c.prev.version) ? c.prev.version : null, canRollback: !!c?.prev && fs.existsSync(resolveTarget(c.prev.target)) && !isBad(c, c.prev.version), probation: c?.probation ? { ok: c.probation.ok, fail: c.probation.fail } : null, last: c?.last ?? null, bad: c?.bad ?? [],
    };
  }));
  return { on: s.on, envOff: envOff(), running: !!mem.job, lastRun: s.lastRun, nextAt: s.on && !envOff() ? s.nextAt : null, clis };
}
export function setAutoUpdate(on: boolean) {
  const s = state();
  s.on = on;
  if (on && (!s.nextAt || s.nextAt < Date.now())) s.nextAt = nextSlot(Date.now() + (s.lastRun ? Math.max(3_600_000, s.lastRun + every() - Date.now()) : 3_600_000));
  save();
}
