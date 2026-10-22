"use client";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import * as I from "./icons";
import { useApp } from "./store";

type Item = { name: string; description: string; enabled: boolean; version: number; versions: number[]; updated_at: string; fileCount: number; warnings: string[] };
type FileInfo = { path: string; size: number; kind: string };
type Preview = { name: string; description: string; body: string; files: FileInfo[]; warnings: string[]; tokens: number; exists: boolean; version: number };
type Detail = Item & { body: string; files: FileInfo[] };

export const SKILLS_CHANGED = "skills:changed";
export const SKILLS_UPLOAD = "skills:upload";
const api = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
  return j;
};
const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const ago = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Kiểm tra (không lưu) rồi trả bản xem trước để người dùng duyệt trước khi bật. */
export async function dryRunSkill(f: File): Promise<Preview> {
  const fd = new FormData(); fd.append("file", f); fd.append("dry", "1");
  return (await api("/api/skills", { method: "POST", body: fd })).preview;
}

export function SkillsPanel({ q, sort, Toggle }: { q: string; sort: "" | "asc" | "desc"; Toggle: ComponentType<{ on: boolean; set: (v: boolean) => void }> }) {
  const app = useApp();
  const [list, setList] = useState<Item[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [pending, setPending] = useState<{ file: File; pv: Preview } | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [fileView, setFileView] = useState<{ path: string; text: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const verRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setList((await api("/api/skills")).skills); setLoadErr(""); } catch (e) { setLoadErr((e as Error).message); setList([]); }
  }, []);
  useEffect(() => { load(); const h = () => load(); window.addEventListener(SKILLS_CHANGED, h); return () => window.removeEventListener(SKILLS_CHANGED, h); }, [load]);

  useEffect(() => { const h = () => verRef.current?.click(); window.addEventListener(SKILLS_UPLOAD, h); return () => window.removeEventListener(SKILLS_UPLOAD, h); }, []);
  const pick = async (f: File) => {
    setErr(""); setDetail(null); setChecking(true);
    try { setPending({ file: f, pv: await dryRunSkill(f) }); } catch (e) { setErr((e as Error).message); } finally { setChecking(false); }
  };
  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const fd = new FormData(); fd.append("file", pending.file);
      const j = await api("/api/skills", { method: "POST", body: fd });
      app.say(j.created ? `Đã thêm skill ${j.skill.name}` : `Đã cập nhật ${j.skill.name} lên v${j.skill.version}`);
      setPending(null); await load();
    } catch (e) { setErr((e as Error).message); setPending(null); } finally { setSaving(false); }
  };
  const toggle = async (n: string, enabled: boolean) => {
    setList((l) => l && l.map((s) => (s.name === n ? { ...s, enabled } : s)));
    try { await api(`/api/skills/${n}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) }); } catch (e) { setErr((e as Error).message); load(); }
  };
  const del = (n: string) => app.confirm(`Delete skill "${n}"?`, "All versions of this skill and its files will be deleted. This can't be undone.", "Delete", async () => {
    try { await api(`/api/skills/${n}`, { method: "DELETE" }); setDetail(null); app.say(`Đã xóa ${n}`); load(); } catch (e) { setErr((e as Error).message); }
  });
  const open = async (n: string) => { setFileView(null); try { setDetail((await api(`/api/skills/${n}`)).skill); } catch (e) { setErr((e as Error).message); } };
  const openFile = async (n: string, path: string) => {
    try { const j = await api(`/api/skills/${n}/file?path=${encodeURIComponent(path)}`); setFileView({ path, text: j.binary ? "(binary file)" : j.text + (j.truncated ? "\n…" : "") }); } catch (e) { setErr((e as Error).message); }
  };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f); };

  const shown = (list ?? []).filter((s) => (s.name + " " + s.description).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort ? (sort === "asc" ? 1 : -1) * a.name.localeCompare(b.name) : +new Date(b.updated_at) - +new Date(a.updated_at)));
  const on = (list ?? []).filter((s) => s.enabled).length;

  return (
    <>
      <div className={`sk-drop ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <I.Scroll size={22} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{list && list.length ? "Add a skill" : "Add your first skill"}</div>
          <p className="d" style={{ margin: "2px 0 0" }}>Drop a .zip skill folder or a SKILL.md here. Synchro checks it, shows a preview, then the model loads it automatically when a request matches.</p>
        </div>
        <button className="btn dark" disabled={checking} onClick={() => verRef.current?.click()}>{checking ? "Checking…" : "Upload skill"}</button>
      </div>
      {err && <div className="sk-err" role="alert"><span>{err}</span><button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setErr("")}>×</button></div>}
      {loadErr && <div className="sk-err">{loadErr}</div>}

      <div className="muted" style={{ fontSize: 12, margin: "18px 0 8px" }}>Your skills <span className="new-tag" style={{ background: "var(--hover)", color: "var(--text-2)" }}>{list?.length ?? 0}</span> · {`${on} enabled`}</div>
      {list === null && <div className="muted" style={{ fontSize: 13 }}>Loading…</div>}
      {list !== null && !shown.length && <div className="empty" style={{ margin: "24px 0" }}>{list.length ? "No matching skills." : "No skills yet."}</div>}
      {shown.map((s) => (
        <div key={s.name} className="item-row sk-row">
          <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => open(s.name)}>
            <div><b style={{ fontWeight: 500 }}>{s.name}</b> <span className="muted" style={{ fontSize: 12 }}>v{s.version} · {ago(s.updated_at)}{s.fileCount ? ` · ${s.fileCount} files` : ""}</span>{s.warnings.length > 0 && <span className="sk-warn" title={s.warnings.join("\n")}>{s.warnings.length} warning{s.warnings.length > 1 ? "s" : ""}</span>}</div>
            <div className="muted sk-desc">{s.description}</div>
          </div>
          <button className="btn" style={{ height: 26 }} onClick={() => open(s.name)}>View</button>
          <Toggle on={s.enabled} set={(v) => toggle(s.name, v)} />
        </div>
      ))}
      <input ref={verRef} type="file" hidden accept=".zip,.md" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />

      {pending && (
        <div className="sk-mask" onMouseDown={(e) => e.target === e.currentTarget && !saving && setPending(null)}>
          <div className="sk-modal">
            <div className="sk-mh"><b>{pending.pv.exists ? `Update ${pending.pv.name} to v${pending.pv.version}` : `Add ${pending.pv.name}`}</b></div>
            <p className="d" style={{ margin: "0 0 10px" }}>{pending.pv.description}</p>
            <div className="sk-note">Skills are instructions the model will follow. Only enable skills from sources you trust, and read the content below first.</div>
            {pending.pv.warnings.length > 0 && <ul className="sk-wl">{pending.pv.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            <div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>SKILL.md · ~{pending.pv.tokens} tokens</div>
            <pre className="sk-pre">{pending.pv.body || "(empty)"}</pre>
            {pending.pv.files.length > 0 && <>
              <div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>{pending.pv.files.length} files</div>
              <div className="sk-files">{pending.pv.files.map((f) => <div key={f.path}><span>{f.path}</span><span className="muted">{f.kind} · {fmt(f.size)}</span></div>)}</div>
            </>}
            <div className="sk-actions"><button className="btn" disabled={saving} onClick={() => setPending(null)}>Cancel</button><button className="btn dark" disabled={saving} onClick={confirm}>{saving ? "Saving…" : pending.pv.exists ? "Update and keep state" : "Add and enable"}</button></div>
          </div>
        </div>
      )}

      {detail && (
        <div className="sk-mask" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="sk-modal">
            <div className="sk-mh"><b>{detail.name}</b><span className="muted" style={{ fontSize: 12 }}>v{detail.version}</span><span style={{ flex: 1 }} /><button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setDetail(null)}>×</button></div>
            <p className="d" style={{ margin: "0 0 10px" }}>{detail.description}</p>
            {detail.warnings.length > 0 && <ul className="sk-wl">{detail.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            <div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>SKILL.md</div>
            <pre className="sk-pre">{detail.body || "(empty)"}</pre>
            {detail.files.length > 0 && <>
              <div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>Files</div>
              <div className="sk-files">{detail.files.map((f) => <div key={f.path} className="clk" onClick={() => openFile(detail.name, f.path)}><span>{f.path}</span><span className="muted">{f.kind} · {fmt(f.size)}</span></div>)}</div>
              {fileView && <><div className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>{fileView.path}</div><pre className="sk-pre">{fileView.text}</pre></>}
            </>}
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
