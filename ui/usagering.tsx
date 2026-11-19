"use client";
// Mức dùng, phần luôn có trên trang chủ (blueprint B3.1): vòng tròn cạnh bộ chọn model (UsageRing), bấm vào hiện giới hạn phiên 5 giờ, giới hạn
// tuần và hạn mức API của nhà cung cấp; dữ liệu dùng chung (useUsage), biểu tượng Mức dùng. Trang Cài đặt → Usage và phần quản trị nằm ở
// usageui.tsx, chỉ tải khi mở Cài đặt.
import { useCallback, useEffect, useState } from "react";
import { inFloating } from "./clickaway";
import { Menu } from "./ui";
import { useApp } from "./store";
import { getLang, tf, tr, trc } from "./i18n";
import { resetAt } from "./resetfmt";
import * as I from "./icons";

/** turn: phần chi phí của lượt người dùng (chat, code…) trong cửa sổ, không gồm việc nền như rút bộ nhớ, embedding (server/usage.ts). */
export type Limit = { key: "session" | "weekly" | "daily"; used: number; turn?: number; limit: number | null; pct: number; resetAt: number | null; active: boolean };
export type Rate = { provider: string; limit: number; remaining: number; resetAt: number; pct: number };
export type Credit = { provider: string; amount: number; since: number; spent: number; remaining: number; pct: number };
// Hạn mức của gói subscription (model "sub-…"): cửa sổ phiên 5 giờ / tuần do CLI của hãng báo về (xem server/ai/subs.ts).
export type PlanWindow = { window: string; usedPct?: number; resetsAt?: number; status?: string; label: string; kind: "session" | "weekly" | "other"; group?: string; idle?: boolean };
/** turnsToday: tin nhắn của chính người dùng hôm nay; helpersToday: việc phụ (đặt tên, ghi nhớ, phản biện tự động…) đã chạy trên gói hôm nay. ranAt: lần gần nhất gói chạy được. */
export type SubUsage = { cli: "claude" | "codex" | "agy" | "grok"; name: string; plan: string | null; windows: PlanWindow[]; turnsToday: number; helpersToday?: number; note: string | null; credits: string | null; at: number | null; setup?: boolean; ranAt?: number | null };
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
export const money = (v: number) => (v > 0 && v < 0.01 ? "<$0.01" : `$${v.toFixed(v >= 100 ? 0 : 2)}`);
export const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n));
export function resetText(t: number | null, active = true) {
  if (!t || !active) return trc("Bắt đầu khi bạn gửi tin nhắn", "giờ đặt lại");
  // Cùng nguồn, cùng định dạng (tuyệt đối) với thẻ báo hết hạn mức dưới câu trả lời (resetfmt.ts).
  return resetAt(t, getLang());
}
const level = (p: number) => (p >= 90 ? "hot" : p >= 70 ? "warn" : "");
const LABEL = { session: "Giới hạn phiên", weekly: "Hằng tuần · mọi model", daily: "Hôm nay · chi phí API" } as const;

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
        <b>{tr(LABEL[l.key])}</b>
        <span>{unlimited ? <>{tr("Không giới hạn")} · {money(l.used)}</> : <>{resetText(l.resetAt, l.active)}<em>{Math.round(l.pct)}%</em></>}</span>
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
        <b>{tf("API {name} · token mỗi phút", { name: PROVIDER[r.provider] ?? r.provider })}</b>
        <span>{tf("Đặt lại sau {secs}s", { secs })}<em>{Math.round(r.pct)}%</em></span>
      </div>
      <Bar pct={r.pct} />
    </div>
  );
}

// Tên cửa sổ hạn mức của gói (chữ gốc tiếng Việt, dịch bằng tr khi hiện).
const WIN: Record<string, string> = {
  five_hour: "Phiên hiện tại", seven_day: "Hằng tuần · mọi model", seven_day_opus: "Hằng tuần · Opus",
  seven_day_sonnet: "Hằng tuần · Sonnet", seven_day_overage_included: "Hằng tuần · giới hạn theo model", overage: "Tín dụng sử dụng",
  // Dòng máy chủ thêm khi hãng báo hết hạn mức mà không có cửa sổ cụ thể (ai/subs.ts subUsage).
  plan_limit: "Hạn mức gói",
};
// Nhóm hạn mức của gói Google (tên hãng trả về bằng tiếng Anh). "model Gemini" ngắn, dễ trùng: dịch theo ngữ cảnh.
const groupName = (g: string) => (g === "Gemini models" ? trc("model Gemini", "nhóm hạn mức") : g === "Claude and GPT models" ? tr("model Claude và GPT") : g);
function winLabel(w: PlanWindow) {
  if (w.group) return `${tr(w.kind === "weekly" ? "Hằng tuần" : "Phiên hiện tại")} · ${groupName(w.group)}`;
  return WIN[w.window] ? tr(WIN[w.window]) : w.label;
}
// Cách hãng đặt lại hạn mức (ghi chú dưới các thanh), dịch bằng tr khi hiện.
export const PLAN_NOTE: Record<SubUsage["cli"], string> = {
  claude: "Phiên 5 giờ bắt đầu từ tin nhắn đầu tiên. Hạn mức tuần đặt lại vào một giờ cố định mỗi tuần.",
  codex: "Hạn mức tùy gói của tài khoản ChatGPT: gói Plus có phiên 5 giờ cuốn chiếu và hạn mức tuần, gói Pro chỉ có hạn mức tuần.",
  agy: "Hạn mức tùy gói của tài khoản Google và hồi theo chu kỳ. Model Gemini và model Claude/GPT tính riêng.",
  grok: "Hạn mức tùy gói của tài khoản Grok và hồi dần theo thời gian; hết hạn mức thì Synchro hỏi bạn trước khi dùng khóa API.",
};
/** Ghi chú khi gói chưa có thanh hạn mức nào: Antigravity chưa đọc được bảng hạn mức, Grok CLI không báo hạn mức, gói khác chờ lượt chat đầu.
 *  agyNote: câu riêng cho Antigravity (chữ gốc tiếng Việt). */
export const noWindows = (cli: SubUsage["cli"] | null | undefined, agyNote: string) =>
  cli === "grok" ? tr("Grok CLI không báo hạn mức còn lại của gói. Synchro đếm số tin nhắn và báo ngay khi Grok nói đã chạm giới hạn.") : cli === "agy" ? tr(agyNote) : tr("Gửi một tin nhắn bằng gói này để xem hạn mức.");
const winLevel = (w: PlanWindow) => (w.status === "rejected" ? "hot" : w.status === "allowed_warning" ? "warn" : level(w.usedPct ?? 0));

export function PlanRow({ w }: { w: PlanWindow }) {
  const pct = w.usedPct ?? 0;
  return (
    <div className="us-row">
      <div className="us-row-t">
        <b>{winLabel(w)}</b>
        <span>{w.status === "rejected" && w.resetsAt ? <>{tr("Đã chạm giới hạn")}{" · "}{resetText(w.resetsAt)}</> : resetText(w.idle ? null : w.resetsAt ?? null, !w.idle && !!w.resetsAt)}<em>{w.usedPct === undefined ? "–" : `${Math.round(pct)}%`}</em></span>
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
        <b>{tf("Số dư API {name}", { name: PROVIDER[c.provider] ?? c.provider })}</b>
        <span>{tf("Còn {left} / {total}", { left: money(c.remaining), total: money(c.amount) })}<em>{Math.round(c.pct)}%</em></span>
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
        ? tf("Số dư API {name} đã hết. Nạp thêm cho khóa rồi cập nhật số dư ở Cài đặt → Providers.", { name })
        : tf("Số dư API {name} sắp hết: còn {left} ({pct}%).", { name, left: money(c.remaining), pct: Math.round(left) }));
    }
    for (const w of st.sub?.windows ?? []) if (w.status === "rejected" && w.resetsAt)
      once(`plan:${st.sub!.cli}:${w.window}:${w.resetsAt}`, tf("Gói {name} đã chạm giới hạn ({win}). {reset}.", { name: st.sub!.name, win: winLabel(w), reset: resetText(w.resetsAt) }));
  }, [st, say]);
}

// ---------------------------------------------------------------- vòng tròn cạnh bộ chọn model
// Màu cố định theo hãng (bảng màu phân loại đã kiểm tra mù màu; màu đi theo hãng, không theo thứ hạng).
export const VENDOR_COLOR: Record<VendorUsage["vendor"] | "other", string> = { anthropic: "var(--vc-claude)", openai: "var(--vc-gpt)", google: "var(--vc-gemini)", xai: "var(--vc-grok)", deepseek: "var(--vc-deepseek)", other: "var(--vc-other)" };
const planName = (sub?: SubUsage) => (sub?.plan ? tf("Gói {plan}", { plan: sub.plan }) : tr("Gói subscription"));
// Mức đã dùng của một hãng (cửa sổ gần chạm nhất của gói; với khóa API: hạn mức gọi / số dư).
const vendorPct = (v: VendorUsage) => v.mode === "plan" ? Math.max(0, ...(v.sub?.windows ?? []).map((w) => (w.status === "rejected" ? 100 : w.usedPct ?? 0)))
  : v.mode === "api" ? Math.max(0, v.rate?.pct ?? 0, v.credit?.pct ?? 0) : 0;
export const hasApi = (st: UsageState | null) => !!st?.vendors?.some((v) => v.mode === "api");
/** Antigravity còn màn hình làm quen lần đầu nên chưa đọc được bảng hạn mức. Gemini đã chạy được (ranAt) thì nói đúng như vậy: chat vẫn chạy, chỉ thiếu số hạn mức
 *  (lỗi 11 của ma trận H1: "đang chờ bước làm quen" trong khi Gemini vừa trả lời 3 lần). */
export const setupNote = (sub: SubUsage, short = false) => sub.ranAt
  ? (short ? tr("Gemini đang chạy bình thường. Synchro chưa đọc được hạn mức của gói này.") : tr("Gemini đang chạy bình thường. Synchro chưa đọc được bảng hạn mức của Antigravity trên tài khoản này nên chưa hiện phần trăm đã dùng; chat không bị ảnh hưởng, và khi gói chạm giới hạn Synchro vẫn nhận ra và báo cho bạn."))
  : short ? tr("Antigravity đang chờ bạn hoàn tất bước làm quen lần đầu.") : tr("Antigravity đang chờ bạn hoàn tất bước làm quen lần đầu (bảng màu, điều khoản, chia sẻ dữ liệu). Xem Cài đặt → Providers → Gemini.");

/** Huy hiệu cách hãng đang chạy: gói đã đăng nhập, khóa API, hoặc chưa kết nối. */
export function ModeTag({ v }: { v: VendorUsage }) {
  if (v.mode === "plan") return <span className="us-tag plan">{planName(v.sub)}</span>;
  if (v.mode === "api") return <span className="us-tag api">{v.usingApiUntil ? tr("Khóa API · gói tạm hết") : trc("Khóa API", "mức dùng")}</span>;
  return <span className="us-tag none">{tr("Chưa kết nối")}</span>;
}

/** Một hãng trong vòng tròn của chế độ Tự động: tên, cách đang chạy, các thanh hạn mức. */
function VendorBlock({ v }: { v: VendorUsage }) {
  const wins = v.sub?.windows ?? [];
  return (
    <div className="us-v">
      <div className="us-v-h"><i style={{ background: VENDOR_COLOR[v.vendor] }} /><b data-notr>{v.name}</b><ModeTag v={v} /></div>
      {v.mode === "plan" ? (wins.length ? wins.filter((w) => w.kind !== "other").map((w) => <PlanRow key={w.window} w={w} />)
        : <p className="us-note">{v.sub?.setup ? setupNote(v.sub, true) : noWindows(v.cli, "Synchro chưa đọc được hạn mức của gói này.")}</p>)
        : <>
          {v.rate && <RateRow r={v.rate} />}
          {v.credit && <CreditBar c={v.credit} />}
          {!v.rate && !v.credit && <p className="us-note">{tr("Tính theo chi phí API thật, trong giới hạn chung bên dưới.")}</p>}
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
    const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.(".us-wrap") && !inFloating(e.target)) setOpen(false); };
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
  // Tự động có gói và một lượt chat / code của người dùng đã chạy bằng khóa API chung trong phiên / tuần / ngày đang tính: vòng trong nhỏ cho phần
  // hạn mức chi phí API đã dùng, để người đang nhìn % của gói vẫn thấy lượt vừa tiêu hạn mức API (lỗi 4 của ma trận H1). Chỉ có việc nền trên
  // khóa API (embedding, rút bộ nhớ) thì không hiện, và phần trăm làm tròn còn 0 cũng không hiện ("khóa API chung 0%" chỉ gây hiểu lầm).
  const apiRaw = auto && hasApi(st) && live.some((v) => v.mode === "plan") ? Math.max(0, ...limited.filter((l) => l.active && (l.turn ?? 0) > 0).map((l) => l.pct)) : 0;
  const apiPct = Math.round(apiRaw) >= 1 ? apiRaw : 0;
  const r = 6.4, c = 2 * Math.PI * r, ri = 3.4, ci = 2 * Math.PI * ri;
  const label = st ? `${tr("Mức dùng")}: ${Math.round(pct)}%${apiPct > 0 ? ` · ${tf("khóa API chung {pct}%", { pct: Math.round(apiPct) })}` : ""}` : tr("Mức dùng");
  const head = auto ? tr("Mức dùng · Tự động chọn hãng")
    : sub ? `${tr("Giới hạn gói")} · ${sub.name}${sub.plan ? ` ${sub.plan}` : ""}` : `${tr("Giới hạn sử dụng")} · ${trc("Khóa API", "mức dùng")}`;
  return (
    <div className="us-wrap">
      <button className={`us-ring ${level(pct)} ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label={label} data-tip={label} aria-expanded={open}>
        <svg width="18" height="18" viewBox="0 0 16 16"><circle cx="8" cy="8" r={r} fill="none" strokeWidth="1.8" className="bg" /><circle cx="8" cy="8" r={r} fill="none" strokeWidth="1.8" className="fg" strokeDasharray={`${(c * Math.max(pct, 0.01)) / 100} ${c}`} transform="rotate(-90 8 8)" strokeLinecap="round" />{apiPct > 0 && <circle cx="8" cy="8" r={ri} fill="none" strokeWidth="1.6" className={`api ${level(apiPct)}`} strokeDasharray={`${(ci * Math.max(apiPct, 4)) / 100} ${ci}`} transform="rotate(-90 8 8)" strokeLinecap="round" />}</svg>{st && <span className="us-ring-n">{Math.round(pct)}%</span>}
      </button>
      <Menu open={open} role="dialog" className={`us-pop ${up ? "up" : "down"}`}>
        <div className="menu-scroll gl-scroll">
        <div className="us-h"><span>{head}</span><UsageIcon size={15} /></div>
        {!st ? <div className="us-empty"><span className="art-spin sm" /></div> : auto ? (
          <>
            {live.map((v) => <VendorBlock key={v.vendor} v={v} />)}
            {hasApi(st) && limited.length > 0 && <div className="us-v"><div className="us-v-h"><b>{tr("Giới hạn chung của khóa API")}</b></div>{limited.map((l) => <LimitRow key={l.key} l={l} />)}</div>}
            {!live.length && <p className="us-note">{tr("Chưa kết nối hãng AI nào. Đăng nhập gói hoặc thêm khóa API ở Cài đặt → Providers.")}</p>}
          </>
        ) : sub ? (
          <>
            {sub.windows.map((w) => <PlanRow key={w.window} w={w} />)}
            {sub.setup && <p className="us-note">{setupNote(sub)}</p>}
            {!sub.windows.length && !sub.setup && <p className="us-note">{noWindows(sub.cli, "Synchro chưa đọc được hạn mức của gói.")}{sub.turnsToday ? ` ${tf("Hôm nay: {n} tin nhắn.", { n: sub.turnsToday })}` : ""}</p>}
            {sub.credits && <p className="us-note" data-notr>{sub.credits}</p>}
            <p className="us-note">{tr(PLAN_NOTE[sub.cli])}</p>
          </>
        ) : (
          <>
            {st.limits.map((l) => <LimitRow key={l.key} l={l} />)}
            {st.rate && <RateRow r={st.rate} />}
            {st.credit && <CreditBar c={st.credit} />}
          </>
        )}
        {extra}
        {onDetails && <button className="us-more" onClick={() => { setOpen(false); onDetails(); }}>{tr("Xem chi tiết mức dùng")}<I.ChevronR size={13} /></button>}
      </div>
      </Menu>
    </div>
  );
}
