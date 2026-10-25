"use client";
// Một ô "Thêm từ GitHub" dùng chung cho Kỹ năng và Plugins: Synchro tự xem link có bao nhiêu skill.
// Một skill → thêm vào Kỹ năng (của riêng mình, giữ các phiên bản). Nhiều skill → cài thành một bộ trong Plugins
// (kiểm tra giấy phép và script, cập nhật theo commit).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { inspectGithub, SkillAddModal, type Found } from "./skillsui";
import { PreviewModal } from "./pluginsui";
import type { PublicPlugin } from "./plugins";

const repoName = (u: string) => u.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/(tree|blob)\/[^/]+/, "").replace(/\/$/, "");

// focus: đổi số này để đưa con trỏ vào ô (mục "Thêm từ GitHub" trong menu Thêm).
export function GithubAdd({ focus, onDone }: { focus?: number; onDone?: (r: { kind: "skill" } | { kind: "plugin"; plugin: PublicPlugin }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focus) { input.current?.focus(); input.current?.scrollIntoView({ block: "center", behavior: "smooth" }); } }, [focus]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [skill, setSkill] = useState<(Found & { kind: "skill" }) | null>(null);
  const [bundle, setBundle] = useState<{ url: string; count: number } | null>(null);
  const go = async () => {
    const u = url.trim();
    if (!u || busy) return;
    setErr(""); setBusy(true);
    try {
      const f = await inspectGithub(u);
      if (f.kind === "skill") setSkill(f);
      else setBundle({ url: u, count: f.count });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const portal = (n: React.ReactNode) => createPortal(n, document.body);
  return (
    <div className="gh-add">
      <form className="sk-gh" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <I.GitHub size={16} />
        <input ref={input} placeholder="Paste a GitHub link: one skill or a whole repository" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        <button className="btn dark" disabled={busy || !url.trim()}>{busy ? <><span className="art-spin sm" />Checking…</> : "Add"}</button>
      </form>
      <p className="d gh-hint">Synchro looks at the link for you. One skill goes to Your skills. A repository with several skills is installed as a library, with license and script checks and one-click updates.</p>
      {err && <div className="sk-err" role="alert"><span>{err}</span><button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setErr("")}>×</button></div>}
      {skill && portal(
        <SkillAddModal src={skill.src} pv={skill.pv} onClose={() => setSkill(null)}
          onDone={() => { setSkill(null); setUrl(""); onDone?.({ kind: "skill" }); }} />
      )}
      {bundle && portal(
        <PreviewModal target={{ url: bundle.url, name: repoName(bundle.url) }}
          note={`This link has ${bundle.count} skills, so Synchro installs them together as one library. Untick any skill you don't need.`}
          onClose={() => setBundle(null)} onDone={(plugin) => { setBundle(null); setUrl(""); onDone?.({ kind: "plugin", plugin }); }} />
      )}
    </div>
  );
}
