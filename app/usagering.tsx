"use client";
// Mức dùng, phần luôn có trên trang chủ (blueprint B3.1): vòng tròn cạnh bộ chọn model (UsageRing), bấm vào hiện giới hạn phiên 5 giờ, giới hạn
// tuần và hạn mức API của nhà cung cấp; dữ liệu dùng chung (useUsage), biểu tượng Mức dùng. Trang Cài đặt → Usage và phần quản trị nằm ở
// usageui.tsx, chỉ tải khi mở Cài đặt.
import { useCallback, useEffect, useState } from "react";
import { Menu } from "./ui";
import { useApp } from "./store";
import { getLang } from "./i18n";
import { resetAt } from "./resetfmt";
import * as I from "./icons";

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
    return () => { window.removeEventListener("synchro:usage", on); document.removeEventListener("visibilitychange", vis); clearInterval(t); };
  }, [load]);
  return st;
}

// ---------------------------------------------------------------- định dạng
export const en = () => getLang() === "en";
export const money = (v: number) => (v > 0 && v < 0.01 ? "<$0.01" : `$${v.toFixed(v >= 100 ? 0 : 2)}`);
export const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n));
export function resetText(t: number | null, active = true) {
  if (!t || !active) return en() ? "Starts with your next message" : "Bắt đầu khi bạn gửi tin nhắn";
  // Cùng nguồn, cùng định dạng (tuyệt đối) với thẻ báo hết hạn mức dưới câu trả lời (resetfmt.ts).
  return resetAt(t, en() ? "en" : "vi");
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

export function Bar({ pct, unlimited }: { pct: number; unlimited?: boolean }) {
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

export function RateRow({ r }: { r: Rate }) {
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
export const PLAN_NOTE: Record<SubUsage["cli"], [string, string]> = {
  claude: ["Phiên 5 giờ bắt đầu từ tin nhắn đầu tiên. Hạn mức tuần đặt lại vào một giờ cố định mỗi tuần.", "The 5-hour session starts with your first message. Weekly limits reset at a fixed time each week."],
  codex: ["Hạn mức tùy gói của tài khoản ChatGPT: gói Plus có phiên 5 giờ cuốn chiếu và hạn mức tuần, gói Pro chỉ có hạn mức tuần.", "Limits depend on your ChatGPT plan. Plus has a rolling 5-hour window and a weekly limit; Pro only has a weekly limit."],
  agy: ["Hạn mức tùy gói của tài khoản Google và hồi theo chu kỳ. Model Gemini và model Claude/GPT tính riêng.", "Limits depend on your Google account's plan and refresh over time. Gemini and Claude/GPT models are counted separately."],
  grok: ["Hạn mức tùy gói của tài khoản Grok và hồi dần theo thời gian; hết hạn mức thì Synchro hỏi bạn trước khi dùng khóa API.", "Limits depend on your Grok plan and refresh over time. When you hit one, Synchro asks before using an API key."],
};
/** Ghi chú khi gói chưa có thanh hạn mức nào: Antigravity chưa đọc được bảng hạn mức, Grok CLI không báo hạn mức, gói khác chờ lượt chat đầu. */
export const noWindows = (cli: SubUsage["cli"] | null | undefined, tail: [string, string]) =>
  cli === "grok" ? L("Grok CLI không báo hạn mức còn lại của gói. Synchro đếm số tin nhắn và báo ngay khi Grok nói đã chạm giới hạn.", "The Grok CLI doesn't report how much of the plan is left. Synchro counts your messages and tells you as soon as Grok says the limit is reached.") : cli === "agy" ? L(...tail) : L("Gửi một tin nhắn bằng gói này để xem hạn mức.", "Send a message with this plan to see its limits.");
const winLevel = (w: PlanWindow) => (w.status === "rejected" ? "hot" : w.status === "allowed_warning" ? "warn" : level(w.usedPct ?? 0));

export function PlanRow({ w }: { w: PlanWindow }) {
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

export function CreditBar({ c }: { c: Credit }) {
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
export const L = (vi: string, e: string) => (en() ? e : vi);
// Màu cố định theo hãng (bảng màu phân loại đã kiểm tra mù màu; màu đi theo hãng, không theo thứ hạng).
export const VENDOR_COLOR: Record<VendorUsage["vendor"] | "other", string> = { anthropic: "var(--vc-claude)", openai: "var(--vc-gpt)", google: "var(--vc-gemini)", xai: "var(--vc-grok)", deepseek: "var(--vc-deepseek)", other: "var(--vc-other)" };
const planName = (sub?: SubUsage) => (sub?.plan ? (en() ? `${sub.plan} plan` : `Gói ${sub.plan}`) : L("Gói subscription", "Subscription plan"));
// Mức đã dùng của một hãng (cửa sổ gần chạm nhất của gói; với khóa API: hạn mức gọi / số dư).
const vendorPct = (v: VendorUsage) => v.mode === "plan" ? Math.max(0, ...(v.sub?.windows ?? []).map((w) => (w.status === "rejected" ? 100 : w.usedPct ?? 0)))
  : v.mode === "api" ? Math.max(0, v.rate?.pct ?? 0, v.credit?.pct ?? 0) : 0;
export const hasApi = (st: UsageState | null) => !!st?.vendors?.some((v) => v.mode === "api");

/** Huy hiệu cách hãng đang chạy: gói đã đăng nhập, khóa API, hoặc chưa kết nối. */
export function ModeTag({ v }: { v: VendorUsage }) {
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
