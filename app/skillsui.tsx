"use client";
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { apiFetch, statusText } from "./apierr";
import { cachedJson, META, SKILLS_CHANGED, SKILL_STUDIOS, type PluginsMeta } from "./studios";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { useApp } from "./store";
import { BulkBar, BulkButton, BulkCheck, bulkRow, each, useBulk, type BulkAct } from "./bulk";
import { getLang, tr } from "./i18n";
import { diffLines } from "./md";
import { slimSkillZip, tooLarge } from "./skillzip";
import { PageBar, usePage } from "./pager";

// studio: mục ở trang Artifacts (Tài liệu / Trình bày / Thiết kế) mà Synchro tự xếp skill vào (src: bộ luật / model / người dùng tự chọn).
type Kind = "docs" | "slides" | "design";
type StudioTag = { studios: Kind[]; src: "rules" | "model" | "manual"; why: string } | null;
type Item = { name: string; description: string; enabled: boolean; version: number; versions: number[]; updated_at: string; fileCount: number; warnings: string[]; useCount: number; lastUsed: string | null; scripts: number; studio?: StudioTag };
const KINDS: Kind[] = ["docs", "slides", "design"];
const KIND_NAME: Record<Kind, string> = { docs: "Docs", slides: "Slides", design: "Design" };
type FileInfo = { path: string; size: number; kind: string };
type Preview = { name: string; description: string; body: string; files: FileInfo[]; warnings: string[]; tokens: number; exists: boolean; version: number; source?: string; generated?: boolean };
type Choice = { dir: string; name: string; description: string; error?: string; exists: boolean };
// Nguồn của skill đang thêm: file tải lên hoặc link GitHub; pick = thư mục skill khi gói có nhiều skill.
type Src = { kind: "file"; file: File; pick?: string } | { kind: "github"; url: string; pick?: string };
// patches: bản tự sửa script (skillheal.ts), kèm bản gốc hiện tại để xem khác biệt.
type Patch = { id: string; path: string; status: "active" | "pending" | "rejected" | "reverted"; mutating: boolean; error: string; attempts: number; created_at: number; uses: number; stale: boolean; content: string; original: string };
type Detail = Item & { body: string; files: FileInfo[]; patches?: Patch[] };

// Hộp thoại gắn thẳng vào <body> để không bị thanh bên hay khung chứa có z-index cao hơn che mất.
const portal = (n: ReactNode) => (typeof document === "undefined" ? n : createPortal(n, document.body));

export { SKILLS_CHANGED, SKILL_STUDIOS };
// Mục ở trang Artifacts của skill vừa đổi (model xếp lại xong, người dùng tự chọn): trang Artifacts đếm lại số skill mỗi mục.
export const SKILLS_UPLOAD = "skills:upload";
// Kho kỹ năng nhận tệp thả vào trang rồi chuyển cho danh sách skill (detail = File).
export const SKILLS_DROP = "skills:drop";
const api = async (url: string, init?: RequestInit) => {
  const r = await apiFetch(url, init);
  const j = await r.json().catch(() => ({}));
  // 413 không kèm lời giải thích: nginx chặn trước khi tới máy chủ (tệp vượt giới hạn mỗi lần tải lên).
  if (!r.ok) throw new Error(j.error || (r.status === 413 ? tooLarge() : statusText(r.status)));
  return j;
};
// Dung lượng tối đa một gói skill tải lên (LIMITS.zip trong skillstore.ts): gói lớn hơn được lọc trong trình duyệt, chỉ giữ thư mục các skill.
const SKILL_ZIP_MAX = 20 * 1024 * 1024;
const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const vi = () => getLang() === "vi";
const ago = (iso: string) => new Date(iso).toLocaleDateString(vi() ? "vi-VN" : "en-US", { day: "numeric", month: "short" });
// Dòng thông tin phụ của skill, theo ngôn ngữ giao diện (nằm trong data-notr nên tự dịch ở đây).
const meta = (s: Item) => [`v${s.version}`, ago(s.updated_at), s.fileCount ? (vi() ? `${s.fileCount} tệp` : `${s.fileCount} files`) : "", s.useCount ? (vi() ? `đã dùng ${s.useCount} lần` : `used ${s.useCount}×`) : ""].filter(Boolean).join(" · ");

// Gửi nguồn skill lên máy chủ: dry = chỉ kiểm tra và trả bản xem trước (hoặc danh sách skill để chọn).
// Link repo không có SKILL.md: máy chủ đọc toàn repo và viết skill ở nền ({ pending }) — gửi lại đúng yêu cầu tới khi xong (tối đa ~8 phút).
async function send(src: Src, dry: boolean, onWait?: () => void): Promise<{ preview?: Preview; choices?: Choice[]; skill?: Item; created?: boolean }> {
  if (src.kind === "github") {
    for (let i = 0; ; i++) {
      const j = await api("/api/skills/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: src.url, pick: src.pick, dry }) });
      if (!j.pending) return j;
      if (i > 190) throw new Error("Đọc repo quá lâu. Thử lại sau.");
      onWait?.();
      await new Promise((ok) => setTimeout(ok, 2500));
    }
  }
  const fd = new FormData(); fd.append("file", await slimSkillZip(src.file, SKILL_ZIP_MAX));
  if (dry) fd.append("dry", "1");
  if (src.pick !== undefined) fd.append("pick", src.pick);
  return api("/api/skills", { method: "POST", body: fd });
}
/** Kiểm tra (không lưu) rồi trả bản xem trước để người dùng duyệt trước khi bật. */
export async function dryRunSkill(f: File): Promise<Preview> {
  const j = await send({ kind: "file", file: f }, true);
  if (!j.preview) throw new Error("Gói có nhiều skill");
  return j.preview;
}

// Xem link repo có mấy skill (không lưu gì): một skill → bản xem trước để thêm vào Kỹ năng; nhiều skill → nên cài thành plugin.
// Không có SKILL.md: bản xem trước là skill Synchro tự viết từ toàn bộ repo (generated). onWait: máy chủ đang đọc repo.
export type Found = { kind: "skill"; src: Src; pv: Preview } | { kind: "bundle"; count: number };
const onGithub = (u: string) => /^https?:\/\/(www\.)?(github\.com|raw\.githubusercontent\.com)\//i.test(u.trim());
export async function inspectGithub(url: string, onWait?: () => void): Promise<Found> {
  const src: Src = { kind: "github", url };
  const j = await send(src, true, onWait);
  if (j.preview) return { kind: "skill", src: { ...src, pick: (j.preview as Preview & { pick?: string }).pick }, pv: j.preview };
  const ok = (j.choices ?? []).filter((c) => !c.error);
  if (!ok.length) throw new Error(j.choices?.length ? j.choices.map((c) => `${c.name || c.dir}: ${c.error}`).join("\n") : "No SKILL.md found at this link.");
  // Cài thành thư viện (plugin) hiện chỉ cho repo GitHub; nơi khác thì dán link tới thư mục của một skill.
  if (ok.length > 1 && !onGithub(url)) throw new Error(getLang() === "vi" ? `Repo có ${ok.length} skill (${ok.map((c) => c.name || c.dir).slice(0, 6).join(", ")}). Hãy dán link tới thư mục của skill cần thêm.` : `This repository has ${ok.length} skills (${ok.map((c) => c.name || c.dir).slice(0, 6).join(", ")}). Paste a link to the folder of the skill you want.`);
  if (ok.length > 1) return { kind: "bundle", count: ok.length };
  const one = await send({ ...src, pick: ok[0].dir }, true);
  return { kind: "skill", src: { ...src, pick: ok[0].dir }, pv: one.preview! };
}

// Tạo skill (quản trị viên): dùng cho riêng mình (Skill của bạn) hay cho mọi người (Thư viện cho mọi người; skill thành một thư viện
// của tổ chức, mọi tài khoản dùng được). Dùng chung cho mọi cách tạo skill: dán link repo, tải lên, lưu cách làm, Synchro đề xuất.
export type Scope = "me" | "org";
// Tải về tệp .zip xuất skill / thư viện (app/skillexport.ts): giữ đúng tên tệp máy chủ đặt, README theo ngôn ngữ giao diện.
export async function downloadExport(url: string, fallback: string): Promise<string> {
  const r = await apiFetch(`${url}?lang=${getLang()}`, { cache: "no-store" });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || statusText(r.status)); }
  const blob = await r.blob();
  const m = /filename\*=UTF-8''([^;]+)/.exec(r.headers.get("content-disposition") ?? "");
  const name = m ? decodeURIComponent(m[1]) : fallback;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  return name;
}

export function useIsAdmin() {
  const [a, setA] = useState(false);
  useEffect(() => { let on = true; cachedJson<PluginsMeta>(META).then((j) => { if (on) setA(!!j?.admin); }).catch(() => {}); return () => { on = false; }; }, []);
  return a;
}
// Chỉ quản trị viên mới thấy lựa chọn này; tài khoản khác thêm skill vào Skill của bạn như thường.
export function ScopeChoice({ value, onChange, admin, disabled }: { value: Scope; onChange: (v: Scope) => void; admin: boolean; disabled?: boolean }) {
  if (!admin) return null;
  return (
    <div className="pub-vis sk-scope" role="radiogroup" aria-label="Who can use this skill?">
      <div className="sk-scope-l">Who can use this skill?</div>
      <button type="button" role="radio" aria-checked={value === "me"} className={value === "me" ? "on" : ""} disabled={disabled} onClick={() => onChange("me")}><I.Lock size={15} /><span><b>Only me</b><em>Goes to Your skills. Only your account uses it.</em></span></button>
      <button type="button" role="radio" aria-checked={value === "org"} className={value === "org" ? "on" : ""} disabled={disabled} onClick={() => onChange("org")}><I.Users size={15} /><span><b>Everyone</b><em>Goes to the Library for everyone. Every account can use it.</em></span></button>
    </div>
  );
}
// Đưa skill vừa lưu vào Thư viện cho mọi người (máy chủ bỏ bản riêng để không trùng); danh sách thư viện tải lại (PLUGINS_CHANGED của pluginsui).
export async function shareSkill(name: string, source?: string) {
  await api(`/api/skills/${encodeURIComponent(name)}/share`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source }) });
  window.dispatchEvent(new Event("synchro:plugins"));
}

// Duyệt một skill trước khi thêm. onOrg (chỉ quản trị viên, repo GitHub có SKILL.md): "Mọi người" cài thành thư viện theo dõi repo
// (kiểm tra giấy phép, cập nhật theo commit); còn lại (tải lên, skill Synchro viết từ repo, link git khác) thì lưu rồi đưa vào thư viện.
export function SkillAddModal({ src, pv, onClose, onDone, onOrg }: { src: Src; pv: Preview; onClose: () => void; onDone: () => void; onOrg?: () => void }) {
  const app = useApp();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const admin = useIsAdmin();
  const [scope, setScope] = useState<Scope>("me");
  const confirm = async () => {
    if (scope === "org" && onOrg && !pv.generated) return onOrg();
    setSaving(true); setErr("");
    try {
      const j = await send(src, false);
      if (scope === "org") {
        await shareSkill(j.skill!.name, src.kind === "github" ? src.url : undefined);
        app.say(`Đã thêm ${j.skill!.name} vào thư viện cho mọi người`);
      } else app.say(j.created ? `Đã thêm skill ${j.skill!.name}` : `Đã cập nhật ${j.skill!.name} lên v${j.skill!.version}`);
      window.dispatchEvent(new Event(SKILLS_CHANGED)); onDone();
    } catch (e) { setErr((e as Error).message); setSaving(false); }
  };
  return (
    <div className="overlay sk-mask" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="sk-modal">
        <div className="sk-mh"><b>{pv.exists ? `Update ${pv.name} to v${pv.version}` : `Add ${pv.name}`}</b></div>
        {pv.source && <div className="muted" style={{ fontSize: 12, margin: "-2px 0 8px" }} data-notr>{pv.source}{src.pick ? ` · ${src.pick.split("/").slice(1).join("/")}` : ""}</div>}
        <p className="d" style={{ margin: "0 0 10px" }} data-notr>{pv.description}</p>
        <div className="sk-note">Skills are instructions the model will follow. Only enable skills from sources you trust, and read the content below first.</div>
        {pv.warnings.length > 0 && <ul className="sk-wl">{pv.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        {err && <div className="sk-err" role="alert"><span>{err}</span></div>}
        <div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>SKILL.md · ~{pv.tokens} tokens</div>
        <pre className="sk-pre">{pv.body || "(empty)"}</pre>
        {pv.files.length > 0 && <>
          <div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>{pv.files.length} files</div>
          <div className="sk-files">{pv.files.map((f) => <div key={f.path}><span>{f.path}</span><span className="muted">{f.kind} · {fmt(f.size)}</span></div>)}</div>
        </>}
        <ScopeChoice value={scope} onChange={setScope} admin={admin} disabled={saving} />
        <div className="sk-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn dark" disabled={saving} onClick={confirm}>{saving ? "Saving…" : scope === "org" ? "Add for everyone" : pv.exists ? "Update and keep state" : "Add and enable"}</button>
        </div>
      </div>
    </div>
  );
}

// Phần "Skill của bạn" trong Kho kỹ năng: các skill lẻ (tải lên, link GitHub một skill), cùng kiểu hàng với thư viện.
// Điểm 👍 / 👎 của skill (cả tổ chức chấm qua nút dưới câu trả lời đã dùng skill đó).
export type SkillScore = { up: number; down: number; low: boolean };
export const LOW_NOTE = "Most answers that used this skill were rated unhelpful. Consider updating it or turning it off.";
export function useSkillScores(key?: unknown) {
  const [sc, setSc] = useState<Record<string, SkillScore>>({});
  useEffect(() => { fetch("/api/feedback").then((r) => (r.ok ? r.json() : {})).then((j: { scores?: Record<string, SkillScore> }) => setSc(j.scores ?? {})).catch(() => {}); }, [key]);
  return sc;
}
export const sumScores = (sc: Record<string, SkillScore>, names: string[]) => {
  const up = names.reduce((n, k) => n + (sc[k]?.up ?? 0), 0), down = names.reduce((n, k) => n + (sc[k]?.down ?? 0), 0);
  return { up, down, low: down >= 3 && down / (up + down) >= 0.6 };
};
export function ScoreBadge({ s }: { s?: SkillScore }) {
  if (!s || s.up + s.down === 0) return null;
  return (
    <span className={`pl-b sk-score ${s.low ? "high" : ""}`} title={s.low ? LOW_NOTE : undefined}>
      <I.ThumbUp size={11} />{s.up}<I.ThumbDown size={11} />{s.down}{s.low && <em>Often unhelpful</em>}
    </span>
  );
}

export function SkillsPanel({ q, Toggle }: { q: string; Toggle: ComponentType<{ on: boolean; set: (v: boolean) => void; label?: string }> }) {
  const app = useApp();
  const [list, setList] = useState<Item[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [pending, setPending] = useState<{ src: Src; pv: Preview } | null>(null);
  const [choose, setChoose] = useState<{ src: Src; choices: Choice[] } | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [fileView, setFileView] = useState<{ path: string; text: string } | null>(null);
  const sc = useSkillScores(list);
  const verRef = useRef<HTMLInputElement>(null);

  // Model đang xếp lại mục ở trang Artifacts cho skill vừa thêm (ở nền): tải lại vài lần để thấy kết quả.
  const polls = useRef(0);
  const load = useCallback(async () => {
    try {
      const j = await api("/api/skills");
      setList(j.skills); setLoadErr("");
      if (j.refining && polls.current < 12) { polls.current++; setTimeout(() => { void load(); window.dispatchEvent(new Event(SKILL_STUDIOS)); }, 2500); }
      else polls.current = 0;
    } catch (e) { setLoadErr((e as Error).message); setList([]); }
  }, []);
  useEffect(() => { load(); const h = () => load(); window.addEventListener(SKILLS_CHANGED, h); return () => window.removeEventListener(SKILLS_CHANGED, h); }, [load]);

  useEffect(() => { const h = () => verRef.current?.click(); window.addEventListener(SKILLS_UPLOAD, h); return () => window.removeEventListener(SKILLS_UPLOAD, h); }, []);
  useEffect(() => { const h = (e: Event) => { const f = (e as CustomEvent<File>).detail; if (f) pick(f); }; window.addEventListener(SKILLS_DROP, h); return () => window.removeEventListener(SKILLS_DROP, h); });
  const check = async (src: Src) => {
    setErr(""); setDetail(null); setChecking(true);
    try {
      const j = await send(src, true);
      if (j.choices) setChoose({ src, choices: j.choices });
      else if (j.preview) { setChoose(null); setPending({ src: { ...src, pick: (j.preview as Preview & { pick?: string }).pick ?? src.pick }, pv: j.preview }); }
    } catch (e) { setErr((e as Error).message); } finally { setChecking(false); }
  };
  const pick = (f: File) => check({ kind: "file", file: f });
  // Thêm lần lượt mọi skill hợp lệ trong gói; skill lỗi được bỏ qua và báo lại.
  const addAll = async () => {
    if (!choose) return;
    const ok = choose.choices.filter((c) => !c.error);
    const failed: string[] = [];
    setBulk({ done: 0, total: ok.length });
    for (let i = 0; i < ok.length; i++) {
      try { await send({ ...choose.src, pick: ok[i].dir }, false); } catch (e) { failed.push(`${ok[i].name}: ${(e as Error).message}`); }
      setBulk({ done: i + 1, total: ok.length });
    }
    setBulk(null); setChoose(null); await load();
    app.say(`Đã thêm ${ok.length - failed.length} skill`);
    if (failed.length) setErr(failed.join("\n"));
  };
  const toggle = async (n: string, enabled: boolean) => {
    setList((l) => l && l.map((s) => (s.name === n ? { ...s, enabled } : s)));
    try { await api(`/api/skills/${n}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) }); } catch (e) { setErr((e as Error).message); load(); }
  };
  const del = (n: string) => app.confirm(`Delete skill "${n}"?`, "All versions of this skill and its files will be deleted. This can't be undone.", "Delete", async () => {
    try { await api(`/api/skills/${n}`, { method: "DELETE" }); setDetail(null); app.say(`Đã xóa ${n}`); load(); } catch (e) { setErr((e as Error).message); }
  });
  const open = async (n: string) => { setFileView(null); try { setDetail((await api(`/api/skills/${n}`)).skill); } catch (e) { setErr((e as Error).message); } };
  const restore = (n: string, v: number) => app.confirm(`Restore v${v}?`, "The model will use this version from now on. Newer versions stay saved and can be restored later.", "Restore version", async () => {
    try { await api(`/api/skills/${n}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ restore: v }) }); app.say(`Đã khôi phục ${n} về v${v}`); await load(); open(n); } catch (e) { setErr((e as Error).message); }
  });
  const [exporting, setExporting] = useState(false);
  const exportZip = async (n: string) => {
    setExporting(true);
    try { const f = await downloadExport(`/api/skills/${encodeURIComponent(n)}/export`, `${n}.zip`); app.say(`${tr("Đã xuất")} ${f}`); }
    catch (e) { setErr((e as Error).message); } finally { setExporting(false); }
  };
  const openFile = async (n: string, path: string) => {
    try { const j = await api(`/api/skills/${n}/file?path=${encodeURIComponent(path)}`); setFileView({ path, text: j.binary ? "(binary file)" : j.text + (j.truncated ? "\n…" : "") }); } catch (e) { setErr((e as Error).message); }
  };

  const shown = (list ?? []).filter((s) => (s.name + " " + s.description).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
  const on = (list ?? []).filter((s) => s.enabled).length;
  // Chọn hàng loạt: bật / tắt, xuất .zip, xóa nhiều skill cùng lúc.
  const bs = useBulk(shown, (x) => x.name);
  const pgS = usePage(shown, 10, q);
  const skActs: BulkAct<Item>[] = [
    { id: "on", label: "Bật", icon: <I.M icon="Play" size={14} />, when: (l) => l.some((x) => !x.enabled), run: (l) => each(l.filter((x) => !x.enabled), (x) => toggle(x.name, true)) },
    { id: "off", label: "Tắt", icon: <I.M icon="Pause" size={14} />, when: (l) => l.some((x) => x.enabled), run: (l) => each(l.filter((x) => x.enabled), (x) => toggle(x.name, false)) },
    { id: "export", label: "Xuất .zip", icon: <I.Download size={14} />, stay: true, run: (l) => each(l, (x) => exportZip(x.name)) },
    { id: "del", label: "Xóa", icon: <I.Trash size={14} />, danger: true,
      confirm: (l) => ({ title: `${tr("Xóa")} ${l.length} skill?`, text: tr("Mọi phiên bản và tệp của các skill này sẽ bị xóa, không hoàn tác được."), ok: "Xóa" }),
      run: async (l) => { await each(l, (x) => api(`/api/skills/${x.name}`, { method: "DELETE" })); app.say(`${tr("Đã xóa")} ${l.length} skill`); setDetail(null); await load(); window.dispatchEvent(new Event(SKILLS_CHANGED)); } },
  ];

  return (
    <>
      {(list === null || list.length > 0 || !q) && <div className="pl-sec">Your skills <i>{list?.length ?? 0}</i>{list && list.length > 0 && <span className="pl-sec-d">{`${on} enabled`}</span>}{checking && <span className="art-spin sm" />}<span className="pl-sec-r"><BulkButton b={bs} compact /></span></div>}
      {err && <div className="sk-err" role="alert"><span>{err}</span><button className="icon-btn" aria-label={tr("Đóng")} style={{ width: 22, height: 22 }} onClick={() => setErr("")}>×</button></div>}
      {loadErr && <div className="sk-err">{loadErr}</div>}
      {list !== null && !list.length && !q && <div className="hub-empty"><I.Scroll size={18} /><span>Single skills you add show up here. Paste a GitHub link above, or drop a .zip skill folder or a SKILL.md anywhere on this page.</span></div>}
      <div className="pl-rows2">
        {pgS.items.map((s) => (
          <div key={s.name} className={`pl-row2 ${s.enabled ? "" : "off"}`} onClick={() => open(s.name)} {...bulkRow(bs, s)}>
            {bs.on && <BulkCheck on={bs.has(s)} />}
            <span className="pl-mark" style={{ width: 36, height: 36 }}><I.Scroll size={17} /></span>
            <div className="pl-row2-t">
              <div className="pl-row2-h"><b data-notr><button type="button" className="art-tile-open">{s.name}</button></b><span className="pl-b" data-notr>v{s.version}</span>{s.scripts > 0 && <span className="pl-b">Scripts</span>}{s.warnings.length > 0 && <span className="pl-b mid" title={s.warnings.join("\n")}>{s.warnings.length} warning{s.warnings.length > 1 ? "s" : ""}</span>}<ScoreBadge s={sc[s.name]} />{!s.enabled && <span className="pl-b">Off</span>}{s.studio?.studios.map((k) => <span key={k} className="pl-b st" data-tip="In this section of Artifacts">{KIND_NAME[k]}</span>)}</div>
              <span data-notr>{s.description}</span>
            </div>
            <span className="pl-date" data-notr>{meta(s).split(" · ").slice(1).join(" · ")}</span>
            {!bs.on && <span onClick={(e) => e.stopPropagation()}><Toggle on={s.enabled} label={s.name} set={(v) => toggle(s.name, v)} /></span>}
          </div>
        ))}
      </div>
      <PageBar pg={pgS} />
      <BulkBar b={bs} acts={skActs} noun="skill" />
      <input ref={verRef} type="file" hidden accept=".zip,.md" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />

      {choose && portal(
        <div className="overlay sk-mask" onMouseDown={(e) => e.target === e.currentTarget && !bulk && setChoose(null)}>
          <div className="sk-modal">
            <div className="sk-mh"><b>Choose skills to add</b><span className="muted" style={{ fontSize: 12 }}>{`${choose.choices.length} found`}</span><span style={{ flex: 1 }} /><button className="icon-btn" aria-label="Close" style={{ width: 24, height: 24 }} disabled={!!bulk} onClick={() => setChoose(null)}>×</button></div>
            <p className="d" style={{ margin: "0 0 10px" }}>This package contains several skills. Preview one to check it before adding, or add every valid skill at once.</p>
            <div className="sk-choices">
              {choose.choices.map((c) => (
                <div key={c.dir} className="sk-choice">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div><b data-notr>{c.name || c.dir.split("/").pop()}</b>{c.exists && <span className="sk-tag">Installed · will update</span>}</div>
                    <div className="muted sk-desc">{c.error ? <span className="sk-bad">{c.error}</span> : <span data-notr>{c.description}</span>}</div>
                  </div>
                  <button className="btn" style={{ height: 26 }} disabled={!!c.error || checking || !!bulk} onClick={() => check({ ...choose.src, pick: c.dir })}>Preview</button>
                </div>
              ))}
            </div>
            <div className="sk-note" style={{ marginTop: 12 }}>Skills are instructions the model will follow. Only add skills from sources you trust.</div>
            <div className="sk-actions"><button className="btn" disabled={!!bulk} onClick={() => setChoose(null)}>Cancel</button><button className="btn dark" disabled={!!bulk || !choose.choices.some((c) => !c.error)} onClick={addAll}>{bulk ? `Adding ${bulk.done}/${bulk.total}…` : `Add all (${choose.choices.filter((c) => !c.error).length})`}</button></div>
          </div>
        </div>
      )}

      {pending && portal(<SkillAddModal src={pending.src} pv={pending.pv} onClose={() => setPending(null)} onDone={() => setPending(null)} />)}

      {detail && portal(
        <div className="overlay sk-mask" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="sk-modal">
            <div className="sk-mh"><b>{detail.name}</b><span className="muted" style={{ fontSize: 12 }}>v{detail.version}</span><span style={{ flex: 1 }} /><button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setDetail(null)} aria-label="Close">×</button></div>
            <p className="d" style={{ margin: "0 0 10px" }} data-notr>{detail.description}</p>
            <div className="sk-meta">
              <span>{detail.useCount ? `Used ${detail.useCount} times` : "Not used yet"}</span>
              {(sc[detail.name]?.up || sc[detail.name]?.down) ? <span>{`Rated helpful ${sc[detail.name].up} · unhelpful ${sc[detail.name].down}`}</span> : null}
              {detail.versions.length > 1 && (
                <span className="sk-vers">Versions:{[...detail.versions].sort((a, b) => b - a).map((v) => v === detail.version
                  ? <b key={v}>v{v}</b>
                  : <button key={v} className="lnk" onClick={() => restore(detail.name, v)}>v{v}</button>)}</span>
              )}
            </div>
            <StudioPick name={detail.name} tag={detail.studio ?? null} onSet={(studio) => { setDetail({ ...detail, studio }); setList((l) => l && l.map((x) => (x.name === detail.name ? { ...x, studio } : x))); }} onErr={setErr} />
            {sc[detail.name]?.low && <div className="sk-note bad">{LOW_NOTE}</div>}
            {detail.warnings.length > 0 && <ul className="sk-wl">{detail.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            <div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>SKILL.md</div>
            <pre className="sk-pre">{detail.body || "(empty)"}</pre>
            {detail.files.length > 0 && <>
              <div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>Files</div>
              <div className="sk-files">{detail.files.map((f) => <div key={f.path} className="clk" onClick={() => openFile(detail.name, f.path)}><span>{f.path}</span><span className="muted">{f.kind} · {fmt(f.size)}</span></div>)}</div>
              {fileView && <><div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>{fileView.path}</div><pre className="sk-pre">{fileView.text}</pre></>}
            </>}
            {!!detail.patches?.length && <SelfFixes name={detail.name} patches={detail.patches} onChange={(patches) => setDetail({ ...detail, patches })} onErr={setErr} />}
            <div className="sk-actions">
              <button className="btn danger" onClick={() => del(detail.name)}>Delete</button>
              <span style={{ flex: 1 }} />
              <button className="btn" disabled={exporting} onClick={() => exportZip(detail.name)}>{exporting ? <span className="art-spin sm" /> : <I.Download size={14} />}Export .zip</button>
              <button className="btn" onClick={() => verRef.current?.click()}>Upload new version</button>
              <button className="btn dark" onClick={() => { toggle(detail.name, !detail.enabled); setDetail({ ...detail, enabled: !detail.enabled }); }}>{detail.enabled ? "Disable" : "Enable"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Mục ở trang Artifacts: Synchro tự nhận diện skill thuộc Tài liệu / Trình bày / Thiết kế (0–3 mục) và thêm vào thư viện của mục đó.
// Bấm một mục để tự chọn (từ đó Synchro không tự xếp lại); "Detect automatically" để Synchro nhận diện lại.
function StudioPick({ name, tag, onSet, onErr }: { name: string; tag: StudioTag; onSet: (t: StudioTag) => void; onErr: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const cur = tag?.studios ?? [];
  const set = async (studios: Kind[] | null) => {
    setBusy(true);
    try {
      const j = await api(`/api/skills/${name}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ studios }) });
      onSet(j.skill.studio ?? null); window.dispatchEvent(new Event(SKILL_STUDIOS));
    } catch (e) { onErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sk-studio">
      <span className="sk-studio-l">In Artifacts</span>
      {KINDS.map((k) => {
        const on = cur.includes(k);
        return <button key={k} className={`sk-st ${on ? "on" : ""}`} aria-pressed={on} disabled={busy} onClick={() => set(on ? cur.filter((x) => x !== k) : KINDS.filter((x) => x === k || cur.includes(x)))}><I.M icon={on ? "Check" : "Plus"} size={12} />{KIND_NAME[k]}</button>;
      })}
      <span className="sk-studio-n">{tag?.src === "manual" ? <>Chosen by you<span aria-hidden> · </span><button className="lnk" disabled={busy} onClick={() => set(null)}>Detect automatically</button></> : cur.length ? "Added automatically by Synchro" : "Not a docs, slides or design skill"}</span>
    </div>
  );
}

// Bản tự sửa: script của skill hỏng thì Synchro tự sửa và chạy lại (script chỉ đọc), hoặc chuẩn bị bản sửa chờ duyệt
// (script có thể gửi / ghi dữ liệu ra ngoài). Xem khác biệt so với bản gốc, duyệt, bỏ, hoặc hoàn tác.
const PATCH_LABEL: Record<Patch["status"], string> = { active: "In use", pending: "Waiting for approval", rejected: "Rejected", reverted: "Undone" };
function SelfFixes({ name, patches, onChange, onErr }: { name: string; patches: Patch[]; onChange: (p: Patch[]) => void; onErr: (m: string) => void }) {
  const [open, setOpen] = useState<string | null>(patches.find((p) => p.status === "pending" && !p.stale)?.id ?? null);
  const act = async (id: string, action: "approve" | "reject" | "revert") => {
    try { const j = await api(`/api/skills/${name}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ patch: id, action }) }); onChange(j.patches); } catch (e) { onErr((e as Error).message); }
  };
  return (
    <>
      <div className="muted" style={{ fontSize: 12, margin: "12px 0 4px" }}>Self-fixes</div>
      <div className="sk-fixes">
        {patches.map((p) => (
          <div key={p.id} className={`sk-fix ${p.status} ${p.stale ? "stale" : ""}`}>
            <div className="sk-fix-h">
              <span className={`sk-tag ${p.status}`}>{p.stale ? "Skill updated, no longer applies" : PATCH_LABEL[p.status]}</span>
              <b data-notr>{p.path}</b>
              <span className="muted" data-notr>{new Date(p.created_at).toLocaleDateString(getLang() === "en" ? "en-US" : "vi-VN")}</span>
              <span style={{ flex: 1 }} />
              <button className="lnk" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Hide changes" : "View changes"}</button>
            </div>
            <div className="sk-fix-e" data-notr>{p.error.trim().split("\n").filter((l) => l.trim()).pop()}</div>
            <div className="muted sk-fix-m">{p.mutating ? "This script can change data outside the sandbox, so Synchro waits for your approval before using the fix." : p.status === "active" ? (p.uses ? `Fixed automatically after ${p.attempts} ${p.attempts === 1 ? "try" : "tries"} · used ${p.uses} more times` : `Fixed automatically after ${p.attempts} ${p.attempts === 1 ? "try" : "tries"}`) : ""}</div>
            {open === p.id && <pre className="sk-pre sk-diff">{diffLines(p.original, p.content).filter((d, i, a) => d.t !== " " || a.slice(Math.max(0, i - 2), i + 3).some((x) => x.t !== " ")).map((d, i) => <div key={i} className={d.t === "+" ? "add" : d.t === "-" ? "del" : ""}>{d.t} {d.s}</div>)}</pre>}
            {!p.stale && (p.status === "pending" || p.status === "active") && (
              <div className="sk-fix-a">
                {p.status === "pending" && <><button className="btn" onClick={() => act(p.id, "reject")}>Reject</button><button className="btn dark" onClick={() => act(p.id, "approve")}>Approve fix</button></>}
                {p.status === "active" && <button className="btn" onClick={() => act(p.id, "revert")}>Undo fix</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
