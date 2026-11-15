"use client";
// Cộng tác trên ứng dụng nội bộ: ai đang mở cùng lúc, bình luận có @nhắc tên (người được nhắc nhận thông báo trong Hộp thư),
// mọi thay đổi (bình luận, dữ liệu chung) hiện ngay cho người đang mở nhờ kênh trực tiếp /api/apps/<id>/live.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { tr } from "../app/i18n";

const ago = (ts: number) => {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} giờ trước` : `${Math.floor(h / 24)} ngày trước`;
};

export type Person = { id: string; name: string; email?: string };
export type Comment = { id: string; user: Person; body: string; mentions: Person[]; resolved: boolean; at: number };

/** Kênh trực tiếp: danh sách người đang mở, bình luận, và báo dữ liệu chung vừa đổi (trừ thay đổi do chính tab này). */
export function useLive(app: string | null, client: string, onData: (key: string) => void) {
  const [people, setPeople] = useState<Person[]>([]);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [online, setOnline] = useState(false);
  const cb = useRef(onData); cb.current = onData;
  const load = useCallback(() => {
    if (!app) return;
    fetch(`/api/apps/${encodeURIComponent(app)}/comments`).then((r) => (r.ok ? r.json() : null)).then((j) => j && setComments(j.comments)).catch(() => {});
  }, [app]);
  useEffect(() => {
    if (!app) return;
    load();
    let es: EventSource | null = null;
    const open = () => {
      const s = es = new EventSource(`/api/apps/${encodeURIComponent(app)}/live`);
      s.onopen = () => { setOnline(true); load(); };
      s.onerror = () => setOnline(false);
      s.addEventListener("presence", (e) => setPeople(JSON.parse((e as MessageEvent).data).people));
      s.addEventListener("data", (e) => { const d = JSON.parse((e as MessageEvent).data); if (d.client !== client) cb.current(d.key); });
      s.addEventListener("comment", (e) => { const c = JSON.parse((e as MessageEvent).data).comment as Comment; setComments((l) => (l && !l.some((x) => x.id === c.id) ? [...l, c] : l)); });
      s.addEventListener("comment-update", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { id: string; resolved?: boolean; deleted?: boolean };
        setComments((l) => l && (d.deleted ? l.filter((x) => x.id !== d.id) : l.map((x) => (x.id === d.id ? { ...x, resolved: !!d.resolved } : x))));
      });
    };
    const close = () => { es?.close(); es = null; };
    // Rời trang mà trình duyệt giữ trang trong bộ nhớ đệm quay lại (bfcache; Chrome bản mới giữ cả trang có no-store): kết nối vẫn mở nên
    // người khác vẫn thấy mình "đang xem cùng" tới khi đóng hẳn tab. Đóng kết nối khi rời trang, quay lại bằng nút Back thì mở lại.
    const hide = () => { close(); setOnline(false); };
    const show = (e: PageTransitionEvent) => { if (e.persisted && !es) open(); };
    open();
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => { window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); close(); };
  }, [app, client, load]);
  return { people, comments, setComments, online };
}

const initials = (n: string) => n.trim().split(/\s+/).slice(-2).map((w) => w[0]).join("").toUpperCase() || "?";
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
export function Avatar({ p, size = 26 }: { p: Person; size?: number }) {
  return <span className="cl-av" style={{ width: size, height: size, background: `hsl(${hue(p.id)} 45% 46%)` }} title={p.name} aria-label={p.name}>{initials(p.name)}</span>;
}

/** Người đang mở ứng dụng (tối đa 4 hình, còn lại "+N"). */
export function Presence({ people, me }: { people: Person[]; me: string }) {
  const others = people.filter((p) => p.id !== me);
  if (!others.length) return null;
  return (
    <span className="cl-pres" title={`${tr("Đang xem")}: ${others.map((p) => p.name).join(", ")}`}>
      {others.slice(0, 4).map((p) => <Avatar key={p.id} p={p} />)}
      {others.length > 4 && <span className="cl-av more">+{others.length - 4}</span>}
      <span className="cl-pres-t">{tr(others.length === 1 ? "đang xem cùng bạn" : "người đang xem cùng bạn")}</span>
    </span>
  );
}

// Tô đậm "@Tên" của người được nhắc trong nội dung bình luận.
function Body({ c }: { c: Comment }) {
  const names = c.mentions.map((m) => m.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <>{c.body}</>;
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g");
  return <>{c.body.split(re).map((part, i) => (i % 2 ? <b key={i} className="cl-at">{part}</b> : part))}</>;
}

export function CommentsPanel({ app, me, owner, comments, setComments, onClose, say }: {
  app: string; me: string; owner: boolean; comments: Comment[] | null; setComments: (f: (l: Comment[] | null) => Comment[] | null) => void; onClose: () => void; say: (m: string) => void;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Person[]>([]);
  const [sug, setSug] = useState<{ q: string; list: Person[]; sel: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const open = (comments ?? []).filter((c) => !c.resolved), done = (comments ?? []).filter((c) => c.resolved);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [comments?.length]);

  // Gõ "@tên" → gợi ý người xem được ứng dụng.
  const onType = (v: string) => {
    setText(v);
    const caret = ta.current?.selectionStart ?? v.length;
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(v.slice(0, caret));
    if (!m) return setSug(null);
    const q = m[2];
    fetch(`/api/apps/${encodeURIComponent(app)}/people?q=${encodeURIComponent(q)}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j?.people) setSug(j.people.length ? { q, list: j.people, sel: 0 } : null);
    }).catch(() => {});
  };
  const pick = (p: Person) => {
    const caret = ta.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    setText(before + text.slice(caret)); setPicked((l) => (l.some((x) => x.id === p.id) ? l : [...l, p])); setSug(null);
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(before.length, before.length); });
  };
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/apps/${encodeURIComponent(app)}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, mentions: picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
      setComments((l) => (l && !l.some((x) => x.id === j.comment.id) ? [...l, j.comment] : l));
      setText(""); setPicked([]);
      if (j.comment.mentions.length) say(tr("Đã gửi, người được nhắc sẽ nhận thông báo"));
    } catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };
  const act = async (c: Comment, what: "resolve" | "reopen" | "delete") => {
    const r = await fetch(`/api/apps/comments/${c.id}`, what === "delete" ? { method: "DELETE" } : { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolved: what === "resolve" }) });
    if (!r.ok) return say((await r.json().catch(() => ({}))).error || tr("Không thực hiện được"));
    setComments((l) => l && (what === "delete" ? l.filter((x) => x.id !== c.id) : l.map((x) => (x.id === c.id ? { ...x, resolved: what === "resolve" } : x))));
  };
  const row = (c: Comment) => (
    <div key={c.id} className={`cl-c ${c.resolved ? "done" : ""}`}>
      <Avatar p={c.user} size={28} />
      <div className="cl-c-m">
        <div className="cl-c-h"><b data-notr>{c.user.name}</b><span>{ago(c.at)}</span>
          {(c.user.id === me || owner) && (
            <span className="cl-c-a">
              <button className="icon-btn" onClick={() => act(c, c.resolved ? "reopen" : "resolve")} aria-label={c.resolved ? "Mở lại" : "Đánh dấu đã xử lý"} title={c.resolved ? "Mở lại" : "Đánh dấu đã xử lý"}>{c.resolved ? <I.M icon="Retry" size={14} /> : <I.M icon="Check" size={14} />}</button>
              <button className="icon-btn" onClick={() => act(c, "delete")} aria-label="Xóa bình luận" title="Xóa bình luận"><I.Trash size={14} /></button>
            </span>
          )}
        </div>
        <div className="cl-c-b" data-notr><Body c={c} /></div>
      </div>
    </div>
  );
  return (
    <aside className="cl-panel" aria-label={tr("Bình luận")}>
      <div className="cl-ph"><b>{tr("Bình luận")}</b>{open.length > 0 && <span className="cl-n">{open.length}</span>}<span style={{ flex: 1 }} /><button className="icon-btn" onClick={onClose} aria-label="Đóng"><I.X size={15} /></button></div>
      <div className="cl-list">
        {comments === null ? <div className="cl-empty"><span className="art-spin sm" /></div>
          : !comments.length ? <div className="cl-empty">{tr("Chưa có bình luận. Góp ý cho ứng dụng, gõ @ để nhắc đồng nghiệp.")}</div>
          : <>{open.map(row)}{done.length > 0 && <button className="cl-done-t" onClick={() => setShowDone(!showDone)}>{tr(showDone ? "Ẩn bình luận đã xử lý" : "Xem bình luận đã xử lý")} ({done.length})</button>}{showDone && done.map(row)}</>}
        <div ref={end} />
      </div>
      <div className="cl-box">
        {sug && (
          <div className="cl-sug" role="listbox">
            {sug.list.map((p, i) => (
              <button key={p.id} role="option" aria-selected={i === sug.sel} className={i === sug.sel ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                <Avatar p={p} size={22} /><span data-notr>{p.name}</span><small data-notr>{p.email}</small>
              </button>
            ))}
          </div>
        )}
        <textarea ref={ta} rows={2} value={text} placeholder={tr("Viết bình luận… gõ @ để nhắc tên")} onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (sug) {
              if (e.key === "ArrowDown") { e.preventDefault(); return setSug({ ...sug, sel: (sug.sel + 1) % sug.list.length }); }
              if (e.key === "ArrowUp") { e.preventDefault(); return setSug({ ...sug, sel: (sug.sel - 1 + sug.list.length) % sug.list.length }); }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); return pick(sug.list[sug.sel]); }
              if (e.key === "Escape") { e.preventDefault(); return setSug(null); }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }} />
        <button className="btn dark" disabled={!text.trim() || busy} onClick={send} aria-label="Gửi bình luận"><I.Arrow size={15} /></button>
      </div>
    </aside>
  );
}
