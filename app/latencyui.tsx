"use client";

// Cài đặt → Sức khỏe hệ thống → Độ trễ từng chặng (app/tracing.ts): bảng gọn p50 / p95 của từng chặng một lượt chat, lọc theo hãng và khoảng thời gian.
import { useState } from "react";
import { fmtDate } from "./adminui";
import { getLang, locale } from "./i18n";

type Row = { stage: string; provider: string; n: number; p50: number | null; p95: number | null };
export type Latency = { stages: string[]; turns: number; recent: Row[]; daily: Row[]; week: Row[]; last: { at: number; provider: string | null; model: string | null; status: number | null; totalMs: number; slowest: [string, number] | null }[] };
const STAGE: Record<string, string> = {
  auth: "Sign-in check", queue: "Waiting for a slot", history: "History and files", retrieval: "Skills and brain", routing: "Auto model choice",
  prompt: "Building the prompt", provider_ttfb: "Provider first byte", first_token: "First words on screen", tool: "Each tool run", total: "Whole reply",
};
const L = (vi: string, en: string) => (getLang() === "vi" ? vi : en);
const PLAN: Record<string, string> = { "sub-claude": "Claude", "sub-codex": "ChatGPT", "sub-agy": "Gemini", "sub-grok": "Grok" };
const API: Record<string, string> = { anthropic: "Claude", openai: "OpenAI", google: "Gemini", xai: "Grok", deepseek: "DeepSeek" };
const provName = (p: string) => (PLAN[p] ? `${L("Gói", "Plan")} ${PLAN[p]}` : API[p] ? `${API[p]} API` : p);
const ms = (v: number | null) => (v === null ? "—" : v < 1000 ? `${v.toLocaleString(locale())} ms` : `${(v / 1000).toLocaleString(locale(), { maximumFractionDigits: v < 10_000 ? 2 : 1 })} s`);
const PERIODS = { recent: "Last 500 replies", daily: "Today", week: "7 days" } as const;

export function LatencyTable({ data }: { data: Latency }) {
  const [period, setPeriod] = useState<keyof typeof PERIODS>("recent");
  const [prov, setProv] = useState("all");
  const rows = data[period];
  const provs = ["all", ...new Set(rows.map((r) => r.provider).filter((p) => p !== "all" && p !== "none"))];
  const pick = provs.includes(prov) ? prov : "all";
  const byStage = new Map(rows.filter((r) => r.provider === pick).map((r) => [r.stage, r]));
  const slow = (r?: Row) => !!r && r.p95 !== null && ((r.stage === "first_token" && r.p95 > 8000) || (r.stage === "provider_ttfb" && r.p95 > 6000) || (["auth", "history", "routing", "queue"].includes(r.stage) && r.p95 > 1500));
  return <>
    <div className="lat-bar">
      <div className="group" role="group" aria-label="Period">{(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((k) => <button key={k} className={period === k ? "on" : ""} aria-pressed={period === k} onClick={() => setPeriod(k)}>{PERIODS[k]}</button>)}</div>
      <span className="api-sel lat-sel"><select aria-label="Provider" value={pick} onChange={(e) => setProv(e.target.value)} data-notr>{provs.map((p) => <option key={p} value={p}>{p === "all" ? L("Mọi hãng", "All providers") : provName(p)}</option>)}</select></span>
    </div>
    {!byStage.size ? <div className="d" style={{ padding: "8px 0" }}>No replies measured in this period yet.</div> : (
      <div className="lat-wrap"><table className="tbl lat-tbl">
        <thead><tr><th>Stage</th><th className="num">Count</th><th className="num">p50</th><th className="num">p95</th></tr></thead>
        <tbody>{data.stages.filter((s) => byStage.has(s)).map((s) => { const r = byStage.get(s)!; return (
          <tr key={s} className={s === "total" ? "lat-total" : ""}><td>{STAGE[s] ?? s}</td><td className="num" data-notr>{r.n.toLocaleString(locale())}</td><td className="num" data-notr>{ms(r.p50)}</td><td className={`num${slow(r) ? " lat-slow" : ""}`} data-notr>{ms(r.p95)}</td></tr>
        ); })}</tbody>
      </table></div>
    )}
    {data.last.length > 0 && <details className="lat-last"><summary>Latest replies</summary>
      {data.last.map((t, i) => <div key={i} className="adm-log"><span className="tm" data-notr>{fmtDate(t.at)}</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }} data-notr>{`${t.model ?? "—"} · ${ms(t.totalMs)}${t.slowest ? ` · ${L("chậm nhất", "slowest")}: ${L(...({ auth: ["kiểm tra phiên", "sign-in check"], queue: ["chờ chỗ chạy", "waiting"], history: ["lịch sử", "history"], retrieval: ["skill, bộ não", "skills, brain"], routing: ["chọn model", "model choice"], prompt: ["dựng lời nhắc", "prompt"], provider_ttfb: ["hãng trả byte đầu", "provider first byte"], tool: ["công cụ", "tool"] } as Record<string, [string, string]>)[t.slowest[0]] ?? [t.slowest[0], t.slowest[0]])} ${ms(t.slowest[1])}` : ""}${t.status && t.status >= 400 ? ` · ${t.status}` : ""}`}</span><span /></div>)}
    </details>}
  </>;
}
