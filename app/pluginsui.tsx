"use client";
// Giao diện Plugins (Tùy chỉnh → Plugins, Cài đặt → Plugins) và trang Tùy chỉnh có ba mục Skills / Connectors / Plugins.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { useApp } from "./store";
import { getLang, tr } from "./i18n";
import type { PublicPlugin, Preview, Risk, SkillReport, Studio } from "./plugins";
import type { DirPlugin } from "./plugindir";
import { GithubAdd } from "./ghadd";

type Data = { plugins: PublicPlugin[]; directory: DirPlugin[]; admin: boolean; canInstall: boolean };
async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body instanceof FormData ? undefined : { "content-type": "application/json" }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j as T;
}
// Báo cho thanh nhập và trang Artifacts biết plugin vừa đổi (studio có thêm skill).
export const PLUGINS_CHANGED = "synchro:plugins";
const fire = () => window.dispatchEvent(new Event(PLUGINS_CHANGED));

const STUDIO: Record<Studio, string> = { design: "Design", slides: "Slides", docs: "Docs" };
const RISK: Record<Risk, [string, string]> = { none: ["No scripts", "ok"], low: ["Scripts, sandboxed", "low"], medium: ["Review scripts", "mid"], high: ["High risk", "high"] };
const mb = (n: number) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

// Biểu tượng plugin: ô trung tính với icon đơn sắc theo nội dung (không dùng màu thương hiệu cho đỡ rối mắt).
const MARK: Record<string, (p: { size?: number }) => React.ReactElement> = {
  "design-studio": I.Palette, "slides-studio": I.Layers, "docs-studio": I.File, "web-dev-qa": I.Code, "emil-kowalski": I.Sparkle, "ui-ux-pro-max": I.Grid,
  taste: I.Eye, "awesome-design-html": I.Globe, "app-store-screenshots": I.Image, "ux-designer": I.Pencil, "vercel-agent-skills": I.Terminal, "anthropic-skills": I.Book,
};
function PlugMark({ id, size = 40 }: { id?: string | null; size?: number }) {
  const Ic = (id && MARK[id]) || I.Plugins;
  return <span className="pl-mark" style={{ width: size, height: size }}><Ic size={Math.round(size * 0.48)} /></span>;
}
function Badge({ kind, children }: { kind: string; children: React.ReactNode }) { return <span className={`pl-b ${kind}`}>{children}</span>; }

// ---------------------------------------------------------------- xem trước trước khi cài
// note: lời giải thích phía trên danh sách (ví dụ "link này có nhiều skill nên cài thành một bộ").
export function PreviewModal({ target, admin, note, onClose, onDone }: { target: { catalogId?: string; url?: string; name: string }; admin: boolean; note?: React.ReactNode; onClose: () => void; onDone: (p: PublicPlugin) => void }) {
  const app = useApp();
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState("");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"org" | "personal">(admin ? "org" : "personal");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ preview: Preview }>("POST", "/api/plugins", { action: "preview", catalogId: target.catalogId, url: target.url }).then((r) => setPv(r.preview)).catch((e) => setErr(e.message));
  }, [target]);
  const install = async () => {
    setBusy(true);
    try {
      const r = await api<{ plugin: PublicPlugin }>("POST", "/api/plugins", { action: "install", catalogId: target.catalogId, url: target.url, scope, skip: [...skip] });
      app.say(`${tr("Installed")} ${r.plugin.name} · ${r.plugin.skills.length} skill`); fire(); onDone(r.plugin);
    } catch (e) { app.say((e as Error).message); setBusy(false); }
  };
  const ok = pv?.skills.filter((s) => !s.blocked && !s.duplicateOf) ?? [];
  const n = ok.filter((s) => !skip.has(s.name)).length;
  return (
    <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal pl-modal">
        <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={onClose} disabled={busy} aria-label="Close"><I.X size={16} /></button>
        <h2>{tr("Cài")} {pv?.def.name ?? target.name}</h2>
        {err ? <div className="pl-err"><I.Alert size={16} />{err}</div> : !pv ? <div className="pl-load"><span className="art-spin" /><span>Reading the repository and checking every skill…</span></div> : (
          <>
            <p className="d">{pv.def.description}</p>
            {note && <div className="pl-note"><I.InfoCircle size={14} /><span>{note}</span></div>}
            <div className="pl-sum">
              <span><b>{ok.length}</b> skill</span><span><b>{mb(pv.size)}</b></span>
              {Object.entries(pv.commits).map(([r, c]) => <a key={r} href={`https://github.com/${r}/tree/${c}`} target="_blank" rel="noreferrer" data-notr>{r}@{c.slice(0, 7)}</a>)}
            </div>
            <div className="pl-list">
              {pv.skills.map((s) => <SkillLine key={`${s.repo}/${s.dir}`} s={s} checked={!s.blocked && !s.duplicateOf && !skip.has(s.name)} disabled={!!s.blocked || !!s.duplicateOf}
                onToggle={() => setSkip((x) => { const y = new Set(x); if (y.has(s.name)) y.delete(s.name); else y.add(s.name); return y; })} />)}
            </div>
            {admin && (
              <div className="pl-scope">
                <button className={scope === "org" ? "on" : ""} onClick={() => setScope("org")}><b>Everyone</b><span>Install once for every account on this Synchro</span></button>
                <button className={scope === "personal" ? "on" : ""} onClick={() => setScope("personal")}><b>Only me</b><span>A personal plugin in your account</span></button>
              </div>
            )}
          </>
        )}
        <div className="modal-foot"><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn dark" disabled={!pv || !n || busy} onClick={install}>{busy ? <><span className="art-spin sm" />Installing…</> : `${tr("Cài")} ${n} skill`}</button></div>
      </div>
    </div>
  );
}

function SkillLine({ s, checked, disabled, onToggle, right }: { s: SkillReport; checked?: boolean; disabled?: boolean; onToggle?: () => void; right?: React.ReactNode }) {
  return (
    <div className={`pl-sk ${disabled ? "off" : ""}`}>
      {onToggle && <input type="checkbox" checked={!!checked} disabled={disabled} onChange={onToggle} aria-label={s.name} />}
      <div className="pl-sk-t">
        <b data-notr>{s.name}</b>
        <span>{s.blocked ? <em className="pl-why">{s.blocked}</em> : s.duplicateOf ? <em className="pl-why">{tr("Duplicate of")} {s.duplicateOf}</em> : s.description}</span>
        <div className="pl-tags">
          <Badge kind={s.licenseKind === "open" ? "ok" : s.licenseKind === "proprietary" ? "high" : "mid"}>{s.license}</Badge>
          <Badge kind={RISK[s.risk][1]}>{RISK[s.risk][0]}</Badge>
          {s.flags.map((f) => <Badge key={f} kind="mid">{f}</Badge>)}
          <Badge kind="">{s.files} {tr("tệp")} · {mb(s.size)}</Badge>
          <Badge kind="" ><span data-notr>{s.repo}</span></Badge>
        </div>
      </div>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------- chi tiết một plugin đã cài
function Detail({ p, admin, onClose, onChange }: { p: PublicPlugin; admin: boolean; onClose: () => void; onChange: (d: { plugins: PublicPlugin[]; plugin?: PublicPlugin }) => void }) {
  const app = useApp();
  const manage = p.scope === "personal" || admin;
  const [busy, setBusy] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const patch = (body: unknown) => api<{ plugins: PublicPlugin[]; plugin: PublicPlugin }>("PATCH", `/api/plugins/${p.id}`, body).then((r) => { onChange(r); fire(); }).catch((e) => app.say(e.message));
  const act = async (action: string) => {
    setBusy(action);
    try {
      const r = await api<{ changed?: string[]; plugins?: PublicPlugin[]; plugin: PublicPlugin }>("POST", `/api/plugins/${p.id}`, { action });
      if (action === "check") app.say(r.changed?.length ? tr("An update is available") : tr("Already up to date"));
      else { app.say(tr("Plugin updated")); fire(); }
      onChange({ plugins: r.plugins ?? [], plugin: r.plugin });
    } catch (e) { app.say((e as Error).message); }
    setBusy("");
  };
  const upload = async (f: File) => {
    const fd = new FormData(); fd.append("file", f);
    setBusy("upload");
    try { const r = await api<{ added: string[]; plugins: PublicPlugin[]; plugin: PublicPlugin }>("POST", `/api/plugins/${p.id}`, fd); app.say(`${tr("Added")} ${r.added.join(", ")}`); onChange(r); fire(); }
    catch (e) { app.say((e as Error).message); }
    setBusy("");
  };
  const remove = () => app.confirm(`${tr("Gỡ")} ${p.name}?`, tr(`${p.skills.length} skill sẽ bị gỡ${p.scope === "org" ? " cho mọi người" : ""}. Bạn có thể cài lại từ danh mục.`), "Uninstall",
    () => api<{ plugins: PublicPlugin[] }>("DELETE", `/api/plugins/${p.id}`).then((r) => { onChange(r); fire(); onClose(); app.say(tr("Plugin uninstalled")); }).catch((e) => app.say(e.message)));
  const on = p.enabled && p.mine.enabled;
  return (
    <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pl-modal">
        <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={onClose} aria-label="Close"><I.X size={16} /></button>
        <div className="pl-dh">
          <PlugMark id={p.catalogId} size={44} />
          <div><h2 data-notr>{p.name}</h2><div className="pl-tags">{p.scope === "org" ? <Badge kind="ok">Everyone</Badge> : <Badge kind="">Personal</Badge>}{p.studio && <Badge kind="studio">{STUDIO[p.studio]} studio</Badge>}<Badge kind={RISK[p.risk][1]}>{RISK[p.risk][0]}</Badge>{p.licenses.map((l) => <Badge key={l} kind="">{l}</Badge>)}</div></div>
        </div>
        <p className="d">{p.description}</p>
        <div className="pl-rows">
          <div className="pl-row"><div><b>Turned on</b><span>{p.scope === "org" && !admin ? "Turn it off just for you." : "Off: no skill of this plugin is used anywhere."}</span></div>
            <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} onClick={() => patch(p.scope === "org" && !admin ? { mine: { enabled: !p.mine.enabled } } : { enabled: !p.enabled })} /></div>
          <div className="pl-row"><div><b>List every skill directly</b><span>Off: Synchro opens this library on its own when a request needs it. On: each skill is listed in every chat, which uses more context.</span></div>
            <button className={`toggle ${p.mine.everywhere ? "on" : ""}`} role="switch" aria-checked={p.mine.everywhere} onClick={() => patch(p.scope === "org" ? { mine: { everywhere: !p.mine.everywhere } } : { everywhere: !p.everywhere })} /></div>
          {manage && <div className="pl-row"><div><b>Studio button</b><span>Pressing this Artifacts button gives Synchro the whole library of this plugin.</span></div>
            <select className="pl-sel" value={p.studio ?? ""} onChange={(e) => patch({ studio: e.target.value || null })}><option value="">None</option><option value="design">Design</option><option value="slides">Slides</option><option value="docs">Docs</option></select></div>}
        </div>
        <div className="pl-src">
          {Object.entries(p.commits).map(([r, c]) => <a key={r} href={`https://github.com/${r}/tree/${c}`} target="_blank" rel="noreferrer" data-notr><I.GitHub size={13} />{r}<em>{c.slice(0, 7)}</em></a>)}
          <span className="d">{tr("Updated")} {new Date(p.updatedAt).toLocaleDateString(getLang() === "en" ? "en-US" : "vi-VN")}</span>
        </div>
        <div className="pl-list">
          {p.skills.map((s) => <SkillLine key={s.id} s={s.report} right={<>{s.useCount > 0 && <span className="pl-use">{s.useCount}×</span>}{manage && <button className={`toggle ${s.enabled ? "on" : ""}`} role="switch" aria-checked={s.enabled} aria-label={s.name} onClick={() => patch({ skills: { [s.name]: !s.enabled } })} />}</>} />)}
        </div>
        {manage && (
          <div className="modal-foot pl-acts">
            <button className="btn danger" onClick={remove}>Uninstall</button>
            <span style={{ flex: 1 }} />
            <input ref={file} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            <button className="btn" disabled={!!busy} onClick={() => file.current?.click()}>{busy === "upload" ? <span className="art-spin sm" /> : <I.Plus size={14} />}Add skills from zip</button>
            {p.updateAvailable ? <button className="btn dark" disabled={!!busy} onClick={() => act("update")}>{busy === "update" ? <span className="art-spin sm" /> : null}Update</button>
              : <button className="btn" disabled={!!busy} onClick={() => act("check")}>{busy === "check" ? <span className="art-spin sm" /> : null}Check for updates</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- trang Plugins
// Kết hợp Claude và Synchro: hai tab Của bạn / Khám phá, nút + cài một chạm cho plugin trong danh mục (đã kiểm tra giấy phép),
// "Thêm từ repo GitHub" có bước xem trước giấy phép và rủi ro, mỗi plugin có menu nhanh (quản lý, cập nhật, tắt, gỡ).
// Cùng một ô với trang Kỹ năng: link một skill thì thêm vào Kỹ năng, link nhiều skill thì cài thành plugin.
function AddRepo({ onClose, onDone }: { onClose: () => void; onDone: (r: { kind: "skill" } | { kind: "plugin"; plugin: PublicPlugin }) => void }) {
  const [child, setChild] = useState(false);
  return (
    <div className="overlay" style={{ zIndex: 70, display: child ? "none" : undefined }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pl-modal pl-small">
        <button type="button" className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={onClose} aria-label="Close"><I.X size={16} /></button>
        <h2>Add from GitHub</h2>
        <p className="d">Paste a link to a public repository, a folder inside it, or a single SKILL.md. Synchro checks licenses and scripts and shows you everything before installing.</p>
        <GithubAdd autoFocus onModal={setChild} onDone={onDone} />
      </div>
    </div>
  );
}

function RowMenu({ p, manage, onOpen, onAct }: { p: PublicPlugin; manage: boolean; onOpen: () => void; onAct: (a: "check" | "toggle" | "remove") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const on = p.enabled && p.mine.enabled;
  return (
    <div className="pl-more" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" aria-label="More" onClick={() => setOpen(!open)}><I.Dots size={16} /></button>
      {open && (
        <div className="menu pl-menu">
          <button className="menu-item" onClick={() => { setOpen(false); onOpen(); }}><I.Sliders size={15} />Manage</button>
          {manage && <button className="menu-item" onClick={() => { setOpen(false); onAct("check"); }}><I.Retry size={15} />Check for updates</button>}
          <button className="menu-item" onClick={() => { setOpen(false); onAct("toggle"); }}>{on ? <I.Pause size={15} /> : <I.Play size={15} />}{on ? (p.scope === "org" && !manage ? "Turn off for me" : "Turn off") : "Turn on"}</button>
          {manage && <><hr /><button className="menu-item del" onClick={() => { setOpen(false); onAct("remove"); }}><I.Trash size={15} />Uninstall</button></>}
        </div>
      )}
    </div>
  );
}

const CAT: Record<string, string> = { studio: "Studios", design: "Design", dev: "Development & testing", writing: "Writing" };

export function PluginsPanel() {
  const app = useApp();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"yours" | "discover" | null>(null);
  const [pv, setPv] = useState<{ catalogId?: string; url?: string; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const addRef = useRef<HTMLDivElement>(null);
  const load = useCallback(() => api<Data>("GET", "/api/plugins").then((x) => { setD(x); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!addMenu) return;
    const h = (e: MouseEvent) => { if (!addRef.current?.contains(e.target as Node)) setAddMenu(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [addMenu]);
  if (err) return <div className="empty" style={{ marginTop: 40 }}><I.Alert size={28} /><span>{err}</span><button className="btn" onClick={load}>Try again</button></div>;
  if (!d) return <div className="empty" style={{ marginTop: 40 }}><span className="art-spin" /></div>;
  const view = tab ?? (d.plugins.length ? "yours" : "discover");
  const merge = (r: { plugins: PublicPlugin[]; plugin?: PublicPlugin }) => setD((x) => (x ? { ...x, plugins: r.plugins.length ? r.plugins : x.plugins.map((p) => (r.plugin && p.id === r.plugin.id ? r.plugin : p)) } : x));
  const byCat = new Map(d.plugins.filter((p) => p.catalogId).map((p) => [p.catalogId!, p]));
  const ql = q.trim().toLowerCase();
  const match = (t: string) => !ql || t.toLowerCase().includes(ql);
  // Cài một chạm (plugin trong danh mục đã được kiểm tra giấy phép): quản trị viên cài cho cả tổ chức.
  const quick = async (x: DirPlugin) => {
    setBusy(x.catalogId);
    try {
      const r = await api<{ plugin: PublicPlugin; plugins: PublicPlugin[] }>("POST", "/api/plugins", { action: "install", catalogId: x.catalogId, scope: d.admin ? "org" : "personal" });
      merge({ plugins: r.plugins }); fire();
      app.say(`${r.plugin.name} ${tr("is installed and ready to use")}`);
    } catch (e) { app.say((e as Error).message); }
    setBusy(null);
  };
  const act = async (p: PublicPlugin, a: "check" | "toggle" | "remove") => {
    const manage = p.scope === "personal" || d.admin;
    try {
      if (a === "check") { const r = await api<{ changed: string[]; plugin: PublicPlugin }>("POST", `/api/plugins/${p.id}`, { action: "check" }); merge({ plugins: [], plugin: r.plugin }); app.say(r.changed.length ? tr("An update is available") : tr("Already up to date")); }
      if (a === "toggle") { const on = p.enabled && p.mine.enabled; merge(await api("PATCH", `/api/plugins/${p.id}`, p.scope === "org" && !manage ? { mine: { enabled: !on } } : { enabled: !on })); fire(); }
      if (a === "remove") app.confirm(`${tr("Gỡ")} ${p.name}?`, tr(`${p.skills.length} skill sẽ bị gỡ${p.scope === "org" ? " cho mọi người" : ""}. Bạn có thể cài lại từ danh mục.`), "Uninstall",
        () => api<{ plugins: PublicPlugin[] }>("DELETE", `/api/plugins/${p.id}`).then((r) => { setD((x) => (x ? { ...x, plugins: r.plugins } : x)); fire(); app.say(tr("Plugin uninstalled")); }).catch((e) => app.say(e.message)));
    } catch (e) { app.say((e as Error).message); }
  };
  const cur = d.plugins.find((p) => p.id === open);
  const featured = d.directory.find((x) => x.catalogId === "design-studio")!;
  const plusBtn = (x: DirPlugin) => {
    const inst = byCat.get(x.catalogId);
    if (inst) return <button className="pl-plus done" aria-label="Installed" data-tip="Installed" onClick={() => setOpen(inst.id)}><I.Check size={15} /></button>;
    if (!d.canInstall) return null;
    return <button className="pl-plus" aria-label={`Install ${x.name}`} data-tip="Install" disabled={!!busy} onClick={() => quick(x)}>{busy === x.catalogId ? <span className="art-spin sm" /> : <I.Plus size={15} />}</button>;
  };
  const card = (x: DirPlugin) => (
    <div key={x.catalogId} className="pl-dcard">
      <PlugMark id={x.catalogId} size={44} />
      <div className="pl-dcard-t"><b data-notr>{x.name}</b><span>{x.tagline}</span><em>{x.author} · {x.skillCount} skill · {x.license}</em></div>
      {plusBtn(x)}
    </div>
  );
  const row = (p: PublicPlugin) => {
    const manage = p.scope === "personal" || d.admin;
    return (
      <div key={p.id} role="button" tabIndex={0} className={`pl-row2 ${p.enabled && p.mine.enabled ? "" : "off"}`} onClick={() => setOpen(p.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(p.id)}>
        <PlugMark id={p.catalogId} size={36} />
        <div className="pl-row2-t">
          <div className="pl-row2-h"><b data-notr>{p.name}</b>{p.studio && <Badge kind="">{STUDIO[p.studio]}</Badge>}<Badge kind="">{p.skills.length} skill</Badge>{p.updateAvailable && <Badge kind="mid">Update</Badge>}{!(p.enabled && p.mine.enabled) && <Badge kind="">Off</Badge>}</div>
          <span>{p.author ? `${tr("từ")} ${p.author} · ` : ""}{p.description}</span>
        </div>
        <span className="pl-date">{new Date(p.updatedAt).toLocaleDateString(getLang() === "en" ? "en-US" : "vi-VN", { day: "numeric", month: "short" })}</span>
        <RowMenu p={p} manage={manage} onOpen={() => setOpen(p.id)} onAct={(a) => act(p, a)} />
      </div>
    );
  };
  const org = d.plugins.filter((p) => p.scope === "org" && match(`${p.name} ${p.description}`));
  const mine = d.plugins.filter((p) => p.scope === "personal" && match(`${p.name} ${p.description}`));
  const cats = ["studio", "design", "dev", "writing"].map((c) => [c, d.directory.filter((x) => x.category === c && match(`${x.name} ${x.tagline} ${x.author}`))] as const).filter(([, l]) => l.length);
  return (
    <>
      <div className="pl-top">
        <h1 className="pl-title">Plugins</h1>
        <div className="pl-seg"><button className={view === "yours" ? "on" : ""} onClick={() => setTab("yours")}>Yours</button><button className={view === "discover" ? "on" : ""} onClick={() => setTab("discover")}>Discover</button></div>
        <span style={{ flex: 1 }} />
        <span className="s-search pl-search"><I.Search size={14} /><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></span>
        {d.canInstall && (
          <div className="pl-addw" ref={addRef}>
            <button className="btn dark pl-add" onClick={() => setAddMenu(!addMenu)}><I.Plus size={14} />Add<I.Chevron size={13} /></button>
            {addMenu && (
              <div className="menu pl-menu right">
                <button className="menu-item" onClick={() => { setAddMenu(false); setTab("discover"); }}><I.Book size={15} /><span className="pl-mi"><b>Browse Synchro directory</b><em>Curated plugins with checked licenses</em></span></button>
                <button className="menu-item" onClick={() => { setAddMenu(false); setAdding(true); }}><I.Branch size={15} /><span className="pl-mi"><b>Add from GitHub</b><em>One skill or a whole repository, detected for you</em></span></button>
              </div>
            )}
          </div>
        )}
      </div>

      {view === "yours" ? (
        <>
          {!d.plugins.length && (
            <div className="pl-hero">
              <div><b>Add your first plugins</b><span>Give Synchro role-level expertise with plugins. Add them from Discover.</span><button className="btn dark" onClick={() => setTab("discover")}>Discover plugins</button></div>
              <I.Plugins size={64} />
            </div>
          )}
          {org.length > 0 && <><div className="pl-sec">For everyone <i>{org.length}</i></div><div className="pl-rows2">{org.map(row)}</div></>}
          {mine.length > 0 && <><div className="pl-sec">Just for you <i>{mine.length}</i></div><div className="pl-rows2">{mine.map(row)}</div></>}
          {d.plugins.length > 0 && !org.length && !mine.length && <div className="empty" style={{ marginTop: 40 }}><span>No plugins match your search.</span></div>}
          {d.plugins.length > 0 && <p className="d pl-tip"><I.InfoCircle size={14} />Just chat: Synchro looks through every installed library and picks the skills that fit your request. The Design, Slides and Docs buttons on the Artifacts page only force that mode.</p>}
        </>
      ) : (
        <>
          {!ql && (
            <div className="pl-hero feat">
              <div><em>From Synchro</em><b>{featured.name}</b><span>{featured.tagline}</span>
                {byCat.get(featured.catalogId) ? <button className="btn" onClick={() => setOpen(byCat.get(featured.catalogId)!.id)}><I.Check size={14} />Installed</button>
                  : d.canInstall ? <button className="btn dark" disabled={!!busy} onClick={() => quick(featured)}>{busy === featured.catalogId ? <span className="art-spin sm" /> : null}Add</button> : null}
              </div>
              <I.Palette size={72} />
            </div>
          )}
          {cats.map(([c, list]) => <div key={c}><div className="pl-sec">{CAT[c]}</div><div className="pl-dgrid">{list.map(card)}</div></div>)}
          {!cats.length && <div className="empty" style={{ marginTop: 40 }}><span>No plugins match your search.</span></div>}
          <p className="d pl-tip"><I.ShieldCheck size={14} />Directory plugins only contain skills whose license allows copying. Anthropic&apos;s docx, pdf, pptx and xlsx skills are proprietary and are skipped; Synchro creates those files with code execution instead.</p>
        </>
      )}

      {adding && <AddRepo onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); if (r.kind === "plugin") { load(); setTab("yours"); setOpen(r.plugin.id); } else app.say(tr("It's a single skill, so it was added to Skills")); }} />}
      {pv && <PreviewModal target={pv} admin={d.admin} onClose={() => setPv(null)} onDone={(p) => { setPv(null); load(); setTab("yours"); setOpen(p.id); }} />}
      {cur && <Detail p={cur} admin={d.admin} onClose={() => setOpen(null)} onChange={merge} />}
    </>
  );
}

// ---------------------------------------------------------------- trang Tùy chỉnh (Skills / Connectors / Plugins)
export type CzTab = "skills" | "connectors" | "plugins";
export function CustomizePage({ tab, setTab, skills, connectors, feats }: { tab: CzTab; setTab: (t: CzTab) => void; skills: React.ReactNode; connectors: React.ReactNode; feats: { skills: boolean; connectors: boolean } }) {
  const items: [CzTab, string, React.ReactNode, boolean][] = [["skills", "Skills", <I.Scroll key="s" />, feats.skills], ["connectors", "Connectors", <I.Connectors key="c" />, feats.connectors], ["plugins", "Plugins", <I.Plugins key="p" />, feats.skills]];
  return (
    <div className="page"><div className="page-in cz">
      <nav className="cz-nav">{items.filter((x) => x[3]).map(([k, label, ic]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{ic}<span>{label}</span></button>)}</nav>
      <div className="cz-body">{tab === "skills" ? skills : tab === "connectors" ? connectors : <PluginsPanel />}</div>
    </div></div>
  );
}

// Plugin đang gắn với các studio (để trang Artifacts và thanh chế độ hiện số skill).
export function useStudios() {
  const [m, setM] = useState<Partial<Record<Studio, { name: string; skills: number }>>>({});
  useEffect(() => {
    const load = () => fetch("/api/plugins").then((r) => (r.ok ? r.json() : null)).then((j: Data | null) => {
      if (!j) return;
      const o: Partial<Record<Studio, { name: string; skills: number }>> = {};
      for (const p of j.plugins) if (p.studio && p.enabled && p.mine.enabled) { const c = o[p.studio]; o[p.studio] = { name: c ? `${c.name}, ${p.name}` : p.name, skills: (c?.skills ?? 0) + p.skills.filter((s) => s.enabled).length }; }
      setM(o);
    }).catch(() => {});
    load();
    window.addEventListener(PLUGINS_CHANGED, load);
    return () => window.removeEventListener(PLUGINS_CHANGED, load);
  }, []);
  return m;
}
