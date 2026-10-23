"use client";
// Giao diện agent của Synchro Code: các bước công cụ trong khung chat, thẻ danh sách việc,
// vòng tròn ngữ cảnh dưới khung chat và nút kết nối repo GitHub.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { Markdown } from "./md";
import { ghConnect, ghRepos, ghStatus, ghUnlink, gitOp, planDone, useCodeUi, type GhRepo, type GhStatus, type GitState, type PlanItem } from "./wsclient";

export type ToolStep = { k: "tool"; id: string; name: string; input: Record<string, unknown>; done?: boolean; ok?: boolean; summary?: string; output?: string; diff?: { path: string; add: number; del: number }; image?: string };
export type AStep = { k: "text"; text: string } | ToolStep;
type Say = (m: string) => void;

const base = (p: string) => p.split("/").pop() || p;
const host = (u: string) => { try { const x = new URL(/^[a-z]+:/i.test(u) ? u : "http://" + u); return x.host + (x.pathname !== "/" ? x.pathname : ""); } catch { return u; } };
const VERB: Record<string, string> = {
  bash: "Chạy lệnh", read_file: "Đọc", write_file: "Tạo / ghi", edit_file: "Sửa", list_files: "Liệt kê file", grep: "Tìm",
  browser_navigate: "Mở trang", browser_read: "Đọc trang", browser_screenshot: "Chụp màn hình", browser_click: "Click", browser_type: "Gõ", browser_key: "Nhấn phím",
  browser_scroll: "Cuộn trang", browser_console: "Xem console", open_pane: "Mở khung", load_skill: "Dùng skill", read_skill_file: "Đọc file skill", search_skills: "Tìm skill", run_skill_script: "Chạy script skill",
};
const RUNNING: Record<string, string> = { bash: "Đang chạy lệnh…", write_file: "Đang ghi file…", edit_file: "Đang sửa file…", browser_navigate: "Đang mở trang…", browser_screenshot: "Đang chụp màn hình…" };
const iconOf = (n: string) => (n === "bash" ? <I.Terminal size={14} /> : n.startsWith("browser_") ? <I.Globe size={14} /> : n.endsWith("_file") || n === "list_files" ? <I.File size={14} /> : n === "grep" ? <I.Search size={14} /> : n.includes("skill") ? <I.Scroll size={14} /> : <I.ChevronR size={14} />);

function Diff({ d }: { d?: { add: number; del: number } }) {
  if (!d) return null;
  return <span className="ag-diff"><b>+{d.add}</b><i>−{d.del}</i></span>;
}

// Nhãn tóm tắt một nhóm công cụ liền nhau, kiểu "Đã chạy 2 lệnh, sửa index.html +22 −0".
function groupLabel(ts: ToolStep[]) {
  const parts: React.ReactNode[] = [];
  const n = (name: string) => ts.filter((t) => t.name === name).length;
  if (n("bash")) parts.push(`chạy ${n("bash")} lệnh`);
  const edits = new Map<string, { add: number; del: number }>();
  for (const t of ts) if ((t.name === "write_file" || t.name === "edit_file") && t.ok !== false) {
    const p = String(t.diff?.path ?? t.input.path ?? "");
    const o = edits.get(p) ?? { add: 0, del: 0 };
    edits.set(p, { add: o.add + (t.diff?.add ?? 0), del: o.del + (t.diff?.del ?? 0) });
  }
  for (const [p, d] of edits) parts.push(<span key={p}>sửa <code>{base(p)}</code> <Diff d={d} /></span>);
  const reads = n("read_file") + n("list_files") + n("grep");
  if (reads) parts.push(`đọc ${reads} mục`);
  const nav = ts.filter((t) => t.name === "browser_navigate").map((t) => host(String(t.input.url ?? "")));
  if (nav.length) parts.push(`mở ${nav.join(", ")}`);
  const web = ts.filter((t) => t.name.startsWith("browser_") && t.name !== "browser_navigate").length;
  if (web) parts.push(`${web} thao tác trình duyệt`);
  for (const t of ts.filter((x) => x.name === "load_skill")) parts.push(`dùng skill ${String(t.input.name ?? "")}`);
  if (!parts.length) parts.push(ts.some((t) => t.name === "open_pane") ? "mở khung làm việc" : `${ts.length} thao tác`);
  return parts.map((p, i) => <span key={i}>{i ? ", " : "Đã "}{p}</span>);
}

function ToolRow({ t, onFile }: { t: ToolStep; onFile: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = t.summary || String(t.input.command ?? t.input.path ?? t.input.url ?? "");
  const path = t.name === "write_file" || t.name === "edit_file" || t.name === "read_file" ? String(t.diff?.path ?? t.input.path ?? "") : "";
  return (
    <div className={`ag-tool ${t.ok === false ? "bad" : ""}`}>
      <button className="ag-tool-h" onClick={() => setOpen(!open)}>
        <span className="ag-ic">{!t.done ? <span className="ag-spin" /> : iconOf(t.name)}</span>
        <span className="ag-verb">{VERB[t.name] ?? t.name}</span>
        <code className="ag-sum" data-notr>{label}</code>
        <Diff d={t.diff} />
        {t.ok === false && <span className="ag-err">lỗi</span>}
        <span className={`ag-chev ${open ? "on" : ""}`}><I.ChevronR size={12} /></span>
      </button>
      {open && (
        <div className="ag-out">
          {path && <button className="ag-link" onClick={() => onFile(path)}><I.File size={13} />Mở {base(path)}</button>}
          {t.image && <img className="ag-shot" src={`data:image/jpeg;base64,${t.image}`} alt="Ảnh chụp màn hình" />}
          {t.output && <pre data-notr>{t.output}</pre>}
        </div>
      )}
    </div>
  );
}

function ToolGroup({ ts, live, onFile }: { ts: ToolStep[]; live: boolean; onFile: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const run = ts.find((t) => !t.done);
  const shot = ts.filter((t) => t.image).pop();
  return (
    <div className="ag-group">
      <button className="ag-group-h" onClick={() => setOpen(!open)}>
        {run && live ? <><span className="ag-spin" />{RUNNING[run.name] ?? `${VERB[run.name] ?? run.name}…`}</> : <span>{groupLabel(ts)}</span>}
        <span className={`ag-chev ${open ? "on" : ""}`}><I.ChevronR size={12} /></span>
      </button>
      {open ? <div className="ag-list">{ts.map((t) => <ToolRow key={t.id} t={t} onFile={onFile} />)}</div>
        : shot && <img className="ag-shot sm" src={`data:image/jpeg;base64,${shot.image}`} alt="Ảnh chụp màn hình" onClick={() => setOpen(true)} />}
    </div>
  );
}

// Nội dung một lượt trả lời của agent: đoạn văn xen kẽ nhóm công cụ (danh sách việc hiện ở thẻ riêng).
export function AgentSteps({ steps, live, say }: { steps: AStep[]; live: boolean; say: Say }) {
  const showFile = useCodeUi((s) => s.showFile);
  const blocks = useMemo(() => {
    const out: ({ k: "text"; text: string } | { k: "tools"; ts: ToolStep[] })[] = [];
    for (const s of steps) {
      if (s.k === "text") out.push(s);
      else if (s.name !== "update_plan") {
        const last = out[out.length - 1];
        if (last?.k === "tools") last.ts.push(s); else out.push({ k: "tools", ts: [s] });
      }
    }
    return out;
  }, [steps]);
  return (
    <div className="ag">
      {blocks.map((b, i) => b.k === "text"
        ? <Markdown key={i} text={b.text} say={say} />
        : <ToolGroup key={i} ts={b.ts} live={live && i === blocks.length - 1} onFile={(p) => showFile(p)} />)}
    </div>
  );
}

// Thẻ danh sách việc phía trên khung chat (giống Claude Code).
export function TaskCard({ plan, busy, onClose }: { plan: PlanItem[]; busy: boolean; onClose: () => void }) {
  const done = plan.filter((x) => x.status === "completed").length;
  const [open, setOpen] = useState(true);
  const all = planDone(plan);
  useEffect(() => { if (all && !busy) setOpen(false); }, [all, busy]);
  return (
    <div className={`cv-tasks ${open ? "open" : ""}`}>
      <div className="cv-tasks-h">
        <button onClick={() => setOpen(!open)}>
          <span className="cv-tasks-t">{all ? "Đã xong mọi việc" : plan.find((x) => x.status === "in_progress")?.content ?? "Danh sách việc"}</span>
          <span className="cv-tasks-n">{done}/{plan.length}</span>
          <span className={`ag-chev ${open ? "on down" : ""}`}><I.ChevronR size={12} /></span>
        </button>
        {!busy && <button className="icon-btn" onClick={onClose} aria-label="Ẩn danh sách việc"><I.X size={14} /></button>}
      </div>
      {open && (
        <ul>
          {plan.map((x, i) => (
            <li key={i} className={x.status}>
              <span className="tk-ic">{x.status === "completed" ? <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M5 8.2l2 2 4-4.4" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                : x.status === "in_progress" ? <svg viewBox="0 0 16 16" className={busy ? "spin" : ""}><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="30 10" /></svg>
                : <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2.4" /></svg>}</span>
              <span>{x.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Vòng tròn mức dùng ngữ cảnh (thay cho dòng "x / 128k" cũ trong khung chat).
export function CtxRing({ pct, title, onClick, active }: { pct: number; title: string; onClick: () => void; active?: boolean }) {
  const r = 6.4, c = 2 * Math.PI * r;
  return (
    <button className={`cv-ring2 ${pct > 80 ? "hot" : pct > 50 ? "mid" : ""} ${active ? "on" : ""}`} onClick={onClick} title={title} aria-label={title}>
      <svg width="18" height="18" viewBox="0 0 16 16"><circle cx="8" cy="8" r={r} fill="none" strokeWidth="1.8" className="bg" /><circle cx="8" cy="8" r={r} fill="none" strokeWidth="1.8" className="fg" strokeDasharray={`${(c * Math.max(pct, 1.5)) / 100} ${c}`} transform="rotate(-90 8 8)" strokeLinecap="round" /></svg>
    </button>
  );
}

// ------------------------------------------------------------------ GitHub
export function GitHubButton({ git, available, reason, ensureSid, say, onCloned }: { git?: GitState; available: boolean; reason?: string; ensureSid: () => number; say: Say; onCloned: (g: GitState) => void }) {
  const [open, setOpen] = useState(false);
  const label = git?.git && git.repo ? `${git.repo}` : "GitHub";
  return (
    <>
      <button className={`cv-gh ${git?.git && git.repo ? "on" : ""}`} onClick={() => (available ? setOpen(true) : say(reason ?? "Workspace chưa sẵn sàng"))} title={available ? "Kết nối repo GitHub vào phiên này" : reason}>
        <I.GitHub size={15} /><span className="cv-ell" data-notr={git?.git && git.repo ? "" : undefined}>{label}</span>
        {git?.git && <span className="cv-gh-b" data-notr><I.Branch size={12} />{git.branch}</span>}
      </button>
      {open && typeof document !== "undefined" && createPortal(<RepoModal git={git} ensureSid={ensureSid} say={say} onClose={() => setOpen(false)} onCloned={(g) => { setOpen(false); onCloned(g); }} />, document.body)}
    </>
  );
}

function RepoModal({ git, ensureSid, say, onClose, onCloned }: { git?: GitState; ensureSid: () => number; say: Say; onClose: () => void; onCloned: (g: GitState) => void }) {
  const [st, setSt] = useState<GhStatus | null>(null);
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");
  const load = () => ghStatus().then(setSt).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!st?.linked) return;
    const t = setTimeout(() => ghRepos(q).then(setRepos).catch((e) => setErr(e.message)), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [st?.linked, q]);
  const connect = async () => {
    setBusy("connect"); setErr("");
    const e = await ghConnect();
    setBusy("");
    if (e && e !== "timeout") setErr(e); else if (!e) { say("Đã kết nối GitHub"); load(); }
  };
  const clone = async (repo: string, branch?: string) => {
    if (!repo.trim()) return;
    setBusy(repo); setErr("");
    try {
      const g = await gitOp(ensureSid(), "clone", { repo, branch });
      say(`Đã clone ${g.git && g.repo ? g.repo : repo}`);
      onCloned(g);
    } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const has = git?.git && git.repo;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal gh-modal">
        <div className="gh-head"><I.GitHub size={22} /><div><h2>Repo GitHub</h2><p>Clone repo vào workspace của phiên này để agent đọc, sửa, chạy và kiểm tra code.</p></div>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng"><I.X size={18} /></button></div>
        {has ? (
          <div className="gh-cur">
            <div><b data-notr>{git.repo}</b><span><I.Branch size={13} />{git.branch}</span></div>
            <a className="btn" href={`https://github.com/${git.repo}`} target="_blank" rel="noreferrer"><I.External size={14} />Mở trên GitHub</a>
            <p className="gh-note">Mỗi phiên gắn với một repo. Muốn làm repo khác, hãy tạo phiên mới.</p>
          </div>
        ) : <>
          <div className="gh-acc">
            {!st ? <span className="gh-note">Đang tải…</span>
              : st.linked ? <><span className="gh-ok"><I.Check size={14} />Đã kết nối <b data-notr>@{st.login}</b></span><button className="gh-lnk" onClick={async () => { await ghUnlink(); setRepos(null); load(); say("Đã ngắt kết nối GitHub"); }}>Ngắt kết nối</button></>
              : st.configured ? <><span className="gh-note">Kết nối tài khoản GitHub để clone repo riêng tư và push code.</span><button className="btn dark" disabled={busy === "connect"} onClick={connect}><I.GitHub size={15} />{busy === "connect" ? "Đang chờ GitHub…" : "Kết nối GitHub"}</button></>
              : <span className="gh-note">Máy chủ chưa bật đăng nhập GitHub nên chỉ clone được repo công khai.</span>}
          </div>
          <div className="gh-url">
            <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") clone(url); }} placeholder="owner/repo hoặc https://github.com/owner/repo" />
            <button className="btn dark" disabled={!url.trim() || !!busy} onClick={() => clone(url)}>{busy && busy === url ? "Đang clone…" : "Clone"}</button>
          </div>
          {st?.linked && <>
            <div className="gh-search"><I.Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm repo của bạn" /></div>
            <div className="gh-list">
              {!repos ? <span className="gh-note">Đang tải danh sách repo…</span> : !repos.length ? <span className="gh-note">Không có repo nào.</span> : repos.map((r) => (
                <button key={r.full} className="gh-repo" disabled={!!busy} onClick={() => clone(r.full)}>
                  <span className="gh-repo-n"><b data-notr>{r.full}</b>{r.private && <em>Riêng tư</em>}</span>
                  {r.desc && <span className="gh-repo-d" data-notr>{r.desc}</span>}
                  {busy === r.full && <span className="gh-repo-s"><span className="ag-spin" />Đang clone…</span>}
                </button>
              ))}
            </div>
          </>}
        </>}
        {err && <div className="gh-err">{err}</div>}
      </div>
    </div>
  );
}

