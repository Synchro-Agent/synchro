"use client";
// Cài đặt → Connectors: kết nối Synchro với ứng dụng khác qua MCP (giống Connectors của Claude).
// Phần chính là Composio (một connector cho hơn 1000 ứng dụng, quản trị viên thêm khóa một lần, mỗi người kết nối ứng dụng của mình ngay trong chat);
// phần riêng cho người tự thêm connector bằng địa chỉ máy chủ MCP, đăng nhập OAuth trong cửa sổ bật lên,
// bật/tắt từng connector và đặt quyền từng công cụ (luôn cho phép / hỏi trước / chặn). Kèm thẻ duyệt công cụ dùng trong chat.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, NO_SERVER } from "./apierr";
import * as I from "./icons";
import { useApp } from "./store";
import { ConnLogo } from "./connlogo";
export { ConnLogo };
import type { ApprovalCall, Decision } from "./llm";
import { BulkBar, BulkButton, BulkCheck, bulkRow, each, useBulk, type Bulk, type BulkAct } from "./bulk";
import { PageBar, usePage } from "./pager";
import { tr } from "./i18n";
import { CONN_CHANGED, loginClaims } from "./connwatch";

type Perm = "allow" | "chat" | "ask" | "block";
type Tool = { name: string; title: string; description: string; readOnly: boolean; guessed?: boolean; destructive: boolean; perm: Perm; locked?: "setting" | "admin" };
type Settings = { chat: boolean; projects: boolean; newTools: "auto" | "ask" | "block"; destructive: boolean; maxCalls: number };
export type Conn = {
  id: string; name: string; url: string; host: string; dir: string | null; logo?: string; color?: string; icon?: string; enabled: boolean;
  status: "ok" | "needs_auth" | "forbidden" | "error"; error: string | null; serverName: string | null; auth: "none" | "oauth" | "token" | "composio"; tools: Tool[]; checkedAt: number | null;
  settings: Settings; adminBlocked: boolean; lastError?: string | null; vendorBlocked?: { why: string; whyVi: string } | null; needsScope?: boolean; toolsTotal?: number | null; tokenHeader?: string; ownClient?: boolean;
};
type Policy = { custom: boolean; allowed: string[]; destructive: boolean };
// Composio của tài khoản: active (đang chạy), no_key (quản trị viên chưa thêm khóa), blocked (quản trị viên không cho tài khoản này), error.
export type ComposioInfo = { state: "active" | "no_key" | "blocked" | "error"; admin: boolean; connector: Conn | null; apps: number | null };
export type ComposioApp = { id: string; app: string; name: string; logo?: string; status: string; alias?: string; createdAt: string | null };
type Data = { connectors: Conn[]; composio?: ComposioInfo; policy: Policy };
type Res = { connectors: Conn[]; connector?: Conn; authorizeUrl?: string; error?: string };

async function api<T = Res>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await apiFetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j as { error?: string } | null)?.error || (r.status >= 500 ? NO_SERVER : `Lỗi ${r.status}`));
  if (j === null) throw new Error(NO_SERVER);
  return j as T;
}

const PERM_LABEL: Record<Perm, string> = { allow: "Always allow", chat: "Ask once per chat", ask: "Ask every time", block: "Blocked" };


// ---- đăng nhập trong cửa sổ bật lên ----
// Trang Synchro gửi COOP same-origin (WebContainer cần): cửa sổ đăng nhập vừa sang trang của hãng là bị tách khỏi trang này, window.opener mất và w.closed luôn báo true.
// Nên không theo dõi cửa sổ nữa: trang quay về báo kết quả qua BroadcastChannel; phòng khi trình duyệt không chuyển được tin, trang chính tự hỏi lại máy chủ mỗi 2 giây và khi
// người dùng quay lại tab. Chỉ mở cửa sổ khi đã có địa chỉ đăng nhập: connector bị từ chối hay không cần đăng nhập thì không có cửa sổ nào chớp lên.
const CHANNEL = "synchro-connector";
const FLOW_TTL = 15 * 60_000;
const STALE_AFTER = 10_000;
type LoginResult = { ok: boolean; id: string | null; message: string };
// Địa chỉ đăng nhập do máy chủ của connector khai báo: chỉ https. Nó được mở trong cửa sổ cùng nguồn với Synchro, địa chỉ javascript: sẽ chạy mã bằng phiên của người dùng.
const safeLogin = (raw: string) => { try { const u = new URL(raw); return u.protocol === "https:" || (u.protocol === "http:" && location.protocol === "http:"); } catch { return false; } };
const openLogin = (url: string) => window.open(url, "synchro-connector", "popup,width=560,height=720");
const tag = (c: Conn) => ({ id: c.id, checked: c.checkedAt, lastErr: c.lastError ?? null, at: Date.now() });

/** any: nhận cả kết quả của luồng do thẻ khác mở (trang Connectors); mặc định chỉ nhận luồng của chính nó. */
function useLoginFlow(onDone: (m: LoginResult) => void, o: { any?: boolean; onList?: (d: Data) => void } = {}) {
  const flow = useRef<ReturnType<typeof tag> | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // Trình duyệt chặn cửa sổ (đã quá lâu kể từ lúc bấm): cần người dùng bấm thêm một lần.
  const [blocked, setBlocked] = useState<{ id: string; url: string } | null>(null);
  // Địa chỉ đăng nhập của luồng đang chờ: bấm lại thì mở đúng địa chỉ này, không gọi máy chủ rồi mở cửa sổ sau một lần chờ nữa (trình duyệt sẽ lại chặn).
  const last = useRef<string | null>(null);
  // Người dùng đã quay lại trang mà chưa có kết quả: cửa sổ đăng nhập có thể đã đóng (COOP che mất w.closed nên không biết chắc), đừng nói mãi là "đang chờ".
  const [stale, setStale] = useState(false);
  const cb = useRef({ onDone, ...o });
  cb.current = { onDone, ...o };
  const finish = useCallback((m: LoginResult) => { flow.current = null; last.current = null; setPending(null); setBlocked(null); setStale(false); cb.current.onDone(m); }, []);
  useEffect(() => {
    const seen = new Set<string>();
    // Không biết kết quả của connector nào (id null: phiên đăng nhập hết hạn, sai tài khoản) thì luồng đang chờ cũng đã kết thúc.
    const mine = (id: string | null) => !!cb.current.any || (!!flow.current && (flow.current.id === id || id === null));
    loginClaims.add(mine);
    const take = (d: LoginResult & { type?: string; nonce?: string }) => {
      if (d?.type !== CHANNEL || (d.nonce && seen.has(d.nonce))) return;
      if (d.nonce) seen.add(d.nonce);
      if (mine(d.id)) finish({ ok: d.ok, id: d.id, message: d.message });
    };
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = (e) => { if (e.data?.type === CHANNEL) { bc?.postMessage({ type: `${CHANNEL}-ack`, nonce: e.data.nonce }); take(e.data); } };
    } catch {}
    const onMsg = (e: MessageEvent) => { if (e.origin === location.origin) take(e.data); };
    window.addEventListener("message", onMsg);
    const check = async (back?: unknown) => {
      const f = flow.current;
      if (!f) return;
      if (Date.now() - f.at > FLOW_TTL) { flow.current = null; last.current = null; setPending(null); setStale(false); return; }
      const d = await api<Data>("GET", "/api/connectors").catch(() => null);
      if (!d || flow.current !== f) return;
      cb.current.onList?.(d);
      const c = d.connectors.find((x) => x.id === f.id);
      if (!c) { flow.current = null; last.current = null; setPending(null); setStale(false); return; }
      if (c.status === "ok" && c.checkedAt !== f.checked) finish({ ok: true, id: c.id, message: `Đã kết nối ${c.name}` });
      else if (c.status !== "ok" && c.error) finish({ ok: false, id: c.id, message: c.error });
      else if (c.status === "ok" && (c.lastError ?? null) !== f.lastErr && c.lastError) finish({ ok: false, id: c.id, message: c.lastError });
      else if (back && Date.now() - f.at > STALE_AFTER) setStale(true);
    };
    const onFocus = () => check(true);
    window.addEventListener("focus", onFocus);
    const t = window.setInterval(check, 2000);
    return () => { loginClaims.delete(mine); bc?.close(); window.removeEventListener("message", onMsg); window.removeEventListener("focus", onFocus); clearInterval(t); };
  }, [finish]);
  // Sau khi máy chủ trả về: có địa chỉ đăng nhập thì mở cửa sổ và bắt đầu chờ. true: đang chờ đăng nhập.
  const follow = useCallback((r: Res) => {
    if (!r.authorizeUrl || !r.connector) return false;
    if (!safeLogin(r.authorizeUrl)) throw new Error("Máy chủ của connector đưa địa chỉ đăng nhập không an toàn nên Synchro không mở.");
    flow.current = tag(r.connector);
    last.current = r.authorizeUrl;
    setPending(r.connector.id);
    setStale(false);
    if (openLogin(r.authorizeUrl)) setBlocked(null); else setBlocked({ id: r.connector.id, url: r.authorizeUrl });
    return true;
  }, []);
  // Bấm lại (bị chặn, hoặc lỡ đóng cửa sổ): mở ngay trong lúc bấm nên trình duyệt cho phép. Đã bấm mà vẫn bị chặn (chính sách trình duyệt) thì đăng nhập ngay trong tab này.
  const reopen = useCallback(() => {
    const url = blocked?.url ?? last.current;
    if (!url) return;
    if (flow.current) flow.current.at = Date.now();
    setStale(false);
    if (openLogin(url)) setBlocked(null);
    else if (blocked) location.href = url;
    else if (flow.current) setBlocked({ id: flow.current.id, url });
  }, [blocked]);
  return { follow, pending, blocked, reopen, stale };
}

const LoginBlocked = ({ onOpen }: { onOpen: () => void }) => (
  <div className="cn-pop"><I.External size={14} /><span>Your browser blocked the sign-in window.</span><button className="btn" onClick={onOpen}>Open sign-in window</button></div>
);
const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  return m < 1 ? "Checked just now" : m < 60 ? `Checked ${m} min ago` : m < 2880 ? `Checked ${Math.round(m / 60)} h ago` : `Checked ${Math.round(m / 1440)} d ago`;
};

// Danh sách connector cho thẻ kết nối lại trong chat: nhiều thẻ cùng lúc chỉ hỏi máy chủ một lần.
let listCache: { at: number; p: Promise<Data | null> } | null = null;
const connList = () => {
  if (!listCache || Date.now() - listCache.at > 5000) listCache = { at: Date.now(), p: api<Data>("GET", "/api/connectors").catch(() => null) };
  return listCache.p;
};
// Connector cần kết nối lại, ngay trong khung chat (Synchro nói cần tới nó, hoặc nó vừa mất đăng nhập giữa lượt). Nằm trong .ai-msg nên chữ giao diện dịch bằng tr().
// done: câu trả lời đã xong: thẻ vẫn ở lại (model vừa bảo người dùng bấm nó), nhưng connector đã chạy lại rồi hay đã gỡ thì thôi không hiện.
// refused: máy chủ từ chối một công cụ (403) dù connector còn chạy: cần đi thẳng tới trang đăng nhập để đổi tài khoản hay quyền, thử lại danh sách công cụ không giải quyết được gì.
export function ReconnectCard({ c, done }: { c: { id: string; name: string; logo?: string; color?: string; auth?: string; refused?: boolean }; done?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "ok">("idle");
  const [err, setErr] = useState("");
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<Conn | null | undefined>(undefined);
  const f = useLoginFlow((m) => { setState(m.ok ? "ok" : "idle"); if (!m.ok) setErr(m.message); });
  useEffect(() => {
    let live = true;
    const load = () => { connList().then((d) => { if (live && d) setInfo(d.connectors.find((x) => x.id === c.id) ?? null); }); };
    const changed = () => { listCache = null; load(); };
    load();
    window.addEventListener(CONN_CHANGED, changed);
    return () => { live = false; window.removeEventListener(CONN_CHANGED, changed); };
  }, [c.id]);
  const isToken = (info?.auth ?? c.auth) === "token";
  const refused = info?.status === "forbidden" || !!c.refused;
  const go = async () => {
    setState("busy"); setErr("");
    try {
      const body = isToken ? { token } : refused ? { force: true } : undefined;
      const r = await api("POST", `/api/connectors/${c.id}/connect`, body);
      listCache = null;
      if (f.follow(r)) { setState("idle"); return; }
      setState(r.connector?.status === "ok" ? "ok" : "idle");
    } catch (x) { setState("idle"); setErr((x as Error).message); }
  };
  if (done && state !== "ok" && !f.pending && (info === null || (info?.status === "ok" && !c.refused))) return null;
  const waiting = !!f.pending && state !== "ok";
  const line = state === "ok" ? "Đã kết nối lại. Hãy gửi lại yêu cầu của bạn." : waiting ? (f.stale ? "Chưa đăng nhập xong? Hãy mở lại cửa sổ đăng nhập." : "Đang chờ bạn đăng nhập trong cửa sổ vừa mở…") : isToken ? "Máy chủ từ chối token của connector này. Hãy nhập token mới." : refused ? "Máy chủ từ chối quyền truy cập của tài khoản này. Hãy kết nối lại, hoặc kiểm tra quyền của tài khoản." : "Connector này cần kết nối lại để Synchro dùng được.";
  return (
    <div className="ag-ask cn-rc" role="group" aria-label={c.name}>
      <div className="ag-ask-h"><ConnLogo logo={c.logo} color={c.color} name={c.name} size={28} />
        <div><b data-notr>{c.name}</b><span>{tr(line)}</span></div>
      </div>
      {err && <div className="api-err" role="alert"><I.Alert size={14} /><span data-notr>{tr(err)}</span></div>}
      {f.blocked && <div className="cn-pop"><I.External size={14} /><span>{tr("Trình duyệt đã chặn cửa sổ đăng nhập.")}</span><button className="btn" onClick={f.reopen}>{tr("Mở cửa sổ đăng nhập")}</button></div>}
      {state !== "ok" && isToken && !f.blocked && <form className="ag-ask-note" onSubmit={(e) => { e.preventDefault(); if (token.trim() && state !== "busy") go(); }}>
        <input type="password" autoComplete="off" spellCheck={false} aria-label={tr("Token mới")} placeholder={tr("Token mới")} value={token} onChange={(e) => setToken(e.target.value)} />
        <button type="submit" className="btn dark" disabled={state === "busy" || !token.trim()}>{state === "busy" ? <span className="api-spin" /> : null}{tr("Lưu token")}</button>
      </form>}
      {state !== "ok" && !isToken && !f.blocked && <div className="ag-ask-a"><button className="btn dark" disabled={state === "busy"} onClick={waiting ? f.reopen : go}>{state === "busy" ? <span className="api-spin" /> : null}{tr(waiting ? "Mở lại cửa sổ đăng nhập" : err ? "Thử lại" : "Kết nối lại")}</button></div>}
    </div>
  );
}
// Menu + ở ô chat: connector chưa dùng được thì thay nút bật / tắt bằng liên kết kết nối lại. Hãng chưa duyệt Synchro thì đưa tới Connectors để xem lý do.
export function ReconnectLink({ c, onDone, onManage, say }: { c: Conn; onDone: () => void; onManage: () => void; say: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const f = useLoginFlow((m) => { say(m.message); onDone(); });
  if (c.vendorBlocked || c.auth === "token") return <button className="cn-link cm-rec" onClick={onManage}>{c.vendorBlocked ? "Cần hãng duyệt" : "Nhập lại token"}</button>;
  const go = async () => {
    if (f.blocked || f.pending) return f.reopen();
    setBusy(true);
    try { const r = await api("POST", `/api/connectors/${c.id}/connect`); if (!f.follow(r)) { say(r.connector?.status === "ok" ? `Đã kết nối ${c.name}` : c.name); onDone(); } }
    catch (x) { say((x as Error).message); onDone(); }
    finally { setBusy(false); }
  };
  return <button className="cn-link cm-rec" disabled={busy} onClick={go}>{busy ? <span className="api-spin" /> : f.blocked ? "Mở cửa sổ đăng nhập" : f.pending ? "Đang chờ đăng nhập…" : "Kết nối lại"}</button>;
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
            <div className="cn-tool-n"><span data-notr>{t.title}</span>{t.title !== t.name && <span className="mono-s" data-notr>{t.name}</span>}{t.guessed && <span className="cn-tag" title="The server doesn't say whether this tool changes data. Synchro judged it read-only from its name. Set it to Ask every time if you prefer.">Unclassified</span>}</div>
            {t.description && <div className="cn-tool-d" data-notr>{t.description}</div>}
          </div>
          <PermSelect label={`Permission for ${t.title}`} value={t.perm} onChange={(p) => onPerm(t, p)} locked={t.locked ? LOCK_NOTE[t.locked] : undefined} />
        </div>
      ))}
    </div>
  );
}

function ConnectorCard({ c, policy, open, busy, waiting, stale, onDismissScope, onToggleOpen, onEnable, onConnect, onReauth, onCreds, onRefresh, onRemove, onPerm, onGroup, onSettings, bk }: {
  c: Conn; policy: Policy; open: boolean; busy: boolean; waiting: boolean; stale: boolean; onDismissScope: () => void; onToggleOpen: () => void; onEnable: (v: boolean) => void; onConnect: () => void; onReauth: () => void; onCreds: (mode: CredMode) => void; onRefresh: () => void; onRemove: () => void;
  onPerm: (t: Tool, p: Perm) => void; onGroup: (k: "read" | "write", p: Perm) => void; onSettings: (s: Partial<Settings>) => void; bk: Bulk<Conn>;
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
  const toolCount = c.toolsTotal ? `${c.tools.length} of ${c.toolsTotal} tools` : `${c.tools.length} ${c.tools.length === 1 ? "tool" : "tools"}`;
  const status = c.adminBlocked ? "Turned off by your administrator" : c.status === "ok" ? (c.enabled ? toolCount : "Turned off") : c.vendorBlocked ? "Needs vendor approval" : waiting ? (stale ? "Sign-in not finished" : "Waiting for you to sign in…") : c.status === "forbidden" ? "Access refused" : c.auth === "token" && c.status === "needs_auth" ? "Token rejected" : c.status === "needs_auth" ? "Needs to be connected" : "Connection problem";
  return (
    <div className={`cn-card ${open && !bk.on ? "open" : ""} ${c.status !== "ok" || c.adminBlocked ? "attn" : ""}`} {...bulkRow(bk, c)}>
      <div className="cn-card-h">
        <button className="cn-card-main" onClick={c.status === "ok" ? onToggleOpen : undefined} aria-expanded={c.status === "ok" ? open : undefined} disabled={c.status !== "ok" && !bk.on}>
          {bk.on && <BulkCheck on={bk.has(c)} />}
          <ConnLogo logo={c.logo} color={c.color} icon={c.icon} name={c.name} />
          <span className="cn-meta">
            <span className="cn-name"><b data-notr>{c.name}</b>{c.dir === null && <span className="cn-tag">Custom</span>}</span>
            <span className={`cn-sub ${c.adminBlocked ? "error" : c.status}`}><i />{status}<span className="cn-host" data-notr><b className="cn-dot">·</b>{c.host}</span></span>
          </span>
          {c.status === "ok" && <span className="cn-chev"><I.ChevronR size={14} /></span>}
        </button>
        {!bk.on && <div className="cn-actions">
          {c.status === "ok" || c.adminBlocked
            ? <button className={`cn-switch ${c.enabled && !c.adminBlocked ? "on" : ""}`} role="switch" aria-checked={c.enabled && !c.adminBlocked} aria-label={c.enabled ? "Turn off connector" : "Turn on connector"} onClick={() => onEnable(!c.enabled)} disabled={busy || c.adminBlocked}><i /></button>
            : c.vendorBlocked ? <button className="btn cn-connect" onClick={onConnect} disabled={busy}>{busy ? <span className="api-spin" /> : null}Try again</button>
            : c.auth === "token" && c.status === "needs_auth" ? <button className="btn dark cn-connect" onClick={() => onCreds("token")} disabled={busy}>Update token</button>
            : <button className="btn dark cn-connect" onClick={c.status === "forbidden" && !waiting ? onReauth : onConnect} disabled={busy}>{busy ? <span className="api-spin" /> : null}{waiting ? "Open sign-in window" : c.status === "error" ? "Try again" : c.status === "forbidden" || (c.status === "needs_auth" && c.checkedAt) ? "Reconnect" : "Connect"}</button>}
          <div className="cn-more" ref={mref}>
            <button className="icon-btn" aria-label="More options" aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={busy}>{busy && c.status === "ok" ? <span className="api-spin" /> : <I.Dots size={16} />}</button>
            {menu && (
              <div className="cn-menu" role="menu">
                {c.status === "ok" && <button role="menuitem" onClick={() => { setMenu(false); onRefresh(); }}><I.Retry size={15} />Refresh tools</button>}
                {c.auth === "oauth" && c.status === "ok" && <button role="menuitem" onClick={() => { setMenu(false); onReauth(); }}><I.Key size={15} />Reconnect account</button>}
                {c.auth === "token" && <button role="menuitem" onClick={() => { setMenu(false); onCreds("token"); }}><I.Key size={15} />Update token</button>}
                {c.ownClient && <button role="menuitem" onClick={() => { setMenu(false); onCreds("client"); }}><I.Key size={15} />Update OAuth client</button>}
                <button role="menuitem" className="danger" onClick={() => { setMenu(false); onRemove(); }}><I.Trash size={15} />Disconnect</button>
              </div>
            )}
          </div>
        </div>}
      </div>
      {c.status !== "ok" && c.vendorBlocked && (
        <div className="cn-vendor">
          <p>{c.vendorBlocked.why}</p>
          <p className="d">You can try your own token or API key, though this vendor may not accept one. Synchro tests it first and saves it only if it works. If the vendor gave you an OAuth client, you can use that instead.</p>
          <div className="cn-vendor-a"><button className="cn-link" onClick={() => onCreds("token")}>Use a token instead</button><button className="cn-link" onClick={() => onCreds("client")}>Use my OAuth client</button></div>
        </div>
      )}
      {c.status !== "ok" && c.error && <div className="api-err in" role="alert"><I.Alert size={14} /><span>{c.error}</span></div>}
      {c.status === "ok" && c.needsScope && <div className="cn-pop in"><I.Key size={14} /><span>{c.auth === "token" ? "A tool needs more access than this token allows. Other tools keep working." : "A tool needs more access than this sign-in allows. Other tools keep working."}</span>{c.auth === "token" ? <button className="btn" disabled={busy} onClick={() => onCreds("token")}>Update token</button> : <button className="btn" disabled={busy} onClick={onReauth}>Grant more access</button>}<button className="icon-btn" aria-label="Dismiss" onClick={onDismissScope}><I.X size={13} /></button></div>}
      {c.status === "ok" && c.lastError && <div className="cn-warnline"><I.Alert size={13} /><span>Last check failed. Tools keep working with the list from the last good check. </span><span>{c.lastError}</span></div>}
      {open && !bk.on && c.status === "ok" && (
        <div className="cn-body">
          <ConnSettings c={c} policy={policy} onSettings={onSettings} />
          {c.tools.length > 8 && <div className="s-search cn-search"><I.Search size={14} /><input placeholder="Search tools" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
          {c.tools.length === 0 ? <p className="d cn-empty-tools">This server doesn&apos;t offer any tools yet.</p> : <>
            <ToolGroup title="Read-only tools" hint="Look things up without changing anything." kind="read" tools={shown.filter((t) => t.readOnly)} onPerm={onPerm} onGroup={onGroup} />
            <ToolGroup title="Tools that can make changes" hint="May create, change or delete data, or the server doesn't say they're read-only." kind="write" tools={shown.filter((t) => !t.readOnly)} onPerm={onPerm} onGroup={onGroup} />
            {ql && !shown.length && <p className="d cn-empty-tools">No tools match your search.</p>}
          </>}
          <div className="cn-foot"><span data-notr>{c.serverName ? `${c.serverName} · ` : ""}{c.url}</span>{c.checkedAt ? <span> · {ago(c.checkedAt)}</span> : null}</div>
        </div>
      )}
    </div>
  );
}

// Cách đăng nhập khi thêm connector: tự động (không cần đăng nhập, hoặc OAuth), token / API key tự nhập, hay OAuth client riêng.
type CredMode = "auto" | "token" | "client";
type CustomInit = { name?: string; url?: string; mode?: CredMode; id?: string; locked?: boolean; header?: string };
type CustomValues = { name: string; url: string; clientId: string; clientSecret: string; token: string; header: string };
function Custom({ init, onClose, onAdd }: { init: CustomInit; onClose: () => void; onAdd: (v: CustomValues, done: (err?: string) => void) => void }) {
  const [name, setName] = useState(init.name ?? "");
  const [url, setUrl] = useState(init.url ?? "");
  const [mode, setMode] = useState<CredMode>(init.mode ?? "auto");
  const [cid, setCid] = useState("");
  const [sec, setSec] = useState("");
  const [token, setToken] = useState("");
  // Đổi token: hiện sẵn tên header đang dùng (không bí mật) để khỏi gửi nhầm chỗ.
  const [header, setHeader] = useState(init.header ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const urlOk = /^https?:\/\/[^\s/]+/i.test(url.trim());
  const can = !busy && name.trim().length > 0 && urlOk && (mode !== "token" || token.trim().length > 0) && (mode !== "client" || cid.trim().length > 0);
  const submit = () => {
    if (!can) return;
    setBusy(true); setErr("");
    onAdd({ name, url, clientId: mode === "client" ? cid : "", clientSecret: mode === "client" ? sec : "", token: mode === "token" ? token : "", header: mode === "token" ? header : "" }, (e) => { setBusy(false); if (e) setErr(e); });
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal sm cn-custom" role="dialog" aria-label={init.locked ? "Connect" : "Add custom connector"} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="cn-custom-h"><h2>{init.locked ? <span data-notr>{name}</span> : "Add custom connector"}</h2>{!init.locked && <span className="cn-beta">Beta</span>}</div>
        <p className="d">{init.locked ? "Connect with your own credentials. They are encrypted on the server and never shown again." : "Connect Synchro to any remote MCP server. If the server needs you to sign in, a window opens so you can approve access."}</p>
        {!init.locked && <>
          <label className="api-lbl" htmlFor="cn-name">Name</label>
          <input id="cn-name" className="field" autoFocus maxLength={60} placeholder="e.g. Company wiki" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="api-lbl" htmlFor="cn-url">Remote MCP server URL</label>
          <input id="cn-url" className="field" data-notr spellCheck={false} autoComplete="off" placeholder="https://example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
        </>}
        <div className="api-lbl" id="cn-mode">How to sign in</div>
        <div className="cn-pills cn-modes" role="radiogroup" aria-labelledby="cn-mode">
          {!init.locked && <button type="button" role="radio" aria-checked={mode === "auto"} className={mode === "auto" ? "on" : ""} onClick={() => setMode("auto")}>Automatic</button>}
          <button type="button" role="radio" aria-checked={mode === "token"} className={mode === "token" ? "on" : ""} onClick={() => setMode("token")}>Token or API key</button>
          <button type="button" role="radio" aria-checked={mode === "client"} className={mode === "client" ? "on" : ""} onClick={() => setMode("client")}>My OAuth client</button>
        </div>
        {mode === "token" && <>
          <label className="api-lbl" htmlFor="cn-token">Token or API key</label>
          <input id="cn-token" className="field" data-notr type="password" spellCheck={false} autoComplete="off" autoFocus={init.locked} value={token} onChange={(e) => setToken(e.target.value)} />
          <label className="api-lbl" htmlFor="cn-header">Header name<span className="d"> · optional</span></label>
          <input id="cn-header" className="field" data-notr spellCheck={false} autoComplete="off" placeholder="Authorization" value={header} onChange={(e) => setHeader(e.target.value)} />
          <p className="cn-hint">Sent as Authorization: Bearer … unless you name another header, such as X-API-Key. Saved encrypted and never shown again.</p>
        </>}
        {mode === "client" && <>
          <label className="api-lbl" htmlFor="cn-cid">OAuth Client ID</label>
          <input id="cn-cid" className="field" data-notr spellCheck={false} autoComplete="off" value={cid} onChange={(e) => setCid(e.target.value)} />
          <label className="api-lbl" htmlFor="cn-sec">OAuth Client Secret<span className="d"> · optional</span></label>
          <input id="cn-sec" className="field" data-notr type="password" spellCheck={false} autoComplete="off" value={sec} onChange={(e) => setSec(e.target.value)} />
          <p className="cn-hint">Only needed when the server doesn&apos;t let apps register themselves. Use this callback URL in that app&apos;s settings: <span className="mono-s" data-notr>{`${location.origin}/api/connectors/oauth/callback`}</span></p>
        </>}
        {!init.locked && <div className="cn-warn"><I.Alert size={15} /><span>Only use connectors from developers you trust. Synchro doesn&apos;t review custom connectors, and a connector can read what you share with it and act in that service on your behalf.</span></div>}
        {err && <div className="api-err" role="alert"><I.Alert size={14} /><span>{err}</span></div>}
        <div className="api-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn dark" disabled={!can}>{busy ? <><span className="api-spin" />Connecting…</> : init.locked ? "Connect" : "Add"}</button>
        </div>
      </form>
    </div>
  );
}

// Thẻ Composio: là gì, trạng thái, ứng dụng đã kết nối (ngắt từng cái), quyền công cụ. Ứng dụng được kết nối ngay trong chat khi người dùng nhờ.
function ComposioSection({ info, onInfo }: { info: ComposioInfo; onInfo: (i: ComposioInfo) => void }) {
  const app = useApp();
  const [list, setList] = useState<ComposioApp[] | null>(null);
  const [listErr, setListErr] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  type Full = ComposioInfo & { list: ComposioApp[]; appsError?: string; removed?: string };
  const take = (j: Full) => { onInfo({ state: j.state, admin: j.admin, connector: j.connector, apps: j.apps }); setList(j.list); setListErr(j.appsError ?? ""); };
  const loadApps = useCallback(() => api<Full>("GET", "/api/connectors/composio").then(take).catch((e) => setListErr((e as Error).message)), []);
  useEffect(() => { if (info.state === "active") void loadApps(); }, [info.state, loadApps]);
  const retry = async () => {
    setBusy("retry");
    try { take(await api<Full>("GET", "/api/connectors/composio?retry=1")); } catch (e) { app.say((e as Error).message); } finally { setBusy(""); }
  };
  const drop = (a: ComposioApp) => app.confirm(`Disconnect ${a.name}?`, "Synchro will stop using this app through Composio. You can connect it again from chat any time.", "Disconnect", async () => {
    setBusy(a.id);
    try { const j = await api<Full>("DELETE", `/api/connectors/composio?id=${encodeURIComponent(a.id)}`); take(j); app.say(`Disconnected ${a.name}`); }
    catch (e) { app.say((e as Error).message); } finally { setBusy(""); }
  });
  const c = info.connector;
  const patch = async (body: Record<string, unknown>) => {
    if (!c) return;
    try { const r = await api<Res>("PATCH", `/api/connectors/${c.id}`, body); if (r.connector) onInfo({ ...info, connector: r.connector }); }
    catch (e) { app.say((e as Error).message); }
  };
  const on = info.state === "active" && !!c?.enabled;
  const status = info.state === "no_key" ? "Not set up yet" : info.state === "blocked" ? "Turned off by your administrator" : info.state === "error" ? "Connection problem" : !c?.enabled ? "Turned off" : !info.apps ? "Active" : info.apps === 1 ? "Active · 1 app connected" : `Active · ${info.apps} apps connected`;
  const live = (list ?? []).filter((a) => a.status === "ACTIVE" || !a.status);
  const other = (list ?? []).filter((a) => !(a.status === "ACTIVE" || !a.status));
  return (
    <div className={`cn-card cpo-card ${open ? "open" : ""} ${info.state === "error" ? "attn" : ""}`}>
      <div className="cn-card-h">
        <div className="cn-card-main cpo-main">
          <ConnLogo color="#5B4BDB" name="Composio" />
          <span className="cn-meta">
            <span className="cn-name"><b data-notr>Composio</b><span className="cn-tag">1000+ apps</span></span>
            <span className={`cn-sub ${info.state === "active" ? (c?.enabled ? "ok" : "needs_auth") : info.state === "error" ? "error" : "needs_auth"}`}><i />{status}</span>
          </span>
        </div>
        <div className="cn-actions">
          {info.state === "active" && c && <button className={`cn-switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={on ? "Turn off Composio" : "Turn on Composio"} onClick={() => { onInfo({ ...info, connector: { ...c, enabled: !c.enabled } }); void patch({ enabled: !c.enabled }); }}><i /></button>}
          {info.state === "error" && <button className="btn dark cn-connect" disabled={busy === "retry"} onClick={retry}>{busy === "retry" ? <span className="api-spin" /> : null}Try again</button>}
          {info.state === "no_key" && info.admin && <button className="btn dark cn-connect" onClick={() => window.dispatchEvent(new Event("synchro:providers"))}>Add Composio key</button>}
        </div>
      </div>
      <p className="cpo-what">One connector for Gmail, Slack, GitHub, Notion, Google Drive and more than 1000 other apps. Synchro finds the right tool, asks you to sign in to an app the first time it needs it, then works in it during your chats. Sign-ins are handled by Composio, so you never paste keys or client IDs.</p>
      {info.state === "no_key" && <p className="cpo-note">{info.admin ? "Add a Composio project API key in Settings → Providers. Everyone on this Synchro then gets Composio here, and each person connects their own apps." : "Your administrator hasn't added a Composio key yet, so Composio isn't available."}</p>}
      {info.state === "blocked" && <p className="cpo-note">Your administrator hasn&apos;t allowed Composio for your account.</p>}
      {info.state === "error" && c?.error && <div className="api-err in" role="alert"><I.Alert size={14} /><span>{c.error}</span></div>}
      {info.state === "active" && (
        <div className="cpo-apps">
          <div className="cpo-apps-h">Connected apps</div>
          {list === null && !listErr ? <div className="cpo-row d"><span className="api-spin" /><span>Loading…</span></div>
            : listErr ? <div className="api-err in" role="alert"><I.Alert size={14} /><span>{listErr}</span><button className="btn" onClick={() => void loadApps()}>Try again</button></div>
            : !live.length && !other.length ? <div className="cpo-row d">No apps connected yet.</div>
            : [...live, ...other].map((a) => (
              <div key={a.id} className="cpo-row">
                <ConnLogo logo={a.logo} name={a.name} size={28} />
                <span className="cpo-app"><b data-notr>{a.name}</b>{a.alias && <span className="d" data-notr>{a.alias}</span>}{a.status && a.status !== "ACTIVE" && <span className="cn-tag">{a.status === "EXPIRED" ? "Expired" : a.status === "FAILED" ? "Failed" : "Inactive"}</span>}</span>
                <button className="btn cpo-drop" disabled={busy === a.id} onClick={() => drop(a)}>{busy === a.id ? <span className="api-spin" /> : null}Disconnect</button>
              </div>
            ))}
          <p className="cpo-tip"><I.Sparkle size={13} /><span>To connect an app, just ask in chat, for example “Summarize my latest emails in Gmail”. Synchro shows a Connect button when an app needs your sign-in.</span></p>
        </div>
      )}
      {info.state === "active" && c && c.status === "ok" && <>
        <button className="api-adv cpo-perm" aria-expanded={open} onClick={() => setOpen(!open)}><I.ChevronR size={13} />Tool permissions</button>
        {open && <div className="cn-body">
          <ToolGroup title="Read-only tools" hint="Find tools, check connections and run app actions that only read." kind="read" tools={c.tools.filter((t) => t.readOnly)} onPerm={(t, p) => { onInfo({ ...info, connector: { ...c, tools: c.tools.map((y) => (y.name === t.name ? { ...y, perm: p } : y)) } }); void patch({ perms: { [t.name]: p } }); }} onGroup={(k, p) => void patch({ group: { kind: k, perm: p } })} />
          <ToolGroup title="Tools that can make changes" hint="Run actions in your apps, such as sending an email. Actions that only read run without asking." kind="write" tools={c.tools.filter((t) => !t.readOnly)} onPerm={(t, p) => { onInfo({ ...info, connector: { ...c, tools: c.tools.map((y) => (y.name === t.name ? { ...y, perm: p } : y)) } }); void patch({ perms: { [t.name]: p } }); }} onGroup={(k, p) => void patch({ group: { kind: k, perm: p } })} />
        </div>}
      </>}
    </div>
  );
}

export function ConnectorsPanel() {
  const app = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  // Nhiều mục có thể đang kết nối cùng lúc: hãng đang treo không được khóa nút của các mục khác.
  const [busy, setBusySet] = useState<ReadonlySet<string>>(() => new Set());
  const mark = (id: string, on: boolean) => setBusySet((b) => { const n = new Set(b); if (on) n.add(id); else n.delete(id); return n; });
  const [custom, setCustom] = useState<CustomInit | null>(null);

  const load = useCallback(() => api<Data>("GET", "/api/connectors").then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const apply = (r: Res) => setData((d) => (d ? { ...d, connectors: r.connectors } : d));
  const setCx = (composio: ComposioInfo) => setData((d) => (d ? { ...d, composio } : d));

  // Kết quả đăng nhập: báo từ cửa sổ đăng nhập, hoặc tự thấy khi hỏi lại máy chủ (xem useLoginFlow).
  const login = useLoginFlow((m) => {
    app.say(m.message);
    load().then(() => { if (m.ok && m.id) setOpen(m.id); });
  }, { any: true, onList: (d) => setData(d) });
  const finished = (r: Res) => { apply(r); if (r.connector?.status === "ok") { app.say(`Connected ${r.connector.name}`); setOpen(r.connector.id); } };

  const addCustom = async (init: CustomInit, v: CustomValues, done: (err?: string) => void) => {
    // Connector đã có (thẻ Canva chờ kết nối…): dùng thông tin mới cho chính nó, giữ quyền đã đặt.
    try { const r = init.id ? await api("POST", `/api/connectors/${init.id}/connect`, { token: v.token, header: v.header, clientId: v.clientId, clientSecret: v.clientSecret }) : await api("POST", "/api/connectors", v); done(); setCustom(null); apply(r); if (!login.follow(r)) finished(r); }
    catch (x) { done((x as Error).message); load(); }
  };
  const reconnect = async (c: Conn, force = false) => {
    // Đang chờ đăng nhập: mở lại đúng địa chỉ đã có.
    if (login.pending === c.id) return login.reopen();
    mark(c.id, true);
    try { const r = await api("POST", `/api/connectors/${c.id}/connect`, force ? { force: true } : undefined); apply(r); if (!login.follow(r)) finished(r); }
    catch (x) { app.say((x as Error).message); load(); }
    finally { mark(c.id, false); }
  };
  const refresh = async (c: Conn) => {
    mark(c.id, true);
    try { apply(await api("POST", `/api/connectors/${c.id}/refresh`)); app.say("Tools refreshed"); }
    catch (x) { app.say((x as Error).message); load(); }
    finally { mark(c.id, false); }
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
  // Chọn hàng loạt: bật / tắt, làm mới công cụ, ngắt kết nối nhiều connector cùng lúc.
  const bk = useBulk(conns, (c) => c.id);
  const pgC = usePage(conns, 10);
  const ok = (c: Conn) => c.status === "ok" && !c.adminBlocked;
  const acts: BulkAct<Conn>[] = [
    { id: "on", label: "Bật", icon: <I.Power size={14} />, when: (l) => l.some((c) => ok(c) && !c.enabled), run: (l) => each(l.filter((c) => ok(c) && !c.enabled), (c) => patch(c, { enabled: true }, (x) => ({ ...x, enabled: true }))) },
    { id: "off", label: "Tắt", icon: <I.M icon="Pause" size={14} />, when: (l) => l.some((c) => ok(c) && c.enabled), run: (l) => each(l.filter((c) => ok(c) && c.enabled), (c) => patch(c, { enabled: false }, (x) => ({ ...x, enabled: false }))) },
    { id: "refresh", label: "Làm mới công cụ", icon: <I.Retry size={14} />, when: (l) => l.some(ok), run: async (l) => { await each(l.filter(ok), async (c) => apply(await api("POST", `/api/connectors/${c.id}/refresh`))); app.say("Tools refreshed"); } },
    { id: "del", label: "Ngắt kết nối", icon: <I.Trash size={14} />, danger: true,
      confirm: (l) => ({ title: `Ngắt kết nối ${l.length} connector?`, text: "Synchro sẽ thôi dùng các connector này và quên đăng nhập của chúng. Bạn có thể kết nối lại sau.", ok: "Ngắt kết nối" }),
      run: async (l) => { await each(l, async (c) => apply(await api("DELETE", `/api/connectors/${c.id}`))); app.say(`Đã ngắt kết nối ${l.length} connector`); } },
  ];
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
      {data.composio && <ComposioSection info={data.composio} onInfo={setCx} />}
      <h3 className="sec cpo-sec">Your own connectors</h3>
      <p className="d cpo-sec-d">For people who run their own MCP server or want to connect a service themselves, with its URL and OAuth sign-in, a token or their own OAuth client.</p>
      <div className="cn-bar">
        {data.policy.custom && <button className="btn" onClick={() => setCustom({})}><I.Plus size={14} />Add custom connector</button>}
        {conns.length > 0 && <><span style={{ flex: 1 }} /><BulkButton b={bk} /></>}
      </div>
      {login.blocked && <LoginBlocked onOpen={login.reopen} />}
      {conns.length === 0 ? (
        <div className="cn-empty">
          <b>No connectors of your own</b>
          <span className="d">{data.policy.custom ? "Add any remote MCP server by its URL. Most people don't need this: Composio above already covers popular apps." : "Your administrator hasn't allowed custom connectors for your account."}</span>
        </div>
      ) : (
        <div className="cn-list">
          {pgC.items.map((c) => (
            <ConnectorCard key={c.id} c={c} policy={data.policy} open={open === c.id} busy={busy.has(c.id)} waiting={login.pending === c.id} stale={login.stale} onDismissScope={() => patch(c, { dismissScope: true }, (x) => ({ ...x, needsScope: false }))} onToggleOpen={() => setOpen(open === c.id ? null : c.id)}
              onEnable={(v) => patch(c, { enabled: v }, (x) => ({ ...x, enabled: v }))}
              onConnect={() => reconnect(c)} onReauth={() => reconnect(c, true)} onCreds={(mode) => setCustom({ name: c.name, url: c.url, mode, id: c.id, locked: true, header: c.tokenHeader })} onRefresh={() => refresh(c)} onRemove={() => remove(c)}
              onPerm={(t, p) => patch(c, { perms: { [t.name]: p } }, (x) => ({ ...x, tools: x.tools.map((y) => (y.name === t.name ? { ...y, perm: p } : y)) }))}
              onGroup={(k, p) => patch(c, { group: { kind: k, perm: p } }, (x) => ({ ...x, tools: x.tools.map((y) => (y.readOnly === (k === "read") ? { ...y, perm: p } : y)) }))}
              onSettings={(st) => patch(c, { settings: st }, (x) => ({ ...x, settings: { ...x.settings, ...st } }))} bk={bk} />
          ))}
          <PageBar pg={pgC} />
          <BulkBar b={bk} acts={acts} noun="connector" />
        </div>
      )}
      <p className="cn-note"><I.Lock size={12} />Sign-ins are encrypted on the server. Tools that change data ask before running unless you allow them.</p>
      {custom && <Custom init={custom} onClose={() => setCustom(null)} onAdd={(v, done) => addCustom(custom, v, done)} />}
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
