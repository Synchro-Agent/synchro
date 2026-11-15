// Đo độ trễ từng chặng của mỗi lượt chat (chỉ chạy ở máy chủ, không dùng dịch vụ ngoài):
// auth (kiểm tra phiên), queue (chờ chỗ chạy), history (lịch sử, tệp các lượt trước), retrieval (skill, bộ não), routing (Tự động chọn model),
// prompt (dựng lời nhắc tới lúc gọi hãng), provider_ttfb (từ lúc gọi hãng tới byte đầu tiên), first_token (từ đầu lượt tới chữ đầu tiên tới
// trình duyệt), tool (mỗi lần chạy công cụ), total.
// Giữ 500 lượt gần nhất trong bộ nhớ, cộng dồn theo ngày vào SQLite (p50 / p95 theo chặng và hãng, giữ 30 ngày), in mỗi lượt một dòng
// "[otel]" dạng OTLP/JSON (resourceSpans) để sau này đưa vào hệ thống OpenTelemetry bất kỳ mà không đổi gì. Không có nội dung chat trong span.
// SYNCHRO_OTEL_LOG=0 tắt dòng log; dòng "[timing]" ngắn vẫn giữ để đọc nhanh bằng mắt.
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { db } from "./authstore";

export const STAGES = ["auth", "queue", "history", "retrieval", "routing", "prompt", "provider_ttfb", "first_token", "tool", "total"] as const;
export type Stage = (typeof STAGES)[number];
type Attr = string | number | boolean;
export type Span = { name: string; stage?: Stage; start: number; end: number; attrs?: Record<string, Attr> };
export type Trace = {
  traceId: string; rootId: string; kind: string; start: number; end?: number; spans: Span[]; attrs: Record<string, Attr>;
  provider?: string; model?: string; status?: number; promptFrom?: number; providerFrom?: number; ttfbDone?: boolean; firstTokenDone?: boolean;
};
const g = globalThis as unknown as { __synchroTraceAls?: AsyncLocalStorage<Trace>; __synchroTraceRing?: Trace[] };
const als = (g.__synchroTraceAls ??= new AsyncLocalStorage<Trace>());
const RING = 500;
const ring = (g.__synchroTraceRing ??= []);
const hex = (n: number) => crypto.randomBytes(n).toString("hex");

/** Bắt đầu đo một lượt. seed: thời điểm yêu cầu tới và thời gian kiểm tra phiên (đo ở route trước khi lượt chạy nền bắt đầu). */
export function beginTrace(kind: string, seed?: { at: number; authMs: number }): Trace {
  const start = seed?.at ?? Date.now();
  const t: Trace = { traceId: hex(16), rootId: hex(8), kind, start, spans: [], attrs: {} };
  if (seed) t.spans.push({ name: "auth", stage: "auth", start, end: start + seed.authMs });
  return t;
}
export const withTrace = <T>(t: Trace, fn: () => T): T => als.run(t, fn);
export const currentTrace = () => als.getStore();
const add = (t: Trace | undefined, s: Span) => { if (t && !t.end && t.spans.length < 400) t.spans.push(s); };

/** Ghi một chặng đã đo xong (start, end theo Date.now()). */
export function addSpan(name: string, stage: Stage | undefined, start: number, end = Date.now(), attrs?: Record<string, Attr>) { add(als.getStore(), { name, stage, start, end, attrs }); }
/** Đo một việc bất đồng bộ như một chặng. Không có lượt đang đo thì chạy bình thường. */
export async function span<T>(name: string, stage: Stage | undefined, fn: () => Promise<T> | T, attrs?: Record<string, Attr>): Promise<T> {
  const t = als.getStore();
  if (!t) return fn();
  const s = Date.now();
  try { return await fn(); } finally { add(t, { name, stage, start: s, end: Date.now(), attrs }); }
}
/** Như span nhưng ghi vào một lượt đã biết: lời gọi công cụ qua cầu nối MCP tới từ yêu cầu HTTP khác, không mang ngữ cảnh của lượt. */
export async function spanOn<T>(t: Trace | undefined, name: string, stage: Stage | undefined, fn: () => Promise<T> | T, attrs?: Record<string, Attr>): Promise<T> {
  if (!t) return fn();
  const s = Date.now();
  try { return await fn(); } finally { add(t, { name, stage, start: s, end: Date.now(), attrs }); }
}
/** Như span nhưng cho việc chạy đồng bộ. */
export function spanSync<T>(name: string, stage: Stage | undefined, fn: () => T, attrs?: Record<string, Attr>): T {
  const t = als.getStore();
  if (!t) return fn();
  const s = Date.now();
  try { return fn(); } finally { add(t, { name, stage, start: s, end: Date.now(), attrs }); }
}
/** Model và hãng của lượt (lần gọi cuối cùng thắng: Tự động chuyển model thì ghi model trả lời thật). */
export function noteModel(model: string) {
  const t = als.getStore();
  if (!t || !model) return;
  t.model = model;
  t.provider = model.startsWith("sub-") ? model.split("/")[0] : model.split("/")[0] || "unknown";
}
/** Lời nhắc bắt đầu dựng (sau phần tra cứu): chặng "prompt" kéo dài tới lần gọi hãng đầu tiên. */
export function markPrompt() { const t = als.getStore(); if (t && t.promptFrom === undefined) t.promptFrom = Date.now(); }
/** Sắp gọi hãng (HTTP của khóa API, hoặc CLI của gói). Lần đầu tiên khép chặng "prompt". */
export function markProviderCall(at = Date.now()) {
  const t = als.getStore();
  if (!t) return;
  if (t.providerFrom === undefined) {
    t.providerFrom = at;
    if (t.promptFrom !== undefined) add(t, { name: "prompt", stage: "prompt", start: t.promptFrom, end: at });
  }
}
/** Một lần gọi HTTP tới hãng đã có phản hồi (header): lần đầu là "provider_ttfb" của lượt; lần nào cũng ghi một span con. */
export function noteProviderResponse(kind: string, start: number, status: number) {
  const t = als.getStore();
  if (!t) return;
  markProviderCall(start);
  const end = Date.now();
  add(t, { name: `provider.call ${kind}`, start, end, attrs: { "http.status_code": status, "gen_ai.system": kind } });
  if (!t.ttfbDone) { t.ttfbDone = true; add(t, { name: "provider_ttfb", stage: "provider_ttfb", start, end }); }
}
/** Chữ đầu tiên tới trình duyệt (runs.delta). Gói (CLI) không có header HTTP: byte đầu tiên của CLI cũng là TTFB của hãng. */
export function noteFirstToken() {
  const t = als.getStore();
  if (!t || t.firstTokenDone) return;
  t.firstTokenDone = true;
  const now = Date.now();
  add(t, { name: "first_token", stage: "first_token", start: t.start, end: now });
  if (!t.ttfbDone && t.providerFrom !== undefined) { t.ttfbDone = true; add(t, { name: "provider_ttfb", stage: "provider_ttfb", start: t.providerFrom, end: now }); }
}

// ---- kết thúc lượt: vòng nhớ, tổng hợp theo ngày, log OTel ----
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
let ready = false;
function tbl() {
  const d = db();
  if (!ready) {
    d.exec("CREATE TABLE IF NOT EXISTS trace_daily (day TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT NOT NULL, n INTEGER NOT NULL, samples TEXT NOT NULL, PRIMARY KEY (day, stage, provider))");
    ready = true;
  }
  return d;
}
const MAX_SAMPLES = 1000;
/** Thời lượng (ms) của từng chặng trong một lượt: chặng lặp lại (tool) cộng dồn mỗi lần là một mẫu riêng. */
export function stageDurations(t: Trace): [Stage, number][] {
  const out: [Stage, number][] = [];
  for (const s of t.spans) if (s.stage) out.push([s.stage, Math.max(0, s.end - s.start)]);
  return out;
}
let lastPrune = 0;
function aggregate(t: Trace) {
  const d = tbl(), dd = day(t.start), prov = t.provider ?? "none";
  const get = d.prepare("SELECT n, samples FROM trace_daily WHERE day = ? AND stage = ? AND provider = ?");
  const put = d.prepare("INSERT INTO trace_daily (day, stage, provider, n, samples) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, stage, provider) DO UPDATE SET n = excluded.n, samples = excluded.samples");
  d.transaction(() => {
    for (const [stage, ms] of stageDurations(t)) {
      const r = get.get(dd, stage, prov) as { n: number; samples: string } | undefined;
      const n = (r?.n ?? 0) + 1, smp = r ? (JSON.parse(r.samples) as number[]) : [];
      // Lấy mẫu kiểu reservoir: tối đa 1000 mẫu mỗi ngày / chặng / hãng mà vẫn đại diện cho cả ngày.
      if (smp.length < MAX_SAMPLES) smp.push(ms); else { const k = Math.floor(Math.random() * n); if (k < MAX_SAMPLES) smp[k] = ms; }
      put.run(dd, stage, prov, n, JSON.stringify(smp));
    }
  })();
  if (Date.now() - lastPrune > 3_600_000) { lastPrune = Date.now(); d.prepare("DELETE FROM trace_daily WHERE day < ?").run(day(Date.now() - 30 * 86_400_000)); }
}
const attrList = (o: Record<string, Attr>) => Object.entries(o).map(([key, v]) => ({ key, value: typeof v === "number" ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : typeof v === "boolean" ? { boolValue: v } : { stringValue: String(v) } }));
const ns = (ms: number) => `${BigInt(Math.round(ms)) * BigInt(1_000_000)}`;
/** Một lượt dưới dạng OTLP/JSON (ExportTraceServiceRequest): một span gốc "chat.turn" và các span con theo chặng. */
export function toOtlp(t: Trace) {
  const root = { traceId: t.traceId, spanId: t.rootId, name: `${t.kind}.turn`, kind: 2, startTimeUnixNano: ns(t.start), endTimeUnixNano: ns(t.end ?? Date.now()),
    attributes: attrList({ "synchro.kind": t.kind, ...(t.provider ? { "gen_ai.system": t.provider } : {}), ...(t.model ? { "gen_ai.request.model": t.model } : {}), ...(t.status ? { "http.status_code": t.status } : {}), ...t.attrs }),
    status: { code: t.status && t.status >= 400 ? 2 : 1 } };
  const kids = t.spans.filter((s) => s.stage !== "total").map((s) => ({ traceId: t.traceId, spanId: hex(8), parentSpanId: t.rootId, name: s.name, kind: 1, startTimeUnixNano: ns(s.start), endTimeUnixNano: ns(s.end), attributes: attrList({ ...(s.stage ? { "synchro.stage": s.stage } : {}), ...s.attrs }) }));
  return { resourceSpans: [{ resource: { attributes: attrList({ "service.name": "synchro" }) }, scopeSpans: [{ scope: { name: "synchro.chat", version: "1" }, spans: [root, ...kids] }] }] };
}
export function endTrace(t: Trace, status: number) {
  if (t.end) return;
  t.end = Date.now(); t.status = status;
  t.spans.push({ name: "total", stage: "total", start: t.start, end: t.end });
  ring.push(t); if (ring.length > RING) ring.splice(0, ring.length - RING);
  try { aggregate(t); } catch (e) { console.error("[timing] không ghi được tổng hợp:", (e as Error).message); }
  const parts = new Map<string, number>();
  for (const [s, ms] of stageDurations(t)) parts.set(s, (parts.get(s) ?? 0) + ms);
  console.log(`[timing] ${t.kind} ${t.provider ?? "-"} ${status} ${[...parts].map(([k, v]) => `${k}=${v}ms`).join(" ")}`);
  if (process.env.SYNCHRO_OTEL_LOG !== "0") console.log(`[otel] ${JSON.stringify(toOtlp(t))}`);
}

// ---- đọc cho Sức khỏe hệ thống ----
const pct = (arr: number[], p: number) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))]; };
type Row = { stage: Stage; provider: string; n: number; p50: number | null; p95: number | null };
const summarize = (m: Map<string, { n: number; v: number[] }>): Row[] => [...m].map(([k, x]) => { const [stage, provider] = k.split("|") as [Stage, string]; return { stage, provider, n: x.n, p50: pct(x.v, 50), p95: pct(x.v, 95) }; })
  .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || a.provider.localeCompare(b.provider));
/** recent: 500 lượt gần nhất (bộ nhớ). days: tổng hợp N ngày gần nhất trong SQLite. Cả hai theo chặng × hãng, kèm "all" cho mọi hãng. */
export function latencySummary(days = 1) {
  const rec = new Map<string, { n: number; v: number[] }>();
  const put = (m: Map<string, { n: number; v: number[] }>, stage: string, prov: string, v: number[], n = v.length) => { for (const p of [prov, "all"]) { const k = `${stage}|${p}`, x = m.get(k) ?? { n: 0, v: [] }; x.n += n; x.v.push(...v); m.set(k, x); } };
  for (const t of ring) for (const [s, ms] of stageDurations(t)) put(rec, s, t.provider ?? "none", [ms]);
  const daily = new Map<string, { n: number; v: number[] }>();
  try {
    const rows = tbl().prepare("SELECT stage, provider, n, samples FROM trace_daily WHERE day >= ?").all(day(Date.now() - (days - 1) * 86_400_000)) as { stage: string; provider: string; n: number; samples: string }[];
    for (const r of rows) put(daily, r.stage, r.provider, JSON.parse(r.samples) as number[], r.n);
  } catch { /* chưa có bảng */ }
  // stages: tổng thời gian từng chặng của chính lượt đó (công cụ, tra cứu lặp lại thì cộng dồn).
  const last = [...ring].slice(-8).reverse().map((t) => { const d = stageDurations(t), stages: Partial<Record<Stage, number>> = {}; for (const [s, ms] of d) stages[s] = (stages[s] ?? 0) + ms;
    return { at: t.start, provider: t.provider ?? null, model: t.model ?? null, status: t.status ?? null, totalMs: (t.end ?? t.start) - t.start, slowest: d.filter(([s]) => s !== "total" && s !== "first_token").sort((a, b) => b[1] - a[1])[0] ?? null, stages }; });
  return { stages: STAGES, turns: ring.length, recent: summarize(rec), daily: summarize(daily), days, last };
}
/** Cho kiểm thử: xóa vòng nhớ. */
export const _resetRing = () => { ring.splice(0); };
