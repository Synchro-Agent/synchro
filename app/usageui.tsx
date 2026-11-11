"use client";
// Mức dùng (giống "Plan usage limits" của Claude, nhưng tính theo chi phí API thật):
// - UsageRing: vòng tròn cạnh bộ chọn model, bấm vào hiện giới hạn phiên 5 giờ, giới hạn tuần và hạn mức API của nhà cung cấp.
// - UsageSettings: trang Cài đặt → Usage (chi tiết 30 ngày theo model, tính năng, ngày).
// - UsageAdmin: quản trị viên đặt hạn mức (USD), hạn mức riêng từng người và bảng giá model.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./apierr";
import { rowKeys } from "./a11y";
import { Menu } from "./ui";
import { useApp } from "./store";
import { getLang, tr } from "./i18n";
import * as I from "./icons";
import { PageBar, usePage } from "./pager";
import { BrandLogo } from "./brands";
import { vendorOf } from "./router";

export type Limit = { key: "session" | "weekly"; used: number; limit: number | null; pct: number; resetAt: number | null; active: boolean };
export type Rate = { provider: string; limit: number; remaining: number; resetAt: number; pct: number };
export type Credit = { provider: string; amount: number; since: number; spent: number; remaining: number; pct: number };
// Hạn mức của gói subscription (model "sub-…"): cửa sổ phiên 5 giờ / tuần do CLI của hãng báo về (xem app/ai/subs.ts).
export type PlanWindow = { window: string; usedPct?: number; resetsAt?: number; status?: string; label: string; kind: "session" | "weekly" | "other"; group?: string; idle?: boolean };
export type SubUsage = { cli: "claude" | "codex" | "agy" | "grok"; name: string; plan: string | null; windows: PlanWindow[]; turnsToday: number; note: string | null; credits: string | null; at: number | null; setup?: boolean };
/** Một hãng trong chế độ Tự động / Cài đặt → Usage: Synchro tự nhận đang chạy bằng gói đã đăng nhập (plan) hay khóa API. */
/** cli: null khi hãng không có gói đăng nhập (DeepSeek chỉ có khóa API). */
export type VendorUsage = { vendor: "anthropic" | "openai" | "google" | "xai" | "deepseek"; cli: SubUsage["cli"] | null; name: string; models: number; mode: "plan" | "api" | "none"; provider: string | null;
  sub?: SubUsage; rate?: Rate | null; credit?: Credit | null; usingApiUntil?: number | null };
export type UsageState = { limits: Limit[]; rate: Rate | null; admin: boolean; plan: string; credit?: Credit | null; sub?: SubUsage; vendors?: VendorUsage[] };
const PROVIDER: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", xai: "xAI", deepseek: "DeepSeek" };

// ---------------------------------------------------------------- dữ liệu dùng chung
let cache: { key: string; v: UsageState } | null = null;
const listeners = new Set<() => void>();
// Gọi sau mỗi lượt chat / Synchro Code để vòng tròn cập nhật ngay; fresh: đọc lại hạn mức của gói từ hãng ngay (nút Làm mới).
export const refreshUsage = (fresh = false) => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("synchro:usage", { detail: { fresh } })); };

/** provider: hãng / gói của model đang chọn; "*" = mọi hãng (chế độ Tự động, Cài đặt → Usage). */
export function useUsage(provider?: string) {
  const key = provider ?? "";
  const [st, setSt] = useState<UsageState | null>(cache?.key === key ? cache.v : null);
  const [, tick] = useState(0);
  // idle: lượt hỏi định kỳ, không ai vừa yêu cầu số mới: máy chủ trả số đã có, không mở CLI (codex, agy) chỉ để đọc hạn mức.
  const load = useCallback((fresh = false, idle = false) => {
    const q = provider === "*" ? "?all=1" : provider ? `?provider=${encodeURIComponent(provider)}` : "";
    fetch(`/api/usage${q}${fresh ? `${q ? "&" : "?"}fresh=1` : idle ? `${q ? "&" : "?"}idle=1` : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j?.limits) { cache = { key, v: j }; setSt(j); listeners.forEach((f) => f()); }
    }).catch(() => {});
  }, [provider, key]);
  useEffect(() => {
    load();
    const on = (e: Event) => load(!!(e as CustomEvent).detail?.fresh);
    const vis = () => { if (!document.hidden) load(); };
    window.addEventListener("synchro:usage", on);
    document.addEventListener("visibilitychange", vis);
    // Tab đang ẩn thì không hỏi; quay lại tab thì vis() đọc lại ngay.
    const t = setInterval(() => { if (!document.hidden) load(false, true); }, 60_000);
    // Đồng hồ đếm ngược "Đặt lại sau…" tự cập nhật mỗi 30 giây.
    const c = setInterval(() => tick((x) => x + 1), 30_000);
    return () => { window.removeEventListener("synchro:usage", on); document.removeEventListener("visibilitychange", vis); clearInterval(t); clearInterval(c); };
  }, [load]);
  return st;
}

// ---------------------------------------------------------------- định dạng
const en = () => getLang() === "en";
export const money = (v: number) => (v > 0 && v < 0.01 ? "<$0.01" : `$${v.toFixed(v >= 100 ? 0 : 2)}`);
export const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n));
export function resetText(t: number | null, active = true) {
  if (!t || !active) return en() ? "Starts with your next message" : "Bắt đầu khi bạn gửi tin nhắn";
  const ms = t - Date.now();
  if (ms < 24 * 3600_000) {
    const m = Math.max(1, Math.ceil(ms / 60_000)), h = Math.floor(m / 60), mm = m % 60;
    return en() ? `Resets in ${h ? `${h} hr ` : ""}${h && !mm ? "" : `${mm} min`}`.trim() : `Đặt lại sau ${h ? `${h} giờ ` : ""}${h && !mm ? "" : `${mm} phút`}`.trim();
  }
  const d = new Date(t);
  return en() ? `Resets ${d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}`
    : `Đặt lại ${["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d.getDay()]} ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}
const level = (p: number) => (p >= 90 ? "hot" : p >= 70 ? "warn" : "");
const LABEL = { session: ["Giới hạn phiên", "Session limit"], weekly: ["Hằng tuần · mọi model", "Weekly · all models"] } as const;

// Biểu tượng mức dùng: giọt nước trong vòng tròn (giống Claude).
export function UsageIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 5.6c1.9 2.3 2.9 4 2.9 5.3a2.9 2.9 0 01-5.8 0c0-1.3 1-3 2.9-5.3z" fill="currentColor" />
    </svg>
  );
}

function Bar({ pct, unlimited }: { pct: number; unlimited?: boolean }) {
  return <div className={`us-bar ${level(pct)} ${unlimited ? "free" : ""}`}><i style={{ width: `${unlimited ? 0 : Math.max(pct, pct > 0 ? 1.5 : 0)}%` }} /></div>;
}

function LimitRow({ l }: { l: Limit }) {
  const unlimited = l.limit === null;
  return (
    <div className="us-row" title={`${money(l.used)}${unlimited ? "" : ` / ${money(l.limit!)}`}`}>
      <div className="us-row-t">
        <b>{en() ? LABEL[l.key][1] : LABEL[l.key][0]}</b>
        <span>{unlimited ? <>{en() ? "No limit" : "Không giới hạn"} · {money(l.used)}</> : <>{resetText(l.resetAt, l.active)}<em>{Math.round(l.pct)}%</em></>}</span>
      </div>
      <Bar pct={l.pct} unlimited={unlimited} />
    </div>
  );
}

function RateRow({ r }: { r: Rate }) {
  const secs = Math.max(1, Math.round((r.resetAt - Date.now()) / 1000));
  return (
    <div className="us-row" title={`${kTok(r.remaining)} / ${kTok(r.limit)} token`}>
      <div className="us-row-t">
        <b>{en() ? `${PROVIDER[r.provider] ?? r.provider} API · tokens per minute` : `API ${PROVIDER[r.provider] ?? r.provider} · token mỗi phút`}</b>
        <span>{en() ? `Resets in ${secs}s` : `Đặt lại sau ${secs}s`}<em>{Math.round(r.pct)}%</em></span>
      </div>
      <Bar pct={r.pct} />
    </div>
  );
}

// Tên cửa sổ hạn mức của gói theo ngôn ngữ giao diện.
const WIN: Record<string, [string, string]> = {
  five_hour: ["Phiên hiện tại", "Current session"], seven_day: ["Hằng tuần · mọi model", "Weekly · all models"], seven_day_opus: ["Hằng tuần · Opus", "Weekly · Opus"],
  seven_day_sonnet: ["Hằng tuần · Sonnet", "Weekly · Sonnet"], seven_day_overage_included: ["Hằng tuần · giới hạn theo model", "Weekly · model limit"], overage: ["Tín dụng sử dụng", "Usage credits"],
};
const GROUP: Record<string, [string, string]> = { "Gemini models": ["model Gemini", "Gemini models"], "Claude and GPT models": ["model Claude và GPT", "Claude and GPT models"] };
function winLabel(w: PlanWindow) {
  const i = en() ? 1 : 0;
  if (w.group) return `${w.kind === "weekly" ? (en() ? "Weekly" : "Hằng tuần") : en() ? "Current session" : "Phiên hiện tại"} · ${GROUP[w.group]?.[i] ?? w.group}`;
  return WIN[w.window]?.[i] ?? w.label;
}
// Cách hãng đặt lại hạn mức (ghi chú dưới các thanh).
const PLAN_NOTE: Record<SubUsage["cli"], [string, string]> = {
  claude: ["Phiên 5 giờ bắt đầu từ tin nhắn đầu tiên. Hạn mức tuần đặt lại vào một giờ cố định mỗi tuần.", "The 5-hour session starts with your first message. Weekly limits reset at a fixed time each week."],
  codex: ["Hạn mức tùy gói của tài khoản ChatGPT: gói Plus có phiên 5 giờ cuốn chiếu và hạn mức tuần, gói Pro chỉ có hạn mức tuần.", "Limits depend on your ChatGPT plan. Plus has a rolling 5-hour window and a weekly limit; Pro only has a weekly limit."],
  agy: ["Hạn mức tùy gói của tài khoản Google và hồi theo chu kỳ. Model Gemini và model Claude/GPT tính riêng.", "Limits depend on your Google account's plan and refresh over time. Gemini and Claude/GPT models are counted separately."],
  grok: ["Hạn mức tùy gói của tài khoản Grok và hồi dần theo thời gian; hết hạn mức thì Synchro hỏi bạn trước khi dùng khóa API.", "Limits depend on your Grok plan and refresh over time. When you hit one, Synchro asks before using an API key."],
};
/** Ghi chú khi gói chưa có thanh hạn mức nào: Antigravity chưa đọc được bảng hạn mức, Grok CLI không báo hạn mức, gói khác chờ lượt chat đầu. */
const noWindows = (cli: SubUsage["cli"] | null | undefined, tail: [string, string]) =>
  cli === "grok" ? L("Grok CLI không báo hạn mức còn lại của gói. Synchro đếm số tin nhắn và báo ngay khi Grok nói đã chạm giới hạn.", "The Grok CLI doesn't report how much of the plan is left. Synchro counts your messages and tells you as soon as Grok says the limit is reached.") : cli === "agy" ? L(...tail) : L("Gửi một tin nhắn bằng gói này để xem hạn mức.", "Send a message with this plan to see its limits.");
const winLevel = (w: PlanWindow) => (w.status === "rejected" ? "hot" : w.status === "allowed_warning" ? "warn" : level(w.usedPct ?? 0));

function PlanRow({ w }: { w: PlanWindow }) {
  const pct = w.usedPct ?? 0;
  return (
    <div className="us-row">
      <div className="us-row-t">
        <b>{winLabel(w)}</b>
        <span>{w.status === "rejected" && w.resetsAt ? <>{en() ? "Limit reached · " : "Đã chạm giới hạn · "}{resetText(w.resetsAt)}</> : resetText(w.idle ? null : w.resetsAt ?? null, !w.idle && !!w.resetsAt)}<em>{w.usedPct === undefined ? "–" : `${Math.round(pct)}%`}</em></span>
      </div>
      <div className={`us-bar ${winLevel(w)}`}><i style={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%` }} /></div>
    </div>
  );
}

function CreditBar({ c }: { c: Credit }) {
  const left = 100 - c.pct;
  return (
    <div className="us-row" title={`${money(c.spent)} / ${money(c.amount)}`}>
      <div className="us-row-t">
        <b>{en() ? `${PROVIDER[c.provider] ?? c.provider} API balance` : `Số dư API ${PROVIDER[c.provider] ?? c.provider}`}</b>
        <span>{en() ? `${money(c.remaining)} left of ${money(c.amount)}` : `Còn ${money(c.remaining)} / ${money(c.amount)}`}<em>{Math.round(c.pct)}%</em></span>
      </div>
      <div className={`us-bar ${left <= 5 ? "hot" : left <= 20 ? "warn" : ""}`}><i style={{ width: `${Math.max(c.pct, c.pct > 0 ? 1.5 : 0)}%` }} /></div>
    </div>
  );
}

// Báo một lần cho mỗi ngưỡng: số dư API còn 20%, 5%, hết; gói chạm giới hạn của một cửa sổ (theo từng mốc đặt lại).
function useLimitAlerts(st: UsageState | null) {
  const say = useApp().say;
  useEffect(() => {
    const on = (e: Event) => say(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("synchro:notice", on);
    return () => window.removeEventListener("synchro:notice", on);
  }, [say]);
  useEffect(() => {
    if (!st) return;
    const once = (k: string, msg: string) => {
      try { if (localStorage.getItem(k)) return; localStorage.setItem(k, "1"); } catch { /* bộ nhớ trình duyệt bị chặn: vẫn báo */ }
      say(msg);
    };
    const c = st.credit;
    if (c && c.amount > 0) {
      const left = 100 - c.pct, name = PROVIDER[c.provider] ?? c.provider;
      const lv = left <= 0.01 ? 0 : left <= 5 ? 5 : left <= 20 ? 20 : null;
      if (lv !== null) once(`credit:${c.provider}:${c.since}:${lv}`, lv === 0
        ? (en() ? `${name} API balance is used up. Top up the key, then update the balance in Settings → Providers.` : `Số dư API ${name} đã hết. Nạp thêm cho khóa rồi cập nhật số dư ở Cài đặt → Providers.`)
        : (en() ? `${name} API balance is running low: ${money(c.remaining)} left (${Math.round(left)}%).` : `Số dư API ${name} sắp hết: còn ${money(c.remaining)} (${Math.round(left)}%).`));
    }
    for (const w of st.sub?.windows ?? []) if (w.status === "rejected" && w.resetsAt)
      once(`plan:${st.sub!.cli}:${w.window}:${w.resetsAt}`, en() ? `Your ${st.sub!.name} plan hit its limit (${winLabel(w)}). ${resetText(w.resetsAt)}.` : `Gói ${st.sub!.name} đã chạm giới hạn (${winLabel(w)}). ${resetText(w.resetsAt)}.`);
  }, [st, say]);
}

// ---------------------------------------------------------------- vòng tròn cạnh bộ chọn model
const L = (vi: string, e: string) => (en() ? e : vi);
// Màu cố định theo hãng (bảng màu phân loại đã kiểm tra mù màu; màu đi theo hãng, không theo thứ hạng).
export const VENDOR_COLOR: Record<VendorUsage["vendor"] | "other", string> = { anthropic: "var(--vc-claude)", openai: "var(--vc-gpt)", google: "var(--vc-gemini)", xai: "var(--vc-grok)", deepseek: "var(--vc-deepseek)", other: "var(--vc-other)" };
const planName = (sub?: SubUsage) => (sub?.plan ? (en() ? `${sub.plan} plan` : `Gói ${sub.plan}`) : L("Gói subscription", "Subscription plan"));
// Mức đã dùng của một hãng (cửa sổ gần chạm nhất của gói; với khóa API: hạn mức gọi / số dư).
const vendorPct = (v: VendorUsage) => v.mode === "plan" ? Math.max(0, ...(v.sub?.windows ?? []).map((w) => (w.status === "rejected" ? 100 : w.usedPct ?? 0)))
  : v.mode === "api" ? Math.max(0, v.rate?.pct ?? 0, v.credit?.pct ?? 0) : 0;
const hasApi = (st: UsageState | null) => !!st?.vendors?.some((v) => v.mode === "api");

/** Huy hiệu cách hãng đang chạy: gói đã đăng nhập, khóa API, hoặc chưa kết nối. */
function ModeTag({ v }: { v: VendorUsage }) {
  if (v.mode === "plan") return <span className="us-tag plan">{planName(v.sub)}</span>;
  if (v.mode === "api") return <span className="us-tag api">{v.usingApiUntil ? L("Khóa API · gói tạm hết", "API key · plan paused") : L("Khóa API", "API key")}</span>;
  return <span className="us-tag none">{L("Chưa kết nối", "Not connected")}</span>;
}

/** Một hãng trong vòng tròn của chế độ Tự động: tên, cách đang chạy, các thanh hạn mức. */
function VendorBlock({ v }: { v: VendorUsage }) {
  const wins = v.sub?.windows ?? [];
  return (
    <div className="us-v">
      <div className="us-v-h"><i style={{ background: VENDOR_COLOR[v.vendor] }} /><b data-notr>{v.name}</b><ModeTag v={v} /></div>
      {v.mode === "plan" ? (wins.length ? wins.filter((w) => w.kind !== "other").map((w) => <PlanRow key={w.window} w={w} />)
        : <p className="us-note">{v.sub?.setup ? L("Antigravity đang chờ bạn hoàn tất bước làm quen lần đầu.", "Antigravity is waiting for its first-run setup.") : noWindows(v.cli, ["Synchro chưa đọc được hạn mức của gói này.", "Synchro could not read this plan's quota yet."])}</p>)
        : <>
          {v.rate && <RateRow r={v.rate} />}
          {v.credit && <CreditBar c={v.credit} />}
          {!v.rate && !v.credit && <p className="us-note">{L("Tính theo chi phí API thật, trong giới hạn chung bên dưới.", "Billed by real API cost, within the shared limits below.")}</p>}
        </>}
    </div>
  );
}

export function UsageRing({ model, extra, onDetails, up = true }: { model?: string; extra?: React.ReactNode; onDetails?: () => void; up?: boolean }) {
  // Chế độ Tự động (hoặc chưa chọn model): Synchro có thể chạy bằng bất kỳ hãng nào nên hiện mọi hãng đã kết nối.
  const auto = !model?.includes("/");
  const provider = auto ? "*" : model!.split("/")[0];
  const st = useUsage(provider);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.(".us-wrap")) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  useLimitAlerts(st);
  const sub = st?.sub;
  const limited = st?.limits.filter((l) => l.limit !== null) ?? [];
  const live = st?.vendors?.filter((v) => v.mode !== "none") ?? [];
  // Gói subscription: vòng tròn theo cửa sổ đang gần chạm nhất của gói. Khóa API: hạn mức chi phí của Synchro, hạn mức gọi và số dư đã nạp.
  // Tự động: hãng gần chạm giới hạn nhất (cùng hạn mức chi phí chung nếu có hãng chạy bằng khóa API).
  const pct = auto ? Math.max(0, ...live.map(vendorPct), ...(hasApi(st) ? limited.map((l) => l.pct) : []))
    : sub ? Math.max(0, ...sub.windows.map((w) => (w.status === "rejected" ? 100 : w.usedPct ?? 0)))
    : Math.max(0, ...limited.map((l) => l.pct), st?.rate?.pct ?? 0, st?.credit?.pct ?? 0);
  const r = 6.4, c = 2 * Math.PI * r;
  const label = st ? `${L("Mức dùng", "Usage")}: ${Math.round(pct)}%` : L("Mức dùng", "Usage");
  const head = auto ? L("Mức dùng · Tự động chọn hãng", "Usage · Auto picks the provider")
    : sub ? `${L("Giới hạn gói", "Plan limits")} · ${sub.name}${sub.plan ? ` ${sub.plan}` : ""}` : `${L("Giới hạn sử dụng", "Usage limits")} · ${L("Khóa API", "API key")}`;
  return (
    <div className="us-wrap">
      <button className={`us-ring ${level(pct)} ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label={label} data-tip={label} aria-expanded={open}>
        <svg width="18" height="18" viewBox="0 0 16 16"><circle cx="8" cy="8" r={r} fill="none" strokeWidth="1.8" className="bg" /><circle cx="8" cy="8" r={r} fill="none" strokeWidth="1.8" className="fg" strokeDasharray={`${(c * Math.max(pct, 0.01)) / 100} ${c}`} transform="rotate(-90 8 8)" strokeLinecap="round" /></svg>{st && <span className="us-ring-n">{Math.round(pct)}%</span>}
      </button>
      <Menu open={open} role="dialog" className={`us-pop ${up ? "up" : "down"}`}>
        <div className="menu-scroll gl-scroll">
        <div className="us-h"><span>{head}</span><UsageIcon size={15} /></div>
        {!st ? <div className="us-empty"><span className="art-spin sm" /></div> : auto ? (
          <>
            {live.map((v) => <VendorBlock key={v.vendor} v={v} />)}
            {hasApi(st) && limited.length > 0 && <div className="us-v"><div className="us-v-h"><b>{L("Giới hạn chung của khóa API", "Shared API key limits")}</b></div>{limited.map((l) => <LimitRow key={l.key} l={l} />)}</div>}
            {!live.length && <p className="us-note">{L("Chưa kết nối hãng AI nào. Đăng nhập gói hoặc thêm khóa API ở Cài đặt → Providers.", "No AI provider is connected yet. Sign in to a plan or add an API key in Settings → Providers.")}</p>}
          </>
        ) : sub ? (
          <>
            {sub.windows.map((w) => <PlanRow key={w.window} w={w} />)}
            {sub.setup && <p className="us-note">{L("Antigravity đang chờ bạn hoàn tất bước làm quen lần đầu (bảng màu, điều khoản, chia sẻ dữ liệu). Xem Cài đặt → Providers → Gemini.", "Antigravity is waiting for you to finish its first-run setup (color scheme, terms and data sharing). See Settings → Providers → Gemini.")}</p>}
            {!sub.windows.length && !sub.setup && <p className="us-note">{noWindows(sub.cli, ["Synchro chưa đọc được hạn mức của gói.", "Synchro could not read the plan's quota yet."])}{sub.turnsToday ? ` ${L(`Hôm nay: ${sub.turnsToday} tin nhắn.`, `${sub.turnsToday} messages today.`)}` : ""}</p>}
            {sub.credits && <p className="us-note" data-notr>{sub.credits}</p>}
            <p className="us-note">{PLAN_NOTE[sub.cli][en() ? 1 : 0]}</p>
          </>
        ) : (
          <>
            {st.limits.map((l) => <LimitRow key={l.key} l={l} />)}
            {st.rate && <RateRow r={st.rate} />}
            {st.credit && <CreditBar c={st.credit} />}
          </>
        )}
        {extra}
        {onDetails && <button className="us-more" onClick={() => { setOpen(false); onDetails(); }}>{L("Xem chi tiết mức dùng", "View usage details")}<I.ChevronR size={13} /></button>}
      </div>
      </Menu>
    </div>
  );
}

// ---------------------------------------------------------------- Cài đặt → Usage
type Details = {
  byModel: { model: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; price: { in: number; out: number; cache: number; src: string } }[];
  byPlan: { model: string; cli: SubUsage["cli"]; name: string; turns: number; last: number }[];
  byFeature: { feature: string; calls: number; cost: number }[];
  days: { day: number; cost: number; input: number; output: number; calls: Partial<Record<VendorUsage["vendor"] | "other", number>> }[];
};
const FEATURE: Record<string, [string, string]> = { chat: ["Chat", "Chat"], code: ["Synchro Code", "Synchro Code"], artifact: ["Artifact có AI", "AI-powered artifacts"], internal: ["Bộ nhớ và đặt tên đoạn chat", "Memory and chat titles"], test: ["Thử khóa API", "API key tests"], embed: ["Tìm kiếm theo nghĩa (bộ não, tài liệu)", "Semantic search (brain, documents)"], "brain-rerank": ["Xếp lại kết quả gọi lại", "Recall reranking"] };
// "anthropic/claude-sonnet-5-5" → "Claude Sonnet 5.5", "openai/gpt-6-astra" → "GPT-6 Astra", "google/gemini-3.8-flash" → "Gemini 3.8 Flash",
// "xai/grok-4.7" → "Grok 4.7", "deepseek/deepseek-v4-pro" → "DeepSeek V4 Pro".
const modelName = (k: string) => {
  const id = k.split("/").slice(1).join("/");
  if (id.startsWith("gpt-")) return "GPT-" + id.slice(4).split("-").map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  return id.replace(/-(\d+)-(\d+)$/, " $1.$2").split("-").map((w) => (w === "deepseek" ? "DeepSeek" : /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
};
const SUB_NAME: Record<SubUsage["cli"], string> = { claude: "Claude", codex: "ChatGPT", agy: "Gemini", grok: "Grok" };
const vendorKey = (model: string) => { const v = vendorOf(model); return v === "other" ? "other" : v; };
const SERIES: [VendorUsage["vendor"] | "other", string][] = [["anthropic", "Claude"], ["openai", "ChatGPT"], ["google", "Gemini"], ["xai", "Grok"], ["deepseek", "DeepSeek"], ["other", "Khác"]];
const CLI_VENDOR: Record<SubUsage["cli"], VendorUsage["vendor"]> = { claude: "anthropic", codex: "openai", agy: "google", grok: "xai" };
const num = (n: number) => n.toLocaleString(en() ? "en-US" : "vi-VN");

/** Thẻ của một hãng trong Cài đặt → Usage: cách đang chạy, hạn mức của gói hoặc của khóa API, số lượt 30 ngày. */
function VendorCard({ v, turns, cost, go }: { v: VendorUsage; turns: number; cost: number; go?: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const wins = v.sub?.windows ?? [];
  return (
    <div className={`us-card us-vc ${v.mode}`}>
      <div className="us-vc-h">
        <span className="us-vc-logo" data-notr><BrandLogo id={v.vendor} size={18} /></span>
        <div className="us-vc-t"><b data-notr>{v.name}</b><span>{v.mode === "plan" ? L("Chạy bằng gói bạn đã đăng nhập; hạn mức do hãng báo về.", "Runs on the plan you signed in to; limits come from the provider.")
          : v.mode === "api" ? L("Chạy bằng khóa API; tính theo chi phí token thật.", "Runs on an API key; billed by real token cost.") : L("Chưa đăng nhập gói hay thêm khóa API.", "No plan sign-in or API key yet.")}</span></div>
        <ModeTag v={v} />
        {v.mode === "plan" && <button className="icon-btn" aria-label={L("Đọc lại hạn mức", "Reload limits")} data-tip={L("Đọc lại hạn mức", "Reload limits")} disabled={busy}
          onClick={() => { setBusy(true); refreshUsage(true); setTimeout(() => setBusy(false), 2500); }}>{busy ? <span className="art-spin sm" /> : <I.Retry size={14} />}</button>}
      </div>
      {v.mode === "plan" && (wins.length ? wins.map((w) => <PlanRow key={w.window} w={w} />)
        : <p className="us-note">{v.sub?.setup ? L("Antigravity đang chờ bạn hoàn tất bước làm quen lần đầu (Cài đặt → Providers → Gemini).", "Antigravity is waiting for its first-run setup (Settings → Providers → Gemini).") : v.cli === "agy" || v.cli === "grok" ? noWindows(v.cli, ["Synchro chưa đọc được hạn mức của gói này. Bấm nút đọc lại ở góc thẻ để thử lại.", "Synchro could not read this plan's quota yet. Use the reload button on this card to try again."]) : L("Gửi một tin nhắn bằng gói này để Synchro đọc hạn mức.", "Send a message with this plan so Synchro can read its limits.")}</p>)}
      {v.mode === "api" && <>
        {v.rate && <RateRow r={v.rate} />}
        {v.credit && <CreditBar c={v.credit} />}
        {v.usingApiUntil && <p className="us-note">{L(`Gói tạm hết hạn mức nên bạn đã chọn dùng khóa API tới ${new Date(v.usingApiUntil).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric" })}; sau đó Synchro tự quay lại gói.`, `The plan hit its limit, so you chose the API key until ${new Date(v.usingApiUntil).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}; then Synchro switches back to the plan.`)}</p>}
      </>}
      {v.mode === "none" ? (
        go && <button className="btn us-vc-go" onClick={() => go("Providers")}>{L("Kết nối ở Providers", "Connect in Providers")}<I.ChevronR size={13} /></button>
      ) : (
        <div className="us-vc-f">
          {v.mode === "plan" && v.sub && <span>{L(`Hôm nay: ${num(v.sub.turnsToday)} tin nhắn`, `${num(v.sub.turnsToday)} messages today`)}</span>}
          <span>{L(`30 ngày: ${num(turns)} lượt`, `30 days: ${num(turns)} calls`)}</span>
          {v.mode === "api" && <span>{L(`Chi phí 30 ngày: ${money(cost)}`, `30-day cost: ${money(cost)}`)}</span>}
        </div>
      )}
      {v.mode === "plan" && v.sub && <p className="us-note">{PLAN_NOTE[v.sub.cli][en() ? 1 : 0]}</p>}
    </div>
  );
}

/** Lượt dùng model mỗi ngày, chồng theo hãng (gói lẫn khóa API), có chú thích và bảng chi tiết khi rê chuột. */
function DailyChart({ d, cost }: { d: Details | null; cost: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const days: Details["days"] = d?.days ?? Array.from({ length: 30 }, () => ({ day: 0, cost: 0, input: 0, output: 0, calls: {} }));
  const tot = (x: Details["days"][number]) => SERIES.reduce((a, [k]) => a + (x.calls[k] ?? 0), 0);
  const max = Math.max(1, ...days.map(tot));
  const used = SERIES.filter(([k]) => days.some((x) => x.calls[k]));
  const h = hover !== null && d ? d.days[hover] : null;
  const fmtDay = (t: number) => new Date(t).toLocaleDateString(en() ? "en-US" : "vi-VN", { day: "numeric", month: "short" });
  return (
    <div className="us-card us-chart" onMouseLeave={() => setHover(null)}>
      <div className="us-chart-h">
        <b>{L("Lượt dùng model mỗi ngày", "Model calls per day")}</b>
        <span>{h ? <>{fmtDay(h.day)} · {SERIES.filter(([k]) => h.calls[k]).map(([k, n]) => `${k === "other" ? L("Khác", "Other") : n} ${h.calls[k]}`).join(" · ") || L("không có lượt nào", "no calls")}{cost && h.cost ? ` · ${money(h.cost)}` : ""}</> : L("Rê chuột vào một ngày để xem chi tiết", "Hover a day for details")}</span>
      </div>
      <div className="us-cols" role="img" aria-label={L("Biểu đồ lượt dùng model 30 ngày qua theo hãng", "Model calls over the last 30 days by provider")}>
        {days.map((x, i) => {
          const t = tot(x);
          return (
            <div key={i} className={`us-col ${hover === i ? "on" : ""}`} onMouseEnter={() => setHover(i)}>
              <div className="us-stack" style={{ height: `${t ? Math.max(4, (t / max) * 100) : 0}%` }}>
                {SERIES.filter(([k]) => x.calls[k]).map(([k]) => <i key={k} style={{ flexGrow: x.calls[k], background: VENDOR_COLOR[k] }} />)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="us-axis"><span>{L("30 ngày trước", "30 days ago")}</span><span>{L("Hôm nay", "Today")}</span></div>
      {used.length > 0 && <div className="us-legend">{used.map(([k, n]) => <span key={k}><i style={{ background: VENDOR_COLOR[k] }} />{k === "other" ? L("Khác", "Other") : n} <em>{num(days.reduce((a, x) => a + (x.calls[k] ?? 0), 0))}</em></span>)}</div>}
    </div>
  );
}

export function UsageSettings({ go }: { go?: (t: string) => void }) {
  const st = useUsage("*");
  const [d, setD] = useState<Details | null>(null);
  const [dErr, setDErr] = useState(false);
  // Máy chủ trả lỗi dạng { error } (phiên hết hạn, mất kết nối): từng làm cả app sập ở d.days.reduce. Chỉ nhận đúng dữ liệu, còn lại báo lỗi kèm nút thử lại.
  const loadD = useCallback(() => {
    setDErr(false);
    return fetch(`/api/usage/details?tz=${new Date().getTimezoneOffset()}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j) => {
      if (!Array.isArray(j?.days)) throw new Error("bad");
      setD({ ...j, byModel: j.byModel ?? [], byPlan: j.byPlan ?? [], byFeature: j.byFeature ?? [] });
    }).catch(() => setDErr(true));
  }, []);
  useEffect(() => {
    void loadD();
    window.addEventListener("synchro:usage", loadD);
    return () => window.removeEventListener("synchro:usage", loadD);
  }, [loadD]);
  // Hãng chỉ có khóa API (DeepSeek) mà chưa nối: chỉ quản trị viên mới nối được nên chỉ hiện cho quản trị viên.
  const vendors = (st?.vendors ?? []).filter((v) => v.mode !== "none" || !!v.cli || st?.admin);
  const callsOf = (v: VendorUsage["vendor"]) => d?.days.reduce((a, x) => a + (x.calls[v] ?? 0), 0) ?? 0;
  const costOf = (v: VendorUsage) => d?.byModel.filter((m) => m.model.split("/")[0] === v.provider).reduce((a, m) => a + m.cost, 0) ?? 0;
  const total = d?.days.reduce((a, x) => a + x.cost, 0) ?? 0;
  const calls = d?.days.reduce((a, x) => a + Object.values(x.calls).reduce((b, n) => b + (n ?? 0), 0), 0) ?? 0;
  const planTurns = d?.byPlan.reduce((a, m) => a + m.turns, 0) ?? 0;
  const tokIn = d?.byModel.reduce((a, m) => a + m.input + m.cacheRead + m.cacheWrite, 0) ?? 0;
  const tokOut = d?.byModel.reduce((a, m) => a + m.output, 0) ?? 0;
  const top = Math.max(d?.byModel[0]?.cost || 0, 0.0001);
  const topTurns = Math.max(1, ...(d?.byPlan.map((m) => m.turns) ?? [1]));
  // Hiện theo đúng cách từng hãng đang kết nối: có hãng chạy bằng gói thì có phần của gói, có hãng chạy bằng khóa API thì mới có
  // hạn mức chi phí, chi phí và token của khóa API. Chi phí khóa API từ trước (nay đã chuyển sang gói) thu gọn ở cuối danh sách model.
  const planNow = vendors.some((v) => v.mode === "plan"), apiNow = hasApi(st);
  const [oldApi, setOldApi] = useState(false);
  const today = vendors.reduce((a, v) => a + (v.mode === "plan" ? v.sub?.turnsToday ?? 0 : 0), 0);
  const stats: [string, string][] = [[num(calls), L("Lượt dùng model", "Model calls")]];
  if (planNow) stats.push([num(planTurns), L("Qua gói subscription", "On subscription plans")], [num(today), L("Tin nhắn hôm nay qua gói", "Plan messages today")]);
  if (apiNow) stats.push([money(total), L("Chi phí khóa API", "API key cost")], [kTok(tokIn + tokOut), L("Token qua khóa API", "API key tokens")]);
  const apiRows = (d?.byModel ?? []).map((m) => {
    const vc = VENDOR_COLOR[vendorKey(m.model)];
    return (
      <div key={m.model} className="us-li">
        <div className="us-li-t"><b data-notr><i className="us-dot" style={{ background: vc }} />{modelName(m.model)}</b><span>{L(`Khóa API · ${num(m.calls)} lần gọi · vào ${kTok(m.input + m.cacheRead + m.cacheWrite)} · ra ${kTok(m.output)} · $${m.price.in} / $${m.price.out} mỗi 1 triệu token${m.price.src === "estimate" ? " (giá ước tính)" : ""}`, `API key · ${num(m.calls)} calls · ${kTok(m.input + m.cacheRead + m.cacheWrite)} in · ${kTok(m.output)} out · $${m.price.in} / $${m.price.out} per 1M tokens${m.price.src === "estimate" ? " (estimated price)" : ""}`)}</span></div>
        <em>{money(m.cost)}</em>
        <div className="us-li-bar"><i style={{ width: `${(m.cost / top) * 100}%`, background: vc }} /></div>
      </div>
    );
  });
  // Theo model: dòng của gói rồi dòng của khóa API, chia trang 10 mục.
  const byModelRows: ({ kind: "plan"; m: NonNullable<typeof d>["byPlan"][number] } | { kind: "api"; row: React.ReactNode })[] = [
    ...(d?.byPlan ?? []).map((m) => ({ kind: "plan" as const, m })), ...(apiNow ? apiRows.map((row) => ({ kind: "api" as const, row })) : []),
  ];
  const pgM = usePage(byModelRows, 10);
  const lead = !st ? "" : planNow && apiNow ? L("Hãng chạy bằng gói hiện hạn mức của gói (phiên 5 giờ, hằng tuần); hãng chạy bằng khóa API hiện chi phí và hạn mức của khóa.", "Providers on a plan show the plan's limits (5-hour session, weekly); providers on an API key show the key's cost and limits.")
    : planNow ? L("Các hãng đang chạy bằng gói subscription bạn đã đăng nhập, nên mức dùng hiện theo hạn mức của gói (phiên 5 giờ, hằng tuần) do hãng báo về.", "Your providers run on the subscription plans you signed in to, so usage follows each plan's limits (5-hour session, weekly) as the provider reports them.")
    : apiNow ? L("Các hãng đang chạy bằng khóa API, nên mức dùng tính theo chi phí token thật và hạn mức chi phí của Synchro.", "Your providers run on API keys, so usage is measured in real token cost against Synchro's cost limits.")
    : L("Chưa có hãng nào được kết nối.", "No provider is connected yet.");
  return (
    <div className="us-page">
      <h3 style={{ marginTop: 0 }}>{L("Mức dùng", "Usage")}</h3>
      <p className="d" style={{ margin: "-4px 0 14px" }}>{L("Synchro tự nhận ra mỗi hãng đang chạy bằng gói subscription hay khóa API và hiện mức dùng theo đúng cách đó.", "Synchro detects whether each provider runs on a subscription plan or an API key and shows usage the matching way.")} {lead}</p>
      {!st ? <div className="us-card"><div className="us-empty"><span className="art-spin sm" /></div></div>
        : <div className="us-vgrid">{vendors.map((v) => <VendorCard key={v.vendor} v={v} turns={callsOf(v.vendor)} cost={costOf(v)} go={go} />)}</div>}

      {st && apiNow && (
        <>
          <h3 className="sec">{L("Giới hạn chi phí khóa API", "API key cost limits")}</h3>
          <div className="us-card">
            {st.limits.map((l) => (
              <div key={l.key} className="us-big">
                <div className="us-big-t"><b>{l.key === "session" ? L("Phiên hiện tại", "Current session") : L("Hằng tuần · mọi model", "Weekly · all models")}</b><span>{l.key === "session" ? L("Bắt đầu từ tin nhắn đầu tiên, kéo dài 5 giờ. Chỉ tính các lượt chạy bằng khóa API.", "Starts with your first message and lasts 5 hours. Only API key calls count.") : L("Đặt lại vào cùng giờ mỗi tuần.", "Resets at the same time every week.")}</span></div>
                <div className="us-big-v">{l.limit === null ? <><b>{money(l.used)}</b><span>{L("Không giới hạn", "No limit")}</span></> : <><b>{Math.round(l.pct)}%</b><span>{L(`${money(l.used)} trên ${money(l.limit)}`, `${money(l.used)} of ${money(l.limit)}`)}</span></>}</div>
                <Bar pct={l.pct} unlimited={l.limit === null} />
                <div className="us-big-r">{resetText(l.resetAt, l.active)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="sec">{L("30 ngày qua", "Last 30 days")}</h3>
      {dErr && !d && <div className="err-box sm" role="alert"><b>{L("Chưa tải được số liệu mức dùng", "Couldn't load usage figures")}</b><button className="btn" onClick={() => void loadD()}>{L("Thử lại", "Try again")}</button></div>}
      {/* Tải lỗi: không hiện số 0 dưới dòng báo lỗi, trông như chưa dùng gì. */}
      {!(dErr && !d) && <div className="us-stats" style={{ "--n": Math.min(stats.length, 4) } as React.CSSProperties}>{stats.slice(0, 4).map(([v, t]) => <div key={t}><b>{v}</b><span>{t}</span></div>)}</div>}
      {!(dErr && !d) && <DailyChart d={d} cost={apiNow} />}

      <h3 className="sec">{L("Theo model", "By model")}</h3>
      {!d ? null : !d.byPlan.length && !(apiNow && d.byModel.length) ? <p className="d">{L("Chưa có lượt dùng nào. Bắt đầu một đoạn chat là số liệu hiện ở đây.", "No usage yet. Start a chat and it shows up here.")}</p> : (
        <div className="us-card us-list">
          {pgM.items.map((x) => x.kind === "plan" ? ((m) => (
            <div key={m.model} className="us-li">
              <div className="us-li-t"><b data-notr><i className="us-dot" style={{ background: VENDOR_COLOR[CLI_VENDOR[m.cli]] }} />{m.model.endsWith("/") ? L(`${m.name} (lượt cũ, chưa ghi tên model)`, `${m.name} (earlier calls, model not recorded)`) : m.name}</b><span>{L(`Gói ${SUB_NAME[m.cli]} · ${num(m.turns)} lượt`, `${SUB_NAME[m.cli]} plan · ${num(m.turns)} calls`)}</span></div>
              <em className="us-incl">{L("Trong gói", "Included")}</em>
              <div className="us-li-bar"><i style={{ width: `${(m.turns / topTurns) * 100}%`, background: VENDOR_COLOR[CLI_VENDOR[m.cli]] }} /></div>
            </div>
          ))(x.m) : x.row)}
        </div>
      )}
      <PageBar pg={pgM} />
      {!apiNow && !!d?.byModel.length && (
        <div className="us-old">
          <button className="us-old-b" aria-expanded={oldApi} onClick={() => setOldApi(!oldApi)}>{L(`Khóa API dùng trước đây: ${num(d.byModel.reduce((a, m) => a + m.calls, 0))} lần gọi · ${money(total)}`, `Earlier API key use: ${num(d.byModel.reduce((a, m) => a + m.calls, 0))} calls · ${money(total)}`)}<I.Chevron size={12} /></button>
          {oldApi && <div className="us-card us-list">{apiRows}</div>}
        </div>
      )}
      {apiNow && !!d?.byFeature.length && (
        <>
          <h3 className="sec">{L("Khóa API theo tính năng", "API key cost by feature")}</h3>
          <div className="us-card us-list">{d.byFeature.map((f) => <div key={f.feature} className="us-li"><div className="us-li-t"><b>{FEATURE[f.feature]?.[en() ? 1 : 0] ?? f.feature}</b><span>{L(`${num(f.calls)} lần gọi`, `${num(f.calls)} calls`)}</span></div><em>{money(f.cost)}</em></div>)}</div>
        </>
      )}
      <p className="d" style={{ marginTop: 16 }}>
        {planNow && L("Gói subscription tính theo hạn mức hãng báo về; hãng không báo số token của gói nên Synchro đếm theo lượt. ", "Plans follow the limits each provider reports; providers don't report plan tokens, so Synchro counts calls. ")}
        {apiNow && L("Khóa API tính theo giá niêm yết của từng hãng, gồm cả đọc và ghi cache; hóa đơn của hãng là số cuối cùng.", "API keys are billed at each provider's list price, including cache reads and writes; the provider's invoice is final.")}
        {st?.admin && go && apiNow && <> {L("Quản trị viên đổi hạn mức và bảng giá ở", "Administrators can change limits and prices in")} <a className="lnk" role="button" tabIndex={0} onClick={() => go("Administrator")} onKeyDown={rowKeys(() => go("Administrator"))}>{L("Quản trị → Hạn mức sử dụng", "Administrator → Usage limits")}</a>.</>}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Quản trị viên → Usage limits
type AdminData = { apiKeys?: boolean;
  config: { session: number | null; weekly: number | null; admins: boolean; prices: Record<string, { in: number; out: number; cache: number }> };
  users: { id: string; email: string; name: string; admin: boolean; override: { session?: number | null; weekly?: number | null }; limits: Limit[]; month: { cost: number; input: number; output: number }; effective: { session: number | null; weekly: number | null } }[];
  prices: { model: string; in: number; out: number; cache: number; src: "official" | "estimate" | "custom" }[];
};
async function adm(method: string, body?: unknown): Promise<AdminData> {
  const r = await apiFetch("/api/admin/usage", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// Ô nhập hạn mức USD; để trống = không giới hạn.
function Money({ value, onSave, placeholder = "No limit", label }: { value: number | null | undefined; onSave: (v: number | null) => void; placeholder?: string; label: string }) {
  const [v, setV] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => { setV(value === null || value === undefined ? "" : String(value)); }, [value]);
  const save = () => { const n = v.trim() === "" ? null : Number(v.replace(",", ".")); if (n === null || (isFinite(n) && n >= 0)) { if (n !== (value ?? null)) onSave(n); } else setV(value == null ? "" : String(value)); };
  return <span className="us-money"><i>$</i><input inputMode="decimal" aria-label={label} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /></span>;
}

export function UsageAdmin({ say, Toggle }: { say: (m: string) => void; Toggle: (p: { on: boolean; set: (v: boolean) => void; label?: string }) => React.ReactElement }) {
  const [d, setD] = useState<AdminData | null>(null);
  const [showPrices, setShowPrices] = useState(false);
  const [pq, setPq] = useState("");
  const pql = pq.trim().toLowerCase();
  const people = (d?.users ?? []).filter((u) => !pql || `${u.name} ${u.email}`.toLowerCase().includes(pql));
  const pgP = usePage(people, 10, pql);
  const pgPr = usePage(d?.prices ?? [], 12);
  useEffect(() => { adm("GET").then(setD).catch((e) => say(e.message)); }, [say]);
  const patch = (body: unknown, ok: string) => adm("PATCH", body).then((x) => { setD(x); say(ok); refreshUsage(); }).catch((e) => say(e.message));
  if (!d) return <div className="muted" style={{ fontSize: 12 }}>Loading…</div>;
  // Mọi người chạy bằng gói của chính họ: hạn mức đô la không áp vào đâu, hiện ra chỉ làm quản trị viên tưởng đã giới hạn được.
  if (d.apiKeys === false) return <div className="adm-card"><div className="adm-card-h"><b>Limits come from each person&apos;s AI plan</b><span className="d">Everyone here runs models through the plan they signed in with, so each vendor&apos;s plan limits apply and Synchro has no cost to cap. Spending limits appear here if you add a shared API key in Settings → Providers. To stop someone using a model, change their access below.</span></div></div>;
  const c = d.config;
  return (
    <div className="adm-card">
      <div className="adm-card-h"><b>Default limits</b><span className="d">API cost each person can use. Leave empty for no limit. When a limit is reached, chats pause until it resets.</span></div>
      <div className="adm-perm-row"><div><div className="t">Per session (5 hours)</div><div className="d">Starts with a person&apos;s first message.</div></div><Money label="Per session (5 hours)" value={c.session} onSave={(v) => patch({ config: { session: v } }, "Session limit saved")} /></div>
      <div className="adm-perm-row"><div><div className="t">Per week</div><div className="d">Resets at the same time every week.</div></div><Money label="Per week" value={c.weekly} onSave={(v) => patch({ config: { weekly: v } }, "Weekly limit saved")} /></div>
      <div className="adm-perm-row"><div><div className="t">Apply to administrators</div><div className="d">Off: administrators have no limit unless you set one for them below.</div></div><Toggle on={c.admins} label="Apply to administrators" set={(v) => patch({ config: { admins: v } }, v ? "Limits now apply to administrators" : "Administrators have no limit")} /></div>

      <div className="adm-card-h" style={{ marginTop: 14 }}><b>People</b><span className="d">Cost in the last 30 days and limits for each account. A custom limit replaces the default.</span></div>
      {d.users.length > 10 && <div className="s-search us-ppl-s"><I.Search size={14} /><input placeholder="Search by name or email" value={pq} onChange={(e) => setPq(e.target.value)} /></div>}
      <div className="us-ppl">
        {!people.length && <div className="d" style={{ padding: "10px 4px" }}>No users match.</div>}
        {pgP.items.map((u) => {
          const s = u.limits.find((l) => l.key === "session")!, w = u.limits.find((l) => l.key === "weekly")!;
          return (
            <div key={u.id} className="us-p">
              <div className="us-p-t"><b data-notr>{u.name || u.email}</b><span data-notr>{u.email}{u.admin ? " · admin" : ""}</span></div>
              <div className="us-p-m"><span>{money(u.month.cost)}</span><small>30 days</small></div>
              <div className="us-p-l"><small>Session {u.effective.session === null ? "∞" : `${Math.round(s.pct)}%`}</small><Money label="Session" value={"session" in u.override ? u.override.session : undefined} placeholder={u.effective.session === null ? "Default: none" : `Default: $${u.effective.session}`} onSave={(v) => patch({ user: u.id, override: { ...u.override, session: v } }, "Limit saved")} /></div>
              <div className="us-p-l"><small>Week {u.effective.weekly === null ? "∞" : `${Math.round(w.pct)}%`}</small><Money label="Week" value={"weekly" in u.override ? u.override.weekly : undefined} placeholder={u.effective.weekly === null ? "Default: none" : `Default: $${u.effective.weekly}`} onSave={(v) => patch({ user: u.id, override: { ...u.override, weekly: v } }, "Limit saved")} /></div>
              {Object.keys(u.override).length > 0 && <button className="icon-btn" aria-label="Use default limits" data-tip="Use default limits" onClick={() => patch({ user: u.id, override: null }, "Using default limits")}><I.Retry size={14} /></button>}
            </div>
          );
        })}
      </div>
      <PageBar pg={pgP} />

      <div className="adm-card-h" style={{ marginTop: 14, cursor: "pointer" }} onClick={() => setShowPrices(!showPrices)}><b>Model prices {showPrices ? "▴" : "▾"}</b><span className="d">USD per 1 million tokens, used to turn tokens into cost. Claude prices are official; others are estimates you should check against each provider&apos;s pricing page.</span></div>
      {showPrices && (
        <div className="us-prices">
          <div className="us-pr h"><span>Model</span><span>Input</span><span>Output</span><span>Cache read</span><span /></div>
          {pgPr.items.map((p) => (
            <div key={p.model} className="us-pr">
              <span data-notr>{modelName(p.model)} <i className={`us-src ${p.src}`}>{p.src === "official" ? "Official" : p.src === "custom" ? "Custom" : "Estimate"}</i></span>
              {(["in", "out", "cache"] as const).map((k) => <Money key={k} label={{ in: "Input", out: "Output", cache: "Cache read" }[k]} value={p[k]} placeholder="" onSave={(v) => v !== null && patch({ config: { prices: { [p.model]: { in: p.in, out: p.out, cache: p.cache, [k]: v } } } }, "Price saved")} />)}
              {p.src === "custom" ? <button className="icon-btn" aria-label="Reset price" data-tip="Reset price" onClick={() => patch({ config: { prices: { [p.model]: null } } }, "Price reset")}><I.Retry size={14} /></button> : <span />}
            </div>
          ))}
        </div>
      )}
      {showPrices && <PageBar pg={pgPr} />}
      <p className="d" style={{ marginTop: 10 }}>{tr("Synchro tính chi phí từ số token thật mà nhà cung cấp trả về sau mỗi lần gọi model.")}</p>
    </div>
  );
}
