"use client";
// Cài đặt → Connectors: kết nối Synchro với ứng dụng khác qua MCP (giống Connectors của Claude).
// Danh mục connector có sẵn, thêm connector tùy chỉnh bằng địa chỉ máy chủ MCP, đăng nhập OAuth trong cửa sổ bật lên,
// bật/tắt từng connector và đặt quyền từng công cụ (luôn cho phép / hỏi trước / chặn). Kèm thẻ duyệt công cụ dùng trong chat.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as I from "./icons";
import { useApp } from "./store";
import { DIR_CATS, type DirCat, type DirEntry } from "./connectordir";
import type { ApprovalCall, Decision } from "./llm";

type Perm = "allow" | "chat" | "ask" | "block";
type Tool = { name: string; title: string; description: string; readOnly: boolean; destructive: boolean; perm: Perm; locked?: "setting" | "admin" };
type Settings = { chat: boolean; projects: boolean; newTools: "auto" | "ask" | "block"; destructive: boolean; maxCalls: number };
export type Conn = {
  id: string; name: string; url: string; host: string; dir: string | null; logo?: string; color?: string; icon?: string; enabled: boolean;
  status: "ok" | "needs_auth" | "error"; error: string | null; serverName: string | null; auth: "none" | "oauth"; tools: Tool[]; checkedAt: number | null;
  settings: Settings; adminBlocked: boolean;
};
type Policy = { custom: boolean; allowed: string[]; destructive: boolean };
type Data = { connectors: Conn[]; directory: DirEntry[]; policy: Policy };
const allowed = (p: Policy, dir: string) => p.allowed.includes("*") || p.allowed.includes(dir);
type Res = { connectors: Conn[]; connector?: Conn; authorizeUrl?: string; error?: string };

async function api<T = Res>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Lỗi ${r.status}`);
  return j as T;
}

const PERM_LABEL: Record<Perm, string> = { allow: "Always allow", chat: "Ask once per chat", ask: "Ask every time", block: "Blocked" };

// Logo connector: logo có sẵn của danh mục, logo Synchro tự tìm (data URI, chỉ hiện trong <img>), hoặc chữ cái đầu.
export function ConnLogo({ logo, color, icon, name, size = 36 }: { logo?: string; color?: string; icon?: string; name: string; size?: number }) {
  return (
    <span className="cn-logo" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }} aria-hidden>
      {logo ? <img src={`/connectors/${logo}.svg`} alt="" width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} />
        : icon ? <img src={icon} alt="" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} style={{ objectFit: "contain" }} />
        : <span className={`cn-mono ${color ? "" : "plain"}`} style={color ? { background: color } : undefined} data-notr>{name.trim().slice(0, 1).toUpperCase() || "?"}</span>}
    </span>
  );
}

// Mở cửa sổ đăng nhập NGAY khi bấm (trình duyệt chỉ cho mở cửa sổ bật lên trong lúc bấm), rồi mới chuyển tới trang đăng nhập.
function preOpen(): Window | null {
  const w = window.open("", "synchro-connector", "popup,width=560,height=720");
  try { if (w) w.document.write(`<!doctype html><meta charset="utf-8"><title>Synchro</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;font:14px system-ui;color:#6b6a65;background:#fcfcfa">Đang mở trang đăng nhập…</body>`); } catch {}
  return w;
}

function PermSelect({ value, onChange, label, mixed, locked }: { value: Perm; onChange: (p: Perm) => void; label: string; mixed?: boolean; locked?: string }) {
  if (locked) return <span className="cn-locked" title={locked}><I.Lock size={12} />Blocked</span>;
  return (
    <span className={`api-sel cn-perm ${value}`}>
      <select aria-label={label} value={mixed ? "" : value} onChange={(e) => e.target.value && onChange(e.target.value as Perm)}>
        {mixed && <option value="">Custom</option>}
        {(["allow", "chat", "ask", "block"] as Perm[]).map((p) => <option key={p} value={p}>{PERM_LABEL[p]}</option>)}
      </select><I.Chevron size={13} />
    </span>
  );
}

const LOCK_NOTE = { setting: "Turned off by this connector's setting for tools that delete data.", admin: "Your administrator doesn't allow tools that delete data." } as const;

// Cài đặt riêng của connector, hiện phía trên danh sách công cụ.
function ConnSettings({ c, policy, onSettings }: { c: Conn; policy: Policy; onSettings: (s: Partial<Settings>) => void }) {
  const st = c.settings;
  return (
    <div className="cn-set">
      <div className="cn-set-row">
        <div><b>Use in</b><div className="d">Where Synchro may use this connector.</div></div>
        <div className="cn-pills">
          <button className={st.chat ? "on" : ""} aria-pressed={st.chat} onClick={() => onSettings({ chat: !st.chat })}>{st.chat && <I.Check size={12} />}Chats</button>
          <button className={st.projects ? "on" : ""} aria-pressed={st.projects} onClick={() => onSettings({ projects: !st.projects })}>{st.projects && <I.Check size={12} />}Projects</button>
        </div>
      </div>
      <div className="cn-set-row">
        <div><b>New tools</b><div className="d">Permission for tools the server adds later.</div></div>
        <span className="api-sel cn-perm"><select aria-label="Permission for new tools" value={st.newTools} onChange={(e) => onSettings({ newTools: e.target.value as Settings["newTools"] })}>
          <option value="auto">Automatic (read-only: allow, others: ask)</option><option value="ask">Ask every time</option><option value="block">Blocked</option>
        </select><I.Chevron size={13} /></span>
      </div>
      <div className="cn-set-row">
        <div><b>Tools that delete data</b><div className="d">{policy.destructive ? "Let Synchro use tools the server marks as able to delete data." : LOCK_NOTE.admin}</div></div>
        <button className={`cn-switch ${st.destructive && policy.destructive ? "on" : ""}`} role="switch" aria-checked={st.destructive && policy.destructive} aria-label="Tools that delete data" disabled={!policy.destructive} onClick={() => onSettings({ destructive: !st.destructive })}><i /></button>
      </div>
      <div className="cn-set-row">
        <div><b>Calls per message</b><div className="d">Most times Synchro may call this connector while answering one message.</div></div>
        <span className="api-sel cn-perm"><select aria-label="Calls per message" value={st.maxCalls} onChange={(e) => onSettings({ maxCalls: Number(e.target.value) })}>
          {[0, 3, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n === 0 ? "No limit" : n}</option>)}
        </select><I.Chevron size={13} /></span>
      </div>
    </div>
  );
}

function ToolGroup({ title, hint, kind, tools, onPerm, onGroup }: { title: string; hint: string; kind: "read" | "write"; tools: Tool[]; onPerm: (t: Tool, p: Perm) => void; onGroup: (k: "read" | "write", p: Perm) => void }) {
  if (!tools.length) return null;
  const first = tools[0].perm;
  const mixed = tools.some((t) => t.perm !== first);
  return (
    <div className="cn-group">
      <div className="cn-group-h">
        <div><b>{title}</b><span className="d" data-notr>{` · ${tools.length}`}</span><div className="d">{hint}</div></div>
        <PermSelect label={`Permission for all: ${title}`} value={first} mixed={mixed} onChange={(p) => onGroup(kind, p)} />
      </div>
      {tools.map((t) => (
        <div key={t.name} className="cn-tool">
          <div className="cn-tool-m">
            <div className="cn-tool-n" data-notr>{t.title}{t.title !== t.name && <span className="mono-s">{t.name}</span>}</div>
            {t.description && <div className="cn-tool-d" data-notr>{t.description}</div>}
          </div>
          <PermSelect label={`Permission for ${t.title}`} value={t.perm} onChange={(p) => onPerm(t, p)} locked={t.locked ? LOCK_NOTE[t.locked] : undefined} />
        </div>
      ))}
    </div>
  );
}

function ConnectorCard({ c, policy, open, busy, onToggleOpen, onEnable, onConnect, onRefresh, onRemove, onPerm, onGroup, onSettings }: {
  c: Conn; policy: Policy; open: boolean; busy: boolean; onToggleOpen: () => void; onEnable: (v: boolean) => void; onConnect: () => void; onRefresh: () => void; onRemove: () => void;
  onPerm: (t: Tool, p: Perm) => void; onGroup: (k: "read" | "write", p: Perm) => void; onSettings: (s: Partial<Settings>) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState("");
  const mref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const f = (e: MouseEvent) => { if (!mref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [menu]);
  const ql = q.trim().toLowerCase();
  const shown = c.tools.filter((t) => !ql || t.title.toLowerCase().includes(ql) || t.name.toLowerCase().includes(ql) || t.description.toLowerCase().includes(ql));
  const status = c.adminBlocked ? "Turned off by your administrator" : c.status === "ok" ? (c.enabled ? `${c.tools.length} ${c.tools.length === 1 ? "tool" : "tools"}` : "Turned off") : c.status === "needs_auth" ? "Needs to be connected" : "Connection problem";
  return (
    <div className={`cn-card ${open ? "open" : ""} ${c.status !== "ok" || c.adminBlocked ? "attn" : ""}`}>
      <div className="cn-card-h">
        <button className="cn-card-main" onClick={c.status === "ok" ? onToggleOpen : undefined} aria-expanded={c.status === "ok" ? open : undefined} disabled={c.status !== "ok"}>
          <ConnLogo logo={c.logo} color={c.color} icon={c.icon} name={c.name} />
          <span className="cn-meta">
            <span className="cn-name"><b data-notr>{c.name}</b>{c.dir === null && <span className="cn-tag">Custom</span>}</span>
            <span className={`cn-sub ${c.adminBlocked ? "error" : c.status}`}><i />{status}<span className="cn-host" data-notr>{` · ${c.host}`}</span></span>
          </span>
          {c.status === "ok" && <span className="cn-chev"><I.ChevronR size={14} /></span>}
        </button>
        <div className="cn-actions">
          {c.status === "ok" || c.adminBlocked
            ? <button className={`cn-switch ${c.enabled && !c.adminBlocked ? "on" : ""}`} role="switch" aria-checked={c.enabled && !c.adminBlocked} aria-label={c.enabled ? "Turn off connector" : "Turn on connector"} onClick={() => onEnable(!c.enabled)} disabled={busy || c.adminBlocked}><i /></button>
            : <button className="btn dark cn-connect" onClick={onConnect} disabled={busy}>{busy ? <span className="api-spin" /> : null}{c.status === "error" ? "Try again" : "Connect"}</button>}
          <div className="cn-more" ref={mref}>
            <button className="icon-btn" aria-label="More options" aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={busy}>{busy && c.status === "ok" ? <span className="api-spin" /> : <I.Dots size={16} />}</button>
            {menu && (
              <div className="cn-menu" role="menu">
                {c.status === "ok" && <button role="menuitem" onClick={() => { setMenu(false); onRefresh(); }}><I.Retry size={15} />Refresh tools</button>}
                {c.auth === "oauth" && c.status === "ok" && <button role="menuitem" onClick={() => { setMenu(false); onConnect(); }}><I.Key size={15} />Reconnect account</button>}
                <button role="menuitem" className="danger" onClick={() => { setMenu(false); onRemove(); }}><I.Trash size={15} />Disconnect</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {c.status !== "ok" && c.error && <div className="api-err in"><I.Alert size={14} /><span>{c.error}</span></div>}
      {open && c.status === "ok" && (
        <div className="cn-body">
          <ConnSettings c={c} policy={policy} onSettings={onSettings} />
          {c.tools.length > 8 && <div className="s-search cn-search"><I.Search size={14} /><input placeholder="Search tools" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
          {c.tools.length === 0 ? <p className="d cn-empty-tools">This server doesn&apos;t offer any tools yet.</p> : <>
            <ToolGroup title="Read-only tools" hint="Look things up without changing anything." kind="read" tools={shown.filter((t) => t.readOnly)} onPerm={onPerm} onGroup={onGroup} />
            <ToolGroup title="Tools that can make changes" hint="May create, change or delete data, or the server doesn't say they're read-only." kind="write" tools={shown.filter((t) => !t.readOnly)} onPerm={onPerm} onGroup={onGroup} />
            {ql && !shown.length && <p className="d cn-empty-tools">No tools match your search.</p>}
          </>}
          <div className="cn-foot" data-notr>{c.serverName ? `${c.serverName} · ` : ""}{c.url}</div>
        </div>
      )}
    </div>
  );
}

function Browse({ data, busy, onClose, onConnect, onCustom }: { data: Data; busy: string | null; onClose: () => void; onConnect: (e: DirEntry) => void; onCustom: () => void }) {
  const pol = data.policy;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<DirCat | "all">("all");
  const ql = q.trim().toLowerCase();
  const list = data.directory.filter((e) => (cat === "all" || e.cat === cat) && (!ql || e.name.toLowerCase().includes(ql) || e.desc.toLowerCase().includes(ql) || e.descVi.toLowerCase().includes(ql)));
  const have = (e: DirEntry) => data.connectors.find((c) => c.dir === e.id);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal cn-browse" role="dialog" aria-label="Browse connectors">
        <div className="cn-browse-h">
          <div><h2>Browse connectors</h2><p className="d">Connect the apps you use so Synchro can find information and take actions for you.</p></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><I.X /></button>
        </div>
        <div className="s-search cn-bsearch"><I.Search size={15} /><input autoFocus placeholder="Search connectors" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="cn-cats">{DIR_CATS.map(([k, l]) => <button key={k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{l}</button>)}</div>
        <div className="cn-grid">
          {list.map((e) => {
            const c = have(e);
            const state = !allowed(pol, e.id) ? "blocked" : busy === e.id ? "busy" : c?.status === "ok" ? "ok" : c ? "pending" : "none";
            return (
              <div key={e.id} className="cn-item">
                <ConnLogo logo={e.logo} color={e.color} name={e.name} size={40} />
                <div className="cn-item-m"><b data-notr>{e.name}</b><span>{e.desc}</span></div>
                {state === "blocked" ? <span className="cn-done off" title="Your administrator hasn't allowed this connector for your account."><I.Lock size={13} />Not allowed</span>
                  : state === "ok" ? <span className="cn-done"><I.Check size={14} />Connected</span>
                  : <button className="btn cn-item-btn" disabled={state === "busy" || !!busy} onClick={() => onConnect(e)}>{state === "busy" ? <span className="api-spin" /> : state === "pending" ? "Finish" : "Connect"}</button>}
              </div>
            );
          })}
          {!list.length && <p className="d cn-none">No connectors match your search.</p>}
        </div>
        {pol.custom && <div className="cn-browse-f"><span className="d">Don&apos;t see the app you need?</span><button className="cn-link" onClick={onCustom}>Add a custom connector</button></div>}
      </div>
    </div>
  );
}

function Custom({ onClose, onAdd }: { onClose: () => void; onAdd: (v: { name: string; url: string; clientId: string; clientSecret: string }, done: (err?: string) => void) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [adv, setAdv] = useState(false);
  const [cid, setCid] = useState("");
  const [sec, setSec] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const urlOk = /^https?:\/\/[^\s/]+/i.test(url.trim());
  const can = !busy && name.trim().length > 0 && urlOk;
  const submit = () => { if (!can) return; setBusy(true); setErr(""); onAdd({ name, url, clientId: cid, clientSecret: sec }, (e) => { setBusy(false); if (e) setErr(e); }); };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal sm cn-custom" role="dialog" aria-label="Add custom connector" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="cn-custom-h"><h2>Add custom connector</h2><span className="cn-beta">Beta</span></div>
        <p className="d">Connect Synchro to any remote MCP server. If the server needs you to sign in, a window opens so you can approve access.</p>
        <label className="api-lbl" htmlFor="cn-name">Name</label>
        <input id="cn-name" className="field" autoFocus maxLength={60} placeholder="e.g. Company wiki" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="api-lbl" htmlFor="cn-url">Remote MCP server URL</label>
        <input id="cn-url" className="field" data-notr spellCheck={false} autoComplete="off" placeholder="https://example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="button" className="api-adv" aria-expanded={adv} onClick={() => setAdv(!adv)}><I.ChevronR size={13} />Advanced settings</button>
        {adv && (
          <>
            <label className="api-lbl" htmlFor="cn-cid">OAuth Client ID<span className="d"> · optional</span></label>
            <input id="cn-cid" className="field" data-notr spellCheck={false} autoComplete="off" value={cid} onChange={(e) => setCid(e.target.value)} />
            <label className="api-lbl" htmlFor="cn-sec">OAuth Client Secret<span className="d"> · optional</span></label>
            <input id="cn-sec" className="field" data-notr type="password" spellCheck={false} autoComplete="off" value={sec} onChange={(e) => setSec(e.target.value)} />
            <p className="cn-hint">Only needed when the server doesn&apos;t let apps register themselves. Use this callback URL in that app&apos;s settings: <span className="mono-s" data-notr>{`${location.origin}/api/connectors/oauth/callback`}</span></p>
          </>
        )}
        <div className="cn-warn"><I.Alert size={15} /><span>Only use connectors from developers you trust. Synchro doesn&apos;t review custom connectors, and a connector can read what you share with it and act in that service on your behalf.</span></div>
        {err && <div className="api-err" role="alert"><I.Alert size={14} /><span>{err}</span></div>}
        <div className="api-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn dark" disabled={!can}>{busy ? <><span className="api-spin" />Connecting…</> : "Add"}</button>
        </div>
      </form>
    </div>
  );
}

export function ConnectorsPanel() {
  const app = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [browse, setBrowse] = useState(false);
  const [custom, setCustom] = useState(false);
  const watch = useRef<number | null>(null);

  const load = useCallback(() => api<Data>("GET", "/api/connectors").then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const apply = (r: Res) => setData((d) => (d ? { ...d, connectors: r.connectors } : d));

  // Cửa sổ đăng nhập báo kết quả về đây; người dùng tự đóng cửa sổ thì tải lại danh sách.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || (e.data as { type?: string })?.type !== "synchro-connector") return;
      const m = e.data as { ok: boolean; message: string; id: string | null };
      app.say(m.message);
      load().then(() => { if (m.ok && m.id) setOpen(m.id); });
    };
    window.addEventListener("message", onMsg);
    return () => { window.removeEventListener("message", onMsg); if (watch.current) clearInterval(watch.current); };
  }, [app, load]);

  const follow = (w: Window | null, r: Res) => {
    apply(r);
    if (!r.authorizeUrl) { w?.close(); if (r.connector?.status === "ok") { app.say(`Connected ${r.connector.name}`); setOpen(r.connector.id); } return; }
    if (!w || w.closed) { location.href = r.authorizeUrl; return; }
    w.location.href = r.authorizeUrl;
    w.focus();
    if (watch.current) clearInterval(watch.current);
    watch.current = window.setInterval(() => { if (w.closed) { clearInterval(watch.current!); watch.current = null; load(); } }, 800);
  };

  const connectEntry = async (e: DirEntry) => {
    const w = e.noAuth ? null : preOpen();
    setBusy(e.id);
    try { const r = await api("POST", "/api/connectors", { dir: e.id }); follow(w, r); if (!r.authorizeUrl) setBrowse(false); }
    catch (x) { w?.close(); app.say((x as Error).message); }
    finally { setBusy(null); }
  };
  const addCustom = async (v: { name: string; url: string; clientId: string; clientSecret: string }, done: (err?: string) => void) => {
    const w = preOpen();
    try { const r = await api("POST", "/api/connectors", v); done(); setCustom(false); follow(w, r); }
    catch (x) { w?.close(); done((x as Error).message); }
  };
  const reconnect = async (c: Conn) => {
    const w = c.auth === "oauth" || c.status !== "ok" ? preOpen() : null;
    setBusy(c.id);
    try { follow(w, await api("POST", `/api/connectors/${c.id}/connect`)); }
    catch (x) { w?.close(); app.say((x as Error).message); load(); }
    finally { setBusy(null); }
  };
  const refresh = async (c: Conn) => {
    setBusy(c.id);
    try { apply(await api("POST", `/api/connectors/${c.id}/refresh`)); app.say("Tools refreshed"); }
    catch (x) { app.say((x as Error).message); load(); }
    finally { setBusy(null); }
  };
  const patch = async (c: Conn, body: Record<string, unknown>, optimistic: (c: Conn) => Conn) => {
    setData((d) => (d ? { ...d, connectors: d.connectors.map((x) => (x.id === c.id ? optimistic(x) : x)) } : d));
    try { apply(await api("PATCH", `/api/connectors/${c.id}`, body)); }
    catch (x) { app.say((x as Error).message); load(); }
  };
  const remove = (c: Conn) => app.confirm(`Disconnect ${c.name}?`, "Synchro will stop using this connector and forget its sign-in. You can connect it again later.", "Disconnect", async () => {
    try { apply(await api("DELETE", `/api/connectors/${c.id}`)); app.say(`Disconnected ${c.name}`); } catch (x) { app.say((x as Error).message); }
  });

  const conns = data?.connectors ?? [];
  const head = (
    <div className="adm-head">
      <div className="adm-badge"><I.SetPlug size={22} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="s-title">Connectors</div>
        <div className="d">Let Synchro use your other apps and services for more context, and take actions in them for you.</div>
      </div>
    </div>
  );
  if (err) return <>{head}<div className="empty" style={{ marginTop: 40 }}><I.Alert size={28} /><span>{err}</span><button className="btn" onClick={load}>Try again</button></div></>;
  if (!data) return <>{head}<div className="empty" style={{ marginTop: 40 }}><span className="muted">Loading…</span></div></>;
  return (
    <>
      {head}
      <div className="cn-bar">
        <button className="btn dark" onClick={() => setBrowse(true)}><I.Search size={14} />Browse connectors</button>
        {data.policy.custom && <button className="btn" onClick={() => setCustom(true)}><I.Plus size={14} />Add custom connector</button>}
      </div>
      {conns.length === 0 ? (
        <div className="cn-empty">
          <div className="cn-empty-art" aria-hidden>{["notion", "linear", "figma", "stripe"].map((l) => <ConnLogo key={l} logo={l} name={l} size={40} />)}</div>
          <b>No connectors yet</b>
          <span className="d">Connect Notion, Linear, Figma and more, or any remote MCP server, so Synchro can search and work in them during your chats.</span>
        </div>
      ) : (
        <div className="cn-list">
          {conns.map((c) => (
            <ConnectorCard key={c.id} c={c} policy={data.policy} open={open === c.id} busy={busy === c.id} onToggleOpen={() => setOpen(open === c.id ? null : c.id)}
              onEnable={(v) => patch(c, { enabled: v }, (x) => ({ ...x, enabled: v }))}
              onConnect={() => reconnect(c)} onRefresh={() => refresh(c)} onRemove={() => remove(c)}
              onPerm={(t, p) => patch(c, { perms: { [t.name]: p } }, (x) => ({ ...x, tools: x.tools.map((y) => (y.name === t.name ? { ...y, perm: p } : y)) }))}
              onGroup={(k, p) => patch(c, { group: { kind: k, perm: p } }, (x) => ({ ...x, tools: x.tools.map((y) => (y.readOnly === (k === "read") ? { ...y, perm: p } : y)) }))}
              onSettings={(st) => patch(c, { settings: st }, (x) => ({ ...x, settings: { ...x.settings, ...st } }))} />
          ))}
        </div>
      )}
      <p className="cn-note"><I.Lock size={12} />Sign-ins are encrypted on the server. Tools that change data ask before running unless you allow them.</p>
      {browse && <Browse data={data} busy={busy} onClose={() => setBrowse(false)} onConnect={connectEntry} onCustom={() => { setBrowse(false); setCustom(true); }} />}
      {custom && <Custom onClose={() => setCustom(false)} onAdd={addCustom} />}
    </>
  );
}

// Thẻ hỏi người dùng có cho model dùng công cụ connector hay không (hiện ngay trong cuộc trò chuyện).
export function ApprovalCard({ calls, onDone }: { calls: ApprovalCall[]; onDone: (d: Record<string, Decision>) => void }) {
  const [i, setI] = useState(0);
  const [show, setShow] = useState(false);
  const acc = useRef<Record<string, Decision>>({});
  const c = calls[i];
  const input = useMemo(() => { try { return JSON.stringify(c?.input ?? {}, null, 2); } catch { return "{}"; } }, [c]);
  if (!c) return null;
  const pick = (d: Decision) => {
    acc.current[c.id] = d;
    // "Luôn cho phép" áp dụng luôn cho các lượt gọi cùng công cụ ở bước này.
    if (d === "always" || d === "chat") for (const x of calls) if (x.connector.id === c.connector.id && x.tool.name === c.tool.name) acc.current[x.id] ??= "allow";
    let n = i + 1;
    while (n < calls.length && acc.current[calls[n].id]) n++;
    if (n >= calls.length) onDone(acc.current); else { setI(n); setShow(false); }
  };
  const empty = input === "{}";
  return (
    <div className="ap-card" role="alertdialog" aria-label="Cho phép dùng công cụ">
      <div className="ap-h">
        <ConnLogo logo={c.connector.logo} color={c.connector.color} icon={c.connector.icon} name={c.connector.name} size={32} />
        <div className="ap-t">
          <b>{`Cho phép Synchro dùng "${c.tool.title}"?`}</b>
          <span>{`Công cụ của ${c.connector.name}`}{calls.length > 1 && <span data-notr>{` · ${i + 1}/${calls.length}`}</span>}</span>
        </div>
      </div>
      {c.tool.description && <p className="ap-d" data-notr>{c.tool.description}</p>}
      {c.tool.destructive && <div className="ap-warn"><I.Alert size={14} /><span>Công cụ này có thể tạo, sửa hoặc xóa dữ liệu trong ứng dụng của bạn.</span></div>}
      {!empty && <button className="api-adv ap-more" aria-expanded={show} onClick={() => setShow(!show)}><I.ChevronR size={13} />Xem dữ liệu gửi đi</button>}
      {show && !empty && <pre className="ap-in" data-notr>{input}</pre>}
      <div className="ap-a">
        <button className="btn" onClick={() => pick("deny")}>Từ chối</button>
        <button className="btn" onClick={() => pick("allow")}>Cho phép một lần</button>
        <button className="btn" onClick={() => pick("chat")}>Cho phép trong cuộc trò chuyện này</button>
        <button className="btn dark" onClick={() => pick("always")} autoFocus>Luôn cho phép</button>
      </div>
    </div>
  );
}
