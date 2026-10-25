"use client";
// Mức dùng (giống "Plan usage limits" của Claude, nhưng tính theo chi phí API thật):
// - UsageRing: vòng tròn cạnh bộ chọn model, bấm vào hiện giới hạn phiên 5 giờ, giới hạn tuần và hạn mức API của nhà cung cấp.
// - UsageSettings: trang Cài đặt → Usage (chi tiết 30 ngày theo model, tính năng, ngày).
// - UsageAdmin: quản trị viên đặt hạn mức (USD), hạn mức riêng từng người và bảng giá model.
import { useCallback, useEffect, useState } from "react";
import { Menu } from "./ui";
import { getLang, tr } from "./i18n";
import * as I from "./icons";

export type Limit = { key: "session" | "weekly"; used: number; limit: number | null; pct: number; resetAt: number | null; active: boolean };
export type Rate = { provider: string; limit: number; remaining: number; resetAt: number; pct: number };
export type UsageState = { limits: Limit[]; rate: Rate | null; admin: boolean; plan: string };
const PROVIDER: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };

// ---------------------------------------------------------------- dữ liệu dùng chung
let cache: { key: string; v: UsageState } | null = null;
const listeners = new Set<() => void>();
// Gọi sau mỗi lượt chat / Synchro Code để vòng tròn cập nhật ngay.
export const refreshUsage = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("synchro:usage")); };

export function useUsage(provider?: string) {
  const key = provider ?? "";
  const [st, setSt] = useState<UsageState | null>(cache?.key === key ? cache.v : null);
  const [, tick] = useState(0);
  const load = useCallback(() => {
    fetch(`/api/usage${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j?.limits) { cache = { key, v: j }; setSt(j); listeners.forEach((f) => f()); }
    }).catch(() => {});
  }, [provider, key]);
  useEffect(() => {
    load();
    const on = () => load();
    const vis = () => { if (!document.hidden) load(); };
    window.addEventListener("synchro:usage", on);
    document.addEventListener("visibilitychange", vis);
    const t = setInterval(load, 60_000);
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

// ---------------------------------------------------------------- vòng tròn cạnh bộ chọn model
export function UsageRing({ model, extra, onDetails, up = true }: { model?: string; extra?: React.ReactNode; onDetails?: () => void; up?: boolean }) {
  const provider = model?.includes("/") ? model.split("/")[0] : undefined;
  const st = useUsage(provider);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.(".us-wrap")) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  const limited = st?.limits.filter((l) => l.limit !== null) ?? [];
  const pct = Math.max(0, ...limited.map((l) => l.pct), st?.rate?.pct ?? 0);
  const r = 6.4, c = 2 * Math.PI * r;
  const label = st ? `${en() ? "Usage" : "Mức dùng"}: ${Math.round(pct)}%` : en() ? "Usage" : "Mức dùng";
  return (
    <div className="us-wrap">
      <button className={`us-ring ${level(pct)} ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-label={label} data-tip={label} aria-expanded={open}>
        <svg width="18" height="18" viewBox="0 0 16 16"><circle cx="8" cy="8" r={r} fill="none" strokeWidth="1.8" className="bg" /><circle cx="8" cy="8" r={r} fill="none" strokeWidth="1.8" className="fg" strokeDasharray={`${(c * Math.max(pct, 0.01)) / 100} ${c}`} transform="rotate(-90 8 8)" strokeLinecap="round" /></svg>
      </button>
      <Menu open={open} className={`us-pop ${up ? "up" : "down"}`}>
        <div className="us-h"><span>{en() ? "Usage limits" : "Giới hạn sử dụng"} · API</span><UsageIcon size={15} /></div>
        {!st ? <div className="us-empty"><span className="art-spin sm" /></div> : (
          <>
            {st.limits.map((l) => <LimitRow key={l.key} l={l} />)}
            {st.rate && <RateRow r={st.rate} />}
          </>
        )}
        {extra}
        {onDetails && <button className="us-more" onClick={() => { setOpen(false); onDetails(); }}>{en() ? "View usage details" : "Xem chi tiết mức dùng"}<I.ChevronR size={13} /></button>}
      </Menu>
    </div>
  );
}

// ---------------------------------------------------------------- Cài đặt → Usage
type Details = {
  byModel: { model: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; price: { in: number; out: number; cache: number; src: string } }[];
  byFeature: { feature: string; calls: number; cost: number }[];
  days: { day: number; cost: number; input: number; output: number }[];
};
const FEATURE: Record<string, string> = { chat: "Chat", code: "Synchro Code", artifact: "AI-powered artifacts", internal: "Memory and titles", test: "API key tests" };
// "anthropic/claude-sonnet-5-5" → "Claude Sonnet 5.5", "openai/gpt-6-astra" → "GPT-6 Astra", "google/gemini-3.8-flash" → "Gemini 3.8 Flash".
const modelName = (k: string) => {
  const id = k.split("/").slice(1).join("/");
  if (id.startsWith("gpt-")) return "GPT-" + id.slice(4).split("-").map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  return id.replace(/-(\d+)-(\d+)$/, " $1.$2").split("-").map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
};

export function UsageSettings({ go }: { go?: (t: string) => void }) {
  const st = useUsage();
  const [d, setD] = useState<Details | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const load = () => fetch(`/api/usage/details?tz=${new Date().getTimezoneOffset()}`, { cache: "no-store" }).then((r) => r.json()).then(setD).catch(() => {});
    load();
    window.addEventListener("synchro:usage", load);
    return () => window.removeEventListener("synchro:usage", load);
  }, []);
  const total = d?.days.reduce((a, x) => a + x.cost, 0) ?? 0;
  const tokIn = d?.byModel.reduce((a, m) => a + m.input + m.cacheRead + m.cacheWrite, 0) ?? 0;
  const tokOut = d?.byModel.reduce((a, m) => a + m.output, 0) ?? 0;
  const cached = d?.byModel.reduce((a, m) => a + m.cacheRead, 0) ?? 0;
  const max = Math.max(...(d?.days.map((x) => x.cost) ?? [0]), 0.0001);
  const top = d?.byModel[0]?.cost || 1;
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Usage limits</h3>
      <p className="d" style={{ margin: "-4px 0 14px" }}>Synchro uses AI models through their APIs, so usage is measured in real API cost: the tokens each model reads and writes, at that model&apos;s price.</p>
      <div className="us-card">
        {!st ? <div className="us-empty"><span className="art-spin sm" /></div> : st.limits.map((l) => (
          <div key={l.key} className="us-big">
            <div className="us-big-t"><b>{l.key === "session" ? "Current session" : "Weekly · all models"}</b><span>{l.key === "session" ? "Starts with your first message and lasts 5 hours." : "Resets at the same time every week."}</span></div>
            <div className="us-big-v">{l.limit === null ? <><b>{money(l.used)}</b><span>No limit</span></> : <><b>{Math.round(l.pct)}%</b><span>{money(l.used)} of {money(l.limit)}</span></>}</div>
            <Bar pct={l.pct} unlimited={l.limit === null} />
            <div className="us-big-r">{resetText(l.resetAt, l.active)}</div>
          </div>
        ))}
      </div>
      {st?.rate && <div className="us-card"><RateRow r={st.rate} /><p className="d" style={{ margin: "8px 0 0" }}>Rate limit reported by the provider for the whole Synchro server. When it runs out, replies wait until it resets.</p></div>}

      <h3 className="sec">Last 30 days</h3>
      <div className="us-stats">
        <div><b>{money(total)}</b><span>API cost</span></div>
        <div><b>{kTok(tokIn)}</b><span>Input tokens</span></div>
        <div><b>{kTok(tokOut)}</b><span>Output tokens</span></div>
        <div><b>{tokIn ? Math.round((cached / tokIn) * 100) : 0}%</b><span>Read from cache</span></div>
      </div>
      <div className="us-card us-chart" onMouseLeave={() => setHover(null)}>
        <div className="us-chart-h"><b>Daily cost</b><span>{hover !== null && d ? `${new Date(d.days[hover].day).toLocaleDateString(getLang() === "en" ? "en-US" : "vi-VN", { day: "numeric", month: "short" })} · ${money(d.days[hover].cost)} · ${kTok(d.days[hover].input + d.days[hover].output)} token` : "Hover a day for details"}</span></div>
        <div className="us-cols">{(d?.days ?? Array.from({ length: 30 }, () => ({ cost: 0 }))).map((x, i) => <div key={i} className={`us-col ${hover === i ? "on" : ""}`} onMouseEnter={() => setHover(i)}><i style={{ height: `${x.cost ? Math.max(4, (x.cost / max) * 100) : 0}%` }} /></div>)}</div>
        <div className="us-axis"><span>30 days ago</span><span>Today</span></div>
      </div>

      <h3 className="sec">By model</h3>
      {!d?.byModel.length ? <p className="d">No usage yet. Start a chat and it shows up here.</p> : (
        <div className="us-card us-list">
          {d.byModel.map((m) => (
            <div key={m.model} className="us-li">
              <div className="us-li-t"><b data-notr>{modelName(m.model)}</b><span>{en() ? `${m.calls.toLocaleString()} calls · ${kTok(m.input + m.cacheRead + m.cacheWrite)} in · ${kTok(m.output)} out · $${m.price.in} / $${m.price.out} per 1M tokens${m.price.src === "estimate" ? " (estimated price)" : ""}` : `${m.calls.toLocaleString("vi-VN")} lần gọi · vào ${kTok(m.input + m.cacheRead + m.cacheWrite)} · ra ${kTok(m.output)} · $${m.price.in} / $${m.price.out} mỗi 1 triệu token${m.price.src === "estimate" ? " (giá ước tính)" : ""}`}</span></div>
              <em>{money(m.cost)}</em>
              <div className="us-li-bar"><i style={{ width: `${(m.cost / top) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
      {!!d?.byFeature.length && (
        <>
          <h3 className="sec">By feature</h3>
          <div className="us-card us-list">{d.byFeature.map((f) => <div key={f.feature} className="us-li"><div className="us-li-t"><b>{FEATURE[f.feature] ?? f.feature}</b><span>{en() ? `${f.calls.toLocaleString()} calls` : `${f.calls.toLocaleString("vi-VN")} lần gọi`}</span></div><em>{money(f.cost)}</em></div>)}</div>
        </>
      )}
      <p className="d" style={{ marginTop: 16 }}>Cost is estimated from each provider&apos;s list price, including cache reads and writes. Your provider&apos;s invoice is the final amount.{st?.admin && go && <> Administrators can change limits and prices in <a className="lnk" role="button" tabIndex={0} onClick={() => go("Administrator")}>Administrator → Usage limits</a>.</>}</p>
    </>
  );
}

// ---------------------------------------------------------------- Quản trị viên → Usage limits
type AdminData = {
  config: { session: number | null; weekly: number | null; admins: boolean; prices: Record<string, { in: number; out: number; cache: number }> };
  users: { id: string; email: string; name: string; admin: boolean; override: { session?: number | null; weekly?: number | null }; limits: Limit[]; month: { cost: number; input: number; output: number }; effective: { session: number | null; weekly: number | null } }[];
  prices: { model: string; in: number; out: number; cache: number; src: "official" | "estimate" | "custom" }[];
};
async function adm(method: string, body?: unknown): Promise<AdminData> {
  const r = await fetch("/api/admin/usage", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// Ô nhập hạn mức USD; để trống = không giới hạn.
function Money({ value, onSave, placeholder = "No limit" }: { value: number | null | undefined; onSave: (v: number | null) => void; placeholder?: string }) {
  const [v, setV] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => { setV(value === null || value === undefined ? "" : String(value)); }, [value]);
  const save = () => { const n = v.trim() === "" ? null : Number(v.replace(",", ".")); if (n === null || (isFinite(n) && n >= 0)) { if (n !== (value ?? null)) onSave(n); } else setV(value == null ? "" : String(value)); };
  return <span className="us-money"><i>$</i><input inputMode="decimal" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /></span>;
}

export function UsageAdmin({ say, Toggle }: { say: (m: string) => void; Toggle: (p: { on: boolean; set: (v: boolean) => void }) => React.ReactElement }) {
  const [d, setD] = useState<AdminData | null>(null);
  const [showPrices, setShowPrices] = useState(false);
  useEffect(() => { adm("GET").then(setD).catch((e) => say(e.message)); }, [say]);
  const patch = (body: unknown, ok: string) => adm("PATCH", body).then((x) => { setD(x); say(ok); refreshUsage(); }).catch((e) => say(e.message));
  if (!d) return <div className="muted" style={{ fontSize: 12 }}>Loading…</div>;
  const c = d.config;
  return (
    <div className="adm-card">
      <div className="adm-card-h"><b>Default limits</b><span className="d">API cost each person can use. Leave empty for no limit. When a limit is reached, chats pause until it resets.</span></div>
      <div className="adm-perm-row"><div><div className="t">Per session (5 hours)</div><div className="d">Starts with a person&apos;s first message.</div></div><Money value={c.session} onSave={(v) => patch({ config: { session: v } }, "Session limit saved")} /></div>
      <div className="adm-perm-row"><div><div className="t">Per week</div><div className="d">Resets at the same time every week.</div></div><Money value={c.weekly} onSave={(v) => patch({ config: { weekly: v } }, "Weekly limit saved")} /></div>
      <div className="adm-perm-row"><div><div className="t">Apply to administrators</div><div className="d">Off: administrators have no limit unless you set one for them below.</div></div><Toggle on={c.admins} set={(v) => patch({ config: { admins: v } }, v ? "Limits now apply to administrators" : "Administrators have no limit")} /></div>

      <div className="adm-card-h" style={{ marginTop: 14 }}><b>People</b><span className="d">Cost in the last 30 days and limits for each account. A custom limit replaces the default.</span></div>
      <div className="us-ppl">
        {d.users.map((u) => {
          const s = u.limits.find((l) => l.key === "session")!, w = u.limits.find((l) => l.key === "weekly")!;
          return (
            <div key={u.id} className="us-p">
              <div className="us-p-t"><b data-notr>{u.name || u.email}</b><span data-notr>{u.email}{u.admin ? " · admin" : ""}</span></div>
              <div className="us-p-m"><span>{money(u.month.cost)}</span><small>30 days</small></div>
              <div className="us-p-l"><small>Session {u.effective.session === null ? "∞" : `${Math.round(s.pct)}%`}</small><Money value={"session" in u.override ? u.override.session : undefined} placeholder={u.effective.session === null ? "Default: none" : `Default: $${u.effective.session}`} onSave={(v) => patch({ user: u.id, override: { ...u.override, session: v } }, "Limit saved")} /></div>
              <div className="us-p-l"><small>Week {u.effective.weekly === null ? "∞" : `${Math.round(w.pct)}%`}</small><Money value={"weekly" in u.override ? u.override.weekly : undefined} placeholder={u.effective.weekly === null ? "Default: none" : `Default: $${u.effective.weekly}`} onSave={(v) => patch({ user: u.id, override: { ...u.override, weekly: v } }, "Limit saved")} /></div>
              {Object.keys(u.override).length > 0 && <button className="icon-btn" aria-label="Use default limits" data-tip="Use default limits" onClick={() => patch({ user: u.id, override: null }, "Using default limits")}><I.Retry size={14} /></button>}
            </div>
          );
        })}
      </div>

      <div className="adm-card-h" style={{ marginTop: 14, cursor: "pointer" }} onClick={() => setShowPrices(!showPrices)}><b>Model prices {showPrices ? "▴" : "▾"}</b><span className="d">USD per 1 million tokens, used to turn tokens into cost. Claude prices are official; others are estimates you should check against each provider&apos;s pricing page.</span></div>
      {showPrices && (
        <div className="us-prices">
          <div className="us-pr h"><span>Model</span><span>Input</span><span>Output</span><span>Cache read</span><span /></div>
          {d.prices.map((p) => (
            <div key={p.model} className="us-pr">
              <span data-notr>{modelName(p.model)} <i className={`us-src ${p.src}`}>{p.src === "official" ? "Official" : p.src === "custom" ? "Custom" : "Estimate"}</i></span>
              {(["in", "out", "cache"] as const).map((k) => <Money key={k} value={p[k]} placeholder="" onSave={(v) => v !== null && patch({ config: { prices: { [p.model]: { in: p.in, out: p.out, cache: p.cache, [k]: v } } } }, "Price saved")} />)}
              {p.src === "custom" ? <button className="icon-btn" aria-label="Reset price" data-tip="Reset price" onClick={() => patch({ config: { prices: { [p.model]: null } } }, "Price reset")}><I.Retry size={14} /></button> : <span />}
            </div>
          ))}
        </div>
      )}
      <p className="d" style={{ marginTop: 10 }}>{tr("Synchro tính chi phí từ số token thật mà nhà cung cấp trả về sau mỗi lần gọi model.")}</p>
    </div>
  );
}
