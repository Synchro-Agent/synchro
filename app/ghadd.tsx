"use client";
// Một ô "Thêm từ GitHub" dùng chung cho Kỹ năng và Plugins: Synchro tự xem link có bao nhiêu skill.
// Một skill → thêm vào Kỹ năng (của riêng mình, giữ các phiên bản). Nhiều skill → cài thành một bộ trong Plugins
// (kiểm tra giấy phép và script, cập nhật theo commit, quản trị viên cài được cho cả tổ chức).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { inspectGithub, SkillAddModal, type Found } from "./skillsui";
import { PreviewModal } from "./pluginsui";
import type { PublicPlugin } from "./plugins";

const isAdmin = () => fetch("/api/plugins").then((r) => (r.ok ? r.json() : null)).then((j) => !!j?.admin).catch(() => false);
const repoName = (u: string) => u.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/(tree|blob)\/[^/]+/, "").replace(/\/$/, "");

// onModal: báo khi hộp xem trước đang mở (hộp chứa ô này có thể tạm ẩn đi).
export function GithubAdd({ autoFocus, onDone, onModal }: { autoFocus?: boolean; onDone?: (r: { kind: "skill" } | { kind: "plugin"; plugin: PublicPlugin }) => void; onModal?: (open: boolean) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [skill, setSkill] = useState<(Found & { kind: "skill" }) & { admin: boolean } | null>(null);
  const [bundle, setBundle] = useState<{ url: string; count: number; admin: boolean } | null>(null);
  useEffect(() => { onModal?.(!!skill || !!bundle); }, [skill, bundle]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    const u = url.trim();
    if (!u || busy) return;
    setErr(""); setBusy(true);
    try {
      const [f, admin] = await Promise.all([inspectGithub(u), isAdmin()]);
      if (f.kind === "skill") setSkill({ ...f, admin });
      else setBundle({ url: u, count: f.count, admin });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const portal = (n: React.ReactNode) => createPortal(n, document.body);
  return (
    <div className="gh-add">
      <form className="sk-gh" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <I.GitHub size={16} />
        <input autoFocus={autoFocus} placeholder="Paste a GitHub link: one skill or a whole repository" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        <button className="btn dark" disabled={busy || !url.trim()}>{busy ? <><span className="art-spin sm" />Checking…</> : "Add"}</button>
      </form>
      <p className="d gh-hint">Synchro looks at the link for you. One skill is added to Skills. A repository with several skills is installed as a plugin, with license and script checks and one-click updates.</p>
      {err && <div className="sk-err" role="alert"><span>{err}</span><button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setErr("")}>×</button></div>}
      {skill && portal(
        <SkillAddModal src={skill.src} pv={skill.pv} onClose={() => setSkill(null)}
          onDone={() => { setSkill(null); setUrl(""); onDone?.({ kind: "skill" }); }}
          onOrg={skill.admin ? () => { setSkill(null); setBundle({ url: url.trim(), count: 1, admin: true }); } : undefined} />
      )}
      {bundle && portal(
        <PreviewModal target={{ url: bundle.url, name: repoName(bundle.url) }} admin={bundle.admin}
          note={bundle.count > 1 ? `This link has ${bundle.count} skills, so Synchro installs them together as one plugin under Plugins. Untick any skill you don't need.` : "Installed as a one-skill plugin so every account can use it."}
          onClose={() => setBundle(null)} onDone={(plugin) => { setBundle(null); setUrl(""); onDone?.({ kind: "plugin", plugin }); }} />
      )}
    </div>
  );
}
