"use client";

import { useEffect, useRef, useState } from "react";
import { Fade, Menu } from "./ui";
import { AvatarButton } from "./avatar";
import { usePref, useApp, initials, resetPrefs } from "./store";
import * as I from "./icons";
import { MODES, PRESETS } from "./codeview";
import { ProvidersPanel } from "./providersui";
import { ConnectorsPanel } from "./connectorsui";
import { AdminPanel, call as api, fmtDate, METHOD } from "./adminui";
import { OCCUPATIONS, type AuthUser } from "./auth";
import { ls } from "./userscope";
import { setCaps, useCaps } from "./capsclient";
import { UsageSettings } from "./usageui";
import { BrainSettings } from "./brainui";
import { SkillHub } from "./pluginsui";
import { PKG_DOMAINS, type Caps } from "./catalog";
import { usePlan as useSpeechPlan, useMyVoices, type Voice } from "./speech/client";
import { locale } from "./i18n";
const voiceLabel = (v: Voice | undefined) => (v ? `${v.name}${v.lang ? ` · ${v.lang}` : ""}` : "Auto");

function useAway(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  });
  return ref;
}

export function Toggle({ on, set, disabled }: { on: boolean; set: (v: boolean) => void; disabled?: boolean }) {
  return <button className={`toggle ${on ? "on" : ""}`} onClick={() => set(!on)} role="switch" aria-checked={on} disabled={disabled} />;
}

export function Select({ value, options, onChange, search, width = 160 }: { value: string; options: string[]; onChange: (v: string) => void; search?: boolean; width?: number }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useAway(() => setOpen(false));
  const list = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="sel" onClick={() => { setOpen(!open); setQ(""); }}>{value}<I.Chevron size={14} /></button>
        <Menu open={!!(open)} className="down" style={{ top: 36, right: 0, width, minWidth: width }}>
          <div className="menu-scroll">
          {search && <input className="field" style={{ marginBottom: 6, padding: "5px 8px" }} autoFocus placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />}
          {list.length === 0 && <div className="muted" style={{ padding: "6px 10px", fontSize: 13 }}>No results</div>}
          {list.map((o) => (
            <button key={o} className="menu-item" style={{ height: 30 }} onClick={() => { onChange(o); setOpen(false); }}>{o}{o === value && <span className="ck"><I.Check size={16} /></span>}</button>
          ))}
        </div>
        </Menu>
    </div>
  );
}

function Seg({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return <div className="group">{options.map((s) => <button key={s} className={value === s ? "on" : ""} onClick={() => onChange(s)}>{s}</button>)}</div>;
}

function Row({ t, d, children, top }: { t: React.ReactNode; d?: React.ReactNode; children?: React.ReactNode; top?: boolean }) {
  return (
    <div className="row" style={top ? { borderTop: 0 } : undefined}>
      <div><div className="t">{t}</div>{d && <div className="d">{d}</div>}</div>
      {children}
    </div>
  );
}
const H = ({ children, first }: { children: React.ReactNode; first?: boolean }) => <h3 className={first ? "" : "sec"}>{children}</h3>;
const A = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <a className="lnk" role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick?.()}>{children}</a>;

function Toasts({ msg }: { msg: string }) {
  return msg ? <div className="toast"><I.Clock size={14} />{msg}</div> : null;
}

function General({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  const app = useApp();
  const [font, setFont] = usePref("font", "Anthropic Sans");
  const [size, setSize] = usePref("size", "Medium");
  const [motion, setMotion] = usePref("motion", "System");
  const [lang, setLang] = usePref("vlang", "Vietnamese");
  const [voice, setVoice] = usePref("vvoice", "");
  const [speed, setSpeed] = usePref("vspeed", "Normal");
  // Giọng đọc thật từ tài khoản ElevenLabs (chỉ khi tài khoản được dùng Speech và đã gắn khóa).
  const speechOk = app.me?.perms.features.speech !== false;
  const plan = useSpeechPlan(speechOk);
  const voices = useMyVoices(speechOk && !!plan?.connected);
  const [tg, setTg] = usePref("notif", [false, true, true, true]);
  const set = (i: number) => (v: boolean) => {
    if (i === 0 && v) {
      if (typeof Notification === "undefined") { app.say("Trình duyệt không hỗ trợ thông báo"); return; }
      Notification.requestPermission().then((p) => {
        if (p === "granted") { setTg((o) => o.map((x, j) => (j === 0 ? true : x))); app.say("Đã bật thông báo khi hoàn tất"); new Notification("Synchro", { body: "Bạn sẽ nhận thông báo khi câu trả lời hoàn tất." }); }
        else app.say("Quyền thông báo bị từ chối trong trình duyệt");
      });
      return;
    }
    setTg((o) => o.map((x, j) => (j === i ? v : x)));
  };
  const themes = [["auto", <I.Monitor key="1" size={16} />, "System"], ["light", <I.Sun key="2" size={16} />, "Light"], ["dark", <I.Moon key="3" size={16} />, "Dark"]] as const;
  return (
    <>
      <H first>Appearance</H>
      <Row t="Theme" top>
        <div className="group">{themes.map(([k, ic, n]) => <button key={k} title={n} className={theme === k ? "on" : ""} onClick={() => setTheme(k)} style={{ padding: "0 9px" }}>{ic}</button>)}</div>
      </Row>
      <Row t="Chat font"><Select value={font} onChange={setFont} options={["Anthropic Sans", "System", "Serif"]} /></Row>
      <Row t="Transcript text size" d="Size of the conversation transcript text."><Seg value={size} onChange={setSize} options={["Small", "Medium", "Large"]} /></Row>
      <Row t="Motion" d="Reduce animation in streaming responses and other interface elements."><Seg value={motion} onChange={setMotion} options={["System", "Reduced"]} /></Row>
      <H>Voice</H>
      <Row t="Language" top><Select value={lang} onChange={setLang} options={["English", "Vietnamese"]} /></Row>
      {plan?.connected && voices && (
        <Row t="Voice" d="ElevenLabs voice for reading answers aloud and voice conversation. Auto picks a voice in the answer's language.">
          <Select search width={260} value={voiceLabel(voices.find((x) => x.id === voice))} options={[voiceLabel(undefined), ...voices.map((x) => voiceLabel(x))]} onChange={(l) => setVoice(voices.find((x) => voiceLabel(x) === l)?.id ?? "")} />
        </Row>
      )}
      {plan && !plan.connected && <Row t="Voice" d="Using your browser's voice. Add an ElevenLabs key in Settings → Providers for natural AI voices."><span className="d">Browser</span></Row>}
      <Row t="Speed"><Select value={speed} onChange={setSpeed} options={["Slow", "Normal", "Fast"]} /></Row>
      <H>Notifications</H>
      <Row t="Response completions" d="Get notified when Synchro has finished a response. Useful for long-running tasks." top><Toggle on={tg[0]} set={set(0)} /></Row>
    </>
  );
}

type Sess = { id: string; current: boolean; device: string; ip: string | null; method: string; createdAt: number; lastSeen: number };

function Account() {
  const app = useApp();
  const me = app.me;
  const [name, setName] = usePref("name", "Lâm Tùng");
  const [call, setCall] = usePref("call", "Lâm Tùng");
  const [work, setWork] = usePref("work", "Data science");
  // Hướng dẫn cho Synchro lưu trên máy chủ (theo tài khoản, mọi thiết bị) và được gửi kèm mọi lượt chat, Synchro Code, giọng nói.
  const [, setSaved0] = usePref("ins", "");
  const server = me?.profile.instructions ?? "";
  const [ins, setIns] = useState(server);
  const [insBusy, setInsBusy] = useState(false);
  useEffect(() => { setIns(server); }, [server]);
  const saveIns = () => {
    setInsBusy(true);
    api<{ user: AuthUser }>("POST", "/api/auth/profile", { instructions: ins })
      .then((r) => { app.setMe(r.user); setSaved0(r.user.profile.instructions ?? ""); setSaved("Instructions saved"); setTimeout(() => setSaved(""), 2000); })
      .catch((e) => app.say(e.message)).finally(() => setInsBusy(false));
  };
  const [saved, setSaved] = useState("");
  // Synchro tự cập nhật phần hướng dẫn từ bộ não (Cài đặt → Bộ não): trạng thái, lịch sử các bản và quay lại một bản cũ.
  type InsInfo = { auto: boolean; lastAuto: number | null; history: { id: string; at: number; source: string; text: string }[] };
  const [ia, setIa] = useState<InsInfo | null>(null);
  const [hist, setHist] = useState(false);
  useEffect(() => { api<InsInfo>("GET", "/api/brain/instructions").then(setIa).catch(() => {}); }, [server]);
  const setAuto = (auto: boolean) => api<InsInfo>("PUT", "/api/brain/instructions", { auto }).then(setIa).catch((e) => app.say(e.message));
  const restore = (id: string) => api<InsInfo & { instructions: string }>("POST", "/api/brain/instructions", { restore: id })
    .then((r) => { setIa(r); if (me) app.setMe({ ...me, profile: { ...me.profile, instructions: r.instructions } }); setIns(r.instructions); app.say("Restored this version"); })
    .catch((e) => app.say(e.message));
  const [sessions, setSessions] = useState<Sess[] | null>(null);
  const [pw, setPw] = useState<null | { cur: string; next: string; again: string }>(null);
  const [del, setDel] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ sessions: Sess[] }>("GET", "/api/auth/sessions").then((r) => setSessions(r.sessions)).catch(() => setSessions([])); }, []);
  const endSessions = (body: object, ok: string) => api<{ sessions: Sess[] }>("DELETE", "/api/auth/sessions", body).then((r) => { setSessions(r.sessions); app.say(ok); }).catch((e) => app.say(e.message));
  const savePw = async () => {
    if (!pw || !me) return;
    if (pw.next !== pw.again) { app.say("Passwords do not match!"); return; }
    setBusy(true);
    try { const r = await api<{ user: AuthUser }>("POST", "/api/auth/password", { current: pw.cur, password: pw.next }); app.setMe(r.user); setPw(null); app.say("Password saved"); }
    catch (e) { app.say((e as Error).message); } finally { setBusy(false); }
  };
  const deleteAccount = async () => {
    setBusy(true);
    try { await api("DELETE", "/api/auth/account", { password: del }); setDel(null); app.wipe("all"); resetPrefs(); app.logout(); }
    catch (e) { app.say((e as Error).message); } finally { setBusy(false); }
  };
  const pwOk = !!pw && pw.next.length >= 8 && pw.again.length >= 8 && (!me?.hasPassword || pw.cur.length > 0);
  const [dob, setDob] = useState(me?.profile.birthDate ? me.profile.birthDate.split("-").reverse().join("/") : "");
  // Lưu một trường hồ sơ lên máy chủ (gọi khi rời ô nhập / chọn xong).
  const saveProfile = (patch: Record<string, string>) => api<{ user: AuthUser }>("POST", "/api/auth/profile", patch).then((r) => { app.setMe(r.user); app.say("Profile saved"); }).catch((e) => app.say(e.message));
  const saveDob = () => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dob);
    if (!m) { if (dob) app.say("Please enter a valid date of birth (DD/MM/YYYY)."); return; }
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    if (iso !== me?.profile.birthDate) saveProfile({ birthDate: iso });
  };
  return (
    <>
      <H first>Profile</H>
      <Row t="Profile photo" d="PNG or JPG up to 10MB." top><AvatarButton name={name} /></Row>
      <Row t="Full name"><input className="field" style={{ width: 280, margin: 0 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== me?.profile.fullName && saveProfile({ fullName: name })} /></Row>
      <Row t="What should Synchro call you?"><input className="field" style={{ width: 280, margin: 0 }} value={call} onChange={(e) => setCall(e.target.value)} onBlur={() => call.trim() !== (me?.profile.nickname ?? "") && saveProfile({ nickname: call })} /></Row>
      <Row t="Date of birth"><input className="field" style={{ width: 280, margin: 0 }} inputMode="numeric" placeholder="DD/MM/YYYY" value={dob} onChange={(e) => { const d = e.target.value.replace(/\D/g, "").slice(0, 8); setDob([d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/")); }} onBlur={saveDob} /></Row>
      <Row t="What best describes your work?"><Select width={200} value={work} onChange={(v) => { setWork(v); saveProfile({ occupation: v }); }} options={OCCUPATIONS} /></Row>
      <h3 style={{ marginTop: 14 }}>Instructions for Synchro</h3>
      <p className="d" style={{ margin: "0 0 10px" }}>Introduce yourself and tell Synchro how you like to work. Synchro takes this in as what it already knows about you, together with your name above and what it remembers from your chats, in every chat, in Synchro Code and in voice conversations, with every model, on any device.</p>
      <textarea className="textarea" value={ins} onChange={(e) => setIns(e.target.value)} placeholder="e.g. I'm a high school student preparing for my exams and IELTS. Always answer in Vietnamese. Explain step by step, keep answers short and get to the point." />
      <div className={`ins-f ${ins.length > 20000 ? "over" : ""}`}><span>{ins.length > 20000 ? `${(ins.length - 20000).toLocaleString()} characters over the limit · ` : ""}{ins.length.toLocaleString()} / 20,000</span></div>
      {ins.trim() !== server.trim() && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn dark" disabled={insBusy || ins.length > 20000} onClick={saveIns}>Save changes</button>
          <button className="btn" disabled={insBusy} onClick={() => setIns(server)}>Discard</button>
        </div>
      )}
      {ia && (
        <div className="ins-auto">
          <span className="ins-auto-t"><I.Brain size={14} />{ia.auto ? (ia.lastAuto ? `Synchro updated this from your chats on ${fmtDate(ia.lastAuto)}` : "Synchro keeps this up to date from what it learns in your chats") : "Automatic updates from your chats are off"}</span>
          <button role="switch" aria-checked={ia.auto} aria-label="Update automatically from my chats" className={`bg-sw ${ia.auto ? "on" : ""}`} onClick={() => void setAuto(!ia.auto)}><i /></button>
          {ia.history.length > 0 && <button className="btn sm" onClick={() => setHist(!hist)}><I.History size={13} />{hist ? "Hide history" : "History"}</button>}
        </div>
      )}
      {ia && hist && (
        <div className="ins-hist">
          {ia.history.map((h, i) => (
            <div key={h.id} className="ins-h">
              <div className="ins-h-t"><b>{h.source === "auto" ? "Written by Synchro" : "Written by you"}</b><span className="muted">{fmtDate(h.at)}</span>{i === 0 ? <span className="adm-chip">Current</span> : <button className="btn sm" onClick={() => void restore(h.id)}>Use this version</button>}</div>
              <p data-notr>{h.text.slice(0, 280)}{h.text.length > 280 ? "…" : ""}</p>
            </div>
          ))}
        </div>
      )}
      <H>Account</H>
      <Row t="Email" d={me?.methods.length ? <>Sign in with {me.methods.map((m) => <span key={m} className="adm-chip" style={{ marginLeft: 4 }}>{METHOD[m] ?? m}</span>)}</> : undefined} top><span data-notr>{me?.email}</span></Row>
      <Row t="Password" d={me?.hasPassword ? "Change the password you use to sign in with your email." : "Add a password so you can also sign in with your email."}><button className="btn" onClick={() => setPw({ cur: "", next: "", again: "" })}>{me?.hasPassword ? "Change password" : "Set password"}</button></Row>
      <Row t="Log out of all devices"><button className="btn" onClick={() => app.confirm("Log out of all devices?", "Every other session will be signed out. You will stay signed in on this device.", "Log out", () => endSessions({ others: true }, "Signed out of other devices"))}>Log out</button></Row>
      <Row t="Delete your account" d={me?.isAdmin ? "The administrator account can't be deleted." : undefined}><button className="btn" disabled={me?.isAdmin} style={me?.isAdmin ? { opacity: 0.4 } : undefined} onClick={() => setDel("")}>Delete account</button></Row>
      <Row t="Account ID"><span className="mono" data-notr>{me?.id}</span></Row>
      <H>Trusted devices</H>
      <p className="d" style={{ marginTop: -6 }}>Devices that can control your local machine through remote sessions.</p>
      <p className="d" style={{ margin: "16px 0 0" }}>No trusted devices.</p>
      <H>Active sessions</H>
      <table className="tbl">
        <thead><tr><th>Device</th><th>Location</th><th>Created</th><th>Updated</th><th /></tr></thead>
        <tbody>
          {(sessions ?? []).map((s) => (
            <tr key={s.id}>
              <td><span data-notr>{s.device}</span> {s.current && <span className="new-tag">Current</span>}</td><td data-notr>{s.ip ?? "—"}</td><td data-notr>{fmtDate(s.createdAt)}</td><td data-notr>{fmtDate(s.lastSeen)}</td>
              <td style={{ width: 80, textAlign: "right" }}>{!s.current && <button className="btn" style={{ height: 26 }} onClick={() => endSessions({ id: s.id }, "Session ended")}>Terminate</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Toasts msg={saved} />
      <Fade show={!!pw}>
        <div className="overlay" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && setPw(null)}>
          <div className="modal sm" style={{ width: 400 }}>
            <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={() => setPw(null)}><I.X size={16} /></button>
            <h2 style={{ fontSize: 16 }}>{me?.hasPassword ? "Change password" : "Set password"}</h2>
            {me?.hasPassword && <input className="field" type="password" autoComplete="current-password" placeholder="Current password" value={pw?.cur ?? ""} onChange={(e) => setPw((o) => o && { ...o, cur: e.target.value })} />}
            <input className="field" type="password" autoComplete="new-password" placeholder="New password (at least 8 characters)" value={pw?.next ?? ""} onChange={(e) => setPw((o) => o && { ...o, next: e.target.value })} />
            <input className="field" type="password" autoComplete="new-password" placeholder="Confirm new password" value={pw?.again ?? ""} onChange={(e) => setPw((o) => o && { ...o, again: e.target.value })} onKeyDown={(e) => e.key === "Enter" && pwOk && savePw()} />
            <div className="modal-foot"><button className="btn" onClick={() => setPw(null)}>Cancel</button><button className="btn dark" disabled={!pwOk || busy} style={!pwOk ? { opacity: 0.4 } : undefined} onClick={savePw}>Save</button></div>
          </div>
        </div>
      </Fade>
      <Fade show={del !== null}>
        <div className="overlay" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && setDel(null)}>
          <div className="modal sm" style={{ width: 400 }}>
            <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={() => setDel(null)}><I.X size={16} /></button>
            <h2 style={{ fontSize: 16 }}>Delete your account?</h2>
            <p className="d" style={{ margin: "0 0 12px" }}>Your account, sign-in methods and sessions will be permanently removed, and chats stored in this browser will be erased. This can&apos;t be undone.</p>
            {me?.hasPassword && <input className="field" type="password" autoFocus autoComplete="current-password" placeholder="Enter your password to confirm" value={del ?? ""} onChange={(e) => setDel(e.target.value)} />}
            <div className="modal-foot"><button className="btn" onClick={() => setDel(null)}>Cancel</button><button className="btn danger" disabled={busy || (!!me?.hasPassword && !del)} onClick={deleteAccount}>Delete account</button></div>
          </div>
        </div>
      </Fade>
    </>
  );
}

function Privacy({ go }: { go: (t: string) => void }) {
  const app = useApp();
  const [panel, setPanel] = useState<"" | "shared" | "artifacts" | "files" | "feedback">("");
  const shared = app.chats.filter((c) => c.shared);
  const files = app.chats.flatMap((c) => c.msgs.flatMap((m) => (m.files ?? []).map((f) => ({ f, c: c.title }))));
  const fb = app.chats.flatMap((c) => c.msgs.filter((m) => m.like).map((m) => ({ c: c.title, like: m.like, t: m.text.slice(0, 80) })));
  const title = { shared: "Shared chats", artifacts: "Shared artifacts", files: "Uploaded files", feedback: "Your feedback", "": "" }[panel];
  return (
    <>
      <H first>Privacy</H>
      <p className="d" style={{ margin: "0 0 12px" }}>Synchro runs on its owner’s own server. Your chats are kept in this browser; your files, skills, connectors and apps are kept on that Synchro server. What you send to a model goes straight to that provider (Anthropic, OpenAI, Google) through the server’s API key.</p>
      <H>Your data</H>
      <Row t="Export data" top><button className="btn" onClick={app.exportData}>Export data</button></Row>
      <Row t="Shared chats"><button className="btn" onClick={() => setPanel("shared")}>Manage</button></Row>
      <Row t="Shared artifacts"><button className="btn" onClick={() => setPanel("artifacts")}>Manage</button></Row>
      <Row t="Uploaded files"><button className="btn" onClick={() => setPanel("files")}>Manage</button></Row>
      <Row t="Your feedback"><button className="btn" onClick={() => setPanel("feedback")}>Manage</button></Row>
      <Row t="Memory preferences"><button className="btn" onClick={() => go("Brain")}>Manage ↗</button></Row>
      <Fade show={!!panel}>
        <div className="overlay" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && setPanel("")}>
          <div className="modal sm" style={{ width: 460, maxHeight: "70vh", overflow: "auto" }}>
            <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={() => setPanel("")}><I.X size={16} /></button>
            <h2 style={{ fontSize: 16 }}>{title}</h2>
            {panel === "shared" && (shared.length ? shared.map((c) => <div key={c.id} className="item-row"><span style={{ flex: 1 }}>{c.title}</span><button className="btn danger" style={{ height: 26 }} onClick={() => app.unshare(c.id)}>Stop sharing</button></div>) : <div className="empty">No shared chats.</div>)}
            {panel === "artifacts" && <div className="empty">No shared artifacts.</div>}
            {panel === "files" && (files.length ? files.map((x, i) => <div key={i} className="item-row"><I.Clip size={14} /><span style={{ flex: 1 }}>{x.f}</span><span className="muted" style={{ fontSize: 12 }}>{x.c}</span></div>) : <div className="empty">No uploaded files.</div>)}
            {panel === "feedback" && (fb.length ? fb.map((x, i) => <div key={i} className="item-row"><span>{x.like === 1 ? "👍" : "👎"}</span><span style={{ flex: 1 }}>{x.t}…</span><span className="muted" style={{ fontSize: 12 }}>{x.c}</span></div>) : <div className="empty">You have not given any feedback yet.</div>)}
          </div>
        </div>
      </Fade>
    </>
  );
}

function Billing() {
  const app = useApp();
  const perks = ["Chat on web, iOS, Android, and on your desktop", "Generate code and visualize data", "Write, edit, and create content", "Ability to search the web", "Memory across conversations", "Create files and execute code", "Unlock more from Synchro with desktop extensions", "Connect Slack and Google Workspace services", "Integrate any context or tool through connectors with remote MCP", "Extended thinking for complex work"];
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 12 }}><I.Spark size={28} /><div><div style={{ fontWeight: 560 }}>Free plan</div><div className="d">Try Synchro</div></div></div>
        <button className="btn dark" onClick={app.upgrade}>Upgrade plan</button>
      </div>
      <ul className="perks">{perks.map((p) => <li key={p}><I.Check size={14} />{p}</li>)}</ul>
      <H>Invoices</H>
      <p className="d">We have not sent you an invoice yet.</p>
    </>
  );
}

const RUNNER: Record<string, string> = {
  workspace: "Code runs in a fresh, isolated container on the Synchro server and is deleted right after.",
  e2b: "Code runs in an isolated E2B cloud sandbox that is deleted right after.",
  local: "Local simulation: code runs on this computer inside the macOS sandbox (no access to your files).",
};

function Capabilities({ go }: { go: (t: string) => void }) {
  const app = useApp();
  const st = useCaps();
  const { caps: v, locks } = st;
  const [modal, setModal] = useState<"" | "domains" | "risks">("");
  const set = async (k: keyof Caps, x: boolean) => {
    const err = await setCaps({ [k]: x });
    if (err) app.say(err);
  };
  const lockNote = (k: keyof Caps) => locks[k] === "admin" ? "Your administrator has turned off Cloud sandbox for your account." : locks[k] === "server" ? "This server has no place to run code yet. An administrator needs to set up the workspace service or an E2B key." : null;
  const t = (k: keyof Caps, disabled = false) => <Toggle on={v[k]} set={(x) => set(k, x)} disabled={disabled || !!locks[k]} />;
  return (
    <>
      <H first>General</H>
      <Row t="Switch models when a message is flagged" d="When safeguards flag a message, automatically switch to a different model to keep chatting. When off, your session will pause instead.">{t("sw")}</Row>
      <H>Visuals</H>
      <Row t="Artifacts" d="Build code, documents, and designs in a dedicated window alongside your conversation." top>{t("art")}</Row>
      <Row t="AI-powered artifacts" d={<>Build apps and interactive documents that use Synchro inside the artifact.{!v.art && <span className="cap-note">Turn on Artifacts first.</span>}</>}>{t("ai", !v.art)}</Row>
      <Row t="Inline visualizations" d="Allow Synchro to create interactive visuals, charts, and diagrams within the conversation.">{t("inl")}</Row>
      <Row t="Critic council" d={<>After Synchro writes code, a web page, or an app, one or two models from other providers review it in the background and point out bugs by line, with a fix you can apply.{!v.art && <span className="cap-note">Turn on Artifacts first.</span>}</>}>{t("crit", !v.art)}</Row>
      <H>Code execution and file creation</H>
      <Row t="Code execution and file creation" d={<>Synchro can execute code and create and edit docs, spreadsheets, presentations, PDFs, and data reports. Required for skills.
        {lockNote("code") ? <span className="cap-note warn">{lockNote("code")}</span> : st.runner && v.code ? <span className="cap-note">{RUNNER[st.runner]}</span> : null}</>} top>{t("code")}</Row>
      <div className={`inset ${!v.code ? "dim" : ""}`}><Row t="Allow network egress" d={<>Allow Synchro to access common package managers to install packages and libraries for data analysis, visualizations, and file processing. <A onClick={() => setModal("domains")}>View package manager domains</A>. Monitor chats closely as this comes with <A onClick={() => setModal("risks")}>security risks</A>.</>} top>{t("net", !v.code)}</Row></div>
      <H>Skills</H>
      <p className="d" style={{ marginTop: -6 }}>Skills and plugins live in the <A onClick={() => go("Skill Hub")}>Skill Hub</A>.{!v.code && !locks.code && <span className="cap-note">Skills are paused while code execution and file creation is off.</span>}</p>
      <Fade show={!!modal}>
        <div className="overlay" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && setModal("")}>
          <div className="modal sm cap-modal">
            <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={() => setModal("")} aria-label="Close"><I.X size={16} /></button>
            {modal === "domains" ? (
              <>
                <h2>Package manager domains</h2>
                <p className="d">With network egress on, code can only reach these registries (and their subdomains). Every other address is blocked.</p>
                <div className="cap-domains">{PKG_DOMAINS.map((g) => <div key={g.group}><b>{g.group}</b>{g.hosts.map((h) => <code key={h}>{h}</code>)}</div>)}</div>
              </>
            ) : (
              <>
                <h2>Security risks of network egress</h2>
                <ul className="cap-risks">
                  <li>Packages from public registries can contain malicious code. It runs inside the isolated sandbox, which is deleted after each run.</li>
                  <li>Content Synchro reads (web pages, files, connector results) could try to trick it into installing a package or sending data out. Only package registries are reachable, which limits but does not remove that risk.</li>
                  <li>Review what Synchro runs, especially in chats that use files or connectors you don&apos;t fully trust. Turn this off when you don&apos;t need extra packages.</li>
                </ul>
              </>
            )}
            <div className="modal-foot"><button className="btn dark" onClick={() => setModal("")}>Done</button></div>
          </div>
        </div>
      </Fade>
    </>
  );
}

// Bộ nhớ lưu ở máy chủ (app/memory.ts): Synchro tự rút từ các cuộc trò chuyện và đưa vào mỗi lượt chat khi nút "Bộ nhớ" bật.
type MemItem = { id: string; content: string; createdAt: number; source: string };
function Memory() {
  const app = useApp();
  const [st, setSt] = useState<{ items: MemItem[]; cfg: { gen: boolean; sens: boolean } } | null>(null);
  const [imp, setImp] = useState(false);
  const [txt, setTxt] = useState("");
  const call = async (method: string, body?: unknown, q = "") => {
    try {
      const r = await fetch(`/api/memory${q}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
      setSt(j);
      return j as { added?: number };
    } catch (e) { app.say((e as Error).message); return null; }
  };
  // Bản cũ chỉ lưu bộ nhớ trong cài đặt cá nhân (model không dùng tới): chuyển một lần lên máy chủ.
  const [old, setOld] = usePref<string[]>("memories", []);
  useEffect(() => {
    if (!old.length) { void call("GET"); return; }
    void call("POST", { items: old }).then((j) => { if (j) setOld([]); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cfg = st?.cfg ?? { gen: true, sens: false };
  const mems = st?.items ?? [];
  const PROMPT = "Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim, especially for instructions and preferences.";
  return (
    <>
      <H first>Long-term memory</H>
      <p className="d" style={{ margin: "-4px 0 10px" }}>Lasting facts Synchro remembers about you (name, work, preferences). They feed the brain’s “About you” note and every chat.</p>
      <Row t="Generate memory from chats" d={<>Allow Synchro to remember lasting details from your chats (name, work, preferences) and use them in later chats.</>} top><Toggle on={cfg.gen} set={(v) => void call("POST", { cfg: { gen: v } })} /></Row>
      <Row t="Include sensitive topics in memory" d={<>Allow Synchro to save details about sensitive topics like health conditions or religious beliefs to memory.</>}><Toggle on={cfg.sens} set={(v) => void call("POST", { cfg: { sens: v } })} /></Row>
      <Row t="Import memory from other AI providers" d={<>Bring relevant context and data from another AI provider to Synchro. We&apos;ll provide a prompt you can use to fetch the memory from your other account.</>}><button className="btn" onClick={() => setImp(true)}>Start import</button></Row>
      {st === null ? <div className="empty" style={{ marginTop: 100 }}>Loading…</div> : mems.length === 0 ? <div className="empty" style={{ marginTop: 100 }}>No memories yet</div> : (
        <>
          <H>Stored memories <span className="muted" style={{ fontWeight: 360 }}>({mems.length})</span></H>
          {mems.map((m) => <div key={m.id} className="item-row"><span style={{ flex: 1 }} data-notr>{m.content}</span><button className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Delete memory" onClick={() => void call("DELETE", undefined, `?id=${encodeURIComponent(m.id)}`)}><I.Trash size={14} /></button></div>)}
          <button className="btn danger" style={{ marginTop: 12 }} onClick={() => app.confirm("Delete all memory?", "Synchro will forget everything it has stored about you.", "Delete", () => { void call("DELETE").then(() => app.say("Memory cleared")); })}>Delete all</button>
        </>
      )}
      <Fade show={imp}>
        <div className="overlay" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && setImp(false)}>
          <div className="modal sm" style={{ width: 460 }}>
            <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={() => setImp(false)}><I.X size={16} /></button>
            <h2 style={{ fontSize: 16 }}>Import memory to Synchro</h2>
            <p className="d" style={{ margin: "0 0 8px" }}>1&nbsp; Copy this prompt into a chat with your other AI provider</p>
            <div className="codebox cb-copy">{PROMPT}<button className="btn cb-btn" onClick={() => { navigator.clipboard?.writeText(PROMPT); app.say("Prompt copied"); }}>Copy</button></div>
            <p className="d" style={{ margin: "14px 0 8px" }}>2&nbsp; Paste results below to add to Synchro&apos;s memory</p>
            <textarea className="textarea" value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Paste your memory details here" />
            <div className="modal-foot"><button className="btn" onClick={() => setImp(false)}>Cancel</button><button className="btn dark" disabled={!txt.trim()} style={!txt.trim() ? { opacity: 0.4 } : undefined} onClick={async () => { const j = await call("POST", { text: txt }); if (j) { app.say(`Added ${j.added ?? 0} memories`); setImp(false); setTxt(""); } }}>Add to memory</button></div>
          </div>
        </div>
      </Fade>
    </>
  );
}

function Reflect() {
  const app = useApp();
  const [r, setR] = usePref("reflectRange", "Past month");
  const [loading, setLoading] = useState(false);
  const [gen, setGen] = usePref<{ at: number; chats: number; msgs: number; words: [string, number][]; titles: string[] } | null>("reflect", null);
  const run = () => {
    setLoading(true);
    setTimeout(() => {
      const user = app.chats.flatMap((c) => c.msgs.filter((m) => m.role === "user").map((m) => m.text));
      const freq: Record<string, number> = {};
      user.join(" ").toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 3).forEach((w) => { freq[w] = (freq[w] ?? 0) + 1; });
      const words = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6) as [string, number][];
      setGen({ at: Date.now(), chats: app.chats.length, msgs: user.length, words, titles: app.chats.slice(0, 5).map((c) => c.title) });
      setLoading(false);
    }, 1400);
  };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div><div className="s-title">Reflect</div><div className="d">Based on your conversations in Synchro chat.</div></div>
        <div style={{ display: "flex", gap: 4 }}><Select width={160} value={r} onChange={setR} options={["Past month", "Past 3 months", "Past 6 months", "Past year"]} /><button className="icon-btn" aria-label="Refresh" onClick={run} disabled={loading}><span style={{ display: "inline-flex", animation: loading ? "twirl 1s linear infinite" : undefined }}><I.Retry size={16} /></span></button></div>
      </div>
      {loading || !gen ? (
        <div className="empty" style={{ marginTop: 90 }}><I.Layers size={72} /><span style={{ marginTop: 8 }}>{loading ? "Surfacing themes and patterns." : "No reflection yet."}</span>{loading ? <span className="muted" style={{ fontSize: 12 }}>This should only take a minute or so.</span> : <button className="btn dark" style={{ marginTop: 8 }} onClick={run}>Generate</button>}</div>
      ) : app.chats.length === 0 ? (
        <div className="empty" style={{ marginTop: 90 }}>Start a few conversations and come back for a reflection.</div>
      ) : (
        <div style={{ marginTop: 20 }}>
          <div className="item-row"><span style={{ flex: 1 }}>Conversations</span><b>{gen.chats}</b></div>
          <div className="item-row"><span style={{ flex: 1 }}>Messages you sent</span><b>{gen.msgs}</b></div>
          <H>Recurring themes</H>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{gen.words.length ? gen.words.map(([w, n]) => <span key={w} className="chip-s">{w} · {n}</span>) : <span className="d">Not enough data yet.</span>}</div>
          <H>Recent topics</H>
          {gen.titles.map((x, i) => <div key={i} className="item-row">{x}</div>)}
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>{r} · updated {new Date(gen.at).toLocaleTimeString(locale())}</div>
        </div>
      )}
    </>
  );
}

function genTimes() {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) for (const m of ["00", "30"]) out.push(`${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`);
  return out;
}

function Focus() {
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  const [on, setOn] = usePref<number[]>("qdays", []);
  const [hrs, setHrs] = usePref("breakH", "–");
  const [mins, setMins] = usePref("breakM", "–");
  const [times, setTimes] = usePref<Record<number, [string, string]>>("qtimes", {});
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const T = genTimes();
  return (
    <>
      <div className="s-title">Time and focus</div>
      <Row t="Break reminders" d="Get a nudge to take a break from Synchro. You can snooze or adjust anytime." top>
        <div style={{ display: "flex", gap: 4 }}>
          <Select width={110} value={hrs} onChange={setHrs} options={["–", "1 hr", "2 hr", "3 hr", "4 hr", "5 hr", "6 hr"]} />
          <Select width={110} value={mins} onChange={setMins} options={["–", "15 min", "30 min", "45 min"]} />
        </div>
      </Row>
      <h3 style={{ margin: "18px 0 2px" }}>Quiet hours</h3>
      <p className="d" style={{ margin: "0 0 12px" }}>Set time limits for Synchro. You can dismiss or adjust anytime.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {days.map((d, i) => (
          <button key={i} className={`day ${on.includes(i) ? "on" : ""}`} onClick={() => { setOn(on.includes(i) ? on.filter((x) => x !== i) : [...on, i]); setTimes((t) => ({ ...t, [i]: t[i] ?? ["10:00 PM", "7:00 AM"] })); }}>{d}</button>
        ))}
      </div>
      {[...on].sort().map((i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ width: 80 }}>{names[i]}</span>
          <Select width={130} search value={times[i][0]} options={T} onChange={(v) => setTimes({ ...times, [i]: [v, times[i][1]] })} />
          <span className="muted">to</span>
          <Select width={130} search value={times[i][1]} options={T} onChange={(v) => setTimes({ ...times, [i]: [times[i][0], v] })} />
          <span className="muted">next day</span>
        </div>
      ))}
    </>
  );
}

function CodeTab() {
  const app = useApp();
  const [mode, setMode] = usePref("codeMode", "code");
  const [rules, setRules] = usePref("codeRules", { preset: "next", custom: "" });
  const [edTheme, setEdTheme] = usePref("codeEdTheme", "Auto");
  const [cf, setCf] = usePref("codeFont", "");
  const [size, setSize] = usePref("codeSize", "13");
  const [list, setList] = usePref<{ id: number }[]>("codeList", []);
  const [iso, setIso] = useState(true);
  useEffect(() => setIso(!!window.crossOriginIsolated), []);
  const modeLabel = (k: string) => MODES.find((m) => m.k === k)?.short ?? "Code";
  const presetLabel = (k: string) => (k === "custom" ? "Custom rules" : k === "none" ? "No rules" : PRESETS.find((p) => p.k === k)?.label ?? "");
  const presetKey = (l: string) => (l === "Custom rules" ? "custom" : l === "No rules" ? "none" : PRESETS.find((p) => p.label === l)?.k ?? "none");
  const sample = ["1  function greet(name: string) {", "2    return `Hello, ${name}`", "3  }"];
  const ff = { fontFamily: cf ? `${cf}, var(--font-mono)` : undefined, fontSize: Number(size) };
  const Badge = ({ ok, children }: { ok?: boolean; children: React.ReactNode }) => <span className={`s-badge ${ok ? "ok" : ""}`}>{children}</span>;
  return (
    <>
      <div className="promo">
        <div><div style={{ fontWeight: 560, fontSize: 15, marginBottom: 6 }}>Synchro Code</div><p className="d" style={{ margin: "0 0 14px" }}>Write, debug and run code with Synchro. Pick a mode, attach files with @, and preview results right in the browser.</p><button className="btn dark" onClick={app.goCode}>Open Synchro Code</button></div>
        <div className="term"><span style={{ color: "#e5604f" }}>●</span> <span style={{ color: "#e8b84a" }}>●</span> <span style={{ color: "#5fb36b" }}>●</span><div style={{ marginTop: 10 }}>&gt; Fix the auth bug in signup flow</div></div>
      </div>
      <H>Defaults</H>
      <Row t="Default mode" d="Mode used when you open Synchro Code. Plan only outlines steps, Code writes full files, Debug traces errors to the root cause." top><Seg value={modeLabel(mode)} onChange={(l) => setMode(MODES.find((m) => m.short === l)?.k ?? "code")} options={MODES.map((m) => m.short)} /></Row>
      <Row t="Tech stack rules" d="Added to every Code request so answers follow your stack."><Select value={presetLabel(rules.preset)} width={260} onChange={(l) => setRules({ ...rules, preset: presetKey(l) })} options={[...PRESETS.map((p) => p.label), "Custom rules", "No rules"]} /></Row>
      {rules.preset === "custom" && <textarea className="textarea" style={{ marginTop: 4 }} placeholder="e.g. Use Go 1.22, no global state, return errors explicitly" value={rules.custom} onChange={(e) => setRules({ ...rules, custom: e.target.value })} />}
      <H>Safety and context</H>
      <Row t="Secret redaction" d="API keys, tokens and passwords are masked before anything is sent, then restored in the code you get back." top><Badge ok>Always on</Badge></Row>
      <Row t="Context window" d="Attached files and conversation history count toward this limit. Large files are trimmed to the most relevant parts."><Badge>128k tokens</Badge></Row>
      <H>Code appearance</H>
      <div style={{ display: "flex", gap: 12 }}>
        {[["Light", "#fff", "#222"], ["Dark", "#1b1b1b", "#ddd"]].map(([n, bg, fg]) => (
          <button key={n} className={`codebox cb-theme ${edTheme === n ? "on" : ""}`} style={{ flex: 1, background: bg, color: fg, textAlign: "left", ...ff }} onClick={() => setEdTheme(n)}>
            <div className="dd-lbl" style={{ marginBottom: 6, opacity: 0.6, fontFamily: "var(--font-sans)", fontSize: 12 }}>Synchro {n}</div>
            {sample.map((l) => <div key={l} style={{ whiteSpace: "pre" }}>{l}</div>)}
          </button>
        ))}
      </div>
      <Row t="Editor theme" d="Theme for the code editor panel. Auto follows the interface theme."><Seg value={edTheme} onChange={setEdTheme} options={["Auto", "Light", "Dark"]} /></Row>
      <Row t="Code font" d="Monospace font for code blocks and the editor. Must be installed on your device."><input className="field" style={{ width: 200, margin: 0 }} placeholder="e.g. JetBrains Mono" value={cf} onChange={(e) => setCf(e.target.value)} /></Row>
      <Row t="Code font size" d="Applies to code blocks and the editor."><Seg value={size} onChange={setSize} options={["12", "13", "14", "16"]} /></Row>
      <H>Run code</H>
      <Row t="HTML and JavaScript" d="Runs in a sandboxed preview frame next to the chat." top><Badge ok>Ready</Badge></Row>
      <Row t="Python" d="Runs in your browser with Pyodide. No server needed."><Badge ok>Ready</Badge></Row>
      <Row t="Node.js" d="Runs in a WebContainer inside your browser. Needs HTTPS for cross-origin isolation."><Badge ok={iso}>{iso ? "Ready" : "Needs HTTPS"}</Badge></Row>
      <Row t="Cloud sandbox" d="Optional server runtime (E2B) for heavier jobs. Enabled when the server has an E2B key."><Badge>Optional</Badge></Row>
      <H>Data</H>
      <Row t="Code sessions" d={`${list.length} session${list.length === 1 ? "" : "s"} stored in this browser.`} top><button className="btn" disabled={!list.length} style={!list.length ? { opacity: 0.4 } : undefined} onClick={() => app.confirm("Clear all Code sessions?", "Every Synchro Code conversation saved in this browser will be deleted. This can't be undone.", "Clear all", () => { ls.keys().filter((k) => k.startsWith("codeS:")).forEach((k) => ls.remove(k)); setList([]); app.goCode(); app.say("Code sessions cleared"); })}>Clear all</button></Row>
    </>
  );
}

export function SettingsBody({ tab, theme, setTheme, go }: { tab: string; theme: string; setTheme: (t: string) => void; go: (t: string) => void }) {
  switch (tab) {
    case "General": return <General theme={theme} setTheme={setTheme} />;
    case "Administrator": return <AdminPanel Toggle={Toggle} />;
    case "Providers": case "API": return <ProvidersPanel />;
    case "Connectors": return <ConnectorsPanel />;
    case "Skill Hub": case "Skills": case "Plugins": return <SkillHub />;
    case "Account": return <Account />;
    case "Privacy": return <Privacy go={go} />;
    case "Billing": return <Billing />;
    case "Capabilities": return <Capabilities go={go} />;
    case "Usage": return <UsageSettings go={go} />;
    case "Brain": case "Memory": return <BrainSettings memory={<Memory />} />;
    case "Reflect": return <Reflect />;
    case "Time and focus": return <Focus />;
    case "Synchro Code": return <CodeTab />;
    default: return null;
  }
}
