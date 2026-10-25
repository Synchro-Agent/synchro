"use client";
// Tiện ích dùng chung cho Cài đặt (gọi API, định dạng ngày) và phần chọn model hiện ở bộ chọn trên màn hình chính.
import { useState } from "react";
import { getLang, tr } from "./i18n";
import * as I from "./icons";
import { ALL, allowsModel, type ProviderInfo } from "./catalog";
import type { ApiState } from "./apiui";
import { refreshModels } from "./models";

export async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Lỗi máy chủ. Vui lòng thử lại.");
  return j as T;
}

const locale = () => (getLang() === "vi" ? "vi-VN" : "en-US");
export const fmtDate = (t: number | null) => (t ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(t) : "—");
export function ago(t: number | null) {
  if (!t) return "—";
  const s = (t - Date.now()) / 1000, rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  for (const [u, n] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]] as const) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return rtf.format(0, "second");
}
export const METHOD: Record<string, string> = { password: "Password", google: "Google", github: "GitHub", apple: "Apple", cli: "Server script" };

type ToggleT = (p: { on: boolean; set: (v: boolean) => void }) => React.ReactElement;

// Chọn nhiều model theo từng nhà cung cấp; "*" = mọi model (kể cả model hãng ra sau này).
function ModelChips({ catalog, value, onChange, allLabel, allHint, Toggle }: { catalog: ProviderInfo[]; value: string[]; onChange: (v: string[]) => void; allLabel: string; allHint: string; Toggle: ToggleT }) {
  const [q, setQ] = useState("");
  const all = value.includes(ALL);
  const keys = catalog.flatMap((p) => p.models.map((m) => m.key));
  const ql = q.trim().toLowerCase();
  const flip = (k: string) => {
    const cur = all ? keys : value;
    onChange(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);
  };
  const setProv = (p: ProviderInfo, on: boolean) => {
    const cur = all ? keys : value, ks = p.models.map((m) => m.key);
    onChange(on ? [...new Set([...cur, ...ks])] : cur.filter((k) => !ks.includes(k)));
  };
  if (!catalog.length) return <p className="adm-perm-warn" style={{ color: "var(--text-3)" }}>No models yet. Add an API key in Settings → API first.</p>;
  return (
    <>
      <div className="adm-perm-row" style={{ borderTop: 0, paddingTop: 0 }}>
        <div><div className="t">{allLabel}</div><div className="d">{allHint}</div></div>
        <Toggle on={all} set={(v) => onChange(v ? [ALL] : [...keys])} />
      </div>
      {keys.length > 12 && <div className="s-search adm-msearch"><I.Search size={14} /><input placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      {catalog.map((pv) => {
        const ms = pv.models.filter((m) => !ql || m.name.toLowerCase().includes(ql) || m.id.toLowerCase().includes(ql));
        if (!ms.length) return null;
        const on = pv.models.filter((m) => all || value.includes(m.key)).length;
        return (
          <div key={pv.id} className="adm-perm-prov">
            <div className="adm-perm-pname"><span>{pv.name}</span><button type="button" className="adm-provall" onClick={() => setProv(pv, on < pv.models.length)}>{on < pv.models.length ? "Select all" : "Clear"}</button></div>
            <div className="adm-pchips">{ms.map((m) => { const sel = all || value.includes(m.key); return <button key={m.key} type="button" className={`adm-pchip ${sel ? "on" : ""}`} aria-pressed={sel} title={m.id} onClick={() => flip(m.key)} data-notr>{sel && <I.Check size={12} />}{m.name}</button>; })}</div>
          </div>
        );
      })}
    </>
  );
}

// Model hiện ở bộ chọn trên màn hình chính và model mặc định cho đoạn chat mới.
export function ModelPickerSettings({ s, setS, say, Toggle }: { s: ApiState; setS: (s: ApiState) => void; say: (m: string) => void; Toggle: ToggleT }) {
  const saveMain = (main: string[]) => { setS({ ...s, main }); call<ApiState>("POST", "/api/admin/apikeys", { action: "main", main }).then((x) => { setS(x); refreshModels(); }).catch((e) => say(e.message)); };
  const saveDefault = (model: string) => { call<ApiState>("POST", "/api/admin/apikeys", { action: "default", model }).then((x) => { setS(x); refreshModels(); say("Default model saved"); }).catch((e) => say(e.message)); };
  const shown = s.catalog.map((p) => ({ ...p, models: p.models.filter((m) => allowsModel(s.main, m.key)) })).filter((p) => p.models.length);
  return (
    <div className="adm-card">
      <div className="adm-card-h"><b>Models in the picker</b><span className="d">Choose which models appear in the model picker on the main screen. Hidden models stay connected and can be shown again any time.</span></div>
      <ModelChips catalog={s.catalog} value={s.main} onChange={saveMain} allLabel="Show every model" allHint="New models appear automatically when a provider adds them." Toggle={Toggle} />
      {s.catalog.length > 0 && (
        <div className="adm-perm-row">
          <div><div className="t">Default model</div><div className="d">Used for new chats and when the chosen model is no longer available.</div></div>
          <span className="api-sel"><select aria-label="Default model" value={s.default ?? ""} onChange={(e) => saveDefault(e.target.value)} data-notr>
            <option value="">{`${tr("Automatic")}${s.effectiveDefault ? ` (${s.catalog.flatMap((p) => p.models).find((m) => m.key === s.effectiveDefault)?.name ?? ""})` : ""}`}</option>
            {shown.map((p) => <optgroup key={p.id} label={p.name}>{p.models.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</optgroup>)}
          </select><I.Chevron size={13} /></span>
        </div>
      )}
    </div>
  );
}
