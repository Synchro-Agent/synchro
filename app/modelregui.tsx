"use client";
import "./settings.css";
// Cài đặt → Providers → New models (chỉ quản trị viên): sổ model Synchro tự dò khi hãng ra mắt model mới (server/modelreg.ts).
// Xem model mới thấy, kết quả thử tự động, trạng thái; bật / tắt tự nhận model mới (cả máy chủ hoặc từng hãng); ghim / ẩn / dùng ngay / thử lại; "Check now".
import { useEffect, useMemo, useState } from "react";
import * as I from "./icons";
import { useApp } from "./store";
import { call, ago, fmtDate } from "./adminui";
import { refreshModels } from "./models";
import { ModelLogo } from "./brands";

type Step = { name: "text" | "tool" | "image"; ok: boolean; note?: string };
type Test = { at: number; ok: boolean; ms: number; steps: Step[]; error?: string };
type RegModel = {
  key: string; provider: string; id: string; name: string; family: string; version: string; tier: string; created: number | null; firstSeen: number; lastSeen: number;
  status: "new" | "testing" | "active" | "deprecated" | "retired"; baseline: boolean; isNew: boolean; shown: boolean; pinned: boolean; hidden: boolean; plan: boolean;
  test: Test | null; attempts: number; nextTest: number | null; goneAt: number | null; replacedBy: string | null; ctx: number | null; maxOut: number | null;
};
type Reg = { settings: { auto: boolean; off: string[]; lastCheck: number | null; lastError: string | null }; models: RegModel[]; owner?: boolean; report?: { passed: string[]; failed: string[]; providers: { id: string; added: string[] }[] } };

const PROVIDER: Record<string, string> = { anthropic: "Claude API", openai: "ChatGPT API", google: "Gemini API", xai: "Grok API", deepseek: "DeepSeek API", "sub-claude": "Claude plan", "sub-codex": "ChatGPT plan", "sub-agy": "Gemini plan", "sub-grok": "Grok plan" };
const STATUS: Record<RegModel["status"], [string, string]> = {
  new: ["Waiting for test", "wait"], testing: ["Test failed, retrying", "bad"], active: ["In use", "ok"], deprecated: ["Superseded", "old"], retired: ["Removed by provider", "old"],
};
const STEP: Record<Step["name"], string> = { text: "Text", tool: "Tools", image: "Images" };

function Switch({ on, set, label, disabled }: { on: boolean; set: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => set(!on)} />;
}

function Row({ m, busy, act, owner }: { m: RegModel; busy: boolean; act: (action: string, key: string, on?: boolean) => void; owner: boolean }) {
  const [st, cls] = m.hidden ? ["Hidden", "old"] : STATUS[m.status];
  const waiting = m.status === "new" || m.status === "testing";
  return (
    <div className={`mr-row ${m.shown ? "" : "off"}`}>
      <div className="mr-main">
        <div className="mr-name">
          <ModelLogo k={m.key} name={m.name} />
          <b data-notr>{m.name}</b>
          {m.isNew && <span className="mtag mnew">New</span>}
          {m.pinned && <span className="mtag">Pinned</span>}
          <span className={`api-badge ${cls}`}><i />{st}</span>
        </div>
        <div className="mr-key"><span className="mono-s" data-notr>{m.key}</span></div>
        <div className="mr-meta">
          <span>{PROVIDER[m.provider] ?? m.provider}</span>
          <span>First seen <span data-notr>{m.baseline ? "—" : fmtDate(m.firstSeen)}</span></span>
          {m.created && <span>Released <span data-notr>{fmtDate(m.created)}</span></span>}
          {m.replacedBy && <span>Replaced by <span className="mono-s" data-notr>{m.replacedBy.split("/").slice(1).join("/")}</span></span>}
          {m.nextTest && m.status === "testing" && <span>Next try <span data-notr>{ago(m.nextTest)}</span></span>}
        </div>
        {m.test && (
          <div className="mr-test">
            {m.test.steps.map((s) => <span key={s.name} className={`mr-step ${s.ok ? "ok" : "bad"}`} title={s.note}>{s.ok ? <I.Check size={12} /> : <I.X size={12} />}{STEP[s.name]}</span>)}
            <span className="d">Tested <span data-notr>{ago(m.test.at)}</span></span>
          </div>
        )}
        {m.test && !m.test.ok && m.test.error && <div className="api-err in mr-err"><I.Alert size={14} /><span>{m.test.error}</span></div>}
      </div>
      {!m.plan && m.status === "retired" && <div className="mr-acts"><button className="btn" disabled={busy} onClick={() => act("forget", m.key)}>Remove from list</button></div>}
      {!m.plan && m.status !== "retired" && (
        <div className="mr-acts">
          {waiting && owner && <button className="btn" disabled={busy} onClick={() => act("retest", m.key)}>Test again</button>}
          {(waiting || m.status === "deprecated") && <button className="btn" disabled={busy} onClick={() => act("activate", m.key)}>Use now</button>}
          <button className="btn" disabled={busy} onClick={() => act("pin", m.key, !m.pinned)}>{m.pinned ? "Unpin" : "Pin"}</button>
          <button className="btn" disabled={busy} onClick={() => act("hide", m.key, !m.hidden)}>{m.hidden ? "Show" : "Hide"}</button>
        </div>
      )}
    </div>
  );
}

export function ModelRegistry() {
  const app = useApp();
  const [r, setR] = useState<Reg | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const load = () => call<Reg>("GET", "/api/admin/models").then((x) => { setR(x); setErr(""); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, []);
  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { const x = await call<Reg>("POST", "/api/admin/models", body); setR(x); refreshModels(); return x; }
    catch (e) { app.say((e as Error).message); return null; } finally { setBusy(false); }
  };
  const check = async () => {
    const x = await post({ action: "check" });
    if (!x?.report) return;
    const n = x.report.providers.reduce((s, p) => s + p.added.length, 0);
    app.say(n || x.report.passed.length ? "New models found. Results are listed below" : "No new models since the last check");
  };
  const act = (action: string, key: string, on?: boolean) => { void post({ action, key, on }); };
  const providers = useMemo(() => [...new Set((r?.models ?? []).filter((m) => !m.plan).map((m) => m.provider))], [r]);
  if (err) return <div className="api-err" role="alert"><I.Alert size={14} /><span>{err}</span></div>;
  if (!r) return <p className="pv-note">Loading…</p>;
  const recent = r.models.filter((m) => !m.baseline || m.status === "new" || m.status === "testing" || m.pinned || m.hidden || m.status === "retired");
  const list = all ? r.models : recent;
  const s = r.settings;
  // Bật / tắt tự nhận model mới, "Check now" và "Test again" gọi API bằng khóa của chủ máy chủ: chỉ chủ sở hữu (máy chủ cũng chặn).
  const owner = r.owner !== false;
  return (
    <div className="mr">
      <div className="api-card mr-head">
        <div className="mr-auto">
          <div className="mr-auto-t">
            <b>Add new models automatically</b>
            <span className="d">When a provider releases a model, Synchro tests it with one short message, one tool call and one image, then shows it with a New label. Auto picks the newest model of each line; the previous one stays as a fallback.</span>
          </div>
          <Switch on={s.auto} set={(v) => void post({ action: "auto", on: v })} label="Add new models automatically" disabled={busy || !owner} />
        </div>
        {providers.length > 0 && (
          <div className="mr-provs" aria-label="Providers">
            {providers.map((p) => {
              const on = s.auto && !s.off.includes(p);
              return <button key={p} className={`mr-prov ${on ? "on" : ""}`} aria-pressed={on} disabled={busy || !s.auto || !owner} onClick={() => void post({ action: "provider", id: p, on: !on })}>{on ? <I.Check size={12} /> : <I.X size={12} />}{PROVIDER[p] ?? p}</button>;
            })}
          </div>
        )}
        <div className="mr-check">
          <span className="d">{s.lastCheck ? <>Last check <span data-notr>{ago(s.lastCheck)}</span>. Synchro checks every 6 hours.</> : "Synchro checks every 6 hours."}</span>
          <button className="btn dark" disabled={busy || !owner} onClick={check}>{busy ? <><span className="api-spin" />Checking…</> : <><I.Retry size={14} />Check now</>}</button>
        </div>
        {!owner && <p className="api-own"><I.Lock size={12} /><span>Only the Owner can turn automatic model updates on or off, check now or test a model again, since these use the Owner&apos;s API keys. You can still pin, hide or switch to a model.</span></p>}
        {s.lastError && <div className="api-err in"><I.Alert size={14} /><span>{s.lastError}</span></div>}
      </div>
      <div className="mr-tabs" role="tablist">
        <button role="tab" aria-selected={!all} className={!all ? "on" : ""} onClick={() => setAll(false)}>Recent changes</button>
        <button role="tab" aria-selected={all} className={all ? "on" : ""} onClick={() => setAll(true)}>All models</button>
      </div>
      {list.length ? <div className="mr-list">{list.map((m) => <Row key={m.key} m={m} busy={busy} act={act} owner={owner} />)}</div>
        : <div className="api-empty"><I.Sparkle size={18} /><span>No new models yet. Models found here are tested before anyone can use them.</span></div>}
    </div>
  );
}
