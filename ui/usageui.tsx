"use client";
import "../app/settings.css";
// Mức dùng (giống "Plan usage limits" của Claude, nhưng tính theo chi phí API thật):
// - UsageRing (usagering.tsx): vòng tròn cạnh bộ chọn model; tách riêng để trang chủ không phải tải phần dưới đây (blueprint B3.1).
// - UsageSettings: trang Cài đặt → Usage (chi tiết 30 ngày theo model, tính năng, ngày).
// - UsageAdmin: quản trị viên đặt hạn mức (USD), hạn mức riêng từng người và bảng giá model.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./apierr";
import { rowKeys } from "./a11y";
import { isEn, locale, tf, tr, trc } from "../app/i18n";
import * as I from "./icons";
import { PageBar, usePage } from "./pager";
import { BrandLogo, ModelLogo } from "./brands";
import { vendorOf } from "../app/vendor";
import { Bar, CreditBar, ModeTag, PLAN_NOTE, PlanRow, RateRow, VENDOR_COLOR, hasApi, kTok, money, noWindows, refreshUsage, resetText, useUsage, type Limit, type SubUsage, type VendorUsage } from "./usagering";
export * from "./usagering";

// ---------------------------------------------------------------- Cài đặt → Usage
type Details = {
  byModel: { model: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; price: { in: number; out: number; cache: number; src: string } }[];
  byPlan: { model: string; cli: SubUsage["cli"]; name: string; turns: number; last: number }[];
  byFeature: { feature: string; calls: number; cost: number }[];
  days: { day: number; cost: number; input: number; output: number; calls: Partial<Record<VendorUsage["vendor"] | "other", number>> }[];
};
const FEATURE: Record<string, string> = { chat: "Chat", code: "Synchro Code", artifact: "Artifact có AI", internal: "Bộ nhớ và đặt tên đoạn chat", test: "Thử khóa API", embed: "Tìm kiếm theo nghĩa (bộ não, tài liệu)", "brain-rerank": "Xếp lại kết quả gọi lại" };
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
const num = (n: number) => n.toLocaleString(locale());

/** Thẻ của một hãng trong Cài đặt → Usage: cách đang chạy, hạn mức của gói hoặc của khóa API, số lượt 30 ngày. */
function VendorCard({ v, turns, cost, go }: { v: VendorUsage; turns: number; cost: number; go?: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const wins = v.sub?.windows ?? [];
  return (
    <div className={`us-card us-vc ${v.mode}`}>
      <div className="us-vc-h">
        <span className="us-vc-logo" data-notr><BrandLogo id={v.vendor} size={18} /></span>
        <div className="us-vc-t"><b data-notr>{v.name}</b><span>{v.mode === "plan" ? tr("Chạy bằng gói bạn đã đăng nhập; hạn mức do hãng báo về.")
          : v.mode === "api" ? tr("Chạy bằng khóa API; tính theo chi phí token thật.") : tr("Chưa đăng nhập gói hay thêm khóa API.")}</span></div>
        <ModeTag v={v} />
        {v.mode === "plan" && <button className="icon-btn" aria-label={tr("Đọc lại hạn mức")} data-tip={tr("Đọc lại hạn mức")} disabled={busy}
          onClick={() => { setBusy(true); refreshUsage(true); setTimeout(() => setBusy(false), 2500); }}>{busy ? <span className="art-spin sm" /> : <I.Retry size={14} />}</button>}
      </div>
      {v.mode === "plan" && (wins.length ? wins.map((w) => <PlanRow key={w.window} w={w} />)
        : <p className="us-note">{v.sub?.setup ? tr("Antigravity đang chờ bạn hoàn tất bước làm quen lần đầu (Cài đặt → Providers → Gemini).") : v.cli === "agy" || v.cli === "grok" ? noWindows(v.cli, "Synchro chưa đọc được hạn mức của gói này. Bấm nút đọc lại ở góc thẻ để thử lại.") : tr("Gửi một tin nhắn bằng gói này để Synchro đọc hạn mức.")}</p>)}
      {v.mode === "api" && <>
        {v.rate && <RateRow r={v.rate} />}
        {v.credit && <CreditBar c={v.credit} />}
        {v.usingApiUntil && <p className="us-note">{tf("Gói tạm hết hạn mức nên bạn đã chọn dùng khóa API tới {at}; sau đó Synchro tự quay lại gói.", { at: new Date(v.usingApiUntil).toLocaleString(locale(), isEn() ? { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric" }) })}</p>}
      </>}
      {v.mode === "none" ? (
        go && <button className="btn us-vc-go" onClick={() => go("Providers")}>{tr("Kết nối ở Providers")}<I.ChevronR size={13} /></button>
      ) : (
        <div className="us-vc-f">
          {v.mode === "plan" && v.sub && <span>{tf("Hôm nay: {n} tin nhắn", { n: num(v.sub.turnsToday) })}</span>}
          <span>{tf("30 ngày: {n} lượt", { n: num(turns) })}</span>
          {v.mode === "api" && <span>{tf("Chi phí 30 ngày: {cost}", { cost: money(cost) })}</span>}
        </div>
      )}
      {v.mode === "plan" && v.sub && <p className="us-note">{tr(PLAN_NOTE[v.sub.cli])}</p>}
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
  const fmtDay = (t: number) => new Date(t).toLocaleDateString(locale(), { day: "numeric", month: "short" });
  return (
    <div className="us-card us-chart" onMouseLeave={() => setHover(null)}>
      <div className="us-chart-h">
        <b>{tr("Lượt dùng model mỗi ngày")}</b>
        <span>{h ? <>{fmtDay(h.day)} · {SERIES.filter(([k]) => h.calls[k]).map(([k, n]) => `${k === "other" ? tr("Khác") : n} ${h.calls[k]}`).join(" · ") || tr("không có lượt nào")}{cost && h.cost ? ` · ${money(h.cost)}` : ""}</> : tr("Rê chuột vào một ngày để xem chi tiết")}</span>
      </div>
      <div className="us-cols" role="img" aria-label={tr("Biểu đồ lượt dùng model 30 ngày qua theo hãng")}>
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
      <div className="us-axis"><span>{tr("30 ngày trước")}</span><span>{tr("Hôm nay")}</span></div>
      {used.length > 0 && <div className="us-legend">{used.map(([k, n]) => <span key={k}><i style={{ background: VENDOR_COLOR[k] }} />{k === "other" ? tr("Khác") : n} <em>{num(days.reduce((a, x) => a + (x.calls[k] ?? 0), 0))}</em></span>)}</div>}
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
  const stats: [string, string][] = [[num(calls), tr("Lượt dùng model")]];
  if (planNow) stats.push([num(planTurns), tr("Qua gói subscription")], [num(today), tr("Tin nhắn hôm nay qua gói")]);
  if (apiNow) stats.push([money(total), tr("Chi phí khóa API")], [kTok(tokIn + tokOut), tr("Token qua khóa API")]);
  const apiRows = (d?.byModel ?? []).map((m) => {
    const vc = VENDOR_COLOR[vendorKey(m.model)];
    return (
      <div key={m.model} className="us-li">
        <div className="us-li-t"><b data-notr><i className="us-dot" style={{ background: vc }} /><ModelLogo k={m.model} size={14} className="us-ml" />{modelName(m.model)}</b><span>{tf("Khóa API · {n} lần gọi · vào {in} · ra {out} · ${pin} / ${pout} mỗi 1 triệu token", { n: num(m.calls), in: kTok(m.input + m.cacheRead + m.cacheWrite), out: kTok(m.output), pin: m.price.in, pout: m.price.out })}{m.price.src === "estimate" ? ` ${tr("(giá ước tính)")}` : ""}</span></div>
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
  const lead = !st ? "" : planNow && apiNow ? tr("Hãng chạy bằng gói hiện hạn mức của gói (phiên 5 giờ, hằng tuần); hãng chạy bằng khóa API hiện chi phí và hạn mức của khóa.")
    : planNow ? tr("Các hãng đang chạy bằng gói subscription bạn đã đăng nhập, nên mức dùng hiện theo hạn mức của gói (phiên 5 giờ, hằng tuần) do hãng báo về.")
    : apiNow ? tr("Các hãng đang chạy bằng khóa API, nên mức dùng tính theo chi phí token thật và hạn mức chi phí của Synchro.")
    : tr("Chưa có hãng nào được kết nối.");
  return (
    <div className="us-page">
      <h3 style={{ marginTop: 0 }}>{tr("Mức dùng")}</h3>
      <p className="d" style={{ margin: "-4px 0 14px" }}>{tr("Synchro tự nhận ra mỗi hãng đang chạy bằng gói subscription hay khóa API và hiện mức dùng theo đúng cách đó.")} {lead}</p>
      {!st ? <div className="us-card"><div className="us-empty"><span className="art-spin sm" /></div></div>
        : <div className="us-vgrid">{vendors.map((v) => <VendorCard key={v.vendor} v={v} turns={callsOf(v.vendor)} cost={costOf(v)} go={go} />)}</div>}

      {st && apiNow && (
        <>
          <h3 className="sec">{tr("Giới hạn chi phí khóa API")}</h3>
          <div className="us-card">
            {st.limits.map((l) => (
              <div key={l.key} className="us-big">
                <div className="us-big-t"><b>{l.key === "session" ? tr("Phiên hiện tại") : tr("Hằng tuần · mọi model")}</b><span>{l.key === "session" ? tr("Bắt đầu từ tin nhắn đầu tiên, kéo dài 5 giờ. Chỉ tính các lượt chạy bằng khóa API.") : tr("Đặt lại vào cùng giờ mỗi tuần.")}</span></div>
                <div className="us-big-v">{l.limit === null ? <><b>{money(l.used)}</b><span>{tr("Không giới hạn")}</span></> : <><b>{Math.round(l.pct)}%</b><span>{tf("{used} trên {limit}", { used: money(l.used), limit: money(l.limit) })}</span></>}</div>
                <Bar pct={l.pct} unlimited={l.limit === null} />
                <div className="us-big-r">{resetText(l.resetAt, l.active)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="sec">{tr("30 ngày qua")}</h3>
      {dErr && !d && <div className="err-box sm" role="alert"><b>{tr("Chưa tải được số liệu mức dùng")}</b><button className="btn" onClick={() => void loadD()}>{tr("Thử lại")}</button></div>}
      {/* Tải lỗi: không hiện số 0 dưới dòng báo lỗi, trông như chưa dùng gì. */}
      {!(dErr && !d) && <div className="us-stats" style={{ "--n": Math.min(stats.length, 4) } as React.CSSProperties}>{stats.slice(0, 4).map(([v, t]) => <div key={t}><b>{v}</b><span>{t}</span></div>)}</div>}
      {!(dErr && !d) && <DailyChart d={d} cost={apiNow} />}

      <h3 className="sec">{trc("Theo model", "mức dùng")}</h3>
      {!d ? null : !d.byPlan.length && !(apiNow && d.byModel.length) ? <p className="d">{tr("Chưa có lượt dùng nào. Bắt đầu một đoạn chat là số liệu hiện ở đây.")}</p> : (
        <div className="us-card us-list">
          {pgM.items.map((x) => x.kind === "plan" ? ((m) => (
            <div key={m.model} className="us-li">
              <div className="us-li-t"><b data-notr><i className="us-dot" style={{ background: VENDOR_COLOR[CLI_VENDOR[m.cli]] }} />{m.model.endsWith("/") ? tf("{name} (lượt cũ, chưa ghi tên model)", { name: m.name }) : m.name}</b><span>{tf("Gói {plan} · {n} lượt", { plan: SUB_NAME[m.cli], n: num(m.turns) })}</span></div>
              <em className="us-incl">{trc("Trong gói", "mức dùng")}</em>
              <div className="us-li-bar"><i style={{ width: `${(m.turns / topTurns) * 100}%`, background: VENDOR_COLOR[CLI_VENDOR[m.cli]] }} /></div>
            </div>
          ))(x.m) : x.row)}
        </div>
      )}
      <PageBar pg={pgM} />
      {!apiNow && !!d?.byModel.length && (
        <div className="us-old">
          <button className="us-old-b" aria-expanded={oldApi} onClick={() => setOldApi(!oldApi)}>{tf("Khóa API dùng trước đây: {n} lần gọi · {cost}", { n: num(d.byModel.reduce((a, m) => a + m.calls, 0)), cost: money(total) })}<I.Chevron size={12} /></button>
          {oldApi && <div className="us-card us-list">{apiRows}</div>}
        </div>
      )}
      {apiNow && !!d?.byFeature.length && (
        <>
          <h3 className="sec">{tr("Khóa API theo tính năng")}</h3>
          <div className="us-card us-list">{d.byFeature.map((f) => <div key={f.feature} className="us-li"><div className="us-li-t"><b>{FEATURE[f.feature] ? tr(FEATURE[f.feature]) : f.feature}</b><span>{tf("{n} lần gọi", { n: num(f.calls) })}</span></div><em>{money(f.cost)}</em></div>)}</div>
        </>
      )}
      <p className="d" style={{ marginTop: 16 }}>
        {planNow && tr("Gói subscription tính theo hạn mức hãng báo về; hãng không báo số token của gói nên Synchro đếm theo lượt. ")}
        {apiNow && tr("Khóa API tính theo giá niêm yết của từng hãng, gồm cả đọc và ghi cache; hóa đơn của hãng là số cuối cùng.")}
        {st?.admin && go && apiNow && <> {tr("Quản trị viên đổi hạn mức và bảng giá ở")} <a className="lnk" role="button" tabIndex={0} onClick={() => go("Administrator")} onKeyDown={rowKeys(() => go("Administrator"))}>{tr("Quản trị → Hạn mức sử dụng")}</a>.</>}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Quản trị viên → Usage limits
type AdminData = { apiKeys?: boolean; owner?: boolean;
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
function Money({ value, onSave, placeholder = "No limit", label, disabled }: { value: number | null | undefined; onSave: (v: number | null) => void; placeholder?: string; label: string; disabled?: boolean }) {
  const [v, setV] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => { setV(value === null || value === undefined ? "" : String(value)); }, [value]);
  const save = () => { const n = v.trim() === "" ? null : Number(v.replace(",", ".")); if (n === null || (isFinite(n) && n >= 0)) { if (n !== (value ?? null)) onSave(n); } else setV(value == null ? "" : String(value)); };
  return <span className={`us-money ${disabled ? "off" : ""}`}><i>$</i><input inputMode="decimal" aria-label={label} disabled={disabled} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /></span>;
}

export function UsageAdmin({ say, Toggle }: { say: (m: string) => void; Toggle: (p: { on: boolean; set: (v: boolean) => void; label?: string; disabled?: boolean }) => React.ReactElement }) {
  const [d, setD] = useState<AdminData | null>(null);
  const [showPrices, setShowPrices] = useState(false);
  const [pq, setPq] = useState("");
  const pql = pq.trim().toLowerCase();
  const people = (d?.users ?? []).filter((u) => !pql || `${u.name} ${u.email}`.toLowerCase().includes(pql));
  const pgP = usePage(people, 10, pql);
  const pgPr = usePage(d?.prices ?? [], 12);
  useEffect(() => { adm("GET").then(setD).catch((e) => say(e.message)); }, [say]);
  const patch = (body: unknown, ok: string) => adm("PATCH", body).then((x) => { setD(x); say(ok); refreshUsage(); }).catch((e) => say(e.message));
  if (!d) return <div className="muted" style={{ fontSize: "var(--fs-1)" }}>Loading…</div>;
  // Mọi người chạy bằng gói của chính họ: hạn mức đô la không áp vào đâu, hiện ra chỉ làm quản trị viên tưởng đã giới hạn được.
  if (d.apiKeys === false) return <div className="adm-card"><div className="adm-card-h"><b>Limits come from each person&apos;s AI plan</b><span className="d">Everyone here runs models through the plan they signed in with, so each vendor&apos;s plan limits apply and Synchro has no cost to cap. Spending limits appear here if you add a shared API key in Settings → Providers. To stop someone using a model, change their access below.</span></div></div>;
  const c = d.config;
  // Bảng giá, "áp cho quản trị viên" và hạn mức riêng của quản trị viên: chỉ chủ sở hữu (Owner) đổi được (máy chủ cũng tự chặn).
  const owner = d.owner !== false;
  return (
    <div className="adm-card">
      {!owner && <p className="api-own top"><I.Lock size={13} /><span>{c.admins ? "Limits apply to administrators, including the Owner, so only the Owner can change the default limits. Only the Owner can also change model prices, whether limits apply to administrators, and limits on administrator accounts." : "Only the Owner can change model prices, whether limits apply to administrators, and limits on administrator accounts."}</span></p>}
      <div className="adm-card-h"><b>Default limits</b><span className="d">API cost each person can use. Leave empty for no limit. When a limit is reached, chats pause until it resets.</span></div>
      <div className="adm-perm-row"><div><div className="t">Per session (5 hours)</div><div className="d">Starts with a person&apos;s first message.</div></div><Money label="Per session (5 hours)" disabled={!owner && c.admins} value={c.session} onSave={(v) => patch({ config: { session: v } }, "Session limit saved")} /></div>
      <div className="adm-perm-row"><div><div className="t">Per week</div><div className="d">Resets at the same time every week.</div></div><Money label="Per week" disabled={!owner && c.admins} value={c.weekly} onSave={(v) => patch({ config: { weekly: v } }, "Weekly limit saved")} /></div>
      <div className="adm-perm-row"><div><div className="t">Apply to administrators</div><div className="d">Off: administrators have no limit unless you set one for them below.</div></div><Toggle on={c.admins} disabled={!owner} label="Apply to administrators" set={(v) => owner && patch({ config: { admins: v } }, v ? "Limits now apply to administrators" : "Administrators have no limit")} /></div>

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
              <div className="us-p-l"><small>Session {u.effective.session === null ? "∞" : `${Math.round(s.pct)}%`}</small><Money label="Session" disabled={u.admin && !owner} value={"session" in u.override ? u.override.session : undefined} placeholder={u.effective.session === null ? "Default: none" : `Default: $${u.effective.session}`} onSave={(v) => patch({ user: u.id, override: { ...u.override, session: v } }, "Limit saved")} /></div>
              <div className="us-p-l"><small>Week {u.effective.weekly === null ? "∞" : `${Math.round(w.pct)}%`}</small><Money label="Week" disabled={u.admin && !owner} value={"weekly" in u.override ? u.override.weekly : undefined} placeholder={u.effective.weekly === null ? "Default: none" : `Default: $${u.effective.weekly}`} onSave={(v) => patch({ user: u.id, override: { ...u.override, weekly: v } }, "Limit saved")} /></div>
              {Object.keys(u.override).length > 0 && (owner || !u.admin) && <button className="icon-btn" aria-label="Use default limits" data-tip="Use default limits" onClick={() => patch({ user: u.id, override: null }, "Using default limits")}><I.Retry size={14} /></button>}
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
              <span data-notr><ModelLogo k={p.model} size={14} className="us-ml" />{modelName(p.model)} <i className={`us-src ${p.src}`}>{p.src === "official" ? "Official" : p.src === "custom" ? "Custom" : "Estimate"}</i></span>
              {(["in", "out", "cache"] as const).map((k) => <Money key={k} disabled={!owner} label={{ in: "Input", out: "Output", cache: "Cache read" }[k]} value={p[k]} placeholder="" onSave={(v) => v !== null && patch({ config: { prices: { [p.model]: { in: p.in, out: p.out, cache: p.cache, [k]: v } } } }, "Price saved")} />)}
              {p.src === "custom" && owner ? <button className="icon-btn" aria-label="Reset price" data-tip="Reset price" onClick={() => patch({ config: { prices: { [p.model]: null } } }, "Price reset")}><I.Retry size={14} /></button> : <span />}
            </div>
          ))}
        </div>
      )}
      {showPrices && <PageBar pg={pgPr} />}
      <p className="d" style={{ marginTop: 10 }}>{tr("Synchro tính chi phí từ số token thật mà nhà cung cấp trả về sau mỗi lần gọi model.")}</p>
    </div>
  );
}
