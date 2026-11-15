"use client";
// Cài đặt → Providers (chỉ quản trị viên): nhập khóa API của từng nhà cung cấp, xem model lấy được, gửi thử một câu tới model.
// Khóa gửi lên máy chủ một lần khi lưu; máy chủ kiểm tra với API của hãng, mã hóa rồi lưu, và chỉ trả về dạng che (sk-ant…a1b2).
import { useEffect, useMemo, useState } from "react";
import * as I from "./icons";
import { useApp } from "./store";
import { call, ago } from "./adminui";
import { refreshModels } from "./models";
import type { ProviderInfo } from "../app/catalog";
import { LogoMark, ModelLogo } from "./brands";
import { hostLogo, providerLogo } from "../app/vendorlogo";
import { SettingsSkeleton } from "./skeleton";

export type ApiProvider = {
  id: string; kind: string; name: string; vendor: string; builtin: boolean; configured: boolean; source: "db" | "env" | null;
  baseUrl: string; workspaceId: string; defaultBase: string; keyHint: string | null; keyUrl: string | null; prefix: string | null;
  status: "ok" | "error" | null; error: string | null; info: string | null; checkedAt: number | null; models: { key: string; name: string }[];
};
export type Credit = { provider: string; amount: number; since: number; spent: number; remaining: number; pct: number };
export type ApiState = { providers: ApiProvider[]; catalog: ProviderInfo[]; main: string[]; default: string | null; effectiveDefault: string | null; credits?: Credit[]; owner?: boolean };

const ROLE: Record<string, string> = { anthropic: "Chat, Code and Projects", openai: "Chat, Code and Projects", google: "Chat, Code and Projects", elevenlabs: "Speech and voice conversation", composio: "Connectors for everyone: Gmail, Slack, GitHub, Notion and 1000+ apps", replicate: "Image generation: FLUX 1.1 Pro Ultra and IC-Light product relighting" };
// Khóa dịch vụ (không có model chat): không hiện số model, không theo dõi số dư.
const SERVICE = new Set(["elevenlabs", "composio", "replicate"]);

// Logo của hãng trên ô nền trung tính; nhà cung cấp không có logo thì hiện chữ cái đầu.
// Nhà cung cấp tương thích OpenAI: hãng nhận ra từ địa chỉ API (chủ sở hữu thấy địa chỉ), từ dòng model, hay biểu tượng trang qua /api/favicon?p=….
function Mark({ p }: { p: ApiProvider }) {
  let hint = "site";
  try { if (p.baseUrl) hint = hostLogo(new URL(p.baseUrl).host) ?? "site"; } catch {}
  const pick = providerLogo({ id: p.id, kind: p.kind, name: p.name, logo: p.kind === "compatible" ? hint : undefined, models: p.models.map((m) => ({ id: m.key.slice(m.key.indexOf("/") + 1) })) });
  return <span className="api-mark" aria-hidden data-notr>{"site" in pick || "id" in pick ? <LogoMark pick={pick} size={20} /> : pick.mono}</span>;
}

type WS = { need: boolean; list: { id: string; name: string }[] };
function KeyForm({ p, busy, err, ws, onCancel, onSave }: { p: ApiProvider; busy: boolean; err: string; ws: WS; onCancel: () => void; onSave: (v: { key: string; baseUrl: string; workspaceId?: string }) => void }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [base, setBase] = useState(p.baseUrl);
  const [wid, setWid] = useState(p.workspaceId ?? "");
  const [adv, setAdv] = useState(!!p.baseUrl || !!p.workspaceId);
  const anth = p.kind === "anthropic";
  // Máy chủ báo khóa này cần chọn workspace: mở mục Nâng cao để ô đó hiện ra ngay cạnh thông báo.
  useEffect(() => { if (ws.need) setAdv(true); }, [ws]);
  const editing = p.configured && p.source === "db";
  const can = !busy && !!(key.trim() || (editing && (base !== p.baseUrl || wid.trim() !== (p.workspaceId ?? ""))));
  return (
    <form className="api-form" onSubmit={(e) => { e.preventDefault(); if (can) onSave({ key, baseUrl: base, ...(anth ? { workspaceId: wid.trim() } : {}) }); }}>
      <label className="api-lbl" htmlFor={`api-key-${p.id}`}>API key{editing && <span className="d"> · leave empty to keep the current key</span>}</label>
      <div className="api-keyrow">
        <input id={`api-key-${p.id}`} className="field" type={show ? "text" : "password"} autoComplete="off" spellCheck={false}
          placeholder={p.prefix ? `${p.prefix}…` : "Paste your API key"} value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
        <button type="button" className="icon-btn" aria-label={show ? "Hide key" : "Show key"} title={show ? "Hide key" : "Show key"} onClick={() => setShow(!show)}><I.Eye size={16} /></button>
      </div>
      {p.keyUrl && <a className="api-get" href={p.keyUrl} target="_blank" rel="noreferrer">{`Get a key from ${p.vendor}`}<I.External size={12} /></a>}
      {p.kind === "elevenlabs" && <p className="api-note">Restricted keys work too. Turn on the features you use; User access is optional and only shows your plan here.</p>}
      {p.kind === "composio" && <p className="api-note">Use a project API key from Composio settings. Everyone on this Synchro gets Composio in Connectors and connects their own apps from chat; their sign-ins stay separate.</p>}
      {p.kind === "replicate" && <p className="api-note">Each image is billed to this Replicate account (about $0.06 per FLUX 1.1 Pro Ultra image). Daily image limits per account are in Administrator.</p>}
      <button type="button" className="api-adv" aria-expanded={adv} onClick={() => setAdv(!adv)}><I.ChevronR size={13} />Advanced</button>
      {adv && (
        <>
          <label className="api-lbl" htmlFor={`api-base-${p.id}`}>Base URL<span className="d"> · optional, for proxies or compatible gateways</span></label>
          <input id={`api-base-${p.id}`} className="field" data-notr placeholder={p.defaultBase || "https://api.example.com/v1"} value={base} onChange={(e) => setBase(e.target.value)} />
          {anth && (
            <>
              <label className="api-lbl" htmlFor={`api-ws-${p.id}`}>Workspace<span className="d"> · only for keys not tied to one workspace</span></label>
              {ws.list.length > 0
                ? <select id={`api-ws-${p.id}`} className="field" value={wid} onChange={(e) => setWid(e.target.value)}>
                    <option value="">Choose a workspace</option>
                    {ws.list.map((w) => <option key={w.id} value={w.id} data-notr>{w.name}</option>)}
                  </select>
                : <input id={`api-ws-${p.id}`} className="field" data-notr spellCheck={false} autoComplete="off" placeholder="wrkspc_…" value={wid} onChange={(e) => setWid(e.target.value)} />}
              {ws.need && !ws.list.length && <a className="api-get" href="https://platform.claude.com/settings/workspaces" target="_blank" rel="noreferrer">Find the ID in Claude Console<I.External size={12} /></a>}
            </>
          )}
        </>
      )}
      {err && <div className="api-err" role="alert"><I.Alert size={14} /><span>{err}</span></div>}
      <div className="api-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn dark" disabled={!can}>{busy ? <><span className="api-spin" />Checking…</> : "Verify and save"}</button>
      </div>
      <p className="api-note"><I.Lock size={12} /><span>{`Synchro checks the key with ${p.vendor} first, then stores it encrypted on the server. It is never shown again in full.`}</span></p>
    </form>
  );
}

const usd = (v: number) => `$${v.toFixed(2)}`;
// Số dư API đã nạp: hãng không báo số dư cho khóa, nên quản trị viên nhập số tiền đã nạp; Synchro trừ dần theo chi phí thật.
function CreditRow({ p, credit, onChange, owner }: { p: ApiProvider; credit: Credit | null; onChange: (s: ApiState) => void; owner: boolean }) {
  const app = useApp();
  const [mode, setMode] = useState<"" | "set" | "add">("");
  const [v, setV] = useState("");
  const save = async () => {
    const n = Number(v.replace(",", "."));
    if (!isFinite(n) || n < 0) return;
    try {
      onChange(await call<ApiState>("POST", "/api/admin/apikeys", { action: "credit", id: p.id, ...(mode === "add" ? { add: n } : { amount: n }) }));
      app.say(mode === "add" ? `Added ${usd(n)} to ${p.name}` : `${p.name} balance set to ${usd(n)}`); setMode(""); setV("");
    } catch (e) { app.say((e as Error).message); }
  };
  const stop = () => call<ApiState>("POST", "/api/admin/apikeys", { action: "credit", id: p.id, amount: null }).then(onChange).catch((e) => app.say(e.message));
  const left = credit ? 100 - credit.pct : 0;
  return (
    <div className="api-credit">
      {credit ? (
        <>
          <div className="api-credit-t"><b>Prepaid balance</b><span>{`${usd(credit.remaining)} left of ${usd(credit.amount)}`}</span></div>
          <div className={`us-bar ${left <= 5 ? "hot" : left <= 20 ? "warn" : ""}`}><i style={{ width: `${Math.max(credit.pct, credit.pct > 0 ? 1.5 : 0)}%` }} /></div>
        </>
      ) : <div className="api-credit-t"><b>Prepaid balance</b><span>Not tracked. Enter what you loaded into this key to get a warning before it runs out.</span></div>}
      {!owner ? null : mode ? (
        <form className="api-credit-f" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <span className="us-money"><i>$</i><input inputMode="decimal" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={mode === "add" ? "Amount added" : "Current balance"} aria-label={mode === "add" ? "Amount added" : "Current balance"} /></span>
          <button type="submit" className="btn dark" disabled={!v.trim()}>Save</button>
          <button type="button" className="btn" onClick={() => { setMode(""); setV(""); }}>Cancel</button>
        </form>
      ) : (
        <div className="api-credit-b">
          {credit && <button className="btn" onClick={() => setMode("add")}>Top up</button>}
          <button className="btn" onClick={() => setMode("set")}>{credit ? "Set balance" : "Track balance"}</button>
          {credit && <button className="icon-btn" aria-label="Stop tracking balance" data-tip="Stop tracking balance" onClick={stop}><I.X size={14} /></button>}
        </div>
      )}
    </div>
  );
}

/** bare: nằm trong mục của hãng ở Cài đặt → Providers (bỏ khung và logo, mục cha đã có). */
export function ProviderCard({ p, onChange, credit, bare = false }: { p: ApiProvider; onChange: (s: ApiState) => void; credit?: Credit | null; bare?: boolean }) {
  const app = useApp();
  // Khóa API và số dư đã nạp: chỉ chủ sở hữu (Owner) đổi được; quản trị viên vẫn làm mới danh sách model và gửi thử (máy chủ cũng tự chặn).
  const owner = app.me?.role === "owner";
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showModels, setShowModels] = useState(false);
  const [ws, setWs] = useState<WS>({ need: false, list: [] });
  const save = async (v: { key: string; baseUrl: string; workspaceId?: string }) => {
    setBusy(true); setErr("");
    try {
      const s = await call<ApiState>("POST", "/api/admin/apikeys", { id: p.id, key: v.key, baseUrl: v.baseUrl, name: p.name, ...(v.workspaceId !== undefined ? { workspaceId: v.workspaceId } : {}) });
      onChange(s); setEdit(false); setWs({ need: false, list: [] }); refreshModels();
      const n = s.providers.find((x) => x.id === p.id)?.models.length ?? 0;
      app.say(SERVICE.has(p.id) ? `Connected ${p.name}` : `Connected ${p.name} · ${n} models`);
    } catch (e) {
      setErr((e as Error).message);
      const d = (e as Error & { data?: { needWorkspace?: boolean; workspaces?: WS["list"] } }).data;
      if (d?.needWorkspace) setWs({ need: true, list: d.workspaces ?? [] });
    } finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true);
    try { onChange(await call<ApiState>("POST", "/api/admin/apikeys", { action: "refresh", id: p.id })); refreshModels(); app.say("Model list updated"); }
    catch (e) { app.say((e as Error).message); } finally { setBusy(false); }
  };
  const remove = () => app.confirm(`Remove the ${p.name} key?`, p.id === "elevenlabs" ? "Speech and voice conversation will stop working until you add a key again." : p.id === "composio" ? "Composio will stop working in Connectors and chats until you add a key again. Apps people connected stay linked in Composio." : p.id === "replicate" ? "Images will be made with each person's own plan again, as before the key was added." : "Models from this provider will disappear from the model picker until you add a key again.", "Remove", async () => {
    try { onChange(await call<ApiState>("DELETE", `/api/admin/apikeys?id=${encodeURIComponent(p.id)}`)); refreshModels(); app.say("Key removed"); } catch (e) { app.say((e as Error).message); }
  });
  const status = !p.configured ? { cls: "", text: "Not connected" }
    : p.status === "error" ? { cls: "bad", text: "Needs attention" }
    : { cls: "ok", text: p.id === "elevenlabs" ? (p.info ? `Connected · ${p.info[0].toUpperCase()}${p.info.slice(1)} plan` : "Connected") : SERVICE.has(p.id) ? "Connected" : `Connected · ${p.models.length} models` };
  return (
    <div className={`api-card ${edit ? "open" : ""} ${bare ? "bare" : ""}`}>
      <div className="api-card-h">
        {!bare && <Mark p={p} />}
        <div className="api-meta">
          {!bare && <div className="api-name"><b>{p.name}</b>{p.vendor !== p.name && <span className="api-vendor">{p.vendor}</span>}</div>}
          <div className="api-sub">{ROLE[p.id] ?? "Chat, Code and Projects"}{p.keyHint && <> · <span className="mono-s" data-notr>{p.keyHint}</span></>}{p.source === "env" && <> · from server environment</>}{p.kind === "deepseek" && p.info && <> · {`Balance ${p.info}`}</>}</div>
        </div>
        <span className={`api-badge ${status.cls}`}><i />{status.text}</span>
        <div className="api-btns">
          {owner && !p.configured && !edit && <button className="btn dark" onClick={() => { setEdit(true); setErr(""); }}>Add key</button>}
          {p.configured && !edit && (
            <>
              <button className="icon-btn" aria-label={SERVICE.has(p.id) ? "Check key" : "Refresh model list"} title={SERVICE.has(p.id) ? "Check key" : "Check key and refresh models"} onClick={refresh} disabled={busy}>{busy ? <span className="api-spin" /> : <I.Retry size={16} />}</button>
              {owner && <button className="btn" onClick={() => { setEdit(true); setErr(""); }}>{p.source === "env" ? "Add key" : "Change key"}</button>}
              {owner && p.source === "db" && <button className="icon-btn" aria-label="Remove key" title="Remove key" onClick={remove}><I.Trash size={16} /></button>}
            </>
          )}
        </div>
      </div>
      {p.status === "error" && p.error && !edit && <div className="api-err in"><I.Alert size={14} /><span>{p.error}</span></div>}
      {!owner && !p.configured && !bare && <p className="api-own"><I.Lock size={12} /><span>Only the Owner can add, change or remove API keys.</span></p>}
      {edit && <KeyForm p={p} busy={busy} err={err} ws={ws} onCancel={() => setEdit(false)} onSave={save} />}
      {!edit && p.configured && !SERVICE.has(p.id) && credit !== undefined && <CreditRow p={p} credit={credit} onChange={onChange} owner={owner} />}
      {/* Chưa có khóa Replicate: nói rõ hiện giờ ảnh đi đường nào, để quản trị viên biết chưa có gì thay đổi. */}
      {!edit && p.id === "replicate" && !p.configured && <p className="api-note api-wait">Waiting for a key. Until one is added, images are made with each person&apos;s own plan (Antigravity, ChatGPT, Grok), exactly as now.</p>}
      {!edit && p.id === "replicate" && p.configured && p.info && <p className="api-note">Account <span data-notr>{p.info}</span>. FLUX 1.1 Pro Ultra makes new images; IC-Light puts a product photo into a studio scene. Accounts past their daily image limit go back to their own plan.</p>}
      {!edit && p.models.length > 0 && (
        <div className="api-models">
          <button className="api-adv" aria-expanded={showModels} onClick={() => setShowModels(!showModels)}><I.ChevronR size={13} /><span>{showModels ? "Hide models" : `View ${p.models.length} models`}{p.checkedAt && <span className="d">{` · checked ${ago(p.checkedAt)}`}</span>}</span></button>
          {showModels && <div className="api-chips">{p.models.map((m) => <span key={m.key} className="api-chip" title={m.key} data-notr><ModelLogo k={m.key} name={m.name} size={14} />{m.name}</span>)}</div>}
        </div>
      )}
    </div>
  );
}

export function TestBox({ catalog }: { catalog: ProviderInfo[] }) {
  const all = useMemo(() => catalog.flatMap((p) => p.models.map((m) => ({ ...m, pname: p.name }))), [catalog]);
  const [model, setModel] = useState(all[0]?.key ?? "");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ text?: string; error?: string; ms?: number } | null>(null);
  useEffect(() => { if (!all.some((m) => m.key === model)) setModel(all[0]?.key ?? ""); }, [all, model]);
  const send = async () => {
    setBusy(true); setOut(null);
    try { setOut(await call<{ text: string; ms: number }>("POST", "/api/admin/apikeys/test", { model, prompt: q })); }
    catch (e) { setOut({ error: (e as Error).message }); } finally { setBusy(false); }
  };
  if (!all.length) return <div className="api-empty"><I.SetKey size={18} /><span>Add a key above, then send a test message to any model here.</span></div>;
  return (
    <div className="api-test">
      <div className="api-test-row">
        <span className="api-sel"><select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} data-notr>
          {catalog.map((p) => <optgroup key={p.id} label={p.name}>{p.models.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</optgroup>)}
        </select><I.Chevron size={13} /></span>
        <input className="field" placeholder="Message (optional)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !busy && model) send(); }} />
        <button className="btn dark" onClick={send} disabled={busy || !model}>{busy ? <><span className="api-spin" />Sending…</> : "Send test"}</button>
      </div>
      {out && (out.error
        ? <div className="api-err" role="alert"><I.Alert size={14} /><span>{out.error}</span></div>
        : <div className="api-reply"><div className="api-reply-h"><span className="api-badge ok"><i />Works</span><span className="d">{(out.ms! / 1000).toFixed(1)} s</span></div><p data-notr>{out.text}</p></div>)}
    </div>
  );
}

/** embedded: nằm trong Cài đặt → Providers (bỏ phần tiêu đề riêng). */
export function ApiPanel({ embedded = false }: { embedded?: boolean }) {
  const [s, setS] = useState<ApiState | null>(null);
  const [err, setErr] = useState("");
  const load = () => call<ApiState>("GET", "/api/admin/apikeys").then((x) => { setS(x); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <div className="empty" style={{ marginTop: 80 }}><I.Alert size={28} /><span>{err}</span><button className="btn" onClick={load}>Try again</button></div>;
  if (!s) return <SettingsSkeleton />;
  const chat = s.providers.filter((p) => !SERVICE.has(p.id));
  const voice = s.providers.filter((p) => p.id === "elevenlabs");
  const conn = s.providers.filter((p) => p.id === "composio");
  const images = s.providers.filter((p) => p.id === "replicate");
  const nModels = s.catalog.reduce((n, p) => n + p.models.length, 0);
  const nConn = s.providers.filter((p) => p.configured).length;
  return (
    <>
      {!embedded && <div className="adm-head">
        <div className="adm-badge"><I.SetKey size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="s-title">API</div>
          <div className="d">Connect Synchro to AI providers with your own API keys. One key unlocks every model that provider offers your account.</div>
        </div>
      </div>}
      <div className="api-sum">
        <div><b data-notr>{nConn}</b><span>Providers connected</span></div>
        <div><b data-notr>{nModels}</b><span>Chat models available</span></div>
        <p><I.Lock size={13} />Keys are encrypted on the server and never sent back to the browser.</p>
      </div>
      {!s.owner && <p className="api-own top"><I.Lock size={13} /><span>Only the Owner can add, change or remove shared API keys and prepaid balances. As an administrator you can refresh model lists and send test messages.</span></p>}

      <h3 className="sec">Chat models</h3>
      <div className="api-list">{chat.map((p) => <ProviderCard key={p.id} p={p} onChange={setS} credit={s.credits?.find((c) => c.provider === p.id) ?? null} />)}</div>

      <h3 className="sec">Voice</h3>
      <div className="api-list">{voice.map((p) => <ProviderCard key={p.id} p={p} onChange={setS} />)}</div>

      <h3 className="sec">Connectors</h3>
      <div className="api-list">{conn.map((p) => <ProviderCard key={p.id} p={p} onChange={setS} />)}</div>
      <h3 className="sec">Images</h3>
      <div className="api-list">{images.map((p) => <ProviderCard key={p.id} p={p} onChange={setS} />)}</div>

      <h3 className="sec">Test a model</h3>
      <TestBox catalog={s.catalog} />

      <h3 className="sec">How it works</h3>
      <ol className="api-steps">
        <li><b>Create a key</b><span>Sign in to the provider&apos;s console, add billing, and create an API key.</span></li>
        <li><b>Paste it here</b><span>Synchro checks the key and loads every model it can use.</span></li>
        <li><b>Choose what people see</b><span>In Administrator, pick which models appear in the model picker and who may use them.</span></li>
      </ol>
    </>
  );
}
