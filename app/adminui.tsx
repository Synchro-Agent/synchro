"use client";

// Tab Quản trị viên. Chỉ hiện với tài khoản quản trị; mọi quyền vẫn được kiểm tra lại ở /api/admin/*.
import { Fragment, useCallback, useEffect, useState } from "react";
import { Avatar } from "./avatar";
import { Fade } from "./ui";
import { useApp } from "./store";
import { getLang } from "./i18n";
import * as I from "./icons";
import type { AuthUser, Providers } from "./auth";

type U = AuthUser & { status: "active" | "suspended"; verified: boolean; lastLogin: number | null; lastSeen: number | null; sessions: number; protected: boolean };
type Log = { id: number; at: number; action: string; actor_email: string | null; target_email: string | null; ip: string | null; detail: string | null };
type Data = {
  stats: { users: number; active7: number; new7: number; suspended: number; sessions: number; failed24: number };
  users: U[]; audit: Log[]; settings: { signupOpen: boolean }; providers: Providers; admins: string[];
};
type Sess = { id: string; device: string; ip: string | null; method: string; createdAt: number; lastSeen: number };
type Detail = { sessions: Sess[]; identities: { provider: string; email: string | null; createdAt: number }[] };

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

const ACTIONS: Record<string, [string, "ok" | "bad" | "adm" | ""]> = {
  signup: ["Signed up", "ok"], login: ["Signed in", ""], login_failed: ["Failed sign-in", "bad"], login_blocked: ["Blocked sign-in", "bad"],
  logout: ["Signed out", ""], oauth_link: ["Linked sign-in method", ""], password_changed: ["Changed password", ""],
  session_revoked: ["Ended a session", ""], sessions_revoked: ["Signed out other devices", ""], account_deleted: ["Deleted own account", "bad"],
  admin_suspend: ["Suspended account", "adm"], admin_restore: ["Restored account", "adm"], admin_signout: ["Signed user out everywhere", "adm"],
  admin_delete: ["Deleted account", "adm"], admin_revoke_session: ["Ended user session", "adm"], admin_signup_open: ["Opened sign-ups", "adm"],
  admin_signup_closed: ["Closed sign-ups", "adm"], admin_created: ["Admin account created", "adm"], admin_password_reset: ["Admin password reset", "adm"],
};
const LOG_FILTER: Record<string, (a: string) => boolean> = {
  All: () => true,
  "Sign-ins": (a) => ["signup", "login", "login_failed", "login_blocked", "logout", "oauth_link"].includes(a),
  "Admin actions": (a) => a.startsWith("admin_"),
};
const ENV: Record<keyof Providers, string> = { google: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET", github: "GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET", apple: "APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY" };

function Seg({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return <div className="group">{options.map((s) => <button key={s} className={value === s ? "on" : ""} onClick={() => onChange(s)}>{s}</button>)}</div>;
}

export function AdminPanel({ Toggle }: { Toggle: (p: { on: boolean; set: (v: boolean) => void }) => React.ReactElement }) {
  const app = useApp();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All");
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [logF, setLogF] = useState("All");
  const [more, setMore] = useState(true);
  const [del, setDel] = useState<U | null>(null);
  const [delTxt, setDelTxt] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => call<Data>("GET", "/api/admin").then((x) => { setD(x); setErr(""); setMore(x.audit.length >= 100); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const loadDetail = (id: string) => call<Detail>("GET", `/api/admin/users/${id}`).then(setDetail).catch((e) => app.say(e.message));
  const toggle = (id: string) => { setDetail(null); if (open === id) { setOpen(null); return; } setOpen(id); loadDetail(id); };

  // Chạy thao tác rồi tải lại toàn bộ để số liệu, danh sách và nhật ký luôn khớp nhau.
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); app.say(ok); await load(); if (open) loadDetail(open); } catch (e) { app.say((e as Error).message); } finally { setBusy(false); }
  };

  if (err) return <div className="empty" style={{ marginTop: 80 }}><I.Alert size={28} /><span>{err}</span><button className="btn" onClick={load}>Try again</button></div>;
  if (!d) return <div className="empty" style={{ marginTop: 80 }}><span className="muted">Loading…</span></div>;

  const s = d.stats;
  const ql = q.trim().toLowerCase();
  const users = d.users.filter((u) => (filter === "All" || (filter === "Active") === (u.status === "active")) && (!ql || u.email.toLowerCase().includes(ql) || u.name.toLowerCase().includes(ql)));
  const logs = d.audit.filter((l) => LOG_FILTER[logF](l.action));
  const stats: [string, number, boolean?][] = [["Users", s.users], ["Active in last 7 days", s.active7], ["New in last 7 days", s.new7], ["Active sessions", s.sessions], ["Suspended", s.suspended, s.suspended > 0], ["Failed sign-ins (24h)", s.failed24, s.failed24 > 20]];

  return (
    <>
      <div className="adm-head">
        <div className="adm-badge"><I.Admin size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="s-title">Administrator</div>
          <div className="d">Manage accounts, sessions and sign-in for Synchro. Every action here is recorded in the audit log.</div>
          <div className="adm-owner"><i /><span>Owner</span><span className="em" data-notr>{app.me?.email}</span></div>
        </div>
      </div>

      <div className="adm-stats">
        {stats.map(([l, n, warn]) => <div key={l} className={`adm-stat ${warn ? "warn" : ""}`}><b data-notr>{n.toLocaleString(locale())}</b><span>{l}</span></div>)}
      </div>

      <h3 className="sec">Sign-in</h3>
      <div className="row" style={{ borderTop: 0 }}>
        <div><div className="t">New sign-ups</div><div className="d">Allow new accounts to be created. People who already have an account can still sign in.</div></div>
        <Toggle on={d.settings.signupOpen} set={(v) => act(() => call("PATCH", "/api/admin/settings", { signupOpen: v }), v ? "Sign-ups opened" : "Sign-ups closed")} />
      </div>
      <div className="row"><div><div className="t">Email and password</div><div className="d">Passwords are hashed with scrypt. Accounts lock for 15 minutes after repeated failed attempts.</div></div><span className="s-badge ok">On</span></div>
      {(["google", "github", "apple"] as const).map((p) => (
        <div key={p} className="row">
          <div><div className="t">{METHOD[p]}</div><div className="d">{d.providers[p] ? "Ready. Users can sign in with this provider." : <>Not set up. Add <span className="mono" data-notr>{ENV[p]}</span> to the server environment.</>}</div></div>
          <span className={`s-badge ${d.providers[p] ? "ok" : ""}`}>{d.providers[p] ? "Ready" : "Not set up"}</span>
        </div>
      ))}

      <h3 className="sec">Users</h3>
      <div className="adm-bar">
        <div className="s-search"><I.Search size={14} /><input placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Seg value={filter} onChange={setFilter} options={["All", "Active", "Suspended"]} />
        <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={load}><I.Retry size={16} /></button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl adm-tbl">
          <colgroup><col /><col style={{ width: 112 }} /><col style={{ width: 104 }} /><col style={{ width: 28 }} /></colgroup>
          <thead><tr><th>User</th><th>Last active</th><th>Status</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
                <tr className={`adm-row ${open === u.id ? "on" : ""}`} onClick={() => toggle(u.id)}>
                  <td>
                    <div className="adm-user"><Avatar name={u.name || u.email} size={28} font={10} /><div style={{ minWidth: 0 }}>
                      <div className="nm"><span data-notr>{u.name || u.email.split("@")[0]}</span>{u.id === app.me?.id ? <span className="new-tag" style={{ marginLeft: 6 }}>You</span> : u.protected ? <span className="new-tag" style={{ marginLeft: 6 }}>Admin</span> : null}</div>
                      <div className="em" data-notr>{u.email}</div>
                      <div style={{ marginTop: 3 }}>{u.methods.map((m) => <span key={m} className="adm-chip">{METHOD[m] ?? m}</span>)}</div>
                    </div></div>
                  </td>
                  <td data-notr style={{ whiteSpace: "nowrap" }}>{ago(u.lastSeen)}</td>
                  <td><span className={`adm-st ${u.status === "active" ? "" : "off"}`}><i />{u.status === "active" ? "Active" : "Suspended"}</span></td>
                  <td style={{ width: 24, color: "var(--text-3)" }}><span style={{ display: "inline-flex", transform: open === u.id ? "rotate(180deg)" : undefined, transition: "transform .2s" }}><I.Chevron size={14} /></span></td>
                </tr>
                {open === u.id && (
                  <tr className="adm-detail"><td colSpan={4}>
                    <div className="adm-grid">
                      <div>
                        <h4>Account</h4>
                        <div className="adm-kv"><span>Joined</span><b data-notr>{fmtDate(u.createdAt)}</b></div>
                        <div className="adm-kv"><span>Email verified</span><b>{u.verified ? "Yes" : "No"}</b></div>
                        <div className="adm-kv"><span>Last sign-in</span><b data-notr>{fmtDate(u.lastLogin)}</b></div>
                        <div className="adm-kv"><span>User ID</span><b className="adm-id" data-notr title={u.id}>{u.id}</b></div>
                        {detail?.identities.map((x) => <div key={x.provider} className="adm-kv"><span>{METHOD[x.provider] ?? x.provider}</span><b data-notr>{x.email ?? "—"}</b></div>)}
                      </div>
                      <div>
                        <h4>Active sessions</h4>
                        {!detail ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div> : detail.sessions.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No active sessions.</div> : detail.sessions.map((x) => (
                          <div key={x.id} className="adm-sess">
                            <span style={{ flex: 1, minWidth: 0 }}><span data-notr>{x.device}</span> <span className="adm-chip">{METHOD[x.method] ?? x.method}</span><br /><span className="muted" data-notr>{x.ip ?? "—"} · {ago(x.lastSeen)}</span></span>
                            {!u.protected && <button className="btn" style={{ height: 26 }} disabled={busy} onClick={() => act(() => call("DELETE", `/api/admin/sessions/${x.id}`), "Session ended")}>End</button>}
                          </div>
                        ))}
                      </div>
                    </div>
                    {u.protected ? <p className="d" style={{ margin: "12px 0 0" }}>Owner accounts can&apos;t be suspended or deleted from here.</p> : (
                      <div className="adm-actions">
                        <button className="btn" disabled={busy || !u.sessions} onClick={() => app.confirm("Sign this user out everywhere?", "Every active session for this account will end immediately.", "Sign out", () => act(() => call("PATCH", `/api/admin/users/${u.id}`, { action: "signout" }), "User signed out everywhere"))}>Sign out everywhere</button>
                        {u.status === "active"
                          ? <button className="btn" disabled={busy} onClick={() => app.confirm("Suspend this account?", "They will be signed out everywhere and can't sign in until you restore the account.", "Suspend", () => act(() => call("PATCH", `/api/admin/users/${u.id}`, { action: "suspend" }), "Account suspended"))}>Suspend</button>
                          : <button className="btn" disabled={busy} onClick={() => act(() => call("PATCH", `/api/admin/users/${u.id}`, { action: "restore" }), "Account restored")}>Restore</button>}
                        <button className="btn danger" disabled={busy} onClick={() => { setDel(u); setDelTxt(""); }}>Delete account</button>
                      </div>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <div className="empty" style={{ marginTop: 24 }}>No users match.</div>}
      </div>

      <h3 className="sec">Audit log</h3>
      <div className="adm-bar"><Seg value={logF} onChange={setLogF} options={["All", "Sign-ins", "Admin actions"]} /></div>
      {logs.map((l) => {
        const [label, kind] = ACTIONS[l.action] ?? [l.action, ""];
        const who = l.actor_email && l.target_email && l.actor_email !== l.target_email ? `${l.actor_email} → ${l.target_email}` : l.actor_email ?? l.target_email ?? "—";
        return (
          <div key={l.id} className="adm-log">
            <span className="tm" data-notr>{fmtDate(l.at)}</span>
            <span><span className={kind === "bad" ? "bad" : kind === "adm" ? "adm" : ""}>{label}</span>{l.detail && <span className="adm-chip" style={{ marginLeft: 6 }}>{METHOD[l.detail] ?? l.detail}</span>}<br /><span className="muted" data-notr>{who}</span></span>
            <span className="ip" data-notr>{l.ip ?? ""}</span>
          </div>
        );
      })}
      {logs.length === 0 && <div className="empty" style={{ marginTop: 16 }}>No events yet.</div>}
      {more && d.audit.length > 0 && <button className="btn" style={{ marginTop: 12 }} onClick={() => call<{ audit: Log[] }>("GET", `/api/admin?before=${d.audit[d.audit.length - 1].id}`).then((x) => { setD({ ...d, audit: [...d.audit, ...x.audit] }); setMore(x.audit.length >= 100); }).catch((e) => app.say(e.message))}>Load more</button>}

      <Fade show={!!del}>
        <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && setDel(null)}>
          <div className="modal sm" style={{ width: 420 }}>
            <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={() => setDel(null)}><I.X size={16} /></button>
            <h2 style={{ fontSize: 16 }}>Delete this account?</h2>
            <p className="d" style={{ margin: "0 0 12px" }}>The account, its sign-in methods and all of its sessions will be permanently removed. This can&apos;t be undone.</p>
            <p className="d" style={{ margin: "0 0 6px" }}>Type the user&apos;s email to confirm:</p>
            <div className="mono" style={{ fontSize: 12, marginBottom: 8 }} data-notr>{del?.email}</div>
            <input className="field" autoFocus value={delTxt} onChange={(e) => setDelTxt(e.target.value)} placeholder="Email" />
            <div className="modal-foot">
              <button className="btn" onClick={() => setDel(null)}>Cancel</button>
              <button className="btn danger" disabled={busy || delTxt.trim().toLowerCase() !== del?.email.toLowerCase()} style={delTxt.trim().toLowerCase() !== del?.email.toLowerCase() ? { opacity: 0.4 } : undefined} onClick={() => { const u = del!; setDel(null); setOpen(null); act(() => call("DELETE", `/api/admin/users/${u.id}`, { confirm: delTxt }), "Account deleted"); }}>Delete account</button>
            </div>
          </div>
        </div>
      </Fade>
    </>
  );
}
