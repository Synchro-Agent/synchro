"use client";
// Giao diện agent của Synchro Code: các bước công cụ trong khung chat, thẻ danh sách việc,
// vòng tròn ngữ cảnh dưới khung chat và nút kết nối repo GitHub.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import * as I from "./icons";
import { Markdown } from "./md";
import { Loader } from "./brand";
import { tr, useLangReady } from "./i18n";
import { localizeNote } from "./agentfold";
import { ConnLogo } from "./connlogo";
import { ASK_GONE } from "./codesync";
import { ArgsEditor, readArgs } from "./argsedit";
import { CxDetails, cxHead } from "./cxcard";
import type { CxCard } from "./cxactions";
import { ghConnect, ghRepos, ghStatus, ghUnlink, gitOp, useCodeUi, type GhRepo, type GhStatus, type GitState, type PlanItem } from "./wsclient";

export type ToolStep = { k: "tool"; id: string; name: string; input: Record<string, unknown>; done?: boolean; ok?: boolean; summary?: string; output?: string; diff?: { path: string; add: number; del: number }; image?: string };
// Câu hỏi duyệt (chế độ quyền, trang web chưa được phép): wait = đang chờ bạn; ok / no = đã trả lời; always = luôn cho phép.
// connector: công cụ connector (conn: hiện logo; about: mô tả công cụ; destructive: cảnh báo xóa dữ liệu); chat = cho phép trong đoạn chat này.
export type AskStep = { k: "ask"; id: string; kind: "edit" | "bash" | "site" | "connector"; title: string; detail: string; host?: string; conn?: { name: string; logo?: string; color?: string; icon?: string; site?: string }; about?: string; until?: number; destructive?: boolean; schema?: unknown; edited?: boolean; cx?: CxCard; state: "wait" | "ok" | "always" | "chat" | "no" | "gone" | "typed" };
// steer: tin người dùng nhắn thêm khi agent đang làm (hiện ngay tại chỗ agent nhận được); think: suy nghĩ của model.
export type AStep = { k: "text"; text: string } | { k: "steer"; text: string } | { k: "think"; text: string } | AskStep | ToolStep;
/** Kiểu xem lượt của agent: bình thường (gọn), kèm suy nghĩ, chi tiết (mọi công cụ mở sẵn, kèm đầu vào / đầu ra). */
export type TView = "normal" | "thinking" | "verbose";
export const TVIEW_LABEL: Record<TView, string> = { normal: "Bình thường", thinking: "Suy nghĩ", verbose: "Chi tiết" };
// Trả về lời báo lỗi (nếu có) để thẻ mở lại các nút: gửi hỏng mà nút vẫn khóa thì chỉ còn cách tải lại trang.
export type OnAnswer = (id: string, ok: boolean, o?: { always?: boolean; chat?: boolean; note?: string; input?: Record<string, unknown> }) => void | Promise<string | null | void>;
type Say = (m: string) => void;

const base = (p: string) => p.split("/").pop() || p;
/** Dòng ẩn đánh dấu giai đoạn (<!-- mode:debug -->) chỉ để giao diện đổi nhãn, không hiện ra trong câu trả lời. */
export const stripPhases = (t: string) => t.replace(/<!--\s*mode:\s*(plan|code|debug)\s*-->[ \t]*\n?/g, "").trim();
const host = (u: string) => { try { const x = new URL(/^[a-z]+:/i.test(u) ? u : "http://" + u); return x.host + (x.pathname !== "/" ? x.pathname : ""); } catch { return u; } };
const VERB: Record<string, string> = {
  bash: "Chạy lệnh", read_file: "Đọc", write_file: "Tạo / ghi", edit_file: "Sửa", list_files: "Liệt kê file", grep: "Tìm",
  browser_navigate: "Mở trang", browser_read: "Đọc trang", browser_screenshot: "Chụp màn hình", browser_click: "Bấm", browser_type: "Gõ", browser_key: "Nhấn phím",
  browser_scroll: "Cuộn trang", browser_console: "Xem console", open_pane: "Mở khung", load_skill: "Dùng skill", read_skill_file: "Đọc file skill", search_skills: "Tìm skill", run_skill_script: "Chạy script skill",
};
// Động từ cho dòng trạng thái kiểu Claude ("Clicking, waiting, capturing page").
const DOING: Record<string, string> = {
  bash: "chạy lệnh", read_file: "đọc file", write_file: "ghi file", edit_file: "sửa file", list_files: "xem thư mục", grep: "tìm trong code",
  browser_navigate: "mở trang", browser_read: "đọc trang", browser_screenshot: "chụp trang", browser_click: "bấm", browser_type: "gõ", browser_key: "nhấn phím",
  browser_scroll: "cuộn trang", browser_console: "xem console", open_pane: "mở khung", update_plan: "cập nhật danh sách việc", load_skill: "đọc skill", read_skill_file: "đọc file skill",
  search_skills: "tìm skill", run_skill_script: "chạy script",
};
const desc = (t: ToolStep) => (typeof t.input.description === "string" && t.input.description.trim() ? t.input.description.trim() : "");
const RUNNING: Record<string, string> = { bash: "Đang chạy lệnh…", write_file: "Đang ghi file…", edit_file: "Đang sửa file…", browser_navigate: "Đang mở trang…", browser_screenshot: "Đang chụp màn hình…" };
const iconOf = (n: string) => (n === "bash" ? <I.Terminal size={14} /> : n.startsWith("browser_") ? <I.Globe size={14} /> : n.endsWith("_file") || n === "list_files" ? <I.File size={14} /> : n === "grep" ? <I.Search size={14} /> : n.includes("skill") ? <I.M icon="Scroll" size={14} /> : <I.M icon="ChevronR" size={14} />);

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

function ToolRow({ t, onFile, verbose }: { t: ToolStep; onFile: (p: string) => void; verbose?: boolean }) {
  const [open, setOpen] = useState(!!verbose);
  const label = t.summary || String(t.input.command ?? t.input.path ?? t.input.url ?? "");
  const path = t.name === "write_file" || t.name === "edit_file" || t.name === "read_file" ? String(t.diff?.path ?? t.input.path ?? "") : "";
  return (
    <div className={`ag-tool ${t.ok === false ? "bad" : ""}`}>
      <button className="ag-tool-h" onClick={() => setOpen(!open)}>
        <span className="ag-ic">{!t.done ? <span className="ag-spin" /> : iconOf(t.name)}</span>
        <span className="ag-verb">{desc(t) || VERB[t.name] || t.name}</span>
        <code className="ag-sum" data-notr>{label}</code>
        <Diff d={t.diff} />
        {t.ok === false && <span className="ag-err">lỗi</span>}
        <span className={`ag-chev ${open ? "on" : ""}`}><I.ChevronR size={12} /></span>
      </button>
      {open && (
        <div className="ag-out">
          {verbose && Object.keys(t.input).length > 0 && <pre className="ag-in" data-notr>{JSON.stringify(t.input, null, 2).slice(0, 4000)}</pre>}
          {path && <button className="ag-link" onClick={() => onFile(path)}><I.File size={13} />Mở {base(path)}</button>}
          {t.image && <img className="ag-shot" src={`data:image/jpeg;base64,${t.image}`} alt="Ảnh chụp màn hình" />}
          {t.output && <pre data-notr>{t.output}</pre>}
        </div>
      )}
    </div>
  );
}

function ToolGroup({ ts, live, onFile, verbose }: { ts: ToolStep[]; live: boolean; onFile: (p: string) => void; verbose?: boolean }) {
  const [open, setOpen] = useState(!!verbose);
  useEffect(() => { if (verbose) setOpen(true); }, [verbose]);
  const run = ts.find((t) => !t.done);
  const shot = ts.filter((t) => t.image).pop();
  return (
    <div className="ag-group">
      <button className="ag-group-h" onClick={() => setOpen(!open)}>
        {run && live ? <span className="ag-shimmer">{desc(run) || RUNNING[run.name] || `${VERB[run.name] ?? run.name}…`}</span>
          : ts.length === 1 && desc(ts[0]) ? <span>{desc(ts[0])}</span> : <span>{groupLabel(ts)}</span>}
        <span className={`ag-chev ${open ? "on" : ""}`}><I.ChevronR size={12} /></span>
      </button>
      {open ? <div className="ag-list">{ts.map((t) => <ToolRow key={t.id + (verbose ? "v" : "")} t={t} onFile={onFile} verbose={verbose} />)}</div>
        : shot && <img className="ag-shot sm" src={`data:image/jpeg;base64,${shot.image}`} alt="Ảnh chụp màn hình" onClick={() => setOpen(true)} />}
    </div>
  );
}

// Suy nghĩ của model: chữ mờ, thu gọn được.
function Think({ text, open: init }: { text: string; open: boolean }) {
  const [open, setOpen] = useState(init);
  return (
    <div className={`ag-think ${open ? "on" : ""}`}>
      <button className="ag-think-h" onClick={() => setOpen(!open)}><I.Bulb size={13} /><span>Suy nghĩ</span><span className={`ag-chev ${open ? "on" : ""}`}><I.ChevronR size={12} /></span></button>
      {open ? <div className="ag-think-b" data-notr>{text}</div> : <div className="ag-think-1" data-notr>{text.split("\n")[0].slice(0, 160)}</div>}
    </div>
  );
}

/** Thẻ hỏi duyệt: Synchro dừng chờ bạn cho phép sửa tệp, chạy lệnh, hay dùng trình duyệt trên một trang chưa được phép. */
export function AskCard({ a, onAnswer }: { a: Omit<AskStep, "k">; onAnswer?: OnAnswer }) {
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [gone, setGone] = useState(false);
  // Sửa tham số trước khi cho phép (công cụ connector, tham số hiện đủ): chữ JSON đang sửa; null là không sửa.
  const [edit, setEdit] = useState<string | null>(null);
  const editable = a.kind === "connector" && !!onAnswer && (() => { try { const v = JSON.parse(a.detail || "{}"); return !!v && typeof v === "object" && !Array.isArray(v); } catch { return false; } })();
  const es = edit !== null ? readArgs(edit, a.detail, a.schema) : null;
  const blocked = !!es && (es.errors.length > 0 || !es.value);
  const go = (ok: boolean, o?: { always?: boolean; chat?: boolean; note?: string; input?: Record<string, unknown> }) => {
    if (!onAnswer || sending) return;
    if (ok && blocked) return;
    // Cho phép khi đang sửa và tham số khác bản đầu: gửi tham số đã sửa (máy chủ kiểm tra lại theo schema).
    if (ok && es?.changed && es.value) o = { ...o, input: es.value };
    setSending(true); setErr("");
    Promise.resolve().then(() => onAnswer(a.id, ok, o)).then((e) => {
      if (!e) return;
      setSending(false);
      if (e === ASK_GONE) setGone(true); else setErr(e);
    }, () => { setSending(false); setErr("Không gửi được câu trả lời."); });
  };
  const conn = a.kind === "connector" ? a.conn : undefined;
  // Composio: tên theo thao tác thật ("Google Docs · Tạo tài liệu 'Synchro test'"); strict thì chỉ cho phép từng lần.
  const cx = conn ? a.cx : undefined;
  const head = cx ? cxHead(cx) : conn ? `${conn.name} · ${a.title}` : a.title;
  const state = gone ? "gone" : a.state;
  // Thẻ nằm trong .ai-msg (bộ dịch tự động bỏ qua nội dung câu trả lời) nên chữ giao diện dịch bằng tr().
  if (state !== "wait") return (
    <div className={`ag-asked ${state === "no" || state === "gone" || state === "typed" ? "no" : ""}`}>
      {state === "no" || state === "gone" || state === "typed" ? <I.X size={13} /> : <I.Check size={13} />}
      <span>{tr(state === "typed" ? "Bạn đã nhắn thêm nên công cụ chưa chạy" : state === "no" ? "Đã từ chối" : state === "gone" ? "Không còn chờ" : state === "chat" ? "Cho phép trong đoạn chat này" : state === "always" ? (a.kind === "site" ? "Luôn cho phép trang này" : conn ? "Luôn cho phép" : "Luôn cho phép trong phiên") : "Đã cho phép")}: <b data-notr>{head}</b>{a.edited && state !== "no" ? <em className="ag-asked-ed"> · {tr("đã sửa tham số")}</em> : null}</span>
    </div>
  );
  const always = a.kind === "site" ? `${tr("Luôn cho phép")} ${a.host ?? tr("trang này")}` : tr(a.kind === "connector" ? "Luôn cho phép" : a.kind === "edit" ? "Cho phép mọi lần sửa tệp" : "Luôn cho phép lệnh này");
  return (
    <div className="ag-ask" role="alertdialog" aria-label={a.title}>
      <div className="ag-ask-h">{conn ? <ConnLogo logo={conn.logo} color={conn.color} icon={conn.icon} site={conn.site} name={conn.name} size={28} /> : <span className="ag-ask-ic">{a.kind === "site" ? <I.Globe size={15} /> : a.kind === "edit" ? <I.M icon="Pencil" size={15} /> : <I.M icon="Terminal" size={15} />}</span>}
        <div><b>{tr(a.kind === "connector" ? "Cho Synchro dùng công cụ này?" : a.kind === "site" ? "Cho Synchro dùng trình duyệt trên trang này?" : a.kind === "edit" ? "Cho Synchro sửa tệp này?" : "Cho Synchro chạy lệnh này?")}</b><span data-notr>{head}</span></div></div>
      {cx ? <CxDetails cx={cx} /> : a.about && <p className="ag-ask-about" data-notr>{a.about}</p>}
      {a.destructive && <div className="ap-warn"><I.Alert size={14} /><span>{tr("Công cụ này có thể tạo, sửa hoặc xóa dữ liệu trong ứng dụng của bạn.")}</span></div>}
      {edit !== null && es ? <ArgsEditor text={edit} onText={setEdit} state={es} disabled={sending} /> : a.detail && <pre className="ag-ask-d" data-notr>{a.detail}</pre>}
      {conn && a.until ? <p className="ag-ask-about">{tr(`Chờ bạn trả lời tới ${new Date(a.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).replace(/\s/g, "\u00a0")}. Quá giờ công cụ không chạy. Nhắn trong khung chat cũng được: công cụ không chạy và Synchro đọc tin nhắn.`)}</p> : null}
      {err && <div className="api-err" role="alert"><I.Alert size={14} /><span>{tr(err)}</span></div>}
      {note !== null ? (
        <div className="ag-ask-note">
          <input autoFocus value={note} placeholder={tr("Bảo Synchro nên làm thế nào thay vào đó…")} onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") go(false, { note }); if (e.key === "Escape") setNote(null); }} />
          <button className="btn dark" disabled={sending} onClick={() => go(false, { note })}>{tr("Gửi")}</button>
        </div>
      ) : (
        <div className="ag-ask-a">
          <button className="btn dark" disabled={sending || !onAnswer || blocked} onClick={() => go(true)}>{tr(a.kind === "connector" ? (es?.changed ? "Cho phép với tham số đã sửa" : "Cho phép một lần") : "Cho phép")}</button>
          {a.kind === "connector" && !cx?.strict && <button className="btn" disabled={sending || !onAnswer || blocked} onClick={() => go(true, { chat: true })}>{tr("Cho phép trong đoạn chat này")}</button>}
          {!cx?.strict && <button className="btn" disabled={sending || !onAnswer || blocked} onClick={() => go(true, { always: true })} data-notr={a.kind === "site" ? true : undefined}>{always}</button>}
          {editable && (edit === null
            ? <button className="btn" disabled={sending} onClick={() => setEdit(a.detail || "{}")} aria-label={tr("Sửa tham số trước khi cho phép")}><I.Icon name="BracesCode" size={14} />{tr("Sửa")}</button>
            : <button className="btn" disabled={sending} onClick={() => setEdit(null)}>{tr("Hủy sửa")}</button>)}
          <button className="btn" disabled={sending || !onAnswer} onClick={() => go(false)}>{tr("Từ chối")}</button>
          <button className="ag-ask-other" disabled={sending || !onAnswer} onClick={() => setNote("")}>{tr("Bảo làm khác…")}</button>
        </div>
      )}
    </div>
  );
}

// Nội dung một lượt trả lời của agent: đoạn văn xen kẽ nhóm công cụ (danh sách việc hiện ở thẻ riêng).
export function AgentSteps({ steps, live, say, view = "normal", onAnswer }: { steps: AStep[]; live: boolean; say: Say; view?: TView; onAnswer?: OnAnswer }) {
  const showFile = useCodeUi((s) => s.showFile);
  useLangReady(); // lời báo của hệ thống dịch lúc vẽ: từ điển về sau thì vẽ lại
  const blocks = useMemo(() => {
    const out: ({ k: "text"; text: string } | { k: "steer"; text: string } | { k: "think"; text: string } | AskStep | { k: "tools"; ts: ToolStep[] })[] = [];
    for (const s of steps) {
      if (s.k === "steer" || s.k === "ask") out.push(s);
      else if (s.k === "text") { const text = stripPhases(s.text); if (text) out.push({ k: "text", text }); }
      else if (s.k === "think") { if (view !== "normal") out.push(s); }
      else if (s.name !== "update_plan") {
        const last = out[out.length - 1];
        if (last?.k === "tools") last.ts.push(s); else out.push({ k: "tools", ts: [s] });
      }
    }
    return out;
  }, [steps, view]);
  return (
    <div className={`ag${live ? " ai-streaming" : ""}`}>
      {blocks.map((b, i) => b.k === "steer"
        ? <div key={i} className="ag-steer"><span>Bạn nhắn thêm</span><p data-notr>{b.text}</p></div>
        : b.k === "text"
        ? <Markdown key={i} text={localizeNote(b.text, tr)} say={say} streaming={live && i === blocks.length - 1} />
        : b.k === "think"
        ? <Think key={i} text={b.text.length < 200 ? tr(b.text) : b.text} open={view === "verbose" || (view === "thinking" && live && i === blocks.length - 1)} />
        : b.k === "ask"
        ? <AskCard key={b.id} a={b} onAnswer={live ? onAnswer : undefined} />
        : <ToolGroup key={i + view} ts={b.ts} live={live && (i === blocks.length - 1 || b.ts.some((t) => !t.done))} onFile={(p) => showFile(p)} verbose={view === "verbose"} />)}
    </div>
  );
}

const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const fmtTime = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

// Dòng trạng thái khi agent đang làm: logo Synchro xoay theo nhịp đồng bộ (Loader), việc đang làm (chữ lướt sáng), thời gian, số token.
export function StatusLine({ steps, start, tokens }: { steps: AStep[]; start: number; tokens: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.floor((now - start) / 1000));
  // Việc của nhóm công cụ gần nhất (tối đa 3 việc khác nhau), hoặc "Đang suy nghĩ" khi model đang viết.
  const running = steps.some((x) => x.k === "tool" && !x.done);
  let label = "Đang suy nghĩ";
  const cur = [...steps].reverse().find((x): x is ToolStep => x.k === "tool" && !x.done);
  if (steps.some((x) => x.k === "ask" && x.state === "wait")) label = "Đang chờ bạn duyệt";
  else if (cur && desc(cur)) label = desc(cur);
  else if (running) {
    const tail: string[] = [];
    for (let i = steps.length - 1; i >= 0; i--) {
      const x = steps[i];
      if (x.k !== "tool") break;
      const d = DOING[x.name] ?? x.name;
      if (!tail.includes(d)) tail.unshift(d);
    }
    const last = tail.slice(-3).join(", ");
    label = last.charAt(0).toUpperCase() + last.slice(1);
  }
  return (
    <div className="ag-status">
      <span className="ag-load" aria-hidden><Loader size={15} /></span>
      <span className="ag-shimmer">{tr(label)}</span>
      <span className="ag-meta" data-notr>{sec >= 1 ? `${fmtTime(sec)} · ` : ""}{fmtTok(tokens)} tokens</span>
    </div>
  );
}

// Danh sách việc nằm ngay trong đoạn chat khi agent đang làm (giống Claude); làm xong thì ẩn đi.
export function TaskCard({ plan }: { plan: PlanItem[] }) {
  return (
    <ul className="cv-tasks">
      {plan.map((x, i) => (
        <li key={i} className={x.status}>
          <span className="tk-ic">{x.status === "completed" ? <I.CheckCircle size={16} />
            : x.status === "in_progress" ? <Loader size={14} />
            : <I.CircleDashed size={16} />}</span>
          <span>{x.content}</span>
        </li>
      ))}
    </ul>
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

