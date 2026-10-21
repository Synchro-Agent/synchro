"use client";

import { useEffect, useRef, useState } from "react";
import { Fade, Menu } from "./ui";
import { AvatarButton } from "./avatar";
import { usePref, useApp, initials, resetPrefs } from "./store";
import * as I from "./icons";

function useAway(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  });
  return ref;
}

export function Toggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return <button className={`toggle ${on ? "on" : ""}`} onClick={() => set(!on)} role="switch" aria-checked={on} />;
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
const A = ({ children }: { children: React.ReactNode }) => <a className="lnk">{children}</a>;

function Toasts({ msg }: { msg: string }) {
  return msg ? <div className="toast"><I.Clock size={14} />{msg}</div> : null;
}

function General({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  const app = useApp();
  const [font, setFont] = usePref("font", "Anthropic Sans");
  const [size, setSize] = usePref("size", "Medium");
  const [motion, setMotion] = usePref("motion", "System");
  const [lang, setLang] = usePref("vlang", "Vietnamese");
  const [style, setStyle] = usePref("vstyle", "Buttery");
  const [speed, setSpeed] = usePref("vspeed", "Normal");
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
      <Row t="Style"><Select value={style} onChange={setStyle} options={["Buttery", "Airy", "Mellow", "Glassy", "Rounded"]} /></Row>
      <Row t="Speed"><Select value={speed} onChange={setSpeed} options={["Slow", "Normal", "Fast"]} /></Row>
      <H>Notifications</H>
      <Row t="Response completions" d="Get notified when Synchro has finished a response. Useful for long-running tasks." top><Toggle on={tg[0]} set={set(0)} /></Row>
      <Row t="Mentions and replies" d="Get an email when someone @mentions you on an artifact, or replies in a comment thread you're part of."><Toggle on={tg[1]} set={set(1)} /></Row>
      <Row t="Comments on your artifacts" d="Get an email when someone comments on an artifact you own, even when you're not mentioned. Follows “Mentions and replies” until you change it."><Toggle on={tg[2]} set={set(2)} /></Row>
      <Row t="Artifacts shared with you" d="Get an email when someone shares an artifact with you."><Toggle on={tg[3]} set={set(3)} /></Row>
    </>
  );
}

function Account() {
  const app = useApp();
  const [name, setName] = usePref("name", "Lâm Tùng");
  const [call, setCall] = usePref("call", "Lâm Tùng");
  const [work, setWork] = usePref("work", "Data science");
  const [saved0, setSaved0] = usePref("ins", "");
  const [ins, setIns] = useState(saved0);
  const [saved, setSaved] = useState("");
  const [menu, setMenu] = useState<number | null>(null);
  const [sessions, setSessions] = usePref("sessions", [
    { d: "Synchro Desktop (Mac O…", cur: false, c: "Oct 17, 2026, 11:07 AM", u: "Oct 17, 2026, 5:13 PM" },
    { d: "Chrome (Ma…", cur: true, c: "Oct 17, 2026, 11:01 AM", u: "Oct 17, 2026, 9:10 PM" },
  ]);
  const ref = useAway(() => setMenu(null));
  return (
    <>
      <H first>Profile</H>
      <Row t="Profile photo" d="PNG or JPG up to 10MB." top><AvatarButton name={name} /></Row>
      <Row t="Full name"><input className="field" style={{ width: 280, margin: 0 }} value={name} onChange={(e) => setName(e.target.value)} /></Row>
      <Row t="What should Synchro call you?"><input className="field" style={{ width: 280, margin: 0 }} value={call} onChange={(e) => setCall(e.target.value)} /></Row>
      <Row t="What best describes your work?"><Select width={200} value={work} onChange={setWork} options={["Product management", "Engineering", "Human resources", "Finance", "Marketing", "Sales", "Operations", "Data science", "Design", "Legal", "Other"]} /></Row>
      <h3 style={{ marginTop: 14 }}>Instructions for Synchro</h3>
      <p className="d" style={{ margin: "0 0 10px" }}>Synchro will keep these in mind for this and any of your associated accounts across chats and Cowork within <A>Anthropic&apos;s guidelines</A>. <A>Learn more</A></p>
      <textarea className="textarea" value={ins} onChange={(e) => setIns(e.target.value)} placeholder="e.g. I primarily code in Python (not a coding beginner)" />
      {ins !== saved0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn dark" onClick={() => { setSaved0(ins); setSaved("Instructions saved"); setTimeout(() => setSaved(""), 2000); }}>Save changes</button>
          <button className="btn" onClick={() => setIns(saved0)}>Discard</button>
        </div>
      )}
      <H>Account</H>
      <Row t="Log out of all devices" top><button className="btn" onClick={() => app.confirm("Log out of all devices?", "Every other session will be signed out. You will stay signed in on this device.", "Log out", () => { setSessions((s) => s.filter((x) => x.cur)); app.say("Signed out of other devices"); })}>Log out</button></Row>
      <Row t="Delete your account"><button className="btn" onClick={() => app.confirm("Delete your account?", "All chats, projects and settings stored in this demo will be permanently erased.", "Delete account", () => { app.wipe("all"); resetPrefs(); app.say("Account data deleted"); })}>Delete account</button></Row>
      <Row t="Organization ID"><span className="mono">7048e36f-8c98-4b29-a05f-6b6a8cb1c388</span></Row>
      <H>Trusted devices</H>
      <p className="d" style={{ marginTop: -6 }}>Devices that can control your local machine through remote sessions.</p>
      <p className="d" style={{ margin: "16px 0 0" }}>No trusted devices.</p>
      <H>Active sessions</H>
      <table className="tbl" ref={ref as never}>
        <thead><tr><th>Device</th><th>Location</th><th>Created</th><th>Updated</th><th /></tr></thead>
        <tbody>
          {sessions.map((s, i) => (
            <tr key={i}>
              <td>{s.d} {s.cur && <span className="new-tag">Current</span>}</td><td>Hanoi, Hanoi, VN</td><td>{s.c}</td><td>{s.u}</td>
              <td style={{ position: "relative", width: 30 }}>
                <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setMenu(menu === i ? null : i)}>⋮</button>
                {menu === i && <button className="btn danger" style={{ position: "absolute", right: 0, top: 26, zIndex: 5 }} onClick={() => { setSessions(sessions.filter((_, j) => j !== i)); setMenu(null); }}>Terminate</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Toasts msg={saved} />
    </>
  );
}

function Privacy({ go }: { go: (t: string) => void }) {
  const app = useApp();
  const [a, setA] = usePref("loc", true);
  const [b, setB] = usePref("improve", true);
  const [panel, setPanel] = useState<"" | "shared" | "artifacts" | "files" | "feedback">("");
  const shared = app.chats.filter((c) => c.shared);
  const files = app.chats.flatMap((c) => c.msgs.flatMap((m) => (m.files ?? []).map((f) => ({ f, c: c.title }))));
  const fb = app.chats.flatMap((c) => c.msgs.filter((m) => m.like).map((m) => ({ c: c.title, like: m.like, t: m.text.slice(0, 80) })));
  const title = { shared: "Shared chats", artifacts: "Shared artifacts", files: "Uploaded files", feedback: "Your feedback", "": "" }[panel];
  return (
    <>
      <p className="d" style={{ margin: "0 0 12px" }}>Anthropic believes in transparent data practices. Learn how your information is protected when using Anthropic products, and visit our <A>Privacy Center</A> and <A>Privacy Policy</A> for more details.</p>
      <button className="row link-row" style={{ width: "100%" }}><span>How we protect your data</span><I.ChevronR size={16} /></button>
      <button className="row link-row" style={{ width: "100%" }}><span>How we use your data</span><I.ChevronR size={16} /></button>
      <H>Preferences</H>
      <Row t="Location metadata" d={<>Allow Synchro to use coarse location metadata (city/region) to improve product experiences. <A>Learn more</A></>} top><Toggle on={a} set={setA} /></Row>
      <Row t="Help improve our AI models" d={<>Allow the use of your chats and coding sessions to train and improve Anthropic AI models. <A>Learn more</A></>}><Toggle on={b} set={setB} /></Row>
      <H>Your data</H>
      <Row t="Export data" top><button className="btn" onClick={app.exportData}>Export data</button></Row>
      <Row t="Shared chats"><button className="btn" onClick={() => setPanel("shared")}>Manage</button></Row>
      <Row t="Shared artifacts"><button className="btn" onClick={() => setPanel("artifacts")}>Manage</button></Row>
      <Row t="Uploaded files"><button className="btn" onClick={() => setPanel("files")}>Manage</button></Row>
      <Row t="Your feedback"><button className="btn" onClick={() => setPanel("feedback")}>Manage</button></Row>
      <Row t="Memory preferences"><button className="btn" onClick={() => go("Memory")}>Manage ↗</button></Row>
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
        <div style={{ display: "flex", gap: 12 }}><I.Spark size={28} /><div><div style={{ fontWeight: 600 }}>Free plan</div><div className="d">Try Synchro</div></div></div>
        <button className="btn dark" onClick={app.upgrade}>Upgrade plan</button>
      </div>
      <ul className="perks">{perks.map((p) => <li key={p}><I.Check size={14} />{p}</li>)}</ul>
      <H>Invoices</H>
      <p className="d">We have not sent you an invoice yet.</p>
    </>
  );
}

function Capabilities() {
  const [v, setV0] = usePref<Record<string, boolean>>("caps", { conn: true, sw: true, art: true, ai: false, inl: true, code: true, net: false });
  const setV = (n: Record<string, boolean>) => setV0(n);
  const [tool, setTool] = usePref("tool", "Tools already loaded");
  const t = (k: string) => <Toggle on={v[k]} set={(x) => setV({ ...v, [k]: x })} />;
  return (
    <>
      <H first>General</H>
      <Row t="Tool access mode" d="Controls how connector tools are loaded in conversations." top><Select width={190} value={tool} onChange={setTool} options={["Tools already loaded", "Load when needed"]} /></Row>
      <Row t="Connector search" d="Let Synchro search the connector directory and surface ones relevant to your conversations.">{t("conn")}</Row>
      <Row t="Switch models when a message is flagged" d="When safeguards flag a message, automatically switch to a different model to keep chatting. When off, your session will pause instead.">{t("sw")}</Row>
      <H>Visuals</H>
      <Row t="Artifacts" d="Build code, documents, and designs in a dedicated window alongside your conversation." top>{t("art")}</Row>
      <Row t="AI-powered artifacts" d="Build apps and interactive documents that use Synchro inside the artifact.">{t("ai")}</Row>
      <Row t="Inline visualizations" d="Allow Synchro to create interactive visuals, charts, and diagrams within the conversation.">{t("inl")}</Row>
      <H>Code execution and file creation</H>
      <Row t="Code execution and file creation" d="Synchro can execute code and create and edit docs, spreadsheets, presentations, PDFs, and data reports. Required for skills." top>{t("code")}</Row>
      <div className="inset"><Row t="Allow network egress" d={<>Allow Synchro to access common package managers to install packages and libraries for data analysis, visualizations, and file processing. <A>View package manager domains</A>. Monitor chats closely as this comes with <A>security risks</A>.</>} top>{t("net")}</Row></div>
      <H>Skills</H>
      <p className="d" style={{ marginTop: -6 }}>Skills have moved to <A>Customize</A>.</p>
    </>
  );
}

function Memory() {
  const app = useApp();
  const [gen, setGen] = usePref("memGen", true);
  const [sens, setSens] = usePref("memSens", false);
  const [mems, setMems] = usePref<string[]>("memories", []);
  const [imp, setImp] = useState(false);
  const [txt, setTxt] = useState("");
  return (
    <>
      <H first>Memory</H>
      <Row t="Generate memory from chats" d={<>Allow Synchro to generate memory from your chats. <A>Learn more</A></>} top><Toggle on={gen} set={setGen} /></Row>
      <Row t="Include sensitive topics in memory" d={<>Allow Synchro to save details about sensitive topics like health conditions or religious beliefs to memory. <A>Learn more</A></>}><Toggle on={sens} set={setSens} /></Row>
      <Row t="Import memory from other AI providers" d={<>Bring relevant context and data from another AI provider to Synchro. We&apos;ll provide a prompt you can use to fetch the memory from your other account. <A>Learn more</A></>}><button className="btn" onClick={() => setImp(true)}>Start import</button></Row>
      {mems.length === 0 ? <div className="empty" style={{ marginTop: 100 }}>No files yet</div> : (
        <>
          <H>Stored memories <span className="muted" style={{ fontWeight: 400 }}>({mems.length})</span></H>
          {mems.map((m, i) => <div key={i} className="item-row"><span style={{ flex: 1 }}>{m}</span><button className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Delete memory" onClick={() => setMems((o) => o.filter((_, j) => j !== i))}><I.Trash size={14} /></button></div>)}
          <button className="btn danger" style={{ marginTop: 12 }} onClick={() => app.confirm("Delete all memory?", "Synchro will forget everything it has stored about you.", "Delete", () => { setMems([]); app.say("Memory cleared"); })}>Delete all</button>
        </>
      )}
      <Fade show={imp}>
        <div className="overlay" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && setImp(false)}>
          <div className="modal sm" style={{ width: 460 }}>
            <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={() => setImp(false)}><I.X size={16} /></button>
            <h2 style={{ fontSize: 16 }}>Import memory to Synchro</h2>
            <p className="d" style={{ margin: "0 0 8px" }}>1&nbsp; Copy this prompt into a chat with your other AI provider</p>
            <div className="codebox">Export all of my stored memories and any context you&apos;ve learned about me from past conversations. Preserve my words verbatim, especially for instructions and preferences.<button className="btn" style={{ position: "absolute", right: 8, bottom: 8, height: 26 }} onClick={() => { navigator.clipboard?.writeText("Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim, especially for instructions and preferences."); app.say("Prompt copied"); }}>Copy</button></div>
            <p className="d" style={{ margin: "14px 0 8px" }}>2&nbsp; Paste results below to add to Synchro&apos;s memory</p>
            <textarea className="textarea" value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Paste your memory details here" />
            <div className="modal-foot"><button className="btn" onClick={() => setImp(false)}>Cancel</button><button className="btn dark" disabled={!txt.trim()} style={!txt.trim() ? { opacity: 0.4 } : undefined} onClick={() => { const items = txt.split(/\n+/).map((x) => x.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean); setMems((o) => [...o, ...items]); app.say(`Added ${items.length} memories`); setImp(false); setTxt(""); }}>Add to memory</button></div>
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
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>{r} · updated {new Date(gen.at).toLocaleTimeString()}</div>
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
  const [v, setV] = usePref("codeTg", [true, true, false, false]);
  const t = (i: number) => <Toggle on={v[i]} set={(x) => setV(v.map((y, j) => (j === i ? x : y)))} />;
  const [font, setFont] = usePref("uiFont", "Anthropic Sans");
  const [width, setWidth] = usePref("width", "Narrow");
  const [view, setView] = usePref("tview", "Normal");
  const [cf, setCf] = usePref("codeFont", "");
  const [br, setBr] = usePref("branch", "claude");
  return (
    <>
      <div className="promo">
        <div><div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Synchro Code</div><p className="d" style={{ margin: "0 0 14px" }}>Synchro understands your codebase and helps you build, debug, and ship faster. Upgrade your plan to get started.</p><button className="btn dark" onClick={app.upgrade}>Upgrade to Max or Pro ↗</button></div>
        <div className="term"><span style={{ color: "#e5604f" }}>●</span> <span style={{ color: "#e8b84a" }}>●</span> <span style={{ color: "#5fb36b" }}>●</span><div style={{ marginTop: 10 }}>&gt; Fix the auth bug in signup flow</div></div>
      </div>
      <H>General</H>
      <Row t="Classify session states" d="Allow Synchro to automatically classify sessions as blocked, ready for review, or done. Classifying sessions counts towards your plan usage. Applies to new sessions." top>{t(0)}</Row>
      <Row t="Switch models when a message is flagged" d="When safeguards flag a message, automatically switch to a different model to keep chatting. When off, your session will pause instead.">{t(1)}</Row>
      <H>Code appearance</H>
      <div style={{ display: "flex", gap: 12 }}>
        <div className="codebox" style={{ flex: 1, background: "#fff", color: "#222" }}><div className="muted" style={{ marginBottom: 6 }}>Synchro Light ⌄</div>1 function greet(name: string) {"{"}<br />2 &nbsp; return `Hello, ${"${name}"}`<br />3 {"}"}</div>
        <div className="codebox" style={{ flex: 1, background: "#1b1b1b", color: "#ddd" }}><div className="muted" style={{ marginBottom: 6 }}>Synchro Dark ⌄</div>1 function greet(name: string) {"{"}<br />2 &nbsp; return `Hello, ${"${name}"}`<br />3 {"}"}</div>
      </div>
      <Row t="Code font" d="Set a custom monospace font for code and terminal."><input className="field" style={{ width: 200, margin: 0 }} placeholder="e.g. JetBrains Mono" value={cf} onChange={(e) => setCf(e.target.value)} /></Row>
      <H>Appearance</H>
      <Row t="Interface font" d="Font for the whole interface — menus, sidebars, and panels." top><Seg value={font} onChange={setFont} options={["Anthropic Sans", "System", "Serif"]} /></Row>
      <Row t="Transcript width" d="Maximum width of the transcript and composer columns."><Seg value={width} onChange={setWidth} options={["Narrow", "Medium", "Wide"]} /></Row>
      <Row t="Default transcript view" d="View sessions open in. Picking a view from a session's Transcript view menu changes only that session."><Seg value={view} onChange={setView} options={["Normal", "Thinking", "Verbose"]} /></Row>
      <H>Pull requests</H>
      <Row t="Branch prefix" d="Prefix added to branch names for both local and cloud sessions." top><input className="field" style={{ width: 200, margin: 0 }} value={br} onChange={(e) => setBr(e.target.value)} /></Row>
      <Row t="Create pull requests automatically" d="When Synchro pushes changes to a branch, it automatically opens a pull request without asking first. Applies to cloud sessions only.">{t(2)}</Row>
      <Row t="Auto-fix pull requests" d="When you create a pull request, Synchro automatically monitors it for CI failures and review comments, then responds proactively.">{t(3)}</Row>
      <H>Authorization tokens</H>
      <p className="d" style={{ marginTop: -6 }}>Created when you sign in to Synchro Code. Revoke a token to sign out from that device.</p>
      <table className="tbl"><thead><tr><th>Application</th><th>Scopes</th></tr></thead></table>
      <div className="empty" style={{ marginTop: 20 }}><b>No connected Synchro Code instances</b><span>When you sign in to Synchro Code, your authorization tokens will appear here.</span></div>
    </>
  );
}

const SKILLS: [string, string, string][] = [
  ["google-workspace", "Read this before the first Google Drive, Docs, Sheets or Slides connector call w…", "3d ago"],
  ["import-memory", "Import a memory export from another AI assistant into Synchro's memory — …", "Sep 15"],
  ["morning", "Render the user's morning brief as a styled HTML artifact, or set it up as a recur…", "Sep 15"],
  ["skill-creator", "Create new skills, modify and improve existing skills, and measure skill perform…", "Sep 15"],
];
const CONNECTORS: [string, string, string, string][] = [
  ["Google Drive", "Search, read, and upload files instantly", "Google", "#4285f4"],
  ["Gmail", "Draft replies, summarize threads, and search your inbox", "Google", "#ea4335"],
  ["Google Calendar", "Manage your schedule and coordinate meetings effortlessly", "Google", "#1a73e8"],
  ["Canva", "Search, create, autofill, and export Canva designs", "Canva", "#00c4cc"],
  ["Microsoft 365", "Access your company's SharePoint, OneDrive, Outlook, and Teams directly", "Anthropic", "#f25022"],
  ["Notion", "Connect your Notion workspace to search, update, and power workflows", "Notion", "#222"],
  ["Figma", "Generate diagrams and better code from Figma context", "Figma", "#a259ff"],
  ["Slack", "Send messages, create canvases, and fetch black data", "Slack", "#611f69"],
  ["HubSpot", "CRM context for every answer, insight, and action", "HubSpot", "#ff5c35"],
  ["Asana", "Connect to Asana to coordinate tasks, projects, and goals", "Asana", "#f06a6a"],
];
const PLUGINS: [string, string][] = [
  ["Intuit Developer", "Build QuickBooks integrations with the Intuit…"], ["Zentrik", "Bring product decisions, customer evidence, and…"],
  ["Greenstack Umbraco", "Configure, deploy and troubleshoot Umbraco 13/…"], ["learn", "Use this skill when the user wants intellectual…"],
  ["doc-coauthoring", "Guide users through a structured workflow for co…"], ["web-artifacts-builder", "Suite of tools for creating elaborate, multi-…"],
];
const TAGS: Record<string, string[]> = {
  "Google Drive": ["Files & documents", "Everyday life", "Department"], Gmail: ["Email & messages", "Everyday life"], "Google Calendar": ["Events & tickets", "Everyday life"],
  Canva: ["Designs & media", "Industry"], "Microsoft 365": ["Files & documents", "Email & messages", "Department"], Notion: ["Files & documents", "Automation & workflows"],
  Figma: ["Designs & media", "Industry"], Slack: ["Email & messages", "Department"], HubSpot: ["Automation & workflows", "Department"], Asana: ["Automation & workflows", "Department"],
  "Product Management": ["Department"], Operations: ["Department", "Automation & workflows"], "Small Business": ["Industry", "Finances"], "Bio Research": ["Industry", "Medicine"],
  "Desktop Commander": ["Code", "Files & documents"], Nimble: ["AI models & agents", "APIs"], "google-workspace": ["Files & documents", "Email & messages"], "import-memory": ["AI models & agents"],
  morning: ["Everyday life", "Automation & workflows"], "skill-creator": ["AI models & agents", "Code"], "Intuit Developer": ["APIs", "Finances"], learn: ["Books", "Languages"], "doc-coauthoring": ["Files & documents"], "web-artifacts-builder": ["Code", "Designs & media"],
};
const CATS = ["Topic", "Department", "Industry", "Everyday life"];
const TOPICS = ["AI models & agents", "APIs", "Automation & workflows", "Books", "Synchro settings", "Code", "Dependencies & packages", "Designs & media", "Economics", "Email & messages", "Events & tickets", "Files & documents", "Finances", "Health & exercise data", "Languages", "Law", "Maths", "Medicine"];

function Directory({ kind }: { kind: "Skills" | "Connectors" | "Plugins" }) {
  const [sub, setSub] = useState(kind === "Skills" ? "Yours" : "Discover");
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(false);
  const [filter, setFilter] = useState(false);
  const [cat, setCat] = useState("");
  const app = useApp();
  const [added, setAdded] = usePref<string[]>("inst:" + kind, []);
  const [removed, setRemoved] = usePref<string[]>("rm:" + kind, []);
  const [custom, setCustom] = usePref<[string, string][]>("cus:" + kind, []);
  const [sort, setSort] = useState<"" | "asc" | "desc">("");
  const [rm, setRm] = useState("");
  const [confirm, setConfirm] = useState("");
  const [form, setForm] = useState<{ title: string; ph: string } | null>(null);
  const [formVal, setFormVal] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const srt = <T extends string[]>(a: T[]): T[] => (sort ? [...a].sort((x, y) => (sort === "asc" ? 1 : -1) * x[0].localeCompare(y[0])) : a);
  const tagged = (n: string) => !cat || (TAGS[n] ?? []).includes(cat);
  const cats = Object.fromEntries(CATS.map((c) => [c, c]));
  const doAdd = (a: string) => {
    setAdd(false);
    if (a === "Upload skill" || a === "Upload plugin") fileRef.current?.click();
    else if (a.startsWith("Create")) { app.close(); app.ask(a === "Create with Synchro" ? `Hãy giúp tôi tạo một ${kind === "Skills" ? "skill" : kind === "Plugins" ? "plugin" : "connector"} mới.` : `Hướng dẫn tôi tạo một ${kind === "Skills" ? "skill" : "plugin"} từ đầu.`); }
    else if (a === "Browse connectors") setSub("Discover");
    else { setForm({ title: a, ph: a === "Add marketplace" ? "https://github.com/owner/marketplace" : "https://example.com/mcp" }); setFormVal(""); }
  };
  const submit = () => {
    const v = formVal.trim();
    if (!v) return;
    const name = v.replace(/^https?:\/\//, "").split(/[/?#]/)[0] || v;
    setCustom((o) => [...o, [name, v]]);
    setForm(null); setSub("Yours");
    app.say(`Đã thêm ${name}`);
  };
  void cats;
  const addRef = useAway(() => setAdd(false));
  const fRef = useAway(() => setFilter(false));
  const addItems = kind === "Skills" ? ["Upload skill", "Create a skill", "Create with Synchro"] : kind === "Plugins" ? ["Add marketplace", "Upload plugin", "Create a plugin", "Create with Synchro"] : ["Add custom connector", "Browse connectors"];
  return (
    <>
      <div className="dir-head">
        <h2 className="dir-title">{kind}</h2>
        <div className="group" style={{ marginRight: 8 }}>{["Yours", "Discover"].map((s) => <button key={s} className={sub === s ? "on" : ""} onClick={() => setSub(s)}>{s}</button>)}</div>
        <div className="s-search" style={{ margin: 0, flex: 1, height: 30 }}><I.Search size={14} /><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div ref={fRef} style={{ position: "relative" }}>
          <button className="icon-btn" onClick={() => setFilter(!filter)}><I.Sliders size={16} /></button>
            <Menu open={!!(filter)} className="down" style={{ top: 36, right: 0, width: 200 }}>
              <button className="menu-item" onClick={() => { setCat(""); setFilter(false); }}>All categories{!cat && <span className="ck"><I.Check size={16} /></span>}</button>
              <hr />
              {CATS.map((c) => <button key={c} className="menu-item" onClick={() => { setCat(c); setFilter(false); }}>{c}{cat === c ? <span className="ck"><I.Check size={16} /></span> : <span className="sc"><I.ChevronR size={14} /></span>}</button>)}
            </Menu>
        </div>
        <button className="icon-btn" aria-label="Sort" title={sort === "asc" ? "A → Z" : sort === "desc" ? "Z → A" : "Default order"} onClick={() => { const n = sort === "" ? "asc" : sort === "asc" ? "desc" : ""; setSort(n); app.say(n === "asc" ? "Sắp xếp A → Z" : n === "desc" ? "Sắp xếp Z → A" : "Thứ tự mặc định"); }} style={sort ? { background: "var(--active)" } : undefined}><I.Sort size={16} /></button>
        <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setCustom((o) => [...o, [f.name.replace(/\.[^.]+$/, ""), "Uploaded " + f.name]]); setSub("Yours"); app.say(`Đã tải lên ${f.name}`); } e.target.value = ""; }} />
        <div ref={addRef} style={{ position: "relative" }}>
          <button className="btn dark" onClick={() => setAdd(!add)}>+ Add ⌄</button>
            <Menu open={!!(add)} className="down" style={{ top: 36, right: 0, width: 190 }}>
              {addItems.map((a) => <button key={a} className="menu-item" onClick={() => doAdd(a)}>{a}</button>)}
            </Menu>
        </div>
      </div>
      {cat && <div className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Filtered by {cat} · <a className="lnk" onClick={() => setCat("")}>Clear</a></div>}

      {kind === "Skills" && sub === "Yours" && (
        <>
          <div className="promo" style={{ marginBottom: 20 }}>
            <div><div style={{ fontWeight: 600 }}>Add your first skills</div><p className="d" style={{ margin: "4px 0 12px" }}>Skills teach Synchro how you work. Add them from Discover, or create your own.</p><button className="btn dark" onClick={() => setSub("Discover")}>Discover skills</button></div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>From Anthropic &amp; Partners <span className="new-tag" style={{ background: "var(--hover)", color: "var(--text-2)" }}>{SKILLS.length - removed.length + custom.length + added.length}</span></div>
          {srt([...custom.map(([n, d]) => [n, d, "Just now"]), ...added.map((n) => [n, "Installed from Discover", "Just now"]), ...SKILLS.filter((s) => !removed.includes(s[0]))]).filter((s) => s[0].toLowerCase().includes(q.toLowerCase()) && tagged(s[0])).map(([n, d, t]) => (
            <div key={n} className="item-row" style={{ position: "relative" }}>
              <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 500 }}>{n}</b> <span className="muted" style={{ fontSize: 12 }}>{SKILLS.some((x) => x[0] === n) ? "from Anthropic" : "yours"}</span> <span className="muted" style={{ fontSize: 12 }}>· {d}</span></div>
              <span className="muted" style={{ fontSize: 12 }}>{t}</span>
              <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setRm(rm === n ? "" : n)}>⋮</button>
              {rm === n && <button className="btn danger" style={{ position: "absolute", right: 0, top: 36, zIndex: 5 }} onClick={() => { if (custom.some((x) => x[0] === n)) setCustom((o) => o.filter((x) => x[0] !== n)); else if (added.includes(n)) setAdded((o) => o.filter((x) => x !== n)); else setRemoved([...removed, n]); setRm(""); app.say(`Đã gỡ ${n}`); }}>Remove</button>}
            </div>
          ))}
        </>
      )}

      {kind === "Skills" && sub === "Discover" && (
        <>
          <div className="promo" style={{ background: "#12301f", color: "#e7f3ea", marginBottom: 20 }}>
            <div><div className="muted" style={{ fontSize: 11 }}>From Anthropic</div><div style={{ fontWeight: 600, fontSize: 18 }}>Data</div><p style={{ margin: "4px 0 12px", fontSize: 13 }}>Query, chart and explain your data — SQL, spreadsheets and dashboards in one place.</p><button className="btn" style={{ color: "#141413", background: "#fff" }} onClick={() => setConfirm("Data")}>Add</button></div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>For you</div>
          <div className="cards">
            {srt([["Product Management"], ["Operations"], ["Small Business"], ["Bio Research"], ["Desktop Commander"], ["Nimble"]]).map((x) => x[0]).filter((n) => n.toLowerCase().includes(q.toLowerCase()) && tagged(n)).map((n) => (
              <div key={n} className="dcard"><div className="lg">▢</div><div style={{ flex: 1 }}><b style={{ fontWeight: 500 }}>{n}</b><div className="d">Plugin by Anthropic · installs</div></div><button className="btn" style={{ height: 26 }} onClick={() => { app.close(); app.ask(`Hãy thử kỹ năng "${n}" với một ví dụ nhỏ.`); }}>Try</button><button className="icon-btn" style={{ width: 26, height: 26 }} aria-label={added.includes(n) ? "Installed" : "Install"} onClick={() => (added.includes(n) ? app.say(`${n} đã được cài đặt`) : setConfirm(n))}>{added.includes(n) ? <I.Check size={16} /> : <I.Plus size={16} />}</button></div>
            ))}
          </div>
        </>
      )}

      {kind === "Connectors" && (
        <>
          <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}><b style={{ color: "var(--text)", fontWeight: 600 }}>Top connectors</b> <span className="new-tag" style={{ background: "var(--hover)", color: "var(--text-2)" }}>6316</span></div>
          <div className="cards">
            {srt([...custom.map(([n, d]) => [n, d, "you", "#6b6a63"]), ...CONNECTORS]).filter((c) => (sub === "Discover" || added.includes(c[0]) || custom.some((x) => x[0] === c[0])) && c[0].toLowerCase().includes(q.toLowerCase()) && tagged(c[0])).map(([n, d, by, col]) => (
              <div key={n} className="dcard"><div className="lg" style={{ background: col, color: "#fff" }}>{n[0]}</div><div style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 500 }}>{n}</b> <span className="muted">✓</span><div className="d">{d}</div><div className="d">by {by}</div></div>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => { const on = added.includes(n); setAdded(on ? added.filter((x) => x !== n) : [...added, n]); app.say(on ? `Đã ngắt kết nối ${n}` : `Đã kết nối ${n}`); }}>{added.includes(n) ? <I.Check size={16} /> : <I.Plus size={16} />}</button></div>
            ))}
          </div>
          {sub === "Yours" && added.length === 0 && <div className="empty" style={{ marginTop: 40 }}>No connectors yet. Browse Discover to add one.</div>}
        </>
      )}

      {kind === "Plugins" && (
        <>
          <div className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>New plugins</div>
          <div className="cards">
            {srt([...custom.map(([n, d]) => [n, d]), ...PLUGINS]).filter((p) => (sub === "Discover" || added.includes(p[0]) || custom.some((x) => x[0] === p[0])) && p[0].toLowerCase().includes(q.toLowerCase()) && tagged(p[0])).map(([n, d]) => (
              <div key={n} className="dcard"><div className="lg">▢</div><div style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 500 }}>{n}</b><div className="d">{d}</div></div><button className="btn" style={{ height: 26 }} onClick={() => { app.close(); app.ask(`Hãy thử plugin "${n}" giúp tôi.`); }}>Try</button>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => (added.includes(n) ? (setAdded(added.filter((x) => x !== n)), app.say(`Đã gỡ ${n}`)) : setConfirm(n))}>{added.includes(n) ? <I.Check size={16} /> : <I.Plus size={16} />}</button></div>
            ))}
          </div>
          {sub === "Yours" && added.length === 0 && <div className="empty" style={{ marginTop: 40 }}>No plugins installed yet.</div>}
        </>
      )}

        <Menu open={!!(cat === "Topic" || cat === "Department" || cat === "Industry" || cat === "Everyday life")} className="" style={{ position: "fixed", left: "50%", top: 120, width: 220, maxHeight: 420, overflow: "auto" }}>
          {TOPICS.map((t) => <button key={t} className="menu-item" style={{ height: 28 }} onClick={() => setCat(t)}>{t}{cat === t && <span className="ck"><I.Check size={16} /></span>}</button>)}
        </Menu>

      <Fade show={!!form}>
        <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && setForm(null)}>
          <div className="modal sm" style={{ width: 400 }}>
            <h2 style={{ fontSize: 16 }}>{form?.title}</h2>
            <input className="field" autoFocus placeholder={form?.ph} value={formVal} onChange={(e) => setFormVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && formVal.trim() && submit()} />
            <div className="modal-foot"><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn dark" disabled={!formVal.trim()} style={!formVal.trim() ? { opacity: 0.4 } : undefined} onClick={submit}>Add</button></div>
          </div>
        </div>
      </Fade>
      {confirm && (
        <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && setConfirm("")}>
          <div className="modal sm" style={{ width: 380 }}>
            <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={() => setConfirm("")}><I.X size={16} /></button>
            <p style={{ margin: "0 0 10px", fontWeight: 500 }}>The {confirm} plugin may include components that run code</p>
            <div className="warn">Installing will grant access to everything available to Cowork.</div>
            <p className="d" style={{ margin: "10px 0 14px" }}>Only enable plugins from people you trust.</p>
            <div className="modal-foot"><button className="btn" onClick={() => setConfirm("")}>Cancel</button><button className="btn dark" onClick={() => { setAdded([...added, confirm]); setConfirm(""); }}>Continue</button></div>
          </div>
        </div>
      )}
    </>
  );
}

export function SettingsBody({ tab, theme, setTheme, go }: { tab: string; theme: string; setTheme: (t: string) => void; go: (t: string) => void }) {
  switch (tab) {
    case "General": return <General theme={theme} setTheme={setTheme} />;
    case "Account": return <Account />;
    case "Privacy": return <Privacy go={go} />;
    case "Billing": return <Billing />;
    case "Capabilities": return <Capabilities />;
    case "Memory": return <Memory />;
    case "Reflect": return <Reflect />;
    case "Time and focus": return <Focus />;
    case "Synchro Code": return <CodeTab />;
    case "Skills": case "Connectors": case "Plugins": return <Directory kind={tab} />;
    default: return null;
  }
}
export { Directory };
