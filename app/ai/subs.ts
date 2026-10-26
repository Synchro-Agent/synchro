// Gói subscription trong Synchro (ADR 0001): model của gói hiện trong bộ chọn model của chính người đã đăng nhập,
// lượt chat chạy qua engine CLI (nối tiếp phiên bằng resume), hạn mức của gói (phiên 5 giờ, tuần) cho vòng tròn mức dùng.
// Khóa model: "sub-claude/sonnet", "sub-codex/gpt-6.1-sol", "sub-agy/gemini-3-pro" ("default" = model mặc định của gói).
// Bộ chọn model gộp theo hãng (Claude, ChatGPT, Gemini): đã đăng nhập gói thì nhóm hiện model của gói; gói hết hạn mức thì
// Synchro KHÔNG tự chuyển sang khóa API mà hỏi người dùng. Đồng ý thì nhóm đó hiện model của khóa API cho tới khi gói hồi lại.
import path from "node:path";
import { db, type UserRow } from "../authstore";
import { ALL, equivalentModel, splitKey, vendorOf, type ProviderInfo } from "../catalog";
import { canModel } from "../authstore";
import { catalog, mainModels } from "../providers";
import { engineFor } from "./selector";
import { engineEnv, everLoggedIn, markRelogin, needsRelogin, safeScope, status } from "./cli_auth";
import { CLIS, type Cli, engineHome, find, makeDir, spawnCli, stripAnsi } from "./cli_runtime";
import type { RateWindow, TurnRequest } from "./engine";
import { redact } from "./errors";

export const SUB_PREFIX = "sub-";
export const subCli = (key: unknown): Cli | null => {
  if (typeof key !== "string") return null;
  const p = splitKey(key).provider;
  const c = p.startsWith(SUB_PREFIX) ? p.slice(SUB_PREFIX.length) : "";
  return (CLIS as string[]).includes(c) ? (c as Cli) : null;
};

/** Tên gói, hãng (để hiện logo), và model mặc định khi chưa đọc được danh sách thật. */
export const SUB: Record<Cli, { name: string; vendor: "anthropic" | "openai" | "google"; label: string; fallback: { id: string; name: string }[] }> = {
  claude: { name: "Claude", vendor: "anthropic", label: "Claude · Your plan", fallback: [{ id: "opus", name: "Claude Opus" }, { id: "sonnet", name: "Claude Sonnet" }, { id: "haiku", name: "Claude Haiku" }] },
  codex: { name: "ChatGPT", vendor: "openai", label: "ChatGPT · Your plan", fallback: [{ id: "default", name: "ChatGPT (plan default)" }] },
  agy: { name: "Gemini", vendor: "google", label: "Gemini · Your plan", fallback: [{ id: "default", name: "Gemini (plan default)" }] },
};

// ---------------------------------------------------------------- codex app-server (JSON-RPC qua stdio)
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Gọi vài phương thức của `codex app-server` (danh sách model, gói, hạn mức) rồi tắt tiến trình. */
export async function codexRpc(scope: string, calls: { method: string; params?: Json }[], timeoutMs = 20_000): Promise<(Json | null)[]> {
  const bin = find("codex");
  const out: (Json | null)[] = calls.map(() => null);
  if (!bin) return out;
  const work = path.join(engineHome(), "work");
  makeDir(work);
  const p = spawnCli(bin, ["app-server"], { env: engineEnv("codex", scope), cwd: work, timeoutMs });
  const send = (o: Json) => p.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
  send({ id: 0, method: "initialize", params: { clientInfo: { name: "synchro", version: "1.0" } } });
  send({ method: "initialized" });
  calls.forEach((c, i) => send({ id: i + 1, method: c.method, params: c.params ?? {} }));
  let left = calls.length;
  for await (const l of p.lines) {
    let j: Json;
    try { j = JSON.parse(l); } catch { continue; }
    if (typeof j.id === "number" && j.id > 0 && j.id <= calls.length) {
      out[j.id - 1] = j.result ?? null;
      if (--left === 0) break;
    }
  }
  p.kill();
  await p.done;
  return out;
}

// ---------------------------------------------------------------- danh sách model của gói
type G = {
  models: Map<string, { at: number; v: { id: string; name: string }[] }>;
  limits: Map<string, { at: number; plan?: string; credits?: string | null; windows: (RateWindow | PlanWindow)[] }>;
  /** Gói báo hết hạn mức mà không kèm mốc đặt lại: tạm coi là hết tới thời điểm này. */
  quota: Map<string, number>;
};
const g: G = ((globalThis as { __synchroSubs?: G }).__synchroSubs ??= { models: new Map(), limits: new Map(), quota: new Map() });
g.quota ??= new Map();
const MODELS_TTL = 10 * 60_000;

async function detectModels(cli: Cli, scope: string, agyModels?: string[]): Promise<{ id: string; name: string }[]> {
  if (cli === "agy") {
    const ids = (agyModels ?? []).map((l) => l.split(/\s+/)[0]).filter((x) => /^[a-z][\w.:/-]{2,60}$/i.test(x));
    // "gemini-3-pro" → "Gemini 3 Pro", "claude-sonnet-4.5" → "Claude Sonnet 4.5", "gpt-oss-120b" → "GPT Oss 120b".
    const pretty = (id: string) => id.split("-").map((w) => (/^gpt$/i.test(w) ? "GPT" : w[0].toUpperCase() + w.slice(1))).join(" ");
    return ids.length ? [...new Set(ids)].map((id) => ({ id, name: pretty(id) })) : SUB.agy.fallback;
  }
  if (cli === "codex") {
    const [r] = await codexRpc(scope, [{ method: "model/list" }]).catch(() => [null]);
    const list = ((r?.data ?? []) as Json[]).filter((m) => !m.hidden && typeof (m.id ?? m.model) === "string").map((m) => ({ id: String(m.id ?? m.model), name: String(m.displayName ?? m.id) }));
    return list.length ? list : SUB.codex.fallback;
  }
  // Claude Code nhận tên viết tắt (opus, sonnet, haiku) và tự dùng bản mới nhất mà gói được phép.
  return SUB.claude.fallback;
}

const VENDOR_CLI: Record<string, Cli> = { anthropic: "claude", openai: "codex", google: "agy" };

/** Model của gói (đã đăng nhập, không cần đăng nhập lại), đọc lại tối đa 10 phút một lần. */
async function planModels(cli: Cli, u: UserRow) {
  if (!find(cli) || !everLoggedIn(cli, u.id)) return null;
  const s = await status(cli, u.id, { stale: true }).catch(() => null);
  if (!s?.loggedIn || s.relogin) return null;
  const k = `${cli}:${u.id}`, hit = g.models.get(k);
  const models = hit && Date.now() - hit.at < MODELS_TTL ? hit.v : await detectModels(cli, u.id, s.models);
  g.models.set(k, { at: Date.now(), v: models });
  return models.map((m) => ({ key: `${SUB_PREFIX}${cli}/${m.id}`, id: m.id, name: m.name }));
}

/**
 * Nhóm model theo hãng cho bộ chọn model. api: các nhóm khóa API (đã lọc theo model quản trị viên cho hiện).
 * Nhóm của hãng có gói đã đăng nhập hiện model của gói, trừ khi người dùng đã đồng ý dùng khóa API thay gói (tới khi gói hồi lại).
 */
export async function mergedProviders(u: UserRow, api: ProviderInfo[]): Promise<ProviderInfo[]> {
  const out: ProviderInfo[] = [];
  const used = new Set<string>();
  for (const vendor of ["anthropic", "openai", "google"]) {
    const cli = VENDOR_CLI[vendor];
    const ap = api.find((p) => p.id === vendor) ?? api.find((p) => p.kind === vendor && !used.has(p.id));
    if (ap) used.add(ap.id);
    const models = await planModels(cli, u);
    if (!models?.length) { if (ap) out.push({ ...ap, source: "api" }); continue; }
    const plan = { cli, models, blockedUntil: planBlock(cli, u.id), usingApiUntil: apiOptIn(u.id, cli), relogin: needsRelogin(cli, u.id) };
    const name = ap?.name ?? SUB[cli].name;
    if (plan.usingApiUntil && ap?.models.length) out.push({ ...ap, name, source: "api", plan });
    else out.push({ id: ap?.id ?? vendor, name, kind: SUB[cli].vendor, models, source: "plan", plan });
  }
  for (const p of api) if (!used.has(p.id)) out.push({ ...p, source: "api" });
  return out;
}

/** Model API tương đương để đề nghị khi gói hết hạn mức (model quản trị viên cho hiện và người dùng được dùng). */
export async function apiEquivalent(u: UserRow, key: string): Promise<string | null> {
  const vendor = vendorOf(key), main = mainModels();
  const cands = (await catalog()).filter((p) => p.kind === vendor).flatMap((p) => p.models)
    .filter((m) => (main.includes(ALL) || main.includes(m.key)) && canModel(u, m.key));
  return equivalentModel(key, cands);
}

/** Tên hiển thị của một khóa model API ("anthropic/claude-haiku-5-5" → "Claude Haiku 5.5"). */
export async function apiModelName(key: string | null) {
  if (!key) return null;
  return (await catalog()).flatMap((p) => p.models).find((m) => m.key === key)?.name ?? null;
}

/** Người dùng có được dùng model gói này không (đã đăng nhập CLI đó). */
export async function ownsSub(u: UserRow, key: string) {
  const cli = subCli(key);
  return !!cli && !!find(cli) && !!(await status(cli, u.id).catch(() => null))?.loggedIn;
}
export const forgetSubModels = (cli: Cli, uid: string) => g.models.delete(`${cli}:${uid}`);

// ---------------------------------------------------------------- hạn mức của gói
// Cách các hãng đặt lại hạn mức (theo tài liệu của hãng và dữ liệu chính CLI báo về):
// - Claude (Pro, Max): phiên 5 giờ bắt đầu từ tin nhắn đầu tiên khi phiên trước đã hết; hạn mức tuần đặt lại vào một mốc cố định
//   mỗi tuần riêng cho từng tài khoản (Max có thêm hạn mức tuần riêng theo model). Claude Code báo utilization và resetsAt từng cửa sổ.
// - ChatGPT (Codex): Plus có phiên 5 giờ cuốn chiếu và hạn mức tuần; các gói Pro chỉ có hạn mức tuần. codex app-server báo
//   primary / secondary { usedPercent, windowDurationMins, resetsAt }.
// - Gemini (Antigravity): Pro và Ultra hồi quota mỗi 5 giờ cho tới khi chạm hạn mức tuần; gói khác chỉ có hạn mức tuần.
//   Quota tách hai nhóm: model Gemini, và model Claude / GPT; agy hiện trong bảng /usage (/quota).
// Mốc đặt lại luôn lấy từ hãng. Khi mốc đã qua mà chưa có số mới: phiên 5 giờ về 0% và bắt đầu lại ở tin nhắn sau;
// hạn mức tuần về 0% và mốc kế tiếp là đúng một tuần sau mốc cũ.
export type WindowKind = "session" | "weekly" | "other";
export type PlanWindow = RateWindow & { label: string; kind: WindowKind; group?: string; idle?: boolean };
export type SubUsage = { cli: Cli; name: string; plan: string | null; windows: PlanWindow[]; turnsToday: number; note: string | null; credits: string | null; at: number | null };

const WINDOW_NAME: Record<string, string> = {
  five_hour: "Current session", seven_day: "Weekly · all models", seven_day_opus: "Weekly · Opus", seven_day_sonnet: "Weekly · Sonnet",
  seven_day_overage_included: "Weekly · model limit", overage: "Usage credits",
};
export const kindOf = (window: string): WindowKind => (/five_hour|5h|session/.test(window) ? "session" : /seven_day|weekly|week/.test(window) ? "weekly" : "other");
const WEEK = 7 * 86_400_000;

/** Áp quy tắc đặt lại khi mốc của hãng đã qua (chưa có số mới từ lượt chat sau). */
export function project(w: PlanWindow, now = Date.now()): PlanWindow {
  if (!w.resetsAt || w.resetsAt > now) return w;
  if (w.kind === "session") return { ...w, usedPct: 0, resetsAt: undefined, status: "allowed", idle: true };
  if (w.kind === "weekly") { let t = w.resetsAt; while (t <= now) t += WEEK; return { ...w, usedPct: 0, resetsAt: t, status: "allowed" }; }
  return { ...w, usedPct: 0, resetsAt: undefined, status: "allowed" };
}

function saveLimits(cli: Cli, uid: string, windows: PlanWindow[] | RateWindow[], extra: { plan?: string; credits?: string | null } = {}) {
  const k = `${cli}:${uid}`, old = g.limits.get(k);
  const merged = new Map((old?.windows ?? []).map((w) => [w.window, w]));
  for (const w of windows) merged.set(w.window, w);
  g.limits.set(k, { at: Date.now(), plan: extra.plan ?? old?.plan, credits: extra.credits !== undefined ? extra.credits : old?.credits, windows: [...merged.values()] });
}

/** codex: cửa sổ ≤ 1 ngày là phiên (5 giờ), dài hơn là tuần. Pro không có phiên 5 giờ nên chỉ còn cửa sổ tuần. */
export function codexWindows(r: Json | null): { windows: RateWindow[]; plan?: string; credits: string | null } {
  const rl = (r?.rateLimits ?? r ?? {}) as Json;
  const reached = typeof rl.rateLimitReachedType === "string";
  const one = (x: Json | null | undefined): RateWindow | null => {
    if (!x || typeof x.usedPercent !== "number") return null;
    const mins = Number(x.windowDurationMins ?? 0);
    const window = mins && mins <= 24 * 60 ? "five_hour" : "seven_day";
    const t = Number(x.resetsAt ?? 0);
    return { window, usedPct: Math.min(100, x.usedPercent), resetsAt: t ? (t < 1e12 ? t * 1000 : t) : undefined, status: x.usedPercent >= 100 || (reached && x.usedPercent >= 99) ? "rejected" : x.usedPercent >= 80 ? "allowed_warning" : "allowed" };
  };
  const c = rl.credits as Json | null | undefined;
  return {
    windows: [one(rl.primary), one(rl.secondary)].filter((w): w is RateWindow => !!w),
    plan: typeof rl.planType === "string" && rl.planType !== "unknown" ? rl.planType : undefined,
    credits: c?.unlimited ? "Unlimited credits" : c?.hasCredits && c.balance ? `Credits: ${c.balance}` : null,
  };
}

/** agy: bảng /usage có "Five Hour Limit Remaining" và "Weekly Limit Remaining" cho từng nhóm model (đọc từ terminal giả). */
export function agyWindows(text: string): PlanWindow[] {
  const out: PlanWindow[] = [];
  let group = "", gid = "";
  const dur = (s: string) => {
    let ms = 0;
    for (const [, n, u] of s.matchAll(/(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/gi)) ms += Number(n) * (/^d/i.test(u) ? 86_400_000 : /^h/i.test(u) ? 3_600_000 : 60_000);
    return ms;
  };
  for (const line of text.split("\n")) {
    if (/gemini models?/i.test(line)) { group = "Gemini models"; gid = "gemini"; }
    else if (/claude\b.*\bgpt|gpt\b.*\bclaude/i.test(line) && /models?/i.test(line)) { group = "Claude and GPT models"; gid = "other"; }
    const m = /(five[ -]?hour|5[ -]?hour|weekly)\s+limit\s+remaining\D*?(\d+(?:\.\d+)?)\s*%/i.exec(line);
    if (!m) continue;
    const kind: WindowKind = /week/i.test(m[1]) ? "weekly" : "session";
    const r = /reset[s]?\s+(?:in\s+)?(.+)$/i.exec(line.slice(m.index + m[0].length));
    const ms = r ? dur(r[1]) : 0;
    const remaining = Number(m[2]);
    out.push({ window: `${gid || "all"}_${kind}`, label: `${kind === "weekly" ? "Weekly" : "Current session"}${group ? ` · ${group}` : ""}`, kind, group: group || undefined,
      usedPct: Math.max(0, Math.min(100, Math.round((100 - remaining) * 10) / 10)), resetsAt: ms ? Date.now() + ms : undefined, status: remaining <= 0 ? "rejected" : remaining <= 20 ? "allowed_warning" : "allowed" });
  }
  return out;
}

/** Mở agy trong terminal giả, gõ /usage, đọc bảng hạn mức rồi thoát. */
async function agyUsage(scope: string): Promise<PlanWindow[]> {
  const bin = find("agy");
  if (!bin) return [];
  const work = path.join(engineHome(), "work", safeScope(scope));
  makeDir(work);
  const p = spawnCli(bin, [], { env: engineEnv("agy", scope), cwd: work, pty: true, timeoutMs: 30_000 });
  let raw = "", last = Date.now(), asked = false;
  p.child.stdout!.on("data", (d: Buffer) => { raw = (raw + d.toString()).slice(-200_000); last = Date.now(); });
  const t0 = Date.now();
  let windows: PlanWindow[] = [];
  while (Date.now() - t0 < 25_000) {
    await new Promise((r) => setTimeout(r, 300));
    const text = stripAnsi(raw);
    if (!asked && Date.now() - last > 1200 && Date.now() - t0 > 1500) { p.write("/usage\r"); asked = true; last = Date.now(); continue; }
    if (asked && /limit\s+remaining/i.test(text) && Date.now() - last > 800) { windows = agyWindows(text.slice(text.search(/\/usage|limit\s+remaining/i))); break; }
  }
  p.write("q"); p.kill();
  await p.done;
  return windows;
}

/** Gói đang hết hạn mức tới lúc nào (cửa sổ bị từ chối hoặc đã dùng 100% mà chưa tới mốc đặt lại), hoặc null. */
export function planBlock(cli: Cli, uid: string): number | null {
  const k = `${cli}:${uid}`, now = Date.now();
  let until = 0;
  for (const w of g.limits.get(k)?.windows ?? []) {
    // agy: nhóm Gemini mới chặn model Gemini của gói.
    if (cli === "agy" && (w as PlanWindow).group && !/gemini/i.test((w as PlanWindow).group!)) continue;
    if ((w.status === "rejected" || (w.usedPct ?? 0) >= 100) && w.resetsAt && w.resetsAt > now) until = Math.max(until, w.resetsAt);
  }
  const q = g.quota.get(k);
  if (q && q > now) until = Math.max(until, q);
  return until || null;
}

/** Người dùng đã đồng ý dùng khóa API thay gói tới lúc nào (tự hết khi gói hồi lại), hoặc null. */
export function apiOptIn(uid: string, cli: Cli): number | null {
  const r = sessDb().prepare("SELECT until FROM engine_api_optin WHERE user_id = ? AND cli = ?").get(uid, cli) as { until: number } | undefined;
  return r && r.until > Date.now() ? r.until : null;
}
/** on: dùng khóa API thay gói tới khi gói hồi lại (không rõ mốc thì 5 giờ); off: quay lại gói ngay. */
export function setApiOptIn(uid: string, cli: Cli, on: boolean) {
  const d = sessDb();
  if (!on) { d.prepare("DELETE FROM engine_api_optin WHERE user_id = ? AND cli = ?").run(uid, cli); return null; }
  const until = planBlock(cli, uid) ?? Date.now() + 5 * 3600_000;
  d.prepare("INSERT INTO engine_api_optin (user_id, cli, until) VALUES (?, ?, ?) ON CONFLICT(user_id, cli) DO UPDATE SET until = excluded.until").run(uid, cli, until);
  return until;
}
/** Đăng xuất gói: quên hạn mức, model và lựa chọn dùng API của gói đó. */
export function forgetPlan(cli: Cli, uid: string) {
  const k = `${cli}:${uid}`;
  g.limits.delete(k); g.models.delete(k); g.quota.delete(k);
  sessDb().prepare("DELETE FROM engine_api_optin WHERE user_id = ? AND cli = ?").run(uid, cli);
}

const turnsToday = (uid: string, cli: Cli) => {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  return (sessDb().prepare("SELECT COUNT(*) AS n FROM engine_turns WHERE user_id = ? AND cli = ? AND at >= ?").get(uid, cli, since.getTime()) as { n: number }).n;
};

const label = (w: RateWindow) => WINDOW_NAME[w.window] ?? w.window.replace(/_/g, " ");
const NOTE: Record<Cli, string> = {
  claude: "The session starts with your first message and lasts 5 hours. Weekly limits reset at a fixed time each week.",
  codex: "Plus has a rolling 5-hour window and a weekly limit. Pro plans only have a weekly limit.",
  agy: "Google AI Pro and Ultra refresh every 5 hours until the weekly limit is reached. Gemini and Claude/GPT models have separate quotas.",
};

export async function subUsage(u: UserRow, cli: Cli): Promise<SubUsage> {
  const k = `${cli}:${u.id}`;
  let hit = g.limits.get(k);
  // Claude báo hạn mức trong mỗi lượt chat (rate_limit_event); codex đọc qua app-server (tối đa mỗi phút);
  // agy đọc bảng /usage (tối đa 5 phút một lần vì phải mở cả CLI).
  if (cli === "codex" && (!hit || Date.now() - hit.at > 60_000)) {
    const [acc, rl] = await codexRpc(u.id, [{ method: "account/read" }, { method: "account/rateLimits/read" }]).catch(() => [null, null]);
    const c = codexWindows(rl);
    saveLimits(cli, u.id, c.windows, { plan: (typeof acc?.account?.planType === "string" ? acc.account.planType : undefined) ?? c.plan, credits: c.credits });
    hit = g.limits.get(k);
  } else if (cli === "agy" && (!hit || Date.now() - hit.at > 5 * 60_000)) {
    saveLimits(cli, u.id, await agyUsage(u.id).catch(() => []));
    hit = g.limits.get(k);
  } else if (cli === "claude" && !hit?.plan) {
    const s = await status("claude", u.id).catch(() => null);
    if (s?.plan) saveLimits(cli, u.id, [], { plan: s.plan });
    hit = g.limits.get(k);
  }
  const now = Date.now();
  const order = (w: PlanWindow) => (w.kind === "session" ? 0 : w.kind === "weekly" ? 1 : 2) + (w.group && !/gemini/i.test(w.group) ? 0.5 : 0);
  const windows = (hit?.windows ?? [])
    .map((w) => project({ ...w, label: "label" in w ? (w as PlanWindow).label : label(w), kind: "kind" in w ? (w as PlanWindow).kind : kindOf(w.window) } as PlanWindow, now))
    .sort((a, b) => order(a) - order(b));
  const plan = hit?.plan ? hit.plan.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null;
  return { cli, name: SUB[cli].name, plan, windows, turnsToday: turnsToday(u.id, cli), credits: hit?.credits ?? null, at: hit?.at ?? null,
    note: windows.length ? NOTE[cli] : cli === "agy" ? `${NOTE.agy} Synchro could not read the quota panel yet.` : `Send a message with this plan to see its limits. ${NOTE[cli]}` };
}

// ---------------------------------------------------------------- phiên CLI theo đoạn chat
let ready = false;
function sessDb() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS engine_sessions (user_id TEXT NOT NULL, conv TEXT NOT NULL, cli TEXT NOT NULL, session_id TEXT NOT NULL, turns INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, conv, cli));
      CREATE TABLE IF NOT EXISTS engine_turns (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, cli TEXT NOT NULL, at INTEGER NOT NULL, via TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS engine_turns_user ON engine_turns(user_id, cli, at);
      CREATE TABLE IF NOT EXISTS engine_api_optin (user_id TEXT NOT NULL, cli TEXT NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (user_id, cli))`);
    d.prepare("DELETE FROM engine_sessions WHERE updated_at < ?").run(Date.now() - 90 * 86_400_000);
    d.prepare("DELETE FROM engine_turns WHERE at < ?").run(Date.now() - 30 * 86_400_000);
    ready = true;
  }
  return d;
}
export function removeUserSubs(uid: string) {
  const d = sessDb();
  d.prepare("DELETE FROM engine_sessions WHERE user_id = ?").run(uid);
  d.prepare("DELETE FROM engine_turns WHERE user_id = ?").run(uid);
  d.prepare("DELETE FROM engine_api_optin WHERE user_id = ?").run(uid);
}

type Msg = { role?: string; content?: unknown };
/** Chữ của một tin nhắn (khối văn bản, chữ đọc được từ tài liệu; ảnh chưa gửi được qua CLI). */
function textOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return (c as { type?: string; text?: string; name?: string; fallbackText?: string }[]).map((b) =>
    b.type === "text" ? b.text ?? ""
    : b.type === "document" ? `<file name="${b.name ?? "tệp"}">\n${b.fallbackText ?? ""}\n</file>`
    : b.type === "image" ? "[Ảnh đính kèm: gói subscription qua Synchro chưa đọc được ảnh]" : "").filter(Boolean).join("\n\n");
}

export type SubTurn = { user: UserRow; model: string; system: string; messages: unknown; conv?: string; signal?: AbortSignal; onDelta?: (t: string) => void };
export type SubResult = { status: number; json: Json };

/** Một lượt chat bằng gói subscription của chính người dùng. */
export async function subTurn(o: SubTurn): Promise<SubResult> {
  const cli = subCli(o.model)!;
  const s = await status(cli, o.user.id);
  if (!s.installed) return { status: 503, json: { error: `${SUB[cli].name} CLI chưa được cài trên máy chủ. Quản trị viên cài ở Cài đặt → Providers.` } };
  if (!s.loggedIn) return { status: 409, json: { error: `Bạn chưa đăng nhập gói ${SUB[cli].name}. Đăng nhập ở Cài đặt → Providers.`, relogin: cli } };
  const msgs = (Array.isArray(o.messages) ? o.messages : []) as Msg[];
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "user") return { status: 400, json: { error: "Thiếu tin nhắn của người dùng." } };
  const d = sessDb();
  const conv = o.conv && o.conv.length <= 64 ? o.conv : null;
  const prev = conv ? (d.prepare("SELECT session_id, turns FROM engine_sessions WHERE user_id = ? AND conv = ? AND cli = ?").get(o.user.id, conv, cli) as { session_id: string; turns: number } | undefined) : undefined;
  // Nối tiếp phiên của CLI khi lịch sử khớp đúng lượt trước (không sửa, không tạo lại câu trả lời); ngược lại mở phiên mới kèm lịch sử.
  const resume = prev && prev.turns === msgs.length - 1 ? prev.session_id : undefined;
  const history = resume ? "" : msgs.slice(0, -1).map((m) => `[${m.role === "assistant" ? "assistant" : "user"}]\n${textOf(m.content)}`).filter((x) => x.trim()).join("\n\n");
  const prompt = (history ? `<conversation_history>\n${history}\n</conversation_history>\n\n` : "") + textOf(last.content);
  const id = splitKey(o.model).id;
  const work = path.join(engineHome(), "work", safeScope(o.user.id));
  makeDir(work);
  const req: TurnRequest = {
    prompt, system: o.system || undefined, model: id && id !== "default" ? id : undefined, sessionId: resume, workdir: work, env: engineEnv(cli, o.user.id), signal: o.signal,
    history: msgs.slice(0, -1).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: textOf(m.content) })),
  };
  // Không tự chuyển sang khóa API khi gói hết hạn mức: trả về để trình duyệt hỏi người dùng (xem planLimit bên dưới).
  const eng = engineFor(cli);
  let text = "", final: string | null = null, via: string | null = null, session: string | null = null, err: { message: string; code?: string } | null = null;
  for await (const e of eng.runTurn(req)) {
    if (e.kind === "text") { text += e.text; o.onDelta?.(e.text); }
    else if (e.kind === "session") session = e.id;
    else if (e.kind === "final") { final = e.text; via = e.via ?? cli; }
    else if (e.kind === "usage" && e.usage.limits?.length) saveLimits(cli, o.user.id, e.usage.limits);
    else if (e.kind === "error") err = { message: e.message, code: e.code };
  }
  if (err && final === null) {
    if (err.code === "aborted") return { status: 200, json: { model: o.model, text, cancelled: true } };
    const apiModel = await apiEquivalent(o.user, o.model), apiName = await apiModelName(apiModel);
    if (err.code === "auth") {
      markRelogin(cli, o.user.id);
      return { status: 409, json: { error: `Phiên đăng nhập gói ${SUB[cli].name} không còn hợp lệ. Đăng nhập lại ở Cài đặt → Providers.`, relogin: cli, apiModel, apiModelName: apiName, detail: redact(err.message).slice(0, 300) } };
    }
    if (err.code === "quota") {
      // Gói không báo mốc đặt lại thì tạm coi là hết trong 30 phút; codex đọc lại hạn mức ở lần mở vòng tròn sau.
      if (!planBlock(cli, o.user.id)) g.quota.set(`${cli}:${o.user.id}`, Date.now() + 30 * 60_000);
      if (cli === "codex") { const h = g.limits.get(`${cli}:${o.user.id}`); if (h) h.at = 0; }
      return { status: 429, json: { error: `Gói ${SUB[cli].name} của bạn đã hết hạn mức.`, planLimit: cli, resetsAt: planBlock(cli, o.user.id), apiModel, apiModelName: apiName, detail: redact(err.message).slice(0, 200) } };
    }
    if (err.code === "timeout") return { status: 504, json: { error: "Lượt này chạy quá 30 phút nên đã dừng." } };
    return { status: 502, json: { error: redact(err.message).slice(0, 500) || "Gói subscription báo lỗi." } };
  }
  g.quota.delete(`${cli}:${o.user.id}`);
  d.prepare("INSERT INTO engine_turns (user_id, cli, at, via) VALUES (?, ?, ?, ?)").run(o.user.id, cli, Date.now(), via ?? cli);
  if (conv && session) {
    d.prepare(`INSERT INTO engine_sessions (user_id, conv, cli, session_id, turns, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, conv, cli) DO UPDATE SET session_id = excluded.session_id, turns = excluded.turns, updated_at = excluded.updated_at`)
      .run(o.user.id, conv, cli, session, msgs.length + 1, Date.now());
  }
  return { status: 200, json: { model: o.model, text: final ?? text, via } };
}
