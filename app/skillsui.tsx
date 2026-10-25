"use client";
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { useApp } from "./store";
import { getLang } from "./i18n";
import { diffLines } from "./md";

type Item = { name: string; description: string; enabled: boolean; version: number; versions: number[]; updated_at: string; fileCount: number; warnings: string[]; useCount: number; lastUsed: string | null; scripts: number };
type FileInfo = { path: string; size: number; kind: string };
type Preview = { name: string; description: string; body: string; files: FileInfo[]; warnings: string[]; tokens: number; exists: boolean; version: number; source?: string };
type Choice = { dir: string; name: string; description: string; error?: string; exists: boolean };
// Nguồn của skill đang thêm: file tải lên hoặc link GitHub; pick = thư mục skill khi gói có nhiều skill.
type Src = { kind: "file"; file: File; pick?: string } | { kind: "github"; url: string; pick?: string };
// patches: bản tự sửa script (skillheal.ts), kèm bản gốc hiện tại để xem khác biệt.
type Patch = { id: string; path: string; status: "active" | "pending" | "rejected" | "reverted"; mutating: boolean; error: string; attempts: number; created_at: number; uses: number; stale: boolean; content: string; original: string };
type Detail = Item & { body: string; files: FileInfo[]; patches?: Patch[] };

// Hộp thoại gắn thẳng vào <body> để không bị thanh bên hay khung chứa có z-index cao hơn che mất.
const portal = (n: ReactNode) => (typeof document === "undefined" ? n : createPortal(n, document.body));

export const SKILLS_CHANGED = "skills:changed";
export const SKILLS_UPLOAD = "skills:upload";
// Kho kỹ năng nhận tệp thả vào trang rồi chuyển cho danh sách skill (detail = File).
export const SKILLS_DROP = "skills:drop";
const api = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
  return j;
};
const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const vi = () => getLang() === "vi";
const ago = (iso: string) => new Date(iso).toLocaleDateString(vi() ? "vi-VN" : "en-US", { day: "numeric", month: "short" });
// Dòng thông tin phụ của skill, theo ngôn ngữ giao diện (nằm trong data-notr nên tự dịch ở đây).
const meta = (s: Item) => [`v${s.version}`, ago(s.updated_at), s.fileCount ? (vi() ? `${s.fileCount} tệp` : `${s.fileCount} files`) : "", s.useCount ? (vi() ? `đã dùng ${s.useCount} lần` : `used ${s.useCount}×`) : ""].filter(Boolean).join(" · ");

// Gửi nguồn skill lên máy chủ: dry = chỉ kiểm tra và trả bản xem trước (hoặc danh sách skill để chọn).
async function send(src: Src, dry: boolean): Promise<{ preview?: Preview; choices?: Choice[]; skill?: Item; created?: boolean }> {
  if (src.kind === "github") return api("/api/skills/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: src.url, pick: src.pick, dry }) });
  const fd = new FormData(); fd.append("file", src.file);
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

// Xem link GitHub có mấy skill (không lưu gì): một skill → bản xem trước để thêm vào Kỹ năng; nhiều skill → nên cài thành plugin.
export type Found = { kind: "skill"; src: Src; pv: Preview } | { kind: "bundle"; count: number };
export async function inspectGithub(url: string): Promise<Found> {
  const src: Src = { kind: "github", url };
  const j = await send(src, true);
  if (j.preview) return { kind: "skill", src: { ...src, pick: (j.preview as Preview & { pick?: string }).pick }, pv: j.preview };
  const ok = (j.choices ?? []).filter((c) => !c.error);
  if (!ok.length) throw new Error(j.choices?.length ? j.choices.map((c) => `${c.name || c.dir}: ${c.error}`).join("\n") : "No SKILL.md found at this link.");
  if (ok.length > 1) return { kind: "bundle", count: ok.length };
  const one = await send({ ...src, pick: ok[0].dir }, true);
  return { kind: "skill", src: { ...src, pick: ok[0].dir }, pv: one.preview! };
}

// Duyệt một skill trước khi thêm. onOrg (chỉ quản trị viên, nguồn GitHub): cài skill này cho cả tổ chức dưới dạng plugin.
export function SkillAddModal({ src, pv, onClose, onDone, onOrg }: { src: Src; pv: Preview; onClose: () => void; onDone: () => void; onOrg?: () => void }) {
  const app = useApp();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const confirm = async () => {
    setSaving(true); setErr("");
    try {
      const j = await send(src, false);
      app.say(j.created ? `Đã thêm skill ${j.skill!.name}` : `Đã cập nhật ${j.skill!.name} lên v${j.skill!.version}`);
      window.dispatchEvent(new Event(SKILLS_CHANGED)); onDone();
    } catch (e) { setErr((e as Error).message); setSaving(false); }
  };
  return (
    <div className="sk-mask" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="sk-modal">
        <div className="sk-mh"><b>{pv.exists ? `Update ${pv.name} to v${pv.version}` : `Add ${pv.name}`}</b></div>
        {pv.source && <div className="muted" style={{ fontSize: 12, margin: "-2px 0 8px" }} data-notr>{pv.source}{src.pick ? ` · ${src.pick.split("/").slice(1).join("/")}` : ""}</div>}
        <p className="d" style={{ margin: "0 0 10px" }}>{pv.description}</p>
        <div className="sk-note">Skills are instructions the model will follow. Only enable skills from sources you trust, and read the content below first.</div>
        {pv.warnings.length > 0 && <ul className="sk-wl">{pv.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        {err && <div className="sk-err" role="alert"><span>{err}</span></div>}
        <div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>SKILL.md · ~{pv.tokens} tokens</div>
        <pre className="sk-pre">{pv.body || "(empty)"}</pre>
        {pv.files.length > 0 && <>
          <div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>{pv.files.length} files</div>
          <div className="sk-files">{pv.files.map((f) => <div key={f.path}><span>{f.path}</span><span className="muted">{f.kind} · {fmt(f.size)}</span></div>)}</div>
        </>}
        <div className="sk-actions">
          {onOrg && <button className="btn" disabled={saving} onClick={onOrg}>Install for everyone</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn dark" disabled={saving} onClick={confirm}>{saving ? "Saving…" : pv.exists ? "Update and keep state" : "Add and enable"}</button>
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

export function SkillsPanel({ q, Toggle }: { q: string; Toggle: ComponentType<{ on: boolean; set: (v: boolean) => void }> }) {
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

  const load = useCallback(async () => {
    try { setList((await api("/api/skills")).skills); setLoadErr(""); } catch (e) { setLoadErr((e as Error).message); setList([]); }
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
  const openFile = async (n: string, path: string) => {
    try { const j = await api(`/api/skills/${n}/file?path=${encodeURIComponent(path)}`); setFileView({ path, text: j.binary ? "(binary file)" : j.text + (j.truncated ? "\n…" : "") }); } catch (e) { setErr((e as Error).message); }
  };

  const shown = (list ?? []).filter((s) => (s.name + " " + s.description).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
  const on = (list ?? []).filter((s) => s.enabled).length;

  return (
    <>
      {(list === null || list.length > 0 || !q) && <div className="pl-sec">Your skills <i>{list?.length ?? 0}</i>{list && list.length > 0 && <span className="pl-sec-d">{`${on} enabled`}</span>}{checking && <span className="art-spin sm" />}</div>}
      {err && <div className="sk-err" role="alert"><span>{err}</span><button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setErr("")}>×</button></div>}
      {loadErr && <div className="sk-err">{loadErr}</div>}
      {list !== null && !list.length && !q && <div className="hub-empty"><I.Scroll size={18} /><span>Single skills you add show up here. Paste a GitHub link above, or drop a .zip skill folder or a SKILL.md anywhere on this page.</span></div>}
      <div className="pl-rows2">
        {shown.map((s) => (
          <div key={s.name} role="button" tabIndex={0} className={`pl-row2 ${s.enabled ? "" : "off"}`} onClick={() => open(s.name)} onKeyDown={(e) => e.key === "Enter" && open(s.name)}>
            <span className="pl-mark" style={{ width: 36, height: 36 }}><I.Scroll size={17} /></span>
            <div className="pl-row2-t">
              <div className="pl-row2-h"><b data-notr>{s.name}</b><span className="pl-b" data-notr>v{s.version}</span>{s.scripts > 0 && <span className="pl-b">Scripts</span>}{s.warnings.length > 0 && <span className="pl-b mid" title={s.warnings.join("\n")}>{s.warnings.length} warning{s.warnings.length > 1 ? "s" : ""}</span>}<ScoreBadge s={sc[s.name]} />{!s.enabled && <span className="pl-b">Off</span>}</div>
              <span>{s.description}</span>
            </div>
            <span className="pl-date" data-notr>{meta(s).split(" · ").slice(1).join(" · ")}</span>
            <span onClick={(e) => e.stopPropagation()}><Toggle on={s.enabled} set={(v) => toggle(s.name, v)} /></span>
          </div>
        ))}
      </div>
      <input ref={verRef} type="file" hidden accept=".zip,.md" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />

      {choose && portal(
        <div className="sk-mask" onMouseDown={(e) => e.target === e.currentTarget && !bulk && setChoose(null)}>
          <div className="sk-modal">
            <div className="sk-mh"><b>Choose skills to add</b><span className="muted" style={{ fontSize: 12 }}>{`${choose.choices.length} found`}</span><span style={{ flex: 1 }} /><button className="icon-btn" style={{ width: 24, height: 24 }} disabled={!!bulk} onClick={() => setChoose(null)}>×</button></div>
            <p className="d" style={{ margin: "0 0 10px" }}>This package contains several skills. Preview one to check it before adding, or add every valid skill at once.</p>
            <div className="sk-choices">
              {choose.choices.map((c) => (
                <div key={c.dir} className="sk-choice">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div><b data-notr>{c.name || c.dir.split("/").pop()}</b>{c.exists && <span className="sk-tag">Installed · will update</span>}</div>
                    <div className="muted sk-desc">{c.error ? <span className="sk-bad">{c.error}</span> : c.description}</div>
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
        <div className="sk-mask" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="sk-modal">
            <div className="sk-mh"><b>{detail.name}</b><span className="muted" style={{ fontSize: 12 }}>v{detail.version}</span><span style={{ flex: 1 }} /><button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setDetail(null)}>×</button></div>
            <p className="d" style={{ margin: "0 0 10px" }}>{detail.description}</p>
            <div className="sk-meta">
              <span>{detail.useCount ? `Used ${detail.useCount} times` : "Not used yet"}</span>
              {(sc[detail.name]?.up || sc[detail.name]?.down) ? <span>{`Rated helpful ${sc[detail.name].up} · unhelpful ${sc[detail.name].down}`}</span> : null}
              {detail.versions.length > 1 && (
                <span className="sk-vers">Versions:{[...detail.versions].sort((a, b) => b - a).map((v) => v === detail.version
                  ? <b key={v}>v{v}</b>
                  : <button key={v} className="lnk" onClick={() => restore(detail.name, v)}>v{v}</button>)}</span>
              )}
            </div>
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
              <button className="btn" onClick={() => verRef.current?.click()}>Upload new version</button>
              <button className="btn dark" onClick={() => { toggle(detail.name, !detail.enabled); setDetail({ ...detail, enabled: !detail.enabled }); }}>{detail.enabled ? "Disable" : "Enable"}</button>
            </div>
          </div>
        </div>
      )}
    </>
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
