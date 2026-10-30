// Gói subscription trong Synchro (ADR 0001): model của gói hiện trong bộ chọn model của chính người đã đăng nhập,
// lượt chat chạy qua engine CLI (nối tiếp phiên bằng resume), hạn mức của gói (phiên 5 giờ, tuần) cho vòng tròn mức dùng.
// Khóa model: "sub-claude/sonnet", "sub-codex/gpt-6.1-sol", "sub-agy/gemini-3-pro" ("default" = model mặc định của gói).
// Bộ chọn model gộp theo hãng (Claude, ChatGPT, Gemini): đã đăng nhập gói thì nhóm hiện model của gói; gói hết hạn mức thì
// Synchro KHÔNG tự chuyển sang khóa API mà hỏi người dùng. Đồng ý thì nhóm đó hiện model của khóa API cho tới khi gói hồi lại.
import crypto from "node:crypto";
import path from "node:path";
import { db, type UserRow } from "../authstore";
import { ALL, equivalentModel, splitKey, vendorOf, type ProviderInfo } from "../catalog";
import { canModel } from "../authstore";
import { catalog, mainModels } from "../providers";
import { engineFor } from "./selector";
import { engineEnv, everLoggedIn, loginTime, markRelogin, needsRelogin, safeScope, status } from "./cli_auth";
import { CLIS, type Cli, engineHome, find, listEngineDir, makeDir, removeDir, spawnCli, stripAnsi, writeEngineFile } from "./cli_runtime";
import type { Attachment, RateWindow, TurnRequest } from "./engine";
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
  // Claude Code nhận tên gọi tắt fable / opus / sonnet / haiku và tự dùng bản mới nhất gói được phép (Fable có thể cần usage credits).
  claude: { name: "Claude", vendor: "anthropic", label: "Claude · Your plan", fallback: [{ id: "fable", name: "Claude Fable" }, { id: "opus", name: "Claude Opus" }, { id: "sonnet", name: "Claude Sonnet" }, { id: "haiku", name: "Claude Haiku" }] },
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
/**
 * Model của gói. variants: biến thể theo mức effort mà CLI tách thành model riêng (agy: gemini-3.8-flash-low / -medium / -high);
 * efforts: các mức effort model hỗ trợ (codex: supportedReasoningEfforts).
 */
type PlanModel = { id: string; name: string; variants?: Record<string, string>; efforts?: string[] };
type G = {
  /** src: đầu ra danh sách model của CLI lúc đọc (agy): khác đi là đọc lại ngay, không chờ hết hạn nhớ. */
  models: Map<string, { at: number; v: PlanModel[]; src?: string }>;
  limits: Map<string, { at: number; plan?: string; credits?: string | null; setup?: boolean; windows: (RateWindow | PlanWindow)[] }>;
  /** Gói báo hết hạn mức mà không kèm mốc đặt lại: tạm coi là hết tới thời điểm này. */
  quota: Map<string, number>;
  /** Model thật mà tên gọi tắt của Claude Code đang trỏ tới, theo từng tài khoản ("opus" → "claude-opus-5-5"). */
  resolved: Map<string, Record<string, string>>;
  /** Đang đọc bảng /usage của agy (mỗi tài khoản một lượt một lúc). */
  agyBusy: Map<string, Promise<AgyUsage>>;
};
const g: G = ((globalThis as { __synchroSubs?: G }).__synchroSubs ??= { models: new Map(), limits: new Map(), quota: new Map(), resolved: new Map(), agyBusy: new Map() });
g.resolved ??= new Map();
g.quota ??= new Map();
g.agyBusy ??= new Map();
const MODELS_TTL = 10 * 60_000;

const EFFORT_SUFFIX = /-(minimal|extra-low|low|medium|high|xhigh|max)$/;
const pretty = (id: string) => id.split("-").map((w) => (/^gpt$/i.test(w) ? "GPT" : w[0].toUpperCase() + w.slice(1))).join(" ");

/**
 * `agy models` in "mã<TAB>Tên" mỗi dòng (sau dòng "Fetching available models..."). Hiện đủ mọi model gói Google cấp qua Antigravity
 * (như chính agy): model Gemini trước, rồi model Claude / GPT mà Antigravity cung cấp kèm (tên có "(Antigravity)" để phân biệt với
 * model của gói Claude / ChatGPT; hạn mức tính riêng nhóm Claude / GPT của gói Google). Các biến thể theo effort (…-low / -medium /
 * -high) gộp thành một model; effort chọn ở mục Effort riêng và đổi sang đúng biến thể (--model <mã>) khi chạy.
 */
export function agyModels(lines: string[]): PlanModel[] {
  const byBase = new Map<string, PlanModel>();
  for (const raw of lines) {
    const [id, label = ""] = raw.split("\t").map((x) => x.trim());
    if (!/^[a-z][\w.-]*$/i.test(id ?? "") || /^(fetching|error|warning|please)$/i.test(id)) continue;
    const m = EFFORT_SUFFIX.exec(id);
    const base = m ? id.slice(0, m.index) : id;
    const plain = label ? label.replace(/\s*\((minimal|extra low|low|medium|high|xhigh|max|thinking)\)\s*$/i, "") : pretty(base);
    const name = isGeminiId(base) ? plain : `${plain} (Antigravity)`;
    const cur = byBase.get(base) ?? { id: base, name, variants: {} };
    if (m) cur.variants![m[1]] = id; else cur.variants!.default = id;
    byBase.set(base, cur);
  }
  const list = [...byBase.values()];
  return [...list.filter((x) => isGeminiId(x.id)), ...list.filter((x) => !isGeminiId(x.id))];
}
/** Model Gemini của gói Google (khác nhóm Claude / GPT mà Antigravity cung cấp kèm, có hạn mức riêng). */
export const isGeminiId = (id: string) => /^gemini-/i.test(id);

async function detectModels(cli: Cli, scope: string, agyLines?: string[]): Promise<PlanModel[]> {
  if (cli === "agy") {
    const list = agyModels(agyLines ?? []);
    return list.length ? list : SUB.agy.fallback;
  }
  if (cli === "codex") {
    const [r] = await codexRpc(scope, [{ method: "model/list" }]).catch(() => [null]);
    const list = ((r?.data ?? []) as Json[]).filter((m) => !m.hidden && typeof (m.id ?? m.model) === "string").map((m) => ({
      id: String(m.id ?? m.model), name: String(m.displayName ?? m.id).replace(/^GPT-([\d.]+)-/, "GPT-$1 "),
      efforts: Array.isArray(m.supportedReasoningEfforts) ? (m.supportedReasoningEfforts as Json[]).map((e) => String(e.reasoningEffort ?? e)).filter(Boolean) : undefined,
    }));
    return list.length ? list : SUB.codex.fallback;
  }
  // Claude Code nhận tên gọi tắt và tự dùng bản mới nhất mà gói được phép: tên hiện theo model thật đã thấy ở lượt chat trước,
  // không thì theo bản mới nhất cùng dòng trong danh sách khóa API (nếu có), không thì tên chung.
  const seen = g.resolved.get(`claude:${scope}`) ?? {};
  const api = (await catalog().catch(() => [])).filter((p) => p.kind === "anthropic").flatMap((p) => p.models);
  return SUB.claude.fallback.map((m) => {
    if (seen[m.id]) return { id: m.id, name: claudeName(seen[m.id]) };
    const latest = api.find((x) => x.id.startsWith(`claude-${m.id}`));
    return latest ? { id: m.id, name: latest.name } : m;
  });
}
/** "claude-opus-5-5" → "Claude Opus 5.5", "claude-fable-5-1" → "Claude Fable 5.1". */
const claudeName = (id: string) => id.replace(/\[1m\]$/i, "").replace(/-(\d+)-(\d+)(-\d{8})?$/, " $1.$2").split(/[- ]/).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").replace(/ (\d+\.\d+)$/, " $1");

/** Model CLI thật sự chạy cho một model gói và mức effort: agy đổi sang biến thể đúng mức; không có biến thể thì truyền effort riêng. */
export function resolvePlanModel(cli: Cli, uid: string, id: string, effort?: string): { model?: string; effort?: string } {
  const pm = g.models.get(`${cli}:${uid}`)?.v.find((m) => m.id === id);
  const v = pm?.variants && Object.keys(pm.variants).some((k) => k !== "default") ? pm.variants : null;
  if (!v) {
    // Codex: chọn mức gần nhất trong các mức model này hỗ trợ (Synchro "extra" = xhigh; "max" khi model có, không thì xhigh…).
    let e = effort;
    if (effort && pm?.efforts?.length) {
      const order = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"], want = effort === "extra" ? "xhigh" : effort;
      const i = order.indexOf(want);
      e = i < 0 ? undefined : [...order.slice(0, i + 1)].reverse().find((x) => pm.efforts!.includes(x)) ?? pm.efforts[0];
    }
    // agy: model Claude / GPT qua Antigravity không nhận --effort (agy 1.4.11 dừng lượt: "--effort is not supported for model").
    if (cli === "agy" && !isGeminiId(id)) e = undefined;
    return { model: pm?.variants?.default ?? (id && id !== "default" ? id : undefined), effort: e };
  }
  const want = effort === "extra" ? ["xhigh", "high", "max"] : effort === "max" ? ["max", "xhigh", "high"] : effort === "low" ? ["low", "minimal", "extra-low", "medium"]
    : effort === "high" ? ["high", "xhigh", "medium"] : ["medium", "default", "high", "low"];
  const pick = want.map((w) => v[w]).find(Boolean) ?? v.default ?? Object.values(v)[0];
  return { model: pick };
}

const VENDOR_CLI: Record<string, Cli> = { anthropic: "claude", openai: "codex", google: "agy" };

/** Model của gói (đã đăng nhập, không cần đăng nhập lại), đọc lại tối đa 10 phút một lần. */
async function planModels(cli: Cli, u: UserRow) {
  if (!find(cli) || !everLoggedIn(cli, u.id)) return null;
  const s = await status(cli, u.id, { stale: true }).catch(() => null);
  if (!s?.loggedIn || s.relogin) return null;
  // Đọc lại khi hết hạn nhớ, hoặc khi người dùng vừa đăng nhập lại sau lần đọc trước.
  const k = `${cli}:${u.id}`, hit = g.models.get(k);
  // agy: trạng thái (`agy models`, đọc lại mỗi phút) cho biết danh sách hiện tại — Google đổi danh sách (vd. gói chuyển từ dùng thử
  // sang trả phí) thì cập nhật ngay.
  const src = cli === "agy" ? (s.models ?? []).join("\n") : undefined;
  const fresh = hit && Date.now() - hit.at < MODELS_TTL && hit.at > loginTime(cli, u.id) && (src === undefined || hit.src === src);
  const models = fresh ? hit.v : await detectModels(cli, u.id, s.models);
  if (!fresh) g.models.set(k, { at: Date.now(), v: models, src });
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
/** setup: CLI đang chờ người dùng hoàn tất bước làm quen (agy) nên chưa đọc được hạn mức. */
export type SubUsage = { cli: Cli; name: string; plan: string | null; windows: PlanWindow[]; turnsToday: number; note: string | null; credits: string | null; at: number | null; setup?: boolean };

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

function saveLimits(cli: Cli, uid: string, windows: PlanWindow[] | RateWindow[], extra: { plan?: string; credits?: string | null; setup?: boolean } = {}) {
  const k = `${cli}:${uid}`, old = g.limits.get(k);
  const merged = new Map((old?.windows ?? []).map((w) => [w.window, w]));
  for (const w of windows) merged.set(w.window, w);
  g.limits.set(k, { at: Date.now(), plan: extra.plan ?? old?.plan, credits: extra.credits !== undefined ? extra.credits : old?.credits, setup: extra.setup ?? old?.setup, windows: [...merged.values()] });
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

/**
 * agy: bảng /usage ("Models & Quota") có hai nhóm GEMINI MODELS / CLAUDE AND GPT MODELS, mỗi nhóm "Weekly Limit Remaining" và
 * "Five Hour Limit Remaining", mỗi mục một thanh "[████] 99.94%" rồi dòng "Refreshes in 3h 28m" (agy 1.4.7, đọc qua terminal giả).
 * Nhận cả kiểu viết gọn trên một dòng ("Five Hour Limit Remaining  64%  resets in 3h 12m").
 */
export function agyWindows(text: string): PlanWindow[] {
  const out: PlanWindow[] = [];
  let group = "", gid = "", kind: WindowKind | null = null, last: PlanWindow | null = null;
  const dur = (s: string) => {
    let ms = 0;
    for (const [, n, u] of s.matchAll(/(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/gi)) ms += Number(n) * (/^d/i.test(u) ? 86_400_000 : /^h/i.test(u) ? 3_600_000 : 60_000);
    return ms;
  };
  for (const line of text.split("\n")) {
    if (/within this group/i.test(line)) continue;
    if (/gemini models?/i.test(line)) { group = "Gemini models"; gid = "gemini"; kind = null; last = null; continue; }
    if (/claude\b.*\bgpt|gpt\b.*\bclaude/i.test(line) && /models?/i.test(line)) { group = "Claude and GPT models"; gid = "other"; kind = null; last = null; continue; }
    const lab = /(five[ -]?hour|5[ -]?hour|weekly)\s+limit\s+remaining/i.exec(line);
    if (lab) { kind = /week/i.test(lab[1]) ? "weekly" : "session"; last = null; }
    const pct = /(\d+(?:\.\d+)?)\s*%/.exec(lab ? line.slice(lab.index + lab[0].length) : line);
    if (pct && kind && !last) {
      const remaining = Number(pct[1]);
      last = { window: `${gid || "all"}_${kind}`, label: `${kind === "weekly" ? "Weekly" : "Current session"}${group ? ` · ${group}` : ""}`, kind, group: group || undefined,
        usedPct: Math.max(0, Math.min(100, Math.round((100 - remaining) * 100) / 100)), status: remaining <= 0 ? "rejected" : remaining <= 20 ? "allowed_warning" : "allowed" };
      out.push(last);
    }
    const rf = /(?:refreshes|resets?)\s+in\s+(.+)$/i.exec(line);
    if (rf && last && !last.resetsAt) { const ms = dur(rf[1]); if (ms) last.resetsAt = Date.now() + ms; }
  }
  return out;
}

type AgyUsage = { windows: PlanWindow[]; setup: boolean };
/** Màn hình làm quen lần đầu của agy (chọn bảng màu, điều khoản và chia sẻ dữ liệu): người dùng phải tự chọn, Synchro không bấm thay. */
const AGY_ONBOARDING = /Choose your color scheme|Terms of Service & Data Use|I agree to help improve/i;

/**
 * Mở agy trong terminal giả, gõ /usage, đọc bảng hạn mức rồi thoát bằng /exit. Gặp màn hình làm quen thì dừng ngay, không gõ phím nào
 * (chọn bảng màu, đồng ý điều khoản, chia sẻ dữ liệu là quyết định của người dùng). Mỗi tài khoản chỉ đọc một lượt một lúc.
 */
function agyUsage(scope: string): Promise<AgyUsage> {
  const busy = g.agyBusy.get(scope);
  if (busy) return busy;
  const run = (async (): Promise<AgyUsage> => {
    const bin = find("agy");
    if (!bin) return { windows: [], setup: false };
    const work = path.join(engineHome(), "work", safeScope(scope));
    makeDir(work);
    const p = spawnCli(bin, [], { env: engineEnv("agy", scope), cwd: work, pty: true, timeoutMs: 30_000 });
    let raw = "", last = Date.now(), asked = false, setup = false;
    p.child.stdout!.on("data", (d: Buffer) => { raw = (raw + d.toString()).slice(-200_000); last = Date.now(); });
    const t0 = Date.now();
    let windows: PlanWindow[] = [];
    while (Date.now() - t0 < 25_000) {
      await new Promise((r) => setTimeout(r, 300));
      const text = stripAnsi(raw);
      if (AGY_ONBOARDING.test(text)) { setup = true; break; }
      // Chỉ gõ /usage khi đã thấy ô nhập của phiên chat và màn hình đứng yên.
      if (!asked && Date.now() - last > 1500 && Date.now() - t0 > 2500 && !/sign in|signing in/i.test(text.slice(-400))) {
        // Gõ lệnh rồi mới Enter (gõ liền một lần có thể bị coi là dán, Enter không được nhận).
        p.write("/usage"); await new Promise((r) => setTimeout(r, 400)); p.write("\r"); asked = true; last = Date.now(); continue;
      }
      if (asked && /limit\s+remaining/i.test(text) && Date.now() - last > 800) { windows = agyWindows(text.slice(text.search(/\/usage|limit\s+remaining/i))); break; }
    }
    if (!setup) { p.write("\x1b"); await new Promise((r) => setTimeout(r, 300)); p.write("/exit"); await new Promise((r) => setTimeout(r, 300)); p.write("\r"); }
    const quit = setTimeout(() => p.kill(), setup ? 0 : 4000);
    await p.done;
    clearTimeout(quit);
    return { windows, setup };
  })().finally(() => g.agyBusy.delete(scope));
  g.agyBusy.set(scope, run);
  return run;
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

/** Antigravity đang chờ người dùng hoàn tất bước làm quen (đã thấy ở lần đọc hạn mức gần nhất). */
export const agySetupPending = (uid: string) => !!g.limits.get(`agy:${uid}`)?.setup;

/** fresh: bỏ qua bộ nhớ (người dùng bấm làm mới). */
export async function subUsage(u: UserRow, cli: Cli, o: { fresh?: boolean } = {}): Promise<SubUsage> {
  const k = `${cli}:${u.id}`;
  let hit = g.limits.get(k);
  // Claude báo hạn mức trong mỗi lượt chat (rate_limit_event); codex đọc qua app-server (tối đa mỗi phút);
  // agy đọc bảng /usage (tối đa 5 phút một lần vì phải mở cả CLI).
  const age = hit ? Date.now() - hit.at : Infinity;
  if (cli === "codex" && (o.fresh || age > 60_000)) {
    const [acc, rl] = await codexRpc(u.id, [{ method: "account/read" }, { method: "account/rateLimits/read" }]).catch(() => [null, null]);
    const c = codexWindows(rl);
    saveLimits(cli, u.id, c.windows, { plan: (typeof acc?.account?.planType === "string" ? acc.account.planType : undefined) ?? c.plan, credits: c.credits });
    hit = g.limits.get(k);
  } else if (cli === "agy" && (o.fresh || age > (hit?.setup ? 20_000 : 5 * 60_000))) {
    const r = await agyUsage(u.id).catch(() => ({ windows: [] as PlanWindow[], setup: false }));
    saveLimits(cli, u.id, r.windows, { setup: r.setup });
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
  return { cli, name: SUB[cli].name, plan, windows, turnsToday: turnsToday(u.id, cli), credits: hit?.credits ?? null, at: hit?.at ?? null, setup: !!hit?.setup,
    note: hit?.setup ? "Antigravity is waiting for you to finish its first-run setup (color scheme, terms and data sharing) before it shows plan limits."
      : windows.length ? NOTE[cli] : cli === "agy" ? `${NOTE.agy} Synchro could not read the quota panel yet.` : `Send a message with this plan to see its limits. ${NOTE[cli]}` };
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
    // Model của từng lượt (cho Cài đặt → Usage theo model); bảng cũ chưa có cột này.
    if (!(d.prepare("PRAGMA table_info(engine_turns)").all() as { name: string }[]).some((c) => c.name === "model")) d.exec("ALTER TABLE engine_turns ADD COLUMN model TEXT");
    d.prepare("DELETE FROM engine_sessions WHERE updated_at < ?").run(Date.now() - 90 * 86_400_000);
    d.prepare("DELETE FROM engine_turns WHERE at < ?").run(Date.now() - 30 * 86_400_000);
    ready = true;
  }
  return d;
}
/** Các lượt chạy bằng gói từ mốc since (Cài đặt → Usage: theo ngày, theo model). model trống: lượt ghi trước khi có cột model. */
export const planTurns = (uid: string, since: number) =>
  sessDb().prepare("SELECT cli, COALESCE(model, '') AS model, at FROM engine_turns WHERE user_id = ? AND at >= ?").all(uid, since) as { cli: Cli; model: string; at: number }[];
/** Tên model của gói đã đọc được ("sub-claude/opus" → "Claude Opus 5.5"), hoặc null khi chưa đọc danh sách model. */
export function planModelName(uid: string, key: string): string | null {
  const cli = subCli(key);
  if (!cli) return null;
  const id = splitKey(key).id;
  return g.models.get(`${cli}:${uid}`)?.v.find((m: { id: string; name: string }) => m.id === id)?.name ?? SUB[cli].fallback.find((m) => m.id === id)?.name ?? null;
}
export function removeUserSubs(uid: string) {
  const d = sessDb();
  d.prepare("DELETE FROM engine_sessions WHERE user_id = ?").run(uid);
  d.prepare("DELETE FROM engine_turns WHERE user_id = ?").run(uid);
  d.prepare("DELETE FROM engine_api_optin WHERE user_id = ?").run(uid);
}

type Msg = { role?: string; content?: unknown };
type Blk = { type?: string; text?: string; name?: string; media_type?: string; data?: string; fallbackText?: string; fallbackImages?: string[] };
const IMG_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
/** Gom ảnh / PDF gửi kèm nguyên dạng: atts nhận tệp theo thứ tự, keep lọc khối được gửi (tệp cũ trong lịch sử có giới hạn), nativePdf: CLI đọc thẳng PDF. */
type Collect = { atts: Attachment[]; keep?: (b: Blk) => boolean; nativePdf?: boolean };
/**
 * Chữ của một tin nhắn: khối văn bản, chữ đọc được từ tài liệu; ảnh và PDF được đánh số ("[Ảnh đính kèm 1]") và gửi kèm nguyên dạng
 * cho CLI (xem subTurn). Không gom (lịch sử cho engine khóa API, hoặc tệp cũ vượt giới hạn) thì chỉ còn dòng ghi chú.
 */
function textOf(c: unknown, col?: Collect): string {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return (c as Blk[]).map((b) => {
    if (b.type === "text") return b.text ?? "";
    const take = !!(col && b.data && (col.keep?.(b) ?? true));
    if (b.type === "image") {
      if (!take) return "[Ảnh đính kèm ở lượt trước]";
      const n = col!.atts.length + 1, mime = b.media_type ?? "image/png";
      col!.atts.push({ n, kind: "image", mime, data: b.data!, name: `anh-${n}.${IMG_EXT[mime] ?? "png"}` });
      return `[Ảnh đính kèm ${n}]`;
    }
    if (b.type === "document") {
      const name = b.name ?? "tệp.pdf", file = `<file name="${name}">\n${b.fallbackText ?? ""}\n</file>`;
      if (!take) return file;
      const n = col!.atts.length + 1;
      col!.atts.push({ n, kind: "pdf", mime: b.media_type ?? "application/pdf", data: b.data!, name: `${n}-${name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-80)}`,
        pages: (b.fallbackImages ?? []).map((d) => ({ mime: "image/jpeg", data: d })) });
      return col!.nativePdf ? `[Tệp PDF đính kèm ${n}: ${name}]` : `[Tệp PDF đính kèm ${n}: ${name}]\n${file}`;
    }
    return "";
  }).filter(Boolean).join("\n\n");
}
/** Ảnh / PDF trong lịch sử gửi lại khi mở phiên mới: tối đa 8 tệp gần nhất (phiên nối tiếp đã có sẵn tệp cũ). */
function recentMedia(msgs: Msg[], max = 8): Set<Blk> {
  const out = new Set<Blk>();
  for (let i = msgs.length - 1; i >= 0 && out.size < max; i--) {
    if (msgs[i].role !== "user" || !Array.isArray(msgs[i].content)) continue;
    const bs = (msgs[i].content as Blk[]).filter((b) => (b.type === "image" || b.type === "document") && b.data);
    for (let j = bs.length - 1; j >= 0 && out.size < max; j--) out.add(bs[j]);
  }
  return out;
}
/**
 * Ghi tệp đính kèm vào thư mục làm việc của engine (att/<ngày>/<lượt>/) cho CLI nhận tệp theo đường dẫn (Codex --image, Antigravity mở bằng
 * công cụ xem tệp); thư mục quá 7 ngày được dọn.
 */
function saveAttachments(work: string, atts: Attachment[]) {
  const root = path.join(work, "att"), day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dir = path.join(root, day, crypto.randomBytes(6).toString("hex"));
  for (const a of atts) {
    a.path = path.join(dir, a.name);
    writeEngineFile(a.path, Buffer.from(a.data, "base64"));
    a.pages?.forEach((p, i) => { p.path = path.join(dir, `${a.name.replace(/\.pdf$/i, "")}-trang-${i + 1}.jpg`); writeEngineFile(p.path, Buffer.from(p.data, "base64")); });
  }
  const old = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10).replace(/-/g, "");
  for (const d of listEngineDir(root)) if (/^\d{8}$/.test(d) && d < old) { try { removeDir(path.join(root, d)); } catch {} }
}

export type SubTurn = { user: UserRow; model: string; system: string; messages: unknown; conv?: string; effort?: string; signal?: AbortSignal; onDelta?: (t: string) => void; mcp?: { url: string }; web?: boolean };
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
  // Ảnh, PDF gửi kèm nguyên dạng như khi dùng ứng dụng của hãng (không đổi thành chữ): Claude Code nhận khối ảnh / PDF qua stream-json,
  // Codex nhận ảnh bằng --image, Antigravity mở tệp trong thư mục làm việc bằng công cụ xem tệp của nó.
  const col: Collect = { atts: [], nativePdf: cli === "claude" };
  const old = resume ? null : recentMedia(msgs.slice(0, -1));
  const history = resume ? "" : msgs.slice(0, -1).map((m) => `[${m.role === "assistant" ? "assistant" : "user"}]\n${textOf(m.content, m.role === "user" ? { ...col, keep: (b) => old!.has(b) } : undefined)}`).filter((x) => x.trim()).join("\n\n");
  const prompt = (history ? `<conversation_history>\n${history}\n</conversation_history>\n\n` : "") + textOf(last.content, col);
  const run = resolvePlanModel(cli, o.user.id, splitKey(o.model).id, o.effort);
  const work = path.join(engineHome(), "work", safeScope(o.user.id));
  makeDir(work);
  if (col.atts.length && cli !== "claude") {
    try { saveAttachments(work, col.atts); }
    catch (e) { return { status: 500, json: { error: `Không chuyển được tệp đính kèm cho ${SUB[cli].name}: ${redact((e as Error).message).slice(0, 200)}` } }; }
  }
  const req: TurnRequest = {
    prompt, attachments: col.atts.length ? col.atts : undefined, system: o.system || undefined, model: run.model, effort: run.effort, sessionId: resume, workdir: work, env: engineEnv(cli, o.user.id), signal: o.signal, mcp: o.mcp, web: o.web,
    history: msgs.slice(0, -1).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: textOf(m.content) })),
  };
  // Không tự chuyển sang khóa API khi gói hết hạn mức: trả về để trình duyệt hỏi người dùng (xem planLimit bên dưới).
  const eng = engineFor(cli);
  let text = "", final: string | null = null, via: string | null = null, session: string | null = null, err: { message: string; code?: string } | null = null;
  for await (const e of eng.runTurn(req)) {
    if (e.kind === "text") { text += e.text; o.onDelta?.(e.text); }
    else if (e.kind === "session") {
      session = e.id;
      // Ghi nhớ model thật của tên gọi tắt Claude (để bộ chọn model hiện "Claude Opus 5.5" thay vì "Claude Opus").
      if (cli === "claude" && e.model && run.model) {
        const k = `claude:${o.user.id}`, cur = g.resolved.get(k) ?? {};
        if (cur[run.model] !== e.model) { g.resolved.set(k, { ...cur, [run.model]: e.model }); g.models.delete(k); }
      }
    }
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
      // Gói Google: model Claude / GPT qua Antigravity có hạn mức riêng; hết nhóm đó thì model Gemini của gói vẫn dùng được.
      if (cli === "agy" && !isGeminiId(splitKey(o.model).id)) return { status: 429, json: { error: "Hạn mức model Claude / GPT trong gói Google (Antigravity) đã hết. Model Gemini của gói vẫn dùng được.", detail: redact(err.message).slice(0, 200) } };
      // Gói không báo mốc đặt lại thì tạm coi là hết trong 30 phút; codex đọc lại hạn mức ở lần mở vòng tròn sau.
      if (!planBlock(cli, o.user.id)) g.quota.set(`${cli}:${o.user.id}`, Date.now() + 30 * 60_000);
      if (cli === "codex") { const h = g.limits.get(`${cli}:${o.user.id}`); if (h) h.at = 0; }
      return { status: 429, json: { error: `Gói ${SUB[cli].name} của bạn đã hết hạn mức.`, planLimit: cli, resetsAt: planBlock(cli, o.user.id), apiModel, apiModelName: apiName, detail: redact(err.message).slice(0, 200) } };
    }
    if (err.code === "timeout") return { status: 504, json: { error: "Lượt này chạy quá 30 phút nên đã dừng." } };
    return { status: 502, json: { error: redact(err.message).slice(0, 500) || "Gói subscription báo lỗi." } };
  }
  g.quota.delete(`${cli}:${o.user.id}`);
  d.prepare("INSERT INTO engine_turns (user_id, cli, at, via, model) VALUES (?, ?, ?, ?, ?)").run(o.user.id, cli, Date.now(), via ?? cli, o.model);
  if (conv && session) {
    d.prepare(`INSERT INTO engine_sessions (user_id, conv, cli, session_id, turns, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, conv, cli) DO UPDATE SET session_id = excluded.session_id, turns = excluded.turns, updated_at = excluded.updated_at`)
      .run(o.user.id, conv, cli, session, msgs.length + 1, Date.now());
  }
  return { status: 200, json: { model: o.model, text: final ?? text, via } };
}
