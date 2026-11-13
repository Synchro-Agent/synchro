// Mức dùng model của từng tài khoản (chỉ chạy ở máy chủ). Synchro gọi model qua API nên mức dùng tính theo chi phí API thật:
// mỗi lần gọi, đọc số token nhà cung cấp trả về (input, output, cache) rồi nhân với giá của model đó.
// Giới hạn giống Claude: "phiên" 5 giờ tính từ tin nhắn đầu tiên, và "hằng tuần" đặt lại vào cùng giờ mỗi tuần.
// Quản trị viên đặt hạn mức (USD) cho mọi người, từng người, và sửa bảng giá nếu nhà cung cấp đổi giá.
// Ngoài ra ghi lại hạn mức gọi API mà nhà cung cấp báo trong header (Anthropic, OpenAI) để biết API còn bao nhiêu.
import { AsyncLocalStorage } from "node:async_hooks";
import { adminRole, db, getSetting, isAdmin, setSetting, type UserRow } from "./authstore";
import { vendorOf } from "./router";
import { familyKey, parseId, versionCmp } from "./modelrules";
import { providerPriceOf } from "./modelreg";

export const SESSION_MS = 5 * 3600_000;
export const WEEK_MS = 7 * 86_400_000;

// ---------------------------------------------------------------- bảng giá (USD / 1 triệu token)
// official: theo trang giá của hãng; estimate: chưa có giá chính thức, quản trị viên nên kiểm tra và sửa.
export type Price = { in: number; out: number; cache: number; src: "official" | "estimate" | "custom" };
// Mã mẫu (cột cuối): một model cụ thể của dòng, để model mới cùng dòng mà chưa có giá chính thức kế thừa giá của bản gần nhất (ước tính).
const DEFAULT_PRICES: [RegExp, Omit<Price, "src">, Price["src"], string?][] = [
  [/^anthropic\/claude-fable-5-1/, { in: 10, out: 50, cache: 0.25 }, "official", "anthropic/claude-fable-5-1"],
  [/^anthropic\/claude-opus-5-5/, { in: 4, out: 20, cache: 0.2 }, "official", "anthropic/claude-opus-5-5"],
  [/^anthropic\/claude-sonnet-5-5/, { in: 2, out: 10, cache: 0.2 }, "official", "anthropic/claude-sonnet-5-5"],
  [/^anthropic\/claude-haiku-5-5/, { in: 0.1, out: 0.5, cache: 0.01 }, "official", "anthropic/claude-haiku-5-5"],
  [/^anthropic\/claude-fable/, { in: 10, out: 50, cache: 1 }, "estimate"],
  [/^anthropic\/claude-opus/, { in: 5, out: 25, cache: 0.5 }, "estimate"],
  [/^anthropic\/claude-sonnet/, { in: 3, out: 15, cache: 0.3 }, "estimate"],
  [/^anthropic\/claude-haiku/, { in: 1, out: 5, cache: 0.1 }, "estimate"],
  [/^openai\/gpt-6-astra/, { in: 10, out: 50, cache: 1 }, "estimate", "openai/gpt-6-astra"],
  [/^openai\/gpt-6(\.\d)?-sol/, { in: 2, out: 10, cache: 0.2 }, "estimate", "openai/gpt-6.1-sol"],
  [/^openai\/gpt-6(\.\d)?-luna/, { in: 0.1, out: 0.5, cache: 0.01 }, "estimate", "openai/gpt-6-luna"],
  [/^google\/gemini-4/, { in: 2.5, out: 15, cache: 0.25 }, "estimate", "google/gemini-4-argon"],
  [/^google\/gemini-[\d.]+-pro/, { in: 2, out: 12, cache: 0.2 }, "estimate", "google/gemini-3.1-pro-preview"],
  [/^google\/gemini-[\d.]+-flash-lite/, { in: 0.25, out: 1.5, cache: 0.025 }, "estimate", "google/gemini-3.5-flash-lite"],
  [/^google\/gemini-[\d.]+-flash/, { in: 1.5, out: 9, cache: 0.15 }, "estimate", "google/gemini-3.8-flash"],
  // xAI (docs.x.ai, giá cho prompt dưới 200 nghìn token; từ 200 nghìn token cả yêu cầu tính gấp đôi).
  [/^xai\/grok-4\.[67]\b/, { in: 2, out: 6, cache: 0.5 }, "official", "xai/grok-4.7"],
  [/^xai\/grok-4\.5\b/, { in: 2, out: 6, cache: 0.3 }, "official", "xai/grok-4.5"],
  [/^xai\/grok-4\.(3|20)\b/, { in: 1.25, out: 2.5, cache: 0.2 }, "official"],
  [/^xai\/grok-build/, { in: 1, out: 2, cache: 0.2 }, "official", "xai/grok-build-0.1"],
  [/^xai\//, { in: 2, out: 6, cache: 0.5 }, "estimate"],
  // DeepSeek (api-docs.deepseek.com): giá giờ cao điểm; ngoài giờ cao điểm và cuối tuần hãng tính một nửa, nên đây là mức trần.
  [/^deepseek\/deepseek-(v[\d.]+-)?flash/, { in: 0.3, out: 1.2, cache: 0.006 }, "official", "deepseek/deepseek-flash"],
  [/^deepseek\/deepseek-v[\d.]+-pro/, { in: 1.32, out: 3.96, cache: 0.044 }, "official", "deepseek/deepseek-v4-pro"],
  [/^deepseek\//, { in: 1.32, out: 3.96, cache: 0.044 }, "estimate"],
  // Embedding (tìm kiếm ngữ nghĩa của bộ não và tài liệu dự án): chỉ tính token đầu vào.
  [/\/text-embedding-3-small$/, { in: 0.02, out: 0, cache: 0 }, "official"],
  [/\/text-embedding-3-large$/, { in: 0.13, out: 0, cache: 0 }, "official"],
  [/\/gemini-embedding-001$/, { in: 0.15, out: 0, cache: 0 }, "official"],
  [/\/[\w.-]*embedding[\w.-]*$/, { in: 0.15, out: 0, cache: 0 }, "estimate"],
  [/./, { in: 3, out: 15, cache: 0.3 }, "estimate"],
];

// ---------------------------------------------------------------- cấu hình của quản trị viên
// session / weekly: hạn mức USD mặc định cho mọi người (null = không giới hạn). admins: có áp hạn mức cho quản trị viên không.
export type UsageConfig = { session: number | null; weekly: number | null; admins: boolean; prices: Record<string, { in: number; out: number; cache: number }> };
const DEFAULT_CONFIG: UsageConfig = { session: 2, weekly: 20, admins: false, prices: {} };
type Override = { session?: number | null; weekly?: number | null };

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS usage_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL, model TEXT NOT NULL, feature TEXT NOT NULL,
        input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL, cost REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_events_user ON usage_events(user_id, at);
      CREATE INDEX IF NOT EXISTS usage_events_at ON usage_events(at);
      CREATE TABLE IF NOT EXISTS usage_users (user_id TEXT PRIMARY KEY, session_start INTEGER, week_anchor INTEGER, override TEXT);
      CREATE TABLE IF NOT EXISTS usage_config (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)`);
    // Giữ 60 ngày lịch sử là đủ cho giới hạn tuần và thống kê.
    d.prepare("DELETE FROM usage_events WHERE at < ?").run(Date.now() - 60 * 86_400_000);
    ready = true;
  }
  return d;
}

const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
export function getConfig(): UsageConfig {
  const r = init().prepare("SELECT json FROM usage_config WHERE id = 1").get() as { json: string } | undefined;
  let j: Partial<UsageConfig> = {};
  try { j = r ? JSON.parse(r.json) : {}; } catch {}
  return { ...DEFAULT_CONFIG, ...j, prices: { ...(j.prices ?? {}) } };
}
export function setConfig(patch: Partial<UsageConfig>): UsageConfig {
  const c = getConfig();
  if ("session" in patch) c.session = patch.session === null ? null : num(patch.session) ?? c.session;
  if ("weekly" in patch) c.weekly = patch.weekly === null ? null : num(patch.weekly) ?? c.weekly;
  if (typeof patch.admins === "boolean") c.admins = patch.admins;
  if (patch.prices && typeof patch.prices === "object") {
    for (const [k, v] of Object.entries(patch.prices)) {
      if (!/^[a-z0-9-]+\/[\w.:-]{1,120}$/.test(k)) continue;
      if (v === null) { delete c.prices[k]; continue; }
      const p = { in: num(v?.in), out: num(v?.out), cache: num(v?.cache) };
      if (p.in !== null && p.out !== null) c.prices[k] = { in: p.in, out: p.out, cache: p.cache ?? p.in / 10 };
    }
  }
  init().prepare("INSERT INTO usage_config (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(JSON.stringify(c));
  return c;
}

/**
 * Giá của một model: giá quản trị viên sửa → giá chính thức trong bảng → giá hãng tự báo trong danh sách model (sổ model) →
 * giá của bản gần nhất cùng dòng (model hãng vừa ra: "claude-opus-6" lấy giá Opus 5.5, đánh dấu ước tính) → giá ước tính theo mẫu. Không bao giờ là 0.
 */
export function priceOf(model: string, cfg = getConfig()): Price {
  const o = cfg.prices[model];
  if (o) return { ...o, src: "custom" };
  const row = DEFAULT_PRICES.find(([re]) => re.test(model))!;
  if (row[2] === "official") return { ...row[1], src: "official" };
  const own = (() => { try { return providerPriceOf(model); } catch { return null; } })();
  if (own && own.in > 0 && own.out > 0) return { ...own, src: "official" };
  const fam = familyKey(model), ver = parseId(model).version;
  const known: [string, Omit<Price, "src">][] = [...DEFAULT_PRICES.filter((r) => r[3]).map((r) => [r[3]!, r[1]] as [string, Omit<Price, "src">]), ...Object.entries(cfg.prices)];
  const near = known.filter(([k]) => k !== model && familyKey(k) === fam && versionCmp(parseId(k).version, ver) <= 0)
    .sort(([a], [b]) => versionCmp(parseId(b).version, parseId(a).version))[0];
  if (near && near[1].in > 0) return { ...near[1], src: "estimate" };
  return { ...row[1], src: row[2] };
}

// ---------------------------------------------------------------- ghi nhận mỗi lần gọi model
// Mọi lời gọi model trong một yêu cầu (chat, artifact, Synchro Code…) được tính cho tài khoản đang gọi.
export const usageScope = new AsyncLocalStorage<{ uid: string; feature: string }>();
export const withUsage = <T,>(uid: string, feature: string, fn: () => T) => usageScope.run({ uid, feature }, fn);

type Tok = { input: number; output: number; cacheRead: number; cacheWrite: number };
// Số token theo định dạng của từng API: Anthropic Messages, OpenAI Responses, Chat Completions (OpenAI / Gemini).
export function readTokens(u: Record<string, unknown> | undefined | null): Tok | null {
  if (!u || typeof u !== "object") return null;
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
  if ("input_tokens" in u && ("cache_read_input_tokens" in u || "cache_creation_input_tokens" in u || !("input_tokens_details" in u))) {
    // Anthropic: input_tokens không gồm phần đọc/ghi cache.
    return { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens) };
  }
  if ("input_tokens" in u) {
    const cached = n((u.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
    return { input: Math.max(0, n(u.input_tokens) - cached), output: n(u.output_tokens), cacheRead: cached, cacheWrite: 0 };
  }
  if ("prompt_tokens" in u) {
    // DeepSeek báo phần đọc từ cache ở prompt_cache_hit_tokens; các hãng khác ở prompt_tokens_details.cached_tokens.
    const cached = "prompt_cache_hit_tokens" in u ? n(u.prompt_cache_hit_tokens) : n((u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
    // Grok tính token suy nghĩ riêng, ngoài completion_tokens (chỉ có trong total_tokens): cộng phần chênh vào đầu ra.
    const think = Math.max(0, n(u.total_tokens) - n(u.prompt_tokens) - n(u.completion_tokens));
    return { input: Math.max(0, n(u.prompt_tokens) - cached), output: n(u.completion_tokens) + think, cacheRead: cached, cacheWrite: 0 };
  }
  return null;
}
export const costOf = (t: Tok, p: Price) => (t.input * p.in + t.cacheWrite * p.in * 1.25 + t.cacheRead * p.cache + t.output * p.out) / 1e6;

function windows(uid: string, now: number) {
  const d = init();
  const r = d.prepare("SELECT session_start, week_anchor, override FROM usage_users WHERE user_id = ?").get(uid) as { session_start: number | null; week_anchor: number | null; override: string | null } | undefined;
  let ov: Override = {};
  try { ov = r?.override ? JSON.parse(r.override) : {}; } catch {}
  const sessionStart = r?.session_start && now < r.session_start + SESSION_MS ? r.session_start : null;
  const anchor = r?.week_anchor ?? null;
  const weekStart = anchor === null ? null : anchor + Math.floor((now - anchor) / WEEK_MS) * WEEK_MS;
  return { sessionStart, anchor, weekStart, override: ov, exists: !!r };
}

export function recordUsage(model: string, usage: unknown) {
  const s = usageScope.getStore();
  const t = readTokens(usage as Record<string, unknown>);
  if (!s || !t || (!t.input && !t.output && !t.cacheRead && !t.cacheWrite)) return;
  const now = Date.now();
  const d = init();
  const w = windows(s.uid, now);
  // Tin nhắn đầu tiên sau khi phiên cũ hết hạn bắt đầu phiên 5 giờ mới; lần dùng đầu tiên đặt mốc cho tuần.
  d.prepare(`INSERT INTO usage_users (user_id, session_start, week_anchor) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET session_start = excluded.session_start, week_anchor = COALESCE(usage_users.week_anchor, excluded.week_anchor)`)
    .run(s.uid, w.sessionStart ?? now, w.anchor ?? now);
  d.prepare("INSERT INTO usage_events (user_id, at, model, feature, input, output, cache_read, cache_write, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(s.uid, now, model, s.feature, t.input, t.output, t.cacheRead, t.cacheWrite, costOf(t, priceOf(model)));
}

/** Tổng chi phí (USD) một tính năng đã dùng của một người từ mốc since (hạn mức riêng cho việc nền như embedding). */
export const featureCost = (uid: string, feature: string, since: number) =>
  (init().prepare("SELECT COALESCE(SUM(cost), 0) AS c FROM usage_events WHERE user_id = ? AND feature = ? AND at >= ?").get(uid, feature, since) as { c: number }).c;

// ---------------------------------------------------------------- hạn mức gọi API của nhà cung cấp (từ header)
export type RateInfo = { provider: string; limit: number; remaining: number; resetAt: number; at: number };
const g = globalThis as { __synchroRate?: Map<string, RateInfo> };
const rates = (g.__synchroRate ??= new Map());
// "6m0s", "1.5s", "120ms" (OpenAI) hoặc thời điểm RFC 3339 (Anthropic) → mốc thời gian.
function resetTime(v: string | null, now: number) {
  if (!v) return now + 60_000;
  const t = Date.parse(v);
  if (!isNaN(t) && /\d{4}-\d\d-\d\d/.test(v)) return t;
  let ms = 0;
  for (const [, n, u] of v.matchAll(/([\d.]+)(ms|h|m|s)/g)) ms += Number(n) * (u === "ms" ? 1 : u === "s" ? 1000 : u === "m" ? 60_000 : 3_600_000);
  return now + (ms || 60_000);
}
export function recordRate(provider: string, h: Headers) {
  const now = Date.now();
  const pick = (...k: string[]) => k.map((x) => h.get(x)).find((x) => x !== null) ?? null;
  const limit = Number(pick("anthropic-ratelimit-tokens-limit", "anthropic-ratelimit-input-tokens-limit", "x-ratelimit-limit-tokens"));
  const remaining = Number(pick("anthropic-ratelimit-tokens-remaining", "anthropic-ratelimit-input-tokens-remaining", "x-ratelimit-remaining-tokens"));
  if (!limit || !isFinite(limit) || !isFinite(remaining)) return;
  rates.set(provider, { provider, limit, remaining, resetAt: resetTime(pick("anthropic-ratelimit-tokens-reset", "anthropic-ratelimit-input-tokens-reset", "x-ratelimit-reset-tokens"), now), at: now });
}
// Gọi sau mỗi phản hồi thành công của nhà cung cấp.
export function noteResponse(provider: string, model: string, body: { usage?: unknown } | null, headers: Headers) {
  try { recordRate(provider, headers); recordUsage(`${provider}/${model}`, body?.usage); } catch (e) { console.error("[usage]", e); }
}

// ---------------------------------------------------------------- số dư API đã nạp (quản trị viên nhập)
// Hãng không có API báo số dư cho khóa, nên quản trị viên nhập số tiền đã nạp; Synchro trừ dần theo chi phí thật
// của mọi lượt gọi tới hãng đó (của mọi tài khoản) kể từ lúc nhập, để vòng tròn mức dùng báo khi sắp hết hoặc đã hết.
export type Credit = { provider: string; amount: number; since: number; spent: number; remaining: number; pct: number };
type CreditRow = { amount: number; since: number };
const creditRows = (): Record<string, CreditRow> => { try { const v = JSON.parse(getSetting("api_credit", "{}")); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const cents = (v: number) => Math.round(v * 10000) / 10000;
export function creditOf(provider: string): Credit | null {
  const r = creditRows()[provider];
  if (!r) return null;
  const spent = (init().prepare("SELECT COALESCE(SUM(cost), 0) AS c FROM usage_events WHERE model LIKE ? AND at >= ?").get(`${provider}/%`, r.since) as { c: number }).c;
  return { provider, amount: r.amount, since: r.since, spent: cents(spent), remaining: cents(Math.max(0, r.amount - spent)), pct: r.amount > 0 ? Math.min(100, (spent / r.amount) * 100) : 100 };
}
export const credits = () => Object.keys(creditRows()).map(creditOf).filter((c): c is Credit => !!c);
/** amount: đặt lại số dư (null = bỏ theo dõi); add: nạp thêm vào số dư còn lại. */
export function setCredit(provider: string, o: { amount?: number | null; add?: number }) {
  if (!/^[a-z0-9-]{1,40}$/.test(provider)) throw new Error("Nhà cung cấp không hợp lệ.");
  const all = creditRows();
  if (o.amount === null) delete all[provider];
  else {
    const v = typeof o.amount === "number" ? o.amount : (creditOf(provider)?.remaining ?? 0) + (o.add ?? 0);
    if (!isFinite(v) || v < 0 || v > 1e7) throw new Error("Số tiền không hợp lệ.");
    all[provider] = { amount: Math.round(v * 100) / 100, since: Date.now() };
  }
  setSetting("api_credit", JSON.stringify(all));
  return creditOf(provider);
}

// ---------------------------------------------------------------- trạng thái để hiện vòng tròn và để chặn khi hết hạn mức
export type Limit = { key: "session" | "weekly"; used: number; limit: number | null; pct: number; resetAt: number | null; active: boolean };
export type UsageState = { limits: Limit[]; rate: (RateInfo & { pct: number }) | null; admin: boolean; plan: string; credit: Credit | null };

function limitsFor(u: UserRow, cfg: UsageConfig, ov: Override) {
  const exempt = isAdmin(u) && !cfg.admins;
  const pick = (k: "session" | "weekly") => (k in ov ? ov[k] ?? null : exempt ? null : cfg[k]);
  return { session: pick("session"), weekly: pick("weekly") };
}
const sumSince = (uid: string, since: number) => (init().prepare("SELECT COALESCE(SUM(cost), 0) AS c FROM usage_events WHERE user_id = ? AND at >= ?").get(uid, since) as { c: number }).c;

export function usageState(u: UserRow, provider?: string): UsageState {
  const now = Date.now();
  const cfg = getConfig();
  const w = windows(u.id, now);
  const lim = limitsFor(u, cfg, w.override);
  const sUsed = w.sessionStart ? sumSince(u.id, w.sessionStart) : 0;
  const wUsed = w.weekStart !== null ? sumSince(u.id, w.weekStart) : 0;
  const mk = (key: Limit["key"], used: number, limit: number | null, resetAt: number | null, active: boolean): Limit =>
    ({ key, used: Math.round(used * 10000) / 10000, limit, pct: limit ? Math.min(100, (used / limit) * 100) : 0, resetAt, active });
  const r = provider ? rates.get(provider) : undefined;
  const rate = r && now - r.at < 10 * 60_000 && r.resetAt > now ? { ...r, pct: Math.min(100, Math.max(0, (1 - r.remaining / r.limit) * 100)) } : null;
  return {
    limits: [mk("session", sUsed, lim.session, w.sessionStart ? w.sessionStart + SESSION_MS : null, !!w.sessionStart), mk("weekly", wUsed, lim.weekly, w.weekStart !== null ? w.weekStart + WEEK_MS : null, w.weekStart !== null)],
    rate, admin: isAdmin(u), plan: "API", credit: provider ? creditOf(provider) : null,
  };
}

// Thông báo khi đã dùng hết hạn mức, hoặc null nếu còn dùng được.
const until = (t: number) => {
  const m = Math.max(1, Math.ceil((t - Date.now()) / 60_000));
  return m < 60 ? `${m} phút` : m < 1440 ? `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ""}` : `${Math.round(m / 1440)} ngày`;
};
export function overLimit(u: UserRow): string | null {
  for (const l of usageState(u).limits) {
    if (l.limit !== null && l.used >= l.limit && l.resetAt) return l.key === "session" ? `Bạn đã dùng hết giới hạn của phiên này. Phiên mới bắt đầu sau ${until(l.resetAt)}.` : `Bạn đã dùng hết giới hạn hằng tuần. Giới hạn được đặt lại sau ${until(l.resetAt)}.`;
  }
  return null;
}

// ---------------------------------------------------------------- dành cho quản trị viên
export function setOverride(uid: string, ov: Override | null) {
  const clean: Override = {};
  if (ov) for (const k of ["session", "weekly"] as const) if (k in ov) clean[k] = ov[k] === null ? null : num(ov[k]) ?? undefined;
  init().prepare("INSERT INTO usage_users (user_id, override) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET override = excluded.override")
    .run(uid, ov ? JSON.stringify(Object.fromEntries(Object.entries(clean).filter(([, v]) => v !== undefined))) : null);
}
export function adminUsage(users: UserRow[]) {
  const cfg = getConfig();
  const now = Date.now();
  return users.map((u) => {
    const w = windows(u.id, now);
    const st = usageState(u);
    const tot = init().prepare("SELECT COALESCE(SUM(cost),0) AS c, COALESCE(SUM(input+cache_read+cache_write),0) AS i, COALESCE(SUM(output),0) AS o FROM usage_events WHERE user_id = ? AND at >= ?").get(u.id, now - 30 * 86_400_000) as { c: number; i: number; o: number };
    return { id: u.id, email: u.email, name: u.name, admin: adminRole(u), override: w.override, limits: st.limits, month: { cost: tot.c, input: tot.i, output: tot.o }, effective: limitsFor(u, cfg, w.override) };
  });
}
export function removeUserUsage(uid: string) {
  const d = init();
  d.prepare("DELETE FROM usage_events WHERE user_id = ?").run(uid);
  d.prepare("DELETE FROM usage_users WHERE user_id = ?").run(uid);
}
// Bảng giá đang áp dụng cho các model đang bật.
export const priceTable = (models: string[]) => { const cfg = getConfig(); return models.map((m) => ({ model: m, ...priceOf(m, cfg) })); };

// Chi tiết 30 ngày cho trang Cài đặt → Usage: theo model, theo tính năng, theo ngày (múi giờ của người xem do client gửi).
export function usageDetails(uid: string, tzOffsetMin = 0) {
  const d = init();
  const since = Date.now() - 30 * 86_400_000;
  const byModel = d.prepare(`SELECT model, COUNT(*) AS calls, SUM(input) AS input, SUM(output) AS output, SUM(cache_read) AS cacheRead, SUM(cache_write) AS cacheWrite, SUM(cost) AS cost
    FROM usage_events WHERE user_id = ? AND at >= ? GROUP BY model ORDER BY cost DESC`).all(uid, since) as { model: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }[];
  const byFeature = d.prepare("SELECT feature, COUNT(*) AS calls, SUM(cost) AS cost FROM usage_events WHERE user_id = ? AND at >= ? GROUP BY feature ORDER BY cost DESC").all(uid, since) as { feature: string; calls: number; cost: number }[];
  const off = Math.max(-840, Math.min(840, Math.round(tzOffsetMin))) * 60_000;
  const rows = d.prepare("SELECT at, model, feature, cost, input + cache_read + cache_write AS i, output AS o FROM usage_events WHERE user_id = ? AND at >= ?").all(uid, since) as { at: number; model: string; feature: string; cost: number; i: number; o: number }[];
  const day = (t: number) => Math.floor((t - off) / 86_400_000);
  const today = day(Date.now());
  // calls: lượt gọi model theo hãng (không tính lời gọi nội bộ như đặt tên đoạn chat, rút bộ nhớ, thử khóa).
  const days = Array.from({ length: 30 }, (_, k) => ({ day: (today - 29 + k) * 86_400_000 + off, cost: 0, input: 0, output: 0, calls: {} as Record<string, number> }));
  for (const r of rows) {
    const k = day(r.at) - (today - 29);
    if (k < 0 || k >= 30) continue;
    days[k].cost += r.cost; days[k].input += r.i; days[k].output += r.o;
    if (r.feature !== "internal" && r.feature !== "test") { const v = vendorOf(r.model); days[k].calls[v] = (days[k].calls[v] ?? 0) + 1; }
  }
  const cfg = getConfig();
  return { byModel: byModel.map((m) => ({ ...m, price: priceOf(m.model, cfg) })), byFeature, days, dayOf: (t: number) => day(t) - (today - 29) };
}
