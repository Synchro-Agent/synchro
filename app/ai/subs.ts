// Gói subscription trong Synchro (ADR 0001): model của gói hiện trong bộ chọn model của chính người đã đăng nhập,
// lượt chat chạy qua engine CLI (nối tiếp phiên bằng resume), hạn mức của gói (phiên 5 giờ, tuần) cho vòng tròn mức dùng.
// Khóa model: "sub-claude/sonnet", "sub-codex/gpt-6.1-sol", "sub-agy/gemini-3-pro", "sub-grok/grok-4.7" ("default" = model mặc định của gói).
// Bộ chọn model gộp theo hãng (Claude, ChatGPT, Gemini, Grok; DeepSeek chỉ có khóa API): đã đăng nhập gói thì nhóm hiện model của gói; gói hết hạn mức thì
// Synchro KHÔNG tự chuyển sang khóa API mà hỏi người dùng. Đồng ý thì nhóm đó hiện model của khóa API cho tới khi gói hồi lại.
import { notConnectLink } from "../composio";
import crypto from "node:crypto";
import path from "node:path";
import { db, type UserRow } from "../authstore";
import { quickLimit, runAge, turnsTotal } from "../runs";
import { acquire, holdsSlot, noteRefused, queuedOf, queueLimit, withSlot } from "../turngate";
import { ALL, equivalentModel, splitKey, vendorOf, type ProviderInfo } from "../catalog";
import { canModel } from "../authstore";
import { catalog, mainModels } from "../providers";
import { engineFor } from "./selector";
import { classifyTurn, noteCliOutcome } from "./cliupdate";
import { clearRelogin, engineEnvReady, ensureScopeDir, everLoggedIn, loginTime, markRelogin, needsRelogin, safeScope, scopeDir, status } from "./cli_auth";
import { prettyGrok } from "../providers";
import { CLIS, type Cli, engineHome, find, listEngineDir, makeDir, removeDir, removeSessionFiles, spawnCli, stripAnsi, watchSessions, writeEngineFile } from "./cli_runtime";
import type { Attachment, RateWindow, TurnRequest, WebSource } from "./engine";
import { friendlyError, redact, retryAfterMs } from "./errors";
import { agyNativeImages, nativeStamp, removeFile, type ImgFile } from "./imagefiles";
import { stallOf, waitText, watchLimits, type WatchState } from "./watchdog";
import { prestartCodexServer } from "./codex_server";
import { dropLiveBridge } from "../mcpbridge";

export const SUB_PREFIX = "sub-";
export const subCli = (key: unknown): Cli | null => {
  if (typeof key !== "string") return null;
  const p = splitKey(key).provider;
  const c = p.startsWith(SUB_PREFIX) ? p.slice(SUB_PREFIX.length) : "";
  return (CLIS as string[]).includes(c) ? (c as Cli) : null;
};

/** Tên gói, hãng (để hiện logo), và model mặc định khi chưa đọc được danh sách thật. */
export const SUB: Record<Cli, { name: string; vendor: "anthropic" | "openai" | "google" | "xai"; label: string; fallback: { id: string; name: string }[] }> = {
  // Claude Code nhận tên gọi tắt fable / opus / sonnet / haiku và tự dùng bản mới nhất gói được phép (Fable có thể cần usage credits).
  claude: { name: "Claude", vendor: "anthropic", label: "Claude · Your plan", fallback: [{ id: "fable", name: "Claude Fable" }, { id: "opus", name: "Claude Opus" }, { id: "sonnet", name: "Claude Sonnet" }, { id: "haiku", name: "Claude Haiku" }] },
  codex: { name: "ChatGPT", vendor: "openai", label: "ChatGPT · Your plan", fallback: [{ id: "default", name: "ChatGPT (plan default)" }] },
  agy: { name: "Gemini", vendor: "google", label: "Gemini · Your plan", fallback: [{ id: "default", name: "Gemini (plan default)" }] },
  grok: { name: "Grok", vendor: "xai", label: "Grok · Your plan", fallback: [{ id: "default", name: "Grok (plan default)" }] },
};

// ---------------------------------------------------------------- codex app-server (JSON-RPC qua stdio)
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Gọi vài phương thức của `codex app-server` (danh sách model, gói, hạn mức) rồi tắt tiến trình. */
export async function codexRpc(scope: string, calls: { method: string; params?: Json }[], timeoutMs = 20_000): Promise<(Json | null)[]> {
  const bin = find("codex");
  const out: (Json | null)[] = calls.map(() => null);
  if (!bin) return out;
  const work = path.join(engineHome(), "work");
  await makeDir(work);
  const p = spawnCli(bin, ["app-server"], { env: await engineEnvReady("codex", scope), cwd: work, timeoutMs });
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
  if (cli === "grok") {
    // `grok models` (đọc cùng lúc kiểm tra đăng nhập): model mặc định của gói trước.
    const list = (agyLines ?? []).map((id) => ({ id, name: prettyGrok(id) }));
    return list.length ? list : SUB.grok.fallback;
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

const VENDOR_CLI: Record<string, Cli> = { anthropic: "claude", openai: "codex", google: "agy", xai: "grok" };
/** Thứ tự các hãng trong bộ chọn model. DeepSeek không có gói đăng nhập (chỉ khóa API). */
export const VENDORS = ["anthropic", "openai", "google", "xai", "deepseek"] as const;

/** Model của gói (đã đăng nhập, không cần đăng nhập lại), đọc lại tối đa 10 phút một lần. */
async function planModels(cli: Cli, u: UserRow) {
  if (!find(cli) || !everLoggedIn(cli, u.id)) return null;
  const s = await status(cli, u.id, { stale: true }).catch(() => null);
  if (!s) return null;
  const list = (ms: PlanModel[]) => ms.map((m) => {
    // Hạn mức riêng của một model (tuần · Opus): chỉ model đó tạm nghỉ, các model khác của gói vẫn dùng được.
    const own = modelBlock(cli, u.id, m.id), plan = planBlock(cli, u.id);
    return { key: `${SUB_PREFIX}${cli}/${m.id}`, id: m.id, name: m.name, ...(own && own !== plan ? { blockedUntil: own } : {}) };
  });
  // Hãng từ chối đăng nhập: nhóm vẫn ở lại bộ chọn model kèm ghi chú đăng nhập lại (từng biến mất hẳn, người dùng không biết chuyện gì xảy ra).
  // Chạy CLI đọc danh sách lúc này cũng vô ích nên dùng danh sách đã biết.
  if (s.relogin) return list(g.models.get(`${cli}:${u.id}`)?.v ?? SUB[cli].fallback);
  if (!s.loggedIn) return null;
  // Đọc lại khi hết hạn nhớ, hoặc khi người dùng vừa đăng nhập lại sau lần đọc trước.
  const k = `${cli}:${u.id}`, hit = g.models.get(k);
  // agy, grok: trạng thái (`… models`, đọc lại mỗi phút) cho biết danh sách hiện tại — hãng đổi danh sách (vd. gói chuyển từ dùng thử
  // sang trả phí) thì cập nhật ngay.
  const src = cli === "agy" || cli === "grok" ? (s.models ?? []).join("\n") : undefined;
  const fresh = hit && Date.now() - hit.at < MODELS_TTL && hit.at > loginTime(cli, u.id) && (src === undefined || hit.src === src);
  const models = fresh ? hit.v : await detectModels(cli, u.id, s.models);
  if (!fresh) g.models.set(k, { at: Date.now(), v: models, src });
  return list(models);
}

/** Model của gói theo đăng nhập của một người (sổ model đọc bằng đăng nhập của quản trị viên để biết gói có model mới). */
export const planModelsFor = (cli: Cli, u: UserRow) => planModels(cli, u);

/**
 * Nhóm model theo hãng cho bộ chọn model. api: các nhóm khóa API (đã lọc theo model quản trị viên cho hiện).
 * Nhóm của hãng có gói đã đăng nhập hiện model của gói, trừ khi người dùng đã đồng ý dùng khóa API thay gói (tới khi gói hồi lại).
 */
export async function mergedProviders(u: UserRow, api: ProviderInfo[]): Promise<ProviderInfo[]> {
  const out: ProviderInfo[] = [];
  const used = new Set<string>();
  for (const vendor of VENDORS) {
    const cli = VENDOR_CLI[vendor];
    const ap = api.find((p) => p.id === vendor) ?? api.find((p) => p.kind === vendor && !used.has(p.id));
    if (ap) used.add(ap.id);
    const models = cli ? await planModels(cli, u) : null;
    if (!models?.length) { if (ap) out.push({ ...ap, source: "api" }); continue; }
    const plan = { cli, models, blockedUntil: planBlock(cli, u.id), usingApiUntil: apiOptIn(u.id, cli), relogin: needsRelogin(cli, u.id), hasApi: !!ap?.models.length };
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
  return !!cli && !!find(cli) && !!(await status(cli, u.id, { stale: true }).catch(() => null))?.loggedIn;
}
export const forgetSubModels = (cli: Cli, uid: string) => g.models.delete(`${cli}:${uid}`);
/** CLI vừa đổi bản: danh sách model của gói đọc lại bằng bản mới cho mọi tài khoản. */
export const forgetAllSubModels = (cli: Cli) => { for (const k of [...g.models.keys()]) if (k.startsWith(`${cli}:`)) g.models.delete(k); };

// ---------------------------------------------------------------- hạn mức của gói
// Cách các hãng đặt lại hạn mức (theo tài liệu của hãng và dữ liệu chính CLI báo về):
// - Claude (Pro, Max): phiên 5 giờ bắt đầu từ tin nhắn đầu tiên khi phiên trước đã hết; hạn mức tuần đặt lại vào một mốc cố định
//   mỗi tuần riêng cho từng tài khoản (Max có thêm hạn mức tuần riêng theo model). Claude Code báo utilization và resetsAt từng cửa sổ.
// - ChatGPT (Codex): Plus có phiên 5 giờ cuốn chiếu và hạn mức tuần; các gói Pro chỉ có hạn mức tuần. codex app-server báo
//   primary / secondary { usedPercent, windowDurationMins, resetsAt }.
// - Gemini (Antigravity): Pro và Ultra hồi quota mỗi 5 giờ cho tới khi chạm hạn mức tuần; gói khác chỉ có hạn mức tuần.
//   Quota tách hai nhóm: model Gemini, và model Claude / GPT; agy hiện trong bảng /usage (/quota).
// - Grok (SuperGrok, X Premium+): hạn mức cuốn chiếu nhưng Grok CLI không báo còn bao nhiêu; chỉ biết khi hãng báo đã chạm giới hạn.
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
    await makeDir(work);
    const p = spawnCli(bin, [], { env: await engineEnvReady("agy", scope), cwd: work, pty: true, timeoutMs: 30_000 });
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

// Claude: chỉ phiên 5 giờ và tuần chung mới là hạn mức của cả gói. seven_day_opus, seven_day_sonnet… là của riêng một dòng model: hết tuần của
// Opus từng làm cả gói biến mất khỏi chế độ Tự động 3 ngày trong khi Sonnet, Haiku vẫn còn. Cửa sổ khác (usage credits, "model limit") không
// nói rõ model nào: không chặn gói, chỉ chặn đúng model vừa bị hãng từ chối (xem subTurn).
const CLAUDE_PLAN_WINDOW = /^(five_hour|seven_day)$/;
const CLAUDE_MODEL_WINDOW = /^(?:five_hour|seven_day)_(opus|sonnet|haiku|fable)$/;
const exhausted = (w: RateWindow, now: number) => (w.status === "rejected" || (w.usedPct ?? 0) >= 100) && !!w.resetsAt && w.resetsAt > now;
/** Cả gói đang hết hạn mức tới lúc nào (cửa sổ của cả gói bị từ chối hoặc đã dùng 100% mà chưa tới mốc đặt lại), hoặc null. */
export function planBlock(cli: Cli, uid: string): number | null {
  const k = `${cli}:${uid}`, now = Date.now();
  let until = 0;
  for (const w of g.limits.get(k)?.windows ?? []) {
    // agy: nhóm Gemini mới chặn model Gemini của gói.
    if (cli === "agy" && (w as PlanWindow).group && !/gemini/i.test((w as PlanWindow).group!)) continue;
    if (cli === "claude" && !CLAUDE_PLAN_WINDOW.test(w.window)) continue;
    if (exhausted(w, now)) until = Math.max(until, w.resetsAt!);
  }
  const q = g.quota.get(k);
  if (q && q > now) until = Math.max(until, q);
  return until || null;
}
/** Một model của gói đang hết hạn mức tới lúc nào: hạn mức của cả gói, cửa sổ riêng của dòng model đó, hoặc lần hãng vừa từ chối riêng model này. */
export function modelBlock(cli: Cli, uid: string, id: string): number | null {
  const now = Date.now();
  let until = planBlock(cli, uid) ?? 0;
  if (cli === "claude") for (const w of g.limits.get(`${cli}:${uid}`)?.windows ?? []) {
    const fam = CLAUDE_MODEL_WINDOW.exec(w.window)?.[1];
    if (fam && id.toLowerCase().includes(fam) && exhausted(w, now)) until = Math.max(until, w.resetsAt!);
  }
  const q = g.quota.get(`${cli}:${uid}:${id}`);
  if (q && q > now) until = Math.max(until, q);
  return until || null;
}
/** Hãng báo hết hạn mức: ghi nhận phạm vi đúng và trả về "plan" (cả gói) hoặc "model" (riêng model này). */
export function noteQuota(cli: Cli, uid: string, id: string, message: string): "plan" | "model" {
  const now = Date.now(), wins = g.limits.get(`${cli}:${uid}`)?.windows ?? [];
  if (planBlock(cli, uid)) return "plan";
  if (modelBlock(cli, uid, id)) return "model";
  // Mốc đặt lại trong câu báo lỗi ("… limit reached|1730000000", "try again in 2 hours"), hoặc tạm 30 phút khi hãng không nói.
  const epoch = /\|(\d{10})\b/.exec(message), wait = retryAfterMs(message);
  const until = epoch ? Number(epoch[1]) * 1000 : wait ? now + wait : now + 30 * 60_000;
  // Chỉ gói Claude có hạn mức riêng theo model; Codex, Grok tính chung cả gói. Câu báo nói rõ phiên / tuần chung thì cũng là cả gói.
  // "weekly limit" trần là hạn tuần chung của gói; "Opus weekly limit" thì chỉ model đó.
  if (cli !== "claude" || /session|5[- ]hour|five[ _-]hour/i.test(message) || (/week|seven[ _-]day/i.test(message) && !/opus|sonnet|haiku|fable/i.test(message))) { g.quota.set(`${cli}:${uid}`, until); return "plan"; }
  const unnamed = wins.filter((w) => exhausted(w, now) && !CLAUDE_PLAN_WINDOW.test(w.window) && !CLAUDE_MODEL_WINDOW.test(w.window)).map((w) => w.resetsAt!);
  g.quota.set(`${cli}:${uid}:${id}`, unnamed.length ? Math.max(...unnamed) : until);
  return "model";
}

/** Gói Google: nhóm model Claude / GPT (kể cả GPT-OSS) qua Antigravity hết hạn mức tới lúc nào — tính riêng với nhóm Gemini (planBlock).
 *  Trước đây không ai theo dõi nhóm này: chế độ Tự động cứ chọn GPT-OSS khi nhóm đã hết, lượt chat báo lỗi hoặc treo. */
export function agyOtherBlock(uid: string): number | null {
  const k = `agy:${uid}`, now = Date.now();
  let until = 0;
  for (const w of g.limits.get(k)?.windows ?? []) {
    const grp = (w as PlanWindow).group;
    if (grp && !/gemini/i.test(grp) && (w.status === "rejected" || (w.usedPct ?? 0) >= 100) && w.resetsAt && w.resetsAt > now) until = Math.max(until, w.resetsAt);
  }
  const q = g.quota.get(`agy-other:${uid}`);
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
  for (const q of [...g.quota.keys()]) if (q.startsWith(`${k}:`)) g.quota.delete(q);
  sessDb().prepare("DELETE FROM engine_api_optin WHERE user_id = ? AND cli = ?").run(uid, cli);
}

const turnsToday = (uid: string, cli: Cli) => {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  return (sessDb().prepare("SELECT COUNT(*) AS n FROM engine_turns WHERE user_id = ? AND cli = ? AND at >= ?").get(uid, cli, since.getTime()) as { n: number }).n;
};

const label = (w: RateWindow) => WINDOW_NAME[w.window] ?? w.window.replace(/_/g, " ");
const NOTE: Record<Cli, string> = {
  claude: "The session starts with your first message and lasts 5 hours. Weekly limits reset at a fixed time each week.",
  codex: "Limits depend on your ChatGPT plan. Plus has a rolling 5-hour window and a weekly limit; Pro only has a weekly limit.",
  agy: "Limits depend on your Google account's plan and refresh over time. Gemini and Claude/GPT models have separate quotas.",
  grok: "Limits depend on your Grok plan and refresh over time. The Grok CLI doesn't report how much is left, so Synchro counts your messages and tells you when Grok says the limit is reached.",
};

/** Antigravity đang chờ người dùng hoàn tất bước làm quen (đã thấy ở lần đọc hạn mức gần nhất). */
export const agySetupPending = (uid: string) => !!g.limits.get(`agy:${uid}`)?.setup;

/** fresh: bỏ qua bộ nhớ (người dùng bấm làm mới). idle: lượt hỏi định kỳ của giao diện: đã có số thì không mở CLI. */
export async function subUsage(u: UserRow, cli: Cli, o: { fresh?: boolean; idle?: boolean } = {}): Promise<SubUsage> {
  const k = `${cli}:${u.id}`;
  let hit = g.limits.get(k);
  // Claude báo hạn mức trong mỗi lượt chat (rate_limit_event); codex đọc qua app-server (tối đa mỗi phút);
  // agy đọc bảng /usage (tối đa 5 phút một lần vì phải mở cả CLI).
  const age = o.idle && hit ? 0 : hit ? Date.now() - hit.at : Infinity;
  if (cli === "codex" && (o.fresh || age > 60_000)) {
    const [acc, rl] = await codexRpc(u.id, [{ method: "account/read" }, { method: "account/rateLimits/read" }]).catch(() => [null, null]);
    const c = codexWindows(rl);
    saveLimits(cli, u.id, c.windows, { plan: (typeof acc?.account?.planType === "string" ? acc.account.planType : undefined) ?? c.plan, credits: c.credits });
    hit = g.limits.get(k);
  } else if (cli === "agy" && (o.fresh || age > (hit?.setup ? 20_000 : 5 * 60_000))) {
    const r = await agyUsage(u.id).catch(() => ({ windows: [] as PlanWindow[], setup: false }));
    saveLimits(cli, u.id, r.windows, { setup: r.setup });
    hit = g.limits.get(k);
  } else if ((cli === "claude" || cli === "grok") && !hit?.plan) {
    const s = await status(cli, u.id).catch(() => null);
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
      : windows.length || cli === "grok" ? NOTE[cli] : cli === "agy" ? `${NOTE.agy} Synchro could not read the quota panel yet.` : `Send a message with this plan to see its limits. ${NOTE[cli]}` };
}

// ---------------------------------------------------------------- phiên CLI theo đoạn chat
let ready = false;
function sessDb() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS engine_sessions (user_id TEXT NOT NULL, conv TEXT NOT NULL, cli TEXT NOT NULL, session_id TEXT NOT NULL, turns INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, conv, cli));
      CREATE TABLE IF NOT EXISTS engine_turns (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, cli TEXT NOT NULL, at INTEGER NOT NULL, via TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS engine_turns_user ON engine_turns(user_id, cli, at);
      CREATE TABLE IF NOT EXISTS engine_api_optin (user_id TEXT NOT NULL, cli TEXT NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (user_id, cli));
      CREATE TABLE IF NOT EXISTS engine_session_log (user_id TEXT NOT NULL, conv TEXT NOT NULL, cli TEXT NOT NULL, session_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, conv, cli, session_id))`);
    // Model của từng lượt (cho Cài đặt → Usage theo model); bảng cũ chưa có cột này.
    if (!(d.prepare("PRAGMA table_info(engine_turns)").all() as { name: string }[]).some((c) => c.name === "model")) d.exec("ALTER TABLE engine_turns ADD COLUMN model TEXT");
    // tooled: phiên đã có lời gọi công cụ (NULL với phiên cũ: chưa biết, coi như có). sys_parts: dấu của các đoạn hướng dẫn phiên đã nhận (Codex, Antigravity).
    const cols = (d.prepare("PRAGMA table_info(engine_sessions)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("tooled")) d.exec("ALTER TABLE engine_sessions ADD COLUMN tooled INTEGER");
    if (!cols.includes("sys_parts")) d.exec("ALTER TABLE engine_sessions ADD COLUMN sys_parts TEXT");
    d.prepare("DELETE FROM engine_sessions WHERE updated_at < ?").run(Date.now() - 90 * 86_400_000);
    d.prepare("DELETE FROM engine_session_log WHERE at < ?").run(Date.now() - 90 * 86_400_000);
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
/** Đoạn chat bị xóa: bỏ mọi phiên CLI của nó (engine_session_log nhớ cả phiên cũ đã được thay bằng phiên mới), xóa lịch sử phiên khỏi đĩa. */
export async function removeConvSessions(uid: string, conv: string) {
  const d = sessDb();
  const rows = d.prepare("SELECT cli, session_id FROM engine_sessions WHERE user_id = ? AND conv = ? UNION SELECT cli, session_id FROM engine_session_log WHERE user_id = ? AND conv = ?").all(uid, conv, uid, conv) as { cli: Cli; session_id: string }[];
  d.prepare("DELETE FROM engine_sessions WHERE user_id = ? AND conv = ?").run(uid, conv);
  d.prepare("DELETE FROM engine_session_log WHERE user_id = ? AND conv = ?").run(uid, conv);
  for (const r of rows) await removeSessionFiles(scopeDir(r.cli, uid), r.session_id);
  dropLiveBridge(uid, conv);
  await removeConvAttachments(uid, conv);
}
/** Đoạn chat này chưa có phiên của CLI, hoặc phiên chưa từng gọi công cụ: đi đường nhanh được. Lịch sử có khối gọi công cụ mà lượt lại không khai báo công cụ thì API có thể từ chối. */
export function sessionPlain(uid: string, conv: string | undefined, cli: Cli): boolean {
  if (!conv) return true;
  const r = sessDb().prepare("SELECT tooled FROM engine_sessions WHERE user_id = ? AND conv = ? AND cli = ?").get(uid, conv, cli) as { tooled: number | null } | undefined;
  return !r || r.tooled === 0;
}
/** Khởi động sẵn tiến trình Claude Code cho lượt không công cụ kế tiếp của người dùng (mở trang, đổi model). Không tốn lượt nào của gói. */
// Tạo thư mục làm việc không còn chặn (makeDir chạy sudo bất đồng bộ): khởi động sẵn chạy nền, lỗi bỏ qua như mọi lời gọi prewarmChat vẫn làm.
export function prewarmClaude(o: { user: UserRow; model: string; system: string; effort?: string }) {
  // ChatGPT (Codex): khởi động sẵn app-server của tài khoản (G2.3), không gửi tin nào nên không tốn lượt của gói.
  if (subCli(o.model) === "codex" && find("codex") && everLoggedIn("codex", o.user.id)) {
    void engineEnvReady("codex", o.user.id).then((env) => prestartCodexServer({ env }, path.join(engineHome(), "work", safeScope(o.user.id)))).catch(() => {});
    return;
  }
  if (subCli(o.model) !== "claude") return;
  const run = resolvePlanModel("claude", o.user.id, splitKey(o.model).id, o.effort);
  const eng = engineFor("claude") as unknown as { prestart?: (r: Pick<TurnRequest, "system" | "model" | "effort" | "env" | "workdir">) => Promise<void> };
  void engineEnvReady("claude", o.user.id).then((env) => eng.prestart?.({ system: o.system || undefined, model: run.model, effort: run.effort, env, workdir: path.join(engineHome(), "work", safeScope(o.user.id)) })).catch(() => {});
}
// Codex, Antigravity chỉ nhận hướng dẫn hệ thống ở lượt mở phiên. Lượt nối tiếp gửi thêm các đoạn phiên chưa có (đoạn tài liệu dự án mới tìm được, hướng dẫn vừa sửa, danh mục connector mới, lượt có công cụ sau lượt đường nhanh);
// nhớ dấu của từng đoạn để không gửi lại cả hướng dẫn mỗi khi bộ nhớ thêm một dòng.
const RESEND = new Set<Cli>(["codex", "agy"]);
const sysSections = (s: string) => [...new Set(s.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean))];
const sysMark = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
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
// Tên thư mục mang dấu của đoạn chat để xóa đoạn chat thì xóa được tệp đính kèm của nó; thư mục cũ không có dấu vẫn được dọn theo tuổi như trước.
const attTag = (conv?: string) => (conv ? `${crypto.createHash("sha1").update(conv).digest("hex").slice(0, 12)}-` : "");
async function saveAttachments(work: string, atts: Attachment[], conv?: string) {
  const root = path.join(work, "att"), day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dir = path.join(root, day, attTag(conv) + crypto.randomBytes(6).toString("hex"));
  for (const a of atts) {
    a.path = path.join(dir, a.name);
    await writeEngineFile(a.path, Buffer.from(a.data, "base64"));
    for (const [i, p] of (a.pages ?? []).entries()) { p.path = path.join(dir, `${a.name.replace(/\.pdf$/i, "")}-trang-${i + 1}.jpg`); await writeEngineFile(p.path, Buffer.from(p.data, "base64")); }
  }
  const old = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10).replace(/-/g, "");
  for (const d of await listEngineDir(root)) if (/^\d{8}$/.test(d) && d < old) { try { await removeDir(path.join(root, d)); } catch {} }
  return dir;
}
async function removeConvAttachments(uid: string, conv: string) {
  const root = path.join(engineHome(), "work", safeScope(uid), "att"), tag = attTag(conv);
  for (const d of await listEngineDir(root)) for (const f of await listEngineDir(path.join(root, d))) if (f.startsWith(tag)) { try { await removeDir(path.join(root, d, f)); } catch {} }
}

/** fresh: không nối tiếp phiên của CLI (mở phiên mới kèm toàn bộ lịch sử) — dùng khi thử lại sau lỗi. */
/** total: số tin thật của đoạn chat (trình duyệt chỉ gửi 60 tin gần nhất, nối tiếp phiên phải so với số thật); lockMs: chờ lượt khác của tài khoản tối đa bao lâu;
 *  onStatus: dòng trạng thái (đang chờ, CLI đang thử lại); onSearch, onSources: CLI đang tìm web và nguồn tìm được. */
/** ephemeral (đoạn chat ẩn danh): không nối tiếp phiên, không nhớ phiên, xóa lịch sử CLI ghi trên đĩa ngay khi xong lượt. */
/** onNativeImages: ảnh Antigravity tự tạo trong lượt (image-generator của nó, không qua generate_image): chuyển ra đây để giao thành tệp, người dùng không mở được đường dẫn trên máy chủ. */
export type SubTurn = { maxWaitMs?: number; onAttDir?: (dir: string) => void; onNativeImages?: (files: ImgFile[]) => void; ephemeral?: boolean; onSession?: (id: string) => void; user: UserRow; model: string; system: string; messages: unknown; conv?: string; effort?: string; /** Lượt không công cụ (đường nhanh): được dùng tiến trình khởi động sẵn. */ fast?: boolean; /** Tên việc phụ, ghi vào [timing]; không có là lượt của người dùng. */ job?: string; /** Việc không ai đứng chờ: xếp hàng sau các việc khác (BG_MAX). */ bg?: boolean; /** Trích ngắn các tin cũ mà trình duyệt không gửi nguyên văn. */ older?: string; awaitingUser?: () => boolean; signal?: AbortSignal; onDelta?: (t: string) => void; onToolUse?: () => void; mcp?: { url: string; alive?: () => number; onPark?: (f: () => void) => void; live?: { url: string; key: string } }; web?: boolean; fresh?: boolean; total?: number; lockMs?: number; onStatus?: (t: string) => void; onSearch?: (q: { query?: string; url?: string }) => void; onSources?: (s: WebSource[]) => void };
export type SubResult = { status: number; json: Json };

// ---------------------------------------------------------------- phiên ấm (Claude Code)
// Đo trên máy chủ thật: câu đầu của đoạn chat mới qua Claude Code chờ ~13 giây tới chữ đầu, câu nối tiếp (nối phiên có sẵn) chỉ ~4 giây —
// phần chờ nằm ở việc CLI khởi tạo một phiên mới, không ở Synchro. Phiên ấm: sau một lượt, Synchro lặng lẽ khởi tạo sẵn ở nền một phiên
// với đúng hướng dẫn hệ thống, model, mức nỗ lực đó; đoạn chat mới tách (--fork-session) từ phiên này thay vì mở phiên mới. Mỗi khóa
// (tài khoản, model, nỗ lực, hướng dẫn) một phiên, dùng trong 50 phút; hướng dẫn đổi (skill, bộ nhớ…) thì khởi tạo lại.
type Warm = { id: string; at: number };
// Mặc định TẮT từ khi connector đi qua danh mục gọn (ec01701): đo lại trên máy chủ thật Haiku cold 3,4 giây, tách phiên ấm 5,5 giây (mỗi loại một lần
// đo). Phiên ấm không có cùng bộ công cụ với lượt thật (cầu nối MCP đã đóng khi khởi tạo) nên không chắc đọc được bộ đệm, mất khi deploy, và mỗi lần
// khởi tạo tốn một lượt thật của gói người dùng. Bật lại bằng SYNCHRO_WARM_SESSIONS=1 để đo: so "text=" ở dòng [timing] giữa resume=0 và resume=fork.
const WARM_ON = process.env.SYNCHRO_WARM_SESSIONS === "1";
const warm: Map<string, Warm> = ((globalThis as { __synchroWarm?: Map<string, Warm> }).__synchroWarm ??= new Map());
const priming = new Set<string>();
const WARM_TTL = 50 * 60_000;
const PRIME = "(Synchro vừa mở phiên làm việc, người dùng chưa gửi gì. Chỉ trả lời đúng một chữ: Sẵn sàng)";
const warmKey = (uid: string, model: string, effort: string | undefined, system: string) =>
  `${uid}|${model}|${effort ?? ""}|${crypto.createHash("sha1").update(system).digest("hex").slice(0, 16)}`;
async function primeWarm(key: string, base: TurnRequest, uid: string) {
  if (priming.has(key)) return;
  // Gói sắp chạm giới hạn: không tiêu thêm lượt để làm ấm.
  if ((g.limits.get(`claude:${uid}`)?.windows ?? []).some((w) => (w.usedPct ?? 0) >= 80)) return;
  priming.add(key);
  try {
    let id: string | null = null, ok = false;
    const req: TurnRequest = { ...base, prompt: PRIME, sessionId: undefined, fork: undefined, attachments: undefined, mcp: undefined, signal: AbortSignal.timeout(120_000) };
    for await (const e of engineFor("claude").runTurn(req)) {
      if (e.kind === "session") id = e.id;
      else if (e.kind === "final") ok = true;
      else if (e.kind === "error") { ok = false; break; }
    }
    // Lượt làm ấm là lượt thật của gói: ghi vào số lượt (Cài đặt → Usage) để người dùng thấy đúng.
    sessDb().prepare("INSERT INTO engine_turns (user_id, cli, at, via, model) VALUES (?, 'claude', ?, 'warm', ?)").run(uid, Date.now(), `sub-claude/${base.model ?? "default"}`);
    if (id && ok) { warm.set(key, { id, at: Date.now() }); if (warm.size > 200) warm.delete(warm.keys().next().value!); }
  } catch { /* không có phiên ấm thì lượt sau mở phiên mới như thường */ }
  finally { priming.delete(key); }
}

/** Link trong câu trả lời (markdown hoặc trần), bỏ phần trong artifact và Connect Link của Composio. */
export function linksIn(text: string): WebSource[] {
  const out = new Map<string, WebSource>();
  const s = text.replace(/<artifact\b[\s\S]*?(?:<\/artifact>|$)/gi, " ").replace(/```[\s\S]*?(?:```|$)/g, " ");
  for (const m of s.matchAll(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)>\]"']+)/g)) {
    const url = (m[2] ?? m[3]).replace(/[.,;:]+$/, "");
    // Connect Link của Composio (nút "Kết nối <Ứng dụng>") không phải nguồn trích dẫn.
    if (!out.has(url) && out.size < 12 && notConnectLink(url)) out.set(url, { title: m[1] ?? "", url });
  }
  return [...out.values()];
}

// Việc phụ chờ chỗ tối đa chừng này (bằng lời gọi chạy thẳng ở /api/llm): hơn nữa thì báo máy chủ bận, không giữ yêu cầu mãi.
const SIDE_WAIT_MS = 120_000;
const STREAMS = new Set<Cli>(["claude", "grok"]), WAIT_TELL_MS = 8000;
// Việc nền của một tài khoản chạy tối đa chừng này cùng lúc: sau một câu trả lời có artifact từng là rút bộ nhớ, chưng cất, đặt tên và hai phản biện cùng lúc, tức 5 CLI ăn vào mức chung của tài khoản (6),
// tin nhắn kế tiếp có thể phải xếp hàng sau chính những việc đó. Chúng không ai đứng chờ nên được chờ lâu hơn việc phụ thường.
const BG_MAX = 2, BG_WAIT_MS = 5 * 60_000;
export const BUSY = "Máy chủ đang bận. Hãy thử lại sau ít phút.";
/** Một lượt chat bằng gói subscription của chính người dùng. */
export async function subTurn(o: SubTurn): Promise<SubResult> {
  // Mỗi lượt là một CLI. Lượt chat, lượt Code đã giữ chỗ từ trước. Việc phụ (phản biện, quét skill, đặt tên, chưng cất) gọi thẳng tới đây từng không qua cổng nào:
  // 40 yêu cầu phản biện cùng lúc là tới 80 CLI, không tính vào mức của tài khoản hay của cả máy, đủ để hết RAM và sập trang của mọi người.
  if (holdsSlot()) return subTurnWatched(o);
  const uid = o.user.id;
  // Việc nền đếm riêng: một câu trả lời có 10 artifact là 8 phản biện đang chờ, từng làm đầy hàng chung nên đặt tên, nén ngữ cảnh ngay sau đó bị báo máy chủ bận. Hàng việc nền đầy thì bỏ việc đó, người có mặt không phải trả giá.
  if (o.bg ? queuedOf(uid, "quick", true) >= Math.ceil(queueLimit() / 2) : queuedOf(uid, "quick", false) >= queueLimit()) { if (!o.bg) noteRefused(); return { status: 503, json: { error: BUSY } }; }
  const slot = await acquire({ uid, lane: "quick", bg: o.bg, limit: o.bg ? Math.min(BG_MAX, quickLimit(o.user)) : quickLimit(o.user), total: turnsTotal(o.user), signal: o.signal, maxWaitMs: o.bg ? o.maxWaitMs ?? BG_WAIT_MS : SIDE_WAIT_MS });
  if (slot === "cancelled") return { status: 200, json: { model: o.model, text: "", cancelled: true } };
  if (slot === "timeout") return { status: 503, json: { error: BUSY } };
  return withSlot(slot, () => subTurnWatched(o));
}
async function subTurnWatched(o: SubTurn): Promise<SubResult> {
  // Antigravity, Grok chỉ báo mã phiên khi xong lượt: bấm Dừng, quá giờ hay CLI chết thì câu lệnh nằm lại trong thư mục đăng nhập mà xóa đoạn chat cũng không tìm thấy.
  // Mã mới xuất hiện mà không lượt nào báo về thì không ai nối tiếp được: dọn ở nền sau lượt. Lượt xong bình thường đã báo mã (sessionSeen) nên được giữ.
  const c0 = subCli(o.model);
  const r = await (async () => {
    if (c0 !== "agy" && c0 !== "grok") return subTurnInner(o);
    const watch = await watchSessions(await ensureScopeDir(c0, o.user.id));
    try { return await subTurnInner(o); } finally { void watch.sweep(); }
  })();
  // Vừa đổi sang bản CLI mới (cập nhật hằng tuần): các lượt thật đầu tiên lỗi thì tự trả về bản trước (app/ai/cliupdate.ts).
  if (c0) { const ok = classifyTurn(r); if (ok !== null) noteCliOutcome(c0, ok, ok ? "" : String(r.json.detail ?? r.json.error ?? ""), { uid: o.user.id, auth: r.status === 409 }); }
  return r;
}
async function subTurnInner(o: SubTurn): Promise<SubResult> {
  // Lượt không thuộc đoạn chat nào (đặt tên, chưng cất…) cũng không có gì nối tiếp: để lại lịch sử phiên thì không có đường nào xóa được khi người dùng xóa đoạn chat.
  if (o.conv && !o.ephemeral) return runTurn(o);
  const cli = subCli(o.model), seen = new Set<string>(), dirs: string[] = [];
  try { return await runTurn({ ...o, conv: undefined, onSession: (id) => seen.add(id), onAttDir: (d) => dirs.push(d) }); }
  finally {
    if (cli) for (const id of seen) void removeSessionFiles(scopeDir(cli, o.user.id), id);
    // Tệp đính kèm của đoạn chat ẩn danh không được nằm lại máy chủ chờ dọn theo tuổi (7 ngày).
    for (const d of dirs) { try { await removeDir(d); } catch {} }
  }
}
async function runTurn(o: SubTurn): Promise<SubResult> {
  const cli = subCli(o.model)!;
  // Đo thời gian từng chặng của lượt (ghi vào nhật ký máy chủ, không ghi nội dung): kiểm tra đăng nhập → khởi động CLI → sự kiện đầu → chữ đầu → xong.
  // wait: từ lúc lượt được tạo tới đây (xếp hàng, chọn model, skill, gọi lại bộ não, cả lần thử đường nhanh trước đó): cộng với text là thời gian người dùng thật sự chờ phía máy chủ.
  const T0 = Date.now(), tm: Record<string, number> = {}, wait = runAge();
  let chunks = 0;
  // Trạng thái đăng nhập đã biết dùng ngay, kiểm tra lại ở nền (stale): trước đây quá 60 giây là lượt chat phải chờ chạy CLI kiểm tra
  // đăng nhập (vài giây đến hơn chục giây) trước khi gọi model. Phiên đăng nhập thật sự hết hạn thì lượt vẫn báo đăng nhập lại (lỗi auth).
  const s = await status(cli, o.user.id, { stale: true });
  tm.status = Date.now() - T0;
  if (!s.installed) return { status: 503, json: { error: `${SUB[cli].name} CLI chưa được cài trên máy chủ. Quản trị viên cài ở Cài đặt → Providers.` } };
  if (!s.loggedIn) return { status: 409, json: { error: `Bạn chưa đăng nhập gói ${SUB[cli].name}. Đăng nhập ở Cài đặt → Providers.`, relogin: cli } };
  const msgs = (Array.isArray(o.messages) ? o.messages : []) as Msg[];
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "user") return { status: 400, json: { error: "Thiếu tin nhắn của người dùng." } };
  const d = sessDb();
  const conv = o.conv && o.conv.length <= 64 ? o.conv : null;
  const prev = conv ? (d.prepare("SELECT session_id, turns, tooled, sys_parts FROM engine_sessions WHERE user_id = ? AND conv = ? AND cli = ?").get(o.user.id, conv, cli) as { session_id: string; turns: number; tooled: number | null; sys_parts: string | null } | undefined) : undefined;
  // Nối tiếp phiên của CLI khi lịch sử khớp đúng lượt trước (không sửa, không tạo lại câu trả lời); ngược lại mở phiên mới kèm lịch sử.
  // Trình duyệt chỉ gửi 60 tin gần nhất: so với số tin thật, không thì từ khoảng lượt 31 mỗi câu đều mở phiên mới kèm toàn bộ lịch sử.
  const total = o.total && o.total >= msgs.length ? o.total : msgs.length;
  const resume = prev && !o.fresh && prev.turns === total - 1 ? prev.session_id : undefined;
  // Ảnh, PDF gửi kèm nguyên dạng như khi dùng ứng dụng của hãng (không đổi thành chữ): Claude Code nhận khối ảnh / PDF qua stream-json,
  // Codex nhận ảnh bằng --image, Antigravity mở tệp trong thư mục làm việc bằng công cụ xem tệp của nó.
  const col: Collect = { atts: [], nativePdf: cli === "claude" };
  const old = resume ? null : recentMedia(msgs.slice(0, -1));
  const history = resume ? "" : msgs.slice(0, -1).map((m) => `[${m.role === "assistant" ? "assistant" : "user"}]\n${textOf(m.content, m.role === "user" ? { ...col, keep: (b) => old!.has(b) } : undefined)}`).filter((x) => x.trim()).join("\n\n");
  // Mở phiên mới cho đoạn chat dài (đổi model, sửa tin cũ): trình duyệt chỉ gửi các tin gần nhất. Model phải biết còn phần trước đó để không khẳng định "chưa nói gì",
  // người dùng cũng phải biết để nhắc lại điều quan trọng.
  const older = !resume ? total - msgs.length : 0;
  const oldNote = older <= 0 ? "" : o.older ? `[Đoạn chat này còn ${older} tin cũ hơn. Dưới đây chỉ là phần đầu của các tin đó, không đầy đủ: đừng khẳng định chi tiết; cần thì hỏi lại người dùng.]\n${o.older}\n[Hết phần trích. Từ đây là nguyên văn.]\n\n` : `[Đoạn chat này còn ${older} tin cũ hơn không có ở đây. Đừng khẳng định về chúng; cần thì hỏi lại người dùng.]\n\n`;
  const prompt = (history ? `<conversation_history>\n${oldNote}${history}\n</conversation_history>\n\n` : "") + textOf(last.content, col);
  if (older > 0) o.onStatus?.(`Đoạn chat dài: ${SUB[cli].name} đọc nguyên văn ${msgs.length} tin gần nhất, ${older} tin cũ hơn chỉ có phần trích ngắn hoặc không có. Điều quan trọng ở đó nên nhắc lại`);
  const run = resolvePlanModel(cli, o.user.id, splitKey(o.model).id, o.effort);
  const work = path.join(engineHome(), "work", safeScope(o.user.id));
  await makeDir(work);
  if (col.atts.length && cli !== "claude") {
    try { const dir = await saveAttachments(work, col.atts, o.conv); o.onAttDir?.(dir); }
    catch (e) { return { status: 500, json: { error: `Không chuyển được tệp đính kèm cho ${SUB[cli].name}: ${redact((e as Error).message).slice(0, 200)}` } }; }
  }
  // Bộ canh lượt treo (watchdog.ts): model không có hoạt động thật quá lâu (treo mạng, phiên kẹt) thì dừng và báo 503 để chế độ Tự động chuyển
  // sang model khác, không để người dùng nhìn vòng xoay mãi. Đang chờ lượt khác của tài khoản, công cụ đang chạy, CLI đang thử lại: không tính.
  const wd = new AbortController();
  const lim = watchLimits(cli, run.effort ?? o.effort);
  // Lịch sử rất dài, nhiều tệp: model đọc lâu hơn hẳn mới bắt đầu trả lời.
  // Tính cả ảnh, PDF gửi nguyên dạng: bản scan lớn tới sự kiện đầu rất chậm, từng bị coi là treo và chuyển sang CLI không đọc được PDF gốc.
  if (Buffer.byteLength(prompt) + Buffer.byteLength(o.system ?? "") + col.atts.reduce((n, a) => n + a.data.length, 0) > 400_000) lim.first *= 3;
  const ws: WatchState = { start: T0, last: 0, alive: 0, waiting: false };
  let stalled: "first" | "idle" | null = null, slowTold = false, waitTold = "";
  const watch = setInterval(() => {
    const a = o.mcp?.alive?.() ?? 0;
    if (a > T0) ws.alive = a;
    // CLI hiện chữ dần mà sau 30 giây chưa có gì: nói cho người dùng biết đang xảy ra chuyện gì, đừng để họ nhìn vòng xoay tới lúc tự chuyển model.
    // Claude, Grok hiện chữ dần nên phần lớn lượt có chữ trong vài giây. Quá 8 giây mà chưa có chữ: nói đúng đang tắc ở đâu, thay vì "Đang suy nghĩ…" cho cả lúc CLI còn đang khởi động. Codex, Antigravity đã có dòng riêng lúc bắt đầu.
    if (STREAMS.has(cli) && !tm.text && !a && !ws.waiting && Date.now() - ws.start > WAIT_TELL_MS) {
      const stage = !tm.event ? `Đang khởi động ${SUB[cli].name}` : ws.last ? `${SUB[cli].name} đang suy nghĩ, chưa viết chữ nào` : `${SUB[cli].name} đã nhận yêu cầu, đang chờ model phản hồi`;
      if (stage !== waitTold) { waitTold = stage; o.onStatus?.(stage); }
    }
    if (!slowTold && lim.first <= 120_000 && lim.first > 30_000 && !ws.waiting && !ws.last && !ws.alive && Date.now() - ws.start > 30_000) { slowTold = true; o.onStatus?.(`${SUB[cli].name} phản hồi chậm hơn bình thường, Synchro vẫn đang chờ`); }
    stalled = stallOf(ws, lim);
    if (stalled) { clearInterval(watch); wd.abort(); }
  }, 2000);
  // Đoạn chat mới qua Claude Code: tách từ phiên ấm nếu có (xem primeWarm).
  const wk = WARM_ON && cli === "claude" && conv ? warmKey(o.user.id, run.model ?? "", run.effort, o.system ?? "") : null;
  const w = wk ? warm.get(wk) : undefined;
  const fork = !resume && w && Date.now() - w.at < WARM_TTL ? w.id : undefined;
  const sysNow = RESEND.has(cli) ? sysSections(o.system ?? "") : [];
  let sysHad = new Set<string>();
  if (resume) { try { sysHad = new Set(JSON.parse(prev?.sys_parts ?? "[]") as string[]); } catch {} }
  const sysNew = resume ? sysNow.filter((x) => !sysHad.has(sysMark(x))) : [];
  const req: TurnRequest = {
    // Lượt có công cụ cũng dùng tiến trình dựng sẵn khi cầu nối có địa chỉ sống theo cuộc trò chuyện (G2.2).
    pool: cli === "claude" && (!!o.fast || !!o.mcp?.live),
    sysUpdate: sysNew.length ? `<system_update>\nHướng dẫn của Synchro có phần mới cho lượt này. Áp dụng cùng với hướng dẫn đã nhận:\n\n${sysNew.join("\n\n")}\n</system_update>` : undefined,
    prompt, attachments: col.atts.length ? col.atts : undefined, system: o.system || undefined, model: run.model, effort: run.effort, sessionId: resume ?? fork, fork: !!fork, workdir: work, env: await engineEnvReady(cli, o.user.id), signal: o.signal ? AbortSignal.any([o.signal, wd.signal]) : wd.signal, mcp: o.mcp && { url: o.mcp.url, onPark: o.mcp.onPark, live: o.mcp.live }, alive: o.mcp?.alive, web: o.web, lockMs: o.lockMs, awaitingUser: o.awaitingUser,
    history: msgs.slice(0, -1).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: textOf(m.content) })),
  };
  const natStamp = cli === "agy" && o.onNativeImages ? await nativeStamp(work) : null;
  // Không tự chuyển sang khóa API khi gói hết hạn mức: trả về để trình duyệt hỏi người dùng (xem planLimit bên dưới).
  const eng = engineFor(cli);
  let text = "", final: string | null = null, via: string | null = null, session: string | null = null, err: { message: string; code?: string } | null = null, denied: string[] = [];
  tm.prep = Date.now() - T0;
  let searched = false, rejected = false, poolState = "";
  const seenSrc = new Set<string>();
  const addSources = (items: WebSource[]) => { const fresh = items.filter((x) => !seenSrc.has(x.url)); for (const x of fresh) seenSrc.add(x.url); if (fresh.length) o.onSources?.(fresh); };
  try {
  for await (const e of eng.runTurn(req)) {
    // event: dòng đầu CLI thật sự in ra. Dấu hiệu của chính Synchro (pool, status) không tính: lượt trong hồ từng ghi event=1 dù CLI còn đang khởi động.
    if (e.kind !== "pool" && e.kind !== "status") tm.event ??= Date.now() - T0;
    if (e.kind === "text") { tm.text ??= Date.now() - T0; chunks++; ws.last = Date.now(); text += e.text; o.onDelta?.(e.text); }
    else if (e.kind === "activity") { tm.active ??= Date.now() - T0; ws.last = Date.now(); }
    else if (e.kind === "status") {
      if (e.wait !== undefined) ws.waiting = e.wait;
      // Hết chờ lượt khác, hoặc CLI báo đang thử lại: tính lại từ lúc này.
      if (!e.wait && !e.tick) ws.start = Date.now();
      if (e.text) o.onStatus?.(e.text);
    }
    else if (e.kind === "pool") poolState = e.state;
    else if (e.kind === "search") { searched = true; ws.last = Date.now(); o.onSearch?.({ query: e.query, url: e.url }); }
    else if (e.kind === "sources") addSources(e.items);
    else if (e.kind === "tooluse") { ws.last = Date.now(); o.onToolUse?.(); }
    else if (e.kind === "session") {
      session = e.id;
      o.onSession?.(e.id);
      // Ghi ngay khi biết mã phiên: lượt bị dừng giữa chừng vẫn để lại lịch sử trên đĩa, xóa đoạn chat phải tìm được.
      if (conv) d.prepare("INSERT OR IGNORE INTO engine_session_log (user_id, conv, cli, session_id, at) VALUES (?, ?, ?, ?, ?)").run(o.user.id, conv, cli, e.id, Date.now());
      // Ghi nhớ model thật của tên gọi tắt Claude (để bộ chọn model hiện "Claude Opus 5.5" thay vì "Claude Opus").
      if (cli === "claude" && e.model && run.model) {
        const k = `claude:${o.user.id}`, cur = g.resolved.get(k) ?? {};
        if (cur[run.model] !== e.model) { g.resolved.set(k, { ...cur, [run.model]: e.model }); g.models.delete(k); }
      }
    }
    else if (e.kind === "final") { final = e.text; via = e.via ?? cli; denied = e.denied ?? []; }
    else if (e.kind === "usage" && e.usage.limits?.length) { saveLimits(cli, o.user.id, e.usage.limits); if (e.usage.limits.some((w) => w.status === "rejected")) rejected = true; }
    else if (e.kind === "error") err = { message: e.message, code: e.code };
  }
  } finally { clearInterval(watch); }
  tm.end = Date.now() - T0;
  // Đọc trước khi trả về: đoạn chat ẩn danh xóa tệp phiên (cả thư mục hội thoại của agy) ngay sau lượt.
  if (natStamp) {
    const env = req.env ?? {};
    const imgs = session && !o.signal?.aborted ? await agyNativeImages({ env, workdir: work, session, stamp: natStamp }).catch(() => [] as ImgFile[]) : [];
    await removeFile(natStamp, { env, cwd: work }).catch(() => {});
    if (imgs.length) o.onNativeImages!(imgs);
  }
  // Hãng vừa báo cửa sổ hạn mức bị từ chối mà lượt lỗi: là hết hạn mức dù câu báo lỗi viết kiểu gì.
  if (err && rejected && (err.code === "other" || err.code === "rate" || !err.code)) err.code = "quota";
  // Phần đã viết trước khi lỗi không bị bỏ: bên gọi giữ lại cùng lời báo lỗi.
  const partial = text ? { text } : {};
  if (stalled && !o.signal?.aborted) {
    console.log(`[timing] ${cli} ${run.model ?? "?"} ${run.effort ?? "-"} không có ${stalled === "first" ? "hoạt động đầu tiên" : "tiến triển"}: dừng lượt ${Object.entries(tm).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    // noRetry: thử lại nguyên lượt này chỉ khiến người dùng chờ thêm chừng ấy; chế độ Tự động chuyển model ngay.
    return { status: 503, json: { error: stalled === "first" ? `${SUB[cli].name} không phản hồi sau ${waitText(lim.first)}. Hãy thử lại hoặc chọn model khác.` : `${SUB[cli].name} không có tiến triển trong ${waitText(lim.idle)}. Hãy nhắn "tiếp tục" hoặc chọn model khác.`, stalled: true, noRetry: true, ...partial } };
  }
  console.log(`[timing] ${cli} ${run.model ?? "?"} ${run.effort ?? "-"} resume=${resume ? 1 : fork ? "fork" : 0}${o.fast ? " fast=1" : ""}${poolState ? ` pool=${poolState}` : ""}${o.job ? ` job=${o.job}` : ""}${wait === null ? "" : ` wait=${wait}`} chunks=${chunks} sysKB=${Math.round(Buffer.byteLength(o.system ?? "") / 1024)} promptKB=${Math.round(Buffer.byteLength(prompt) / 1024)} ${Object.entries(tm).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  // Phiên ấm hỏng (bị xóa, hết hạn phía CLI): bỏ đi rồi chạy lại một lần bằng phiên mới.
  if (fork && wk && err && final === null && !text && err.code !== "aborted" && !o.signal?.aborted) { warm.delete(wk); return runTurn(o); }
  if (err && final === null) {
    if (err.code === "aborted") return { status: 200, json: { model: o.model, text, cancelled: true } };
    const apiModel = await apiEquivalent(o.user, o.model), apiName = await apiModelName(apiModel);
    const id = splitKey(o.model).id;
    if (err.code === "auth") {
      markRelogin(cli, o.user.id);
      return { status: 409, json: { error: `Phiên đăng nhập gói ${SUB[cli].name} không còn hợp lệ. Đăng nhập lại ở Cài đặt → Providers.`, relogin: cli, apiModel, apiModelName: apiName, detail: redact(err.message).slice(0, 300), ...partial } };
    }
    // Giới hạn tốc độ, quá tải ngắn hạn: không phải hết gói, không khóa gói; bên gọi chờ rồi thử lại một lần hoặc chuyển model.
    if (err.code === "rate") {
      const after = retryAfterMs(err.message);
      return { status: 429, json: { error: `${SUB[cli].name} đang giới hạn tốc độ hoặc quá tải. Hãy thử lại sau ${after ? waitText(after) : "ít phút"} hoặc chọn model khác.`, rate: true, retryAfterMs: after, detail: redact(err.message).slice(0, 200), ...partial } };
    }
    if (err.code === "busy") return { status: 503, json: { error: err.message, busy: true, noRetry: true, ...partial } };
    if (err.code === "quota") {
      // Gói Google: model Claude / GPT qua Antigravity có hạn mức riêng; hết nhóm đó thì model Gemini của gói vẫn dùng được.
      if (cli === "agy" && !isGeminiId(id) && !agyOtherBlock(o.user.id)) g.quota.set(`agy-other:${o.user.id}`, Date.now() + 30 * 60_000);
      if (cli === "agy" && !isGeminiId(id)) return { status: 429, json: { error: "Hạn mức model Claude / GPT trong gói Google (Antigravity) đã hết. Model Gemini của gói vẫn dùng được.", quota: "model", resetsAt: agyOtherBlock(o.user.id), detail: redact(err.message).slice(0, 200), ...partial } };
      const scope = noteQuota(cli, o.user.id, id, err.message);
      if (cli === "codex") { const h = g.limits.get(`${cli}:${o.user.id}`); if (h) h.at = 0; }
      const shown = g.models.get(`${cli}:${o.user.id}`)?.v.find((m) => m.id === id)?.name ?? SUB[cli].fallback.find((m) => m.id === id)?.name ?? id;
      return { status: 429, json: { error: scope === "plan" ? `Gói ${SUB[cli].name} của bạn đã hết hạn mức.` : `${shown} đã hết hạn mức. Các model khác của gói ${SUB[cli].name} vẫn dùng được.`, planLimit: cli, quota: scope, resetsAt: modelBlock(cli, o.user.id, id), apiModel, apiModelName: apiName, detail: redact(err.message).slice(0, 200), ...partial } };
    }
    if (err.code === "timeout") return { status: 504, json: { error: err.message, ...partial } };
    const raw = redact(err.message);
    return { status: 502, json: { error: friendlyError(raw, SUB[cli].name) ?? (raw.slice(0, 500) || "Gói subscription báo lỗi."), detail: raw.slice(0, 500), ...partial } };
  }
  // Lượt chạy được: hạn mức tạm ghi nhận không còn đúng; hãng đã nhận đăng nhập nên báo động "cần đăng nhập lại" (nếu có) cũng không còn đúng.
  g.quota.delete(`${cli}:${o.user.id}`);
  g.quota.delete(`${cli}:${o.user.id}:${splitKey(o.model).id}`);
  clearRelogin(cli, o.user.id);
  // Câu trả lời ghi link mà CLI không báo nguồn có cấu trúc (Antigravity, Codex): lấy nguồn từ chính câu trả lời.
  if (o.web && (searched || cli === "agy") && !seenSrc.size) addSources(linksIn(final ?? text));
  d.prepare("INSERT INTO engine_turns (user_id, cli, at, via, model) VALUES (?, ?, ?, ?, ?)").run(o.user.id, cli, Date.now(), via ?? cli, o.model);
  if (conv && session) {
    // Phiên nối tiếp giữ dấu "đã gọi công cụ" (phiên cũ chưa có dấu: coi như có); phiên mới tính từ lượt này.
    const tooled = searched || (o.mcp?.alive?.() ?? 0) > T0 || (resume ? prev?.tooled !== 0 : false);
    const parts = RESEND.has(cli) ? JSON.stringify([...new Set([...sysHad, ...sysNow.map(sysMark)])].slice(-800)) : null;
    d.prepare(`INSERT INTO engine_sessions (user_id, conv, cli, session_id, turns, updated_at, tooled, sys_parts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, conv, cli) DO UPDATE SET session_id = excluded.session_id, turns = excluded.turns, updated_at = excluded.updated_at, tooled = excluded.tooled, sys_parts = excluded.sys_parts`)
      .run(o.user.id, conv, cli, session, total + 1, Date.now(), tooled ? 1 : 0, parts);
  }
  // Khởi tạo sẵn (hoặc làm mới) phiên ấm cho đoạn chat mới sau, ở nền, sau khi lượt này đã xong.
  if (wk && (!w || Date.now() - w.at > WARM_TTL * 0.8)) void primeWarm(wk, req, o.user.id);
  return { status: 200, json: { model: o.model, text: final ?? text, via, ...(denied.length ? { denied } : {}) } };
}
