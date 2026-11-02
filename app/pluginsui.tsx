"use client";
// Kho kỹ năng (gộp Skills và Plugins; ở thanh bên, Tùy chỉnh và Cài đặt) và trang Tùy chỉnh có hai mục Kho kỹ năng / Connectors.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { useApp } from "./store";
import { getLang, tr, untranslated } from "./i18n";
import type { PublicPlugin, Preview, Risk, SkillReport, Studio } from "./plugins";
import type { DirPlugin } from "./plugindir";
import { GithubAdd } from "./ghadd";
import { BulkBar, BulkButton, BulkCheck, bulkRow, each, useBulk, type BulkAct } from "./bulk";
import { slimSkillZip, tooLarge, UPLOAD_MAX } from "./skillzip";
import { downloadExport, ScoreBadge, SkillsPanel, SKILL_STUDIOS, SKILLS_CHANGED, SKILLS_DROP, SKILLS_UPLOAD, sumScores, useSkillScores } from "./skillsui";
import { PageBar, usePage } from "./pager";
import { SkillScan } from "./skillscanui";

type Data = { plugins: PublicPlugin[]; directory: DirPlugin[]; admin: boolean; canInstall: boolean; studios?: Partial<Record<Studio, { name: string; skills: number; auto: { name: string; from: string }[] }>> };
async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body instanceof FormData ? undefined : { "content-type": "application/json" }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || (r.status === 413 ? tooLarge() : `Error ${r.status}`));
  return j as T;
}
// Báo cho thanh nhập và trang Artifacts biết plugin vừa đổi (studio có thêm skill).
export const PLUGINS_CHANGED = "synchro:plugins";
const fire = () => window.dispatchEvent(new Event(PLUGINS_CHANGED));
export const HUB_DISCOVER = "synchro:hub-discover";

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
    const fd = new FormData();
    setBusy("upload");
    // Gói lớn (cả repo): chỉ tải lên thư mục các skill, lọc như máy chủ (addZipToPlugin).
    try { fd.append("file", await slimSkillZip(f, UPLOAD_MAX, "library")); const r = await api<{ added: string[]; plugins: PublicPlugin[]; plugin: PublicPlugin }>("POST", `/api/plugins/${p.id}`, fd); app.say(`${tr("Added")} ${r.added.join(", ")}`); onChange(r); fire(); }
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
        <div className="modal-foot pl-acts">
          {manage && <button className="btn danger" onClick={remove}>Uninstall</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" disabled={!!busy} onClick={async () => { setBusy("export"); await exportLib(p, app.say); setBusy(""); }}>{busy === "export" ? <span className="art-spin sm" /> : <I.Download size={14} />}Export .zip</button>
          {manage && <>
            <input ref={file} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            <button className="btn" disabled={!!busy} onClick={() => file.current?.click()}>{busy === "upload" ? <span className="art-spin sm" /> : <I.Plus size={14} />}Add skills from zip</button>
            {p.updateAvailable ? <button className="btn dark" disabled={!!busy} onClick={() => act("update")}>{busy === "update" ? <span className="art-spin sm" /> : null}Update</button>
              : <button className="btn" disabled={!!busy} onClick={() => act("check")}>{busy === "check" ? <span className="art-spin sm" /> : null}Check for updates</button>}
          </>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- trang Kho kỹ năng
// Kết hợp Claude và Synchro: hai tab Của bạn / Khám phá, nút + cài một chạm cho plugin trong danh mục (đã kiểm tra giấy phép),
// "Thêm từ repo GitHub" có bước xem trước giấy phép và rủi ro, mỗi plugin có menu nhanh (quản lý, cập nhật, tắt, gỡ).
// Xuất thư viện thành .zip (mọi skill, nguồn, commit, giấy phép, tùy chọn): ai thấy thư viện thì xuất được.
async function exportLib(p: PublicPlugin, say: (m: string) => void) {
  try { const f = await downloadExport(`/api/plugins/${encodeURIComponent(p.id)}/export`, `${p.slug}.zip`); say(`${tr("Đã xuất")} ${f}`); }
  catch (e) { say((e as Error).message); }
}
function RowMenu({ p, manage, onOpen, onAct }: { p: PublicPlugin; manage: boolean; onOpen: () => void; onAct: (a: "check" | "toggle" | "remove") => void }) {
  const app = useApp();
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
          <button className="menu-item" onClick={() => { setOpen(false); void exportLib(p, app.say); }}><I.Download size={15} />Export .zip</button>
          <button className="menu-item" onClick={() => { setOpen(false); onAct("toggle"); }}>{on ? <I.M icon="Pause" size={15} /> : <I.M icon="Play" size={15} />}{on ? (p.scope === "org" && !manage ? "Turn off for me" : "Turn off") : "Turn on"}</button>
          {manage && <><hr /><button className="menu-item del" onClick={() => { setOpen(false); onAct("remove"); }}><I.Trash size={15} />Uninstall</button></>}
        </div>
      )}
    </div>
  );
}

const Toggle = ({ on, set }: { on: boolean; set: (v: boolean) => void }) => <button className={`toggle ${on ? "on" : ""}`} onClick={() => set(!on)} role="switch" aria-checked={on} />;

const CAT: Record<string, string> = { studio: "Studios", design: "Design", dev: "Development & testing", writing: "Writing" };

// Kho kỹ năng: gộp Skills và Plugins. Thư viện (plugin, nhiều skill) và skill lẻ nằm chung một trang,
// một ô "Thêm từ GitHub" tự nhận ra link một skill hay cả bộ, thả tệp .zip / SKILL.md vào đâu trên trang cũng được.
export function SkillHub() {
  const app = useApp();
  const [ghFocus, setGhFocus] = useState(0);
  const [drop, setDrop] = useState(false);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"yours" | "discover" | null>(() => { try { if (sessionStorage.getItem("hub-tab") === "discover") { sessionStorage.removeItem("hub-tab"); return "discover"; } } catch {} return null; });
  // Menu + ở ô chat → "Duyệt skill": chuyển sang tab Khám phá.
  useEffect(() => { const h = () => { try { sessionStorage.removeItem("hub-tab"); } catch {} setTab("discover"); }; window.addEventListener(HUB_DISCOVER, h); return () => window.removeEventListener(HUB_DISCOVER, h); }, []);
  const [pv, setPv] = useState<{ catalogId?: string; url?: string; name: string } | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  // Menu Thêm neo theo mép phải của nút; khung hẹp (Cài đặt → Kho kỹ năng) đẩy nút xuống sát mép trái thì menu mở sang phải,
  // không tràn ra ngoài khung đang cắt nội dung (overflow).
  // Menu "Thêm": canh phải theo nút, nhưng luôn nằm gọn trong khung cuộn gần nhất (màn hình hẹp: thu hẹp lại và dời vào trong, không tràn ra ngoài).
  const [menuPos, setMenuPos] = useState<{ left: number; width: number } | null>(null);
  const toggleAdd = () => {
    if (!addMenu) {
      const el = addRef.current, r = el?.getBoundingClientRect();
      let lo = 0, hi = window.innerWidth;
      for (let p = el?.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(`${o.overflowX} ${o.overflow}`)) { const b = p.getBoundingClientRect(); lo = b.left; hi = b.right; break; } }
      if (r) { const w = Math.min(310, hi - lo - 16), x = Math.min(Math.max(r.right - w, lo + 8), hi - 8 - w); setMenuPos({ left: Math.round(x - r.left), width: Math.round(w) }); }
    }
    setAddMenu(!addMenu);
  };
  const sc = useSkillScores(d);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const addRef = useRef<HTMLDivElement>(null);
  const qlib = q.trim().toLowerCase();
  const libs = (d?.plugins ?? []).filter((p) => !qlib || `${p.name} ${p.description}`.toLowerCase().includes(qlib)).sort((a, b) => (a.scope === b.scope ? 0 : a.scope === "org" ? -1 : 1));
  const bk = useBulk(libs, (p) => p.id);
  const pgOrg = usePage(libs.filter((p) => p.scope === "org"), 10, qlib);
  const pgMine = usePage(libs.filter((p) => p.scope === "personal"), 10, qlib);
  const load = useCallback(() => api<Data>("GET", "/api/plugins").then((x) => { setD(x); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  // Có skill lẻ (dù chưa có thư viện nào) thì vẫn mở tab "Của bạn" để thấy skill của mình; chỉ mở Khám phá khi chưa có gì.
  const [ownSkills, setOwnSkills] = useState<number | null>(null);
  useEffect(() => { fetch("/api/skills").then((r) => r.json()).then((j) => setOwnSkills((j.skills ?? []).length)).catch(() => setOwnSkills(0)); }, []);
  // Skill vừa được đưa vào Thư viện cho mọi người (hộp thêm skill, lưu cách làm, đề xuất của Synchro): tải lại danh sách thư viện.
  useEffect(() => { window.addEventListener(PLUGINS_CHANGED, load); return () => window.removeEventListener(PLUGINS_CHANGED, load); }, [load]);
  useEffect(() => {
    if (!addMenu) return;
    const h = (e: MouseEvent) => { if (!addRef.current?.contains(e.target as Node)) setAddMenu(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [addMenu]);
  if (err) return <div className="empty" style={{ marginTop: 40 }}><I.Alert size={28} /><span>{err}</span><button className="btn" onClick={load}>Try again</button></div>;
  if (!d) return <div className="empty" style={{ marginTop: 40 }}><span className="art-spin" /></div>;
  const view = tab ?? (d.plugins.length || ownSkills ? "yours" : "discover");
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
  const canManage = (p: PublicPlugin) => p.scope === "personal" || d.admin;
  const isOn = (p: PublicPlugin) => p.enabled && p.mine.enabled;
  const setOnAll = async (list: PublicPlugin[], on: boolean) => {
    for (const p of list.filter((x) => isOn(x) !== on)) merge(await api("PATCH", `/api/plugins/${p.id}`, p.scope === "org" && !canManage(p) ? { mine: { enabled: on } } : { enabled: on }));
    fire(); app.say(on ? tr("Đã bật các thư viện đã chọn") : tr("Đã tắt các thư viện đã chọn"));
  };
  const libActs: BulkAct<PublicPlugin>[] = [
    { id: "on", label: "Bật", icon: <I.M icon="Play" size={14} />, when: (l) => l.some((p) => !isOn(p)), run: (l) => setOnAll(l, true) },
    { id: "off", label: "Tắt", icon: <I.M icon="Pause" size={14} />, when: (l) => l.some(isOn), run: (l) => setOnAll(l, false) },
    { id: "check", label: "Kiểm tra cập nhật", icon: <I.Retry size={14} />, when: (l) => l.some(canManage), run: async (l) => {
      let n = 0;
      await each(l.filter(canManage), async (p) => { const r = await api<{ changed: string[]; plugin: PublicPlugin }>("POST", `/api/plugins/${p.id}`, { action: "check" }); merge({ plugins: [], plugin: r.plugin }); if (r.changed.length) n++; });
      app.say(n ? `${n} ${tr("thư viện có bản cập nhật")}` : tr("Already up to date"));
    } },
    { id: "export", label: "Xuất .zip", icon: <I.Download size={14} />, stay: true, run: (l) => each(l, (p) => exportLib(p, app.say)) },
    { id: "remove", label: "Gỡ", icon: <I.Trash size={14} />, danger: true, when: (l) => l.some(canManage),
      confirm: (l) => { const m = l.filter(canManage); return { title: `${tr("Gỡ")} ${m.length} ${tr("thư viện")}?`, text: `${m.reduce((n, p) => n + p.skills.length, 0)} ${tr("skill sẽ bị gỡ")}${m.some((p) => p.scope === "org") ? tr(" (thư viện cho mọi người: gỡ cho cả nhóm)") : ""}.${m.length < l.length ? ` ${l.length - m.length} ${tr("thư viện không thuộc quyền bạn được giữ nguyên.")}` : ""}`, ok: "Gỡ" }; },
      run: async (l) => { let last: PublicPlugin[] | null = null; await each(l.filter(canManage), async (p) => { last = (await api<{ plugins: PublicPlugin[] }>("DELETE", `/api/plugins/${p.id}`)).plugins; }); if (last) setD((x) => (x ? { ...x, plugins: last! } : x)); fire(); app.say(tr("Đã gỡ các thư viện đã chọn")); } },
  ];
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
      <div className="pl-dcard-t"><b data-notr>{x.name}</b><span>{x.tagline}</span><em><span data-notr={untranslated(x.author ?? "") || undefined}>{x.author}</span> · {x.skillCount} skill · {x.license}</em></div>
      {plusBtn(x)}
    </div>
  );
  const row = (p: PublicPlugin) => {
    const manage = p.scope === "personal" || d.admin;
    return (
      <div key={p.id} role="button" tabIndex={0} className={`pl-row2 ${p.enabled && p.mine.enabled ? "" : "off"}`} onClick={() => setOpen(p.id)} onKeyDown={(e) => e.key === "Enter" && setOpen(p.id)} {...bulkRow(bk, p)}>
        {bk.on && <BulkCheck on={bk.has(p)} />}
        <PlugMark id={p.catalogId} size={36} />
        <div className="pl-row2-t">
          <div className="pl-row2-h"><b data-notr>{p.name}</b>{p.studio && <Badge kind="">{STUDIO[p.studio]}</Badge>}<Badge kind="">{p.skills.length} skill</Badge><ScoreBadge s={sumScores(sc, [`lib-${p.slug}`, ...p.skills.map((k) => k.name)])} />{p.updateAvailable && <Badge kind="mid">Update</Badge>}{!(p.enabled && p.mine.enabled) && <Badge kind="">Off</Badge>}</div>
          <span>{p.author ? <>{tr("từ")} <span data-notr={untranslated(p.author) || undefined}>{tr(p.author)}</span> · </> : ""}<span data-notr={untranslated(p.description) || undefined}>{p.description}</span></span>
        </div>
        <span className="pl-date">{new Date(p.updatedAt).toLocaleDateString(getLang() === "en" ? "en-US" : "vi-VN", { day: "numeric", month: "short" })}</span>
        {!bk.on && <RowMenu p={p} manage={manage} onOpen={() => setOpen(p.id)} onAct={(a) => act(p, a)} />}
      </div>
    );
  };
  const org = d.plugins.filter((p) => p.scope === "org" && match(`${p.name} ${p.description}`));
  const mine = d.plugins.filter((p) => p.scope === "personal" && match(`${p.name} ${p.description}`));
  const cats = ["studio", "design", "dev", "writing"].map((c) => [c, d.directory.filter((x) => x.category === c && match(`${x.name} ${x.tagline} ${x.author}`))] as const).filter(([, l]) => l.length);
  return (
    <>
      <div className="pl-top">
        <h1 className="pl-title">Skill Hub</h1>
        <div className="pl-seg"><button className={view === "yours" ? "on" : ""} onClick={() => setTab("yours")}>Yours</button><button className={view === "discover" ? "on" : ""} onClick={() => setTab("discover")}>Discover</button></div>
        <span style={{ flex: 1 }} />
        <span className="s-search pl-search"><I.Search size={14} /><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></span>
        {(d.plugins.length > 0 || !!ownSkills) && <SkillScan />}
        {d.canInstall && (
          <div className="pl-addw" ref={addRef}>
            <button className="btn dark pl-add" onClick={toggleAdd}><I.Plus size={14} />Add<I.Chevron size={13} /></button>
            {addMenu && (
              <div className="menu pl-menu right" style={menuPos ? { left: menuPos.left, right: "auto", width: menuPos.width, minWidth: 0 } : undefined}>
                <button className="menu-item" onClick={() => { setAddMenu(false); setTab("yours"); setGhFocus(Date.now()); }}><span className="pl-mic"><I.GitHub size={15} /></span><span className="pl-mi"><b>Add from a repository link</b><em>GitHub, GitLab… One skill or any repository, detected for you</em></span></button>
                <button className="menu-item" onClick={() => { setAddMenu(false); setTab("yours"); setTimeout(() => window.dispatchEvent(new Event(SKILLS_UPLOAD)), 50); }}><span className="pl-mic"><I.FileUp size={17} /></span><span className="pl-mi"><b>Upload a skill</b><em>A .zip skill folder or a SKILL.md file</em></span></button>
                <button className="menu-item" onClick={() => { setAddMenu(false); app.close(); app.ask("Hãy giúp tôi tạo một skill mới."); }}><span className="pl-mic"><I.Sparkles size={17} /></span><span className="pl-mi"><b>Create with Synchro</b><em>Describe what you need, Synchro writes the skill</em></span></button>
                <hr />
                <button className="menu-item" onClick={() => { setAddMenu(false); setTab("discover"); }}><span className="pl-mic"><I.Library size={17} /></span><span className="pl-mi"><b>Browse Synchro directory</b><em>Curated libraries with checked licenses</em></span></button>
              </div>
            )}
          </div>
        )}
      </div>

      {view === "yours" ? (
        <div className={`hub-yours ${drop ? "drop" : ""}`} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrop(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false); }}
          onDrop={(e) => { e.preventDefault(); setDrop(false); const f = e.dataTransfer.files?.[0]; if (f) window.dispatchEvent(new CustomEvent(SKILLS_DROP, { detail: f })); }}>
          {d.canInstall && <GithubAdd focus={ghFocus} onDone={(r) => { if (r.kind === "plugin") { load(); setOpen(r.plugin.id); } }} />}
          {!d.plugins.length && (
            <div className="pl-hero">
              <div><b>Add your first plugins</b><span>Give Synchro role-level expertise with plugins. Add them from Discover.</span><button className="btn dark" onClick={() => setTab("discover")}>Discover plugins</button></div>
              <I.Plugins size={64} />
            </div>
          )}
          {org.length > 0 && <><div className="pl-sec">Libraries for everyone <i>{org.length}</i><span className="pl-sec-r"><BulkButton b={bk} compact /></span></div><div className="pl-rows2">{pgOrg.items.map(row)}</div><PageBar pg={pgOrg} /></>}
          {mine.length > 0 && <><div className="pl-sec">Your libraries <i>{mine.length}</i>{!org.length && <span className="pl-sec-r"><BulkButton b={bk} compact /></span>}</div><div className="pl-rows2">{pgMine.items.map(row)}</div><PageBar pg={pgMine} /></>}
          <BulkBar b={bk} acts={libActs} noun="thư viện" />
          <SkillsPanel q={q} Toggle={Toggle} />
          <p className="d pl-tip"><I.InfoCircle size={14} />Just chat: Synchro looks through every library and skill here and picks the ones that fit your request. A library is a set of skills installed together; a single skill is one you added on its own.</p>
          {drop && <div className="hub-drop"><I.Upload size={22} /><b>Drop to add the skill</b><span>.zip skill folder or SKILL.md</span></div>}
        </div>
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

      {pv && <PreviewModal target={pv} admin={d.admin} onClose={() => setPv(null)} onDone={(p) => { setPv(null); load(); setTab("yours"); setOpen(p.id); }} />}
      {cur && <Detail p={cur} admin={d.admin} onClose={() => setOpen(null)} onChange={merge} />}
    </>
  );
}

// ---------------------------------------------------------------- trang Tùy chỉnh (Skills / Connectors / Plugins)
export type CzTab = "hub" | "connectors";
export function CustomizePage({ tab, setTab, connectors, feats }: { tab: CzTab; setTab: (t: CzTab) => void; connectors: React.ReactNode; feats: { skills: boolean; connectors: boolean } }) {
  const items: [CzTab, string, React.ReactNode, boolean][] = [["hub", "Skill Hub", <I.Plugins key="h" />, feats.skills], ["connectors", "Connectors", <I.Connectors key="c" />, feats.connectors]];
  const shown = items.filter((x) => x[3]);
  const cur: CzTab = tab === "connectors" && feats.connectors ? "connectors" : "hub";
  return (
    <div className="page ds-page cz-page"><div className="page-in cz">
      <header className="ds-head">
        <div className="ds-head-t"><h1>{cur === "connectors" ? "Connectors" : "Skill Hub"}</h1>
          <p>{cur === "connectors" ? "Let Synchro use your other apps and services for more context, and take actions in them for you." : "Libraries and skills Synchro uses when it works for you: add one from a repository link, upload one, or browse the license-checked directory."}</p></div>
      </header>
      {shown.length > 1 && <nav className="ds-tabs" role="tablist">{shown.map(([k, label, ic]) => <button key={k} role="tab" aria-selected={cur === k} className={cur === k ? "on" : ""} onClick={() => setTab(k)}>{ic}<span>{label}</span></button>)}</nav>}
      <div className="cz-body">{cur === "connectors" ? connectors : <SkillHub />}</div>
    </div></div>
  );
}

// Plugin đang gắn với các studio (để trang Artifacts và thanh chế độ hiện số skill).
export function useStudios() {
  const [m, setM] = useState<Partial<Record<Studio, { name: string; skills: number }>>>({});
  useEffect(() => {
    const load = () => fetch("/api/plugins").then((r) => (r.ok ? r.json() : null)).then((j: Data | null) => {
      if (!j) return;
      // Máy chủ đếm sẵn (gồm skill Synchro tự nhận diện thuộc mục — từ Kho kỹ năng và plugin khác); máy chủ cũ thì tự đếm plugin studio.
      if (j.studios) { setM(j.studios); return; }
      const o: Partial<Record<Studio, { name: string; skills: number }>> = {};
      for (const p of j.plugins) if (p.studio && p.enabled && p.mine.enabled) { const c = o[p.studio]; o[p.studio] = { name: c ? `${c.name}, ${p.name}` : p.name, skills: (c?.skills ?? 0) + p.skills.filter((s) => s.enabled).length }; }
      setM(o);
    }).catch(() => {});
    load();
    // Skill thêm / sửa / xóa trong Kho kỹ năng có thể vào hoặc ra khỏi một mục (Synchro tự nhận diện): đếm lại.
    const evs = [PLUGINS_CHANGED, SKILLS_CHANGED, SKILL_STUDIOS];
    for (const e of evs) window.addEventListener(e, load);
    return () => { for (const e of evs) window.removeEventListener(e, load); };
  }, []);
  return m;
}
