"use client";
// Giao diện Plugins (Tùy chỉnh → Plugins, Cài đặt → Plugins) và trang Tùy chỉnh có ba mục Skills / Connectors / Plugins.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { useApp } from "./store";
import { getLang, tr } from "./i18n";
import type { PublicPlugin, Preview, Risk, SkillReport, Studio } from "./plugins";
import type { DirPlugin } from "./plugindir";

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
function PreviewModal({ target, data, onClose, onDone }: { target: { catalogId?: string; url?: string; name: string }; data: Data; onClose: () => void; onDone: (p: PublicPlugin) => void }) {
  const app = useApp();
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState("");
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"org" | "personal">(data.admin ? "org" : "personal");
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
            <div className="pl-sum">
              <span><b>{ok.length}</b> skill</span><span><b>{mb(pv.size)}</b></span>
              {Object.entries(pv.commits).map(([r, c]) => <a key={r} href={`https://github.com/${r}/tree/${c}`} target="_blank" rel="noreferrer" data-notr>{r}@{c.slice(0, 7)}</a>)}
            </div>
            <div className="pl-list">
              {pv.skills.map((s) => <SkillLine key={`${s.repo}/${s.dir}`} s={s} checked={!s.blocked && !s.duplicateOf && !skip.has(s.name)} disabled={!!s.blocked || !!s.duplicateOf}
                onToggle={() => setSkip((x) => { const y = new Set(x); if (y.has(s.name)) y.delete(s.name); else y.add(s.name); return y; })} />)}
            </div>
            {data.admin && (
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
          <div className="pl-row"><div><b>Use in every chat</b><span>Off: skills only load when you press its studio button. Saves context for big plugins.</span></div>
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
export function PluginsPanel() {
  const app = useApp();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [url, setUrl] = useState("");
  const [pv, setPv] = useState<{ catalogId?: string; url?: string; name: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const load = useCallback(() => api<Data>("GET", "/api/plugins").then((x) => { setD(x); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const head = (
    <div className="adm-head">
      <div className="adm-badge"><I.Plugins size={22} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="s-title">Plugins</div>
        <div className="d">Install a whole set of skills in one step from GitHub. Link a plugin to the Design, Slides or Docs button and Synchro gets its entire library for that work.</div>
      </div>
    </div>
  );
  if (err) return <>{head}<div className="empty" style={{ marginTop: 40 }}><I.Alert size={28} /><span>{err}</span><button className="btn" onClick={load}>Try again</button></div></>;
  if (!d) return <>{head}<div className="empty" style={{ marginTop: 40 }}><span className="muted">Loading…</span></div></>;
  const merge = (r: { plugins: PublicPlugin[]; plugin?: PublicPlugin }) => setD((x) => (x ? { ...x, plugins: r.plugins.length ? r.plugins : x.plugins.map((p) => (r.plugin && p.id === r.plugin.id ? r.plugin : p)) } : x));
  const installed = new Set(d.plugins.map((p) => p.catalogId).filter(Boolean));
  const studios = d.directory.filter((x) => x.category === "studio");
  const ql = q.trim().toLowerCase();
  const more = d.directory.filter((x) => x.category !== "studio" && (!ql || `${x.name} ${x.tagline} ${x.author}`.toLowerCase().includes(ql)));
  const cur = d.plugins.find((p) => p.id === open);
  return (
    <>
      {head}
      {d.canInstall && (
        <form className="pl-url" onSubmit={(e) => { e.preventDefault(); if (url.trim()) setPv({ url: url.trim(), name: url.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "") }); }}>
          <I.GitHub size={16} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo  (every SKILL.md inside is found automatically)" spellCheck={false} />
          <button className="btn dark" disabled={!url.trim()}>Preview</button>
        </form>
      )}

      <h3 className="sec">Studios</h3>
      <p className="d" style={{ marginTop: -6 }}>The Design, Slides and Docs buttons on the Artifacts page. Each one loads its plugin&apos;s library, so Synchro already knows how to do the work well.</p>
      <div className="pl-grid">
        {studios.map((x) => {
          const p = d.plugins.find((y) => y.studio === x.studio);
          return (
            <div key={x.catalogId} className={`pl-card studio ${p ? "in" : ""}`}>
              <div className="pl-card-h"><PlugMark id={x.catalogId} /><div><b>{x.name}</b><span>{p ? `${p.skills.filter((s) => s.enabled).length} skill · ${p.scope === "org" ? tr("for everyone") : tr("personal")}` : `${x.skillCount} skill · ${x.license}`}</span></div></div>
              <p>{x.tagline}</p>
              {p ? <button className="btn" onClick={() => setOpen(p.id)}>Manage</button> : d.canInstall ? <button className="btn dark" onClick={() => setPv({ catalogId: x.catalogId, name: x.name })}>Install</button> : <span className="d">Ask an administrator to install it.</span>}
            </div>
          );
        })}
      </div>

      {d.plugins.length > 0 && (
        <>
          <h3 className="sec">Installed</h3>
          <div className="pl-inst">
            {d.plugins.map((p) => (
              <button key={p.id} className={`pl-li ${p.enabled && p.mine.enabled ? "" : "off"}`} onClick={() => setOpen(p.id)}>
                <PlugMark id={p.catalogId} size={36} />
                <span className="pl-li-t"><b data-notr>{p.name}</b><span>{p.skills.length} skill · {mb(p.size)} · {p.scope === "org" ? tr("for everyone") : tr("personal")}{p.studio ? ` · ${STUDIO[p.studio]} studio` : ""}{p.mine.everywhere ? ` · ${tr("every chat")}` : ""}</span></span>
                {p.updateAvailable && <Badge kind="mid">Update</Badge>}
                <Badge kind={RISK[p.risk][1]}>{RISK[p.risk][0]}</Badge>
                <I.ChevronR size={14} />
              </button>
            ))}
          </div>
        </>
      )}

      <h3 className="sec" style={{ display: "flex", alignItems: "center", gap: 12 }}>Browse<span className="s-search" style={{ margin: "0 0 0 auto", height: 30, width: 220 }}><I.Search size={14} /><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></span></h3>
      <div className="pl-grid">
        {more.map((x) => (
          <div key={x.catalogId} className="pl-card">
            <div className="pl-card-h"><PlugMark id={x.catalogId} /><div><b data-notr>{x.name}</b><span>{x.author} · {x.skillCount} skill · {x.license}</span></div></div>
            <p>{x.tagline}</p>
            {installed.has(x.catalogId) ? <button className="btn" onClick={() => setOpen(d.plugins.find((p) => p.catalogId === x.catalogId)!.id)}>Manage</button>
              : d.canInstall ? <button className="btn" onClick={() => setPv({ catalogId: x.catalogId, name: x.name })}>Install</button> : null}
          </div>
        ))}
      </div>
      <p className="d" style={{ marginTop: 14 }}>Synchro only installs skills whose license allows copying. Anthropic&apos;s docx, pdf, pptx and xlsx skills are proprietary and are skipped; Synchro creates those files with code execution instead.</p>

      {pv && <PreviewModal target={pv} data={d} onClose={() => setPv(null)} onDone={(p) => { setPv(null); setUrl(""); load(); setOpen(p.id); }} />}
      {cur && <Detail p={cur} admin={d.admin} onClose={() => setOpen(null)} onChange={merge} />}
      {app && null}
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
