"use client";
// Bộ não công ty: trang Tri thức (tài liệu, trí nhớ nhóm, thử tìm) và nguồn trích dẫn dưới câu trả lời.
import { useCallback, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { tr } from "./i18n";
import { extractText } from "./llm";

type Scope = "private" | "org";
type Doc = { id: string; title: string; scope: Scope; source: string; chars: number; chunks: number; created_at: number; mine: boolean; canEdit: boolean };
type Mem = { id: string; scope: Scope; content: string; created_at: number; canEdit: boolean };
export type Source = { n: number; doc: string; title: string; scope: Scope; chunk: number; text: string };
const api = async <T,>(method: string, url: string, body?: unknown): Promise<T> => {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
  return j as T;
};
const kb = (n: number) => (n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K` : `${(n / 1_000_000).toFixed(1)}M`);
const ScopeBadge = ({ s }: { s: Scope }) => <span className={`kb-scope ${s}`}>{s === "org" ? tr("Cả tổ chức") : tr("Riêng tôi")}</span>;

// ---------------------------------------------------------------- xem tài liệu, cuộn tới đúng đoạn được trích dẫn
export function KbDocModal({ id, chunk, onClose }: { id: string; chunk?: number; onClose: () => void }) {
  const [doc, setDoc] = useState<(Doc & { chunks: { n: number; text: string }[] }) | null>(null);
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { api<{ doc: typeof doc }>("GET", `/api/kb/${id}`).then((j) => setDoc(j.doc), (e) => setErr(e.message)); }, [id]);
  useEffect(() => { if (doc && chunk !== undefined) box.current?.querySelector(`[data-n="${chunk}"]`)?.scrollIntoView({ block: "center" }); }, [doc, chunk]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="overlay" style={{ zIndex: 80 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal kb-doc">
        <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={onClose} aria-label="Đóng"><I.X size={16} /></button>
        {err ? <div className="sk-err"><span>{err}</span></div> : !doc ? <div className="empty"><span className="art-spin" /></div> : <>
          <div className="kb-doc-h"><I.File size={18} /><b data-notr>{doc.title}</b><ScopeBadge s={doc.scope} /></div>
          <div className="kb-doc-b" ref={box}>{doc.chunks.map((c) => <p key={c.n} data-n={c.n} className={c.n === chunk ? "hit" : ""}>{c.text}</p>)}</div>
        </>}
      </div>
    </div>
  );
}

/** Nguồn dưới câu trả lời: [1] Tên tài liệu … bấm để mở đúng đoạn. */
export function SourceChips({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState<Source | null>(null);
  if (!sources.length) return null;
  return (
    <div className="kb-src">
      <span className="kb-src-h"><I.Book size={13} />{tr("Nguồn")}</span>
      {sources.map((s) => <button key={s.n} className="kb-src-c" title={s.text} onClick={() => setOpen(s)}><b>[{s.n}]</b><span data-notr>{s.title}</span></button>)}
      {open && <KbDocModal id={open.doc} chunk={open.chunk} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- trang Tri thức
export function KnowledgePage({ say }: { say: (m: string) => void }) {
  const [tab, setTab] = useState<"docs" | "memory" | "search">("docs");
  const [data, setData] = useState<{ docs: Doc[]; memory: Mem[]; admin: boolean } | null>(null);
  const [scope, setScope] = useState<Scope>("private");
  const [busy, setBusy] = useState("");
  const [paste, setPaste] = useState<{ title: string; text: string } | null>(null);
  const [mem, setMem] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Source[] | null>(null);
  const [open, setOpen] = useState<{ id: string; chunk?: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api<NonNullable<typeof data>>("GET", "/api/kb").then(setData).catch((e) => say(e.message)), [say]);
  useEffect(() => { load(); }, [load]);
  const upload = async (files: FileList) => {
    for (const f of Array.from(files).slice(0, 20)) {
      setBusy(`${tr("Đang đọc")} ${f.name}…`);
      try {
        const text = await extractText(f);
        await api("POST", "/api/kb", { kind: "doc", title: f.name.replace(/\.[^.]+$/, ""), text, source: f.name, scope });
        say(`${tr("Đã thêm")} ${f.name}`);
      } catch (e) { say(`${f.name}: ${(e as Error).message}`); }
    }
    setBusy(""); load();
  };
  const savePaste = async () => {
    if (!paste) return;
    setBusy(tr("Đang lưu…"));
    try { await api("POST", "/api/kb", { kind: "doc", title: paste.title, text: paste.text, scope }); setPaste(null); say(tr("Đã thêm tài liệu")); load(); } catch (e) { say((e as Error).message); }
    setBusy("");
  };
  const addMem = async () => { try { await api("POST", "/api/kb", { kind: "memory", content: mem, scope }); setMem(""); load(); } catch (e) { say((e as Error).message); } };
  const del = async (id: string) => { try { await api("DELETE", `/api/kb/${id}`); load(); } catch (e) { say((e as Error).message); } };
  const search = async () => { if (!q.trim()) return; try { setHits((await api<{ hits: Source[] }>("GET", `/api/kb/search?q=${encodeURIComponent(q)}`)).hits); } catch (e) { say((e as Error).message); } };
  const scopePick = data?.admin && (
    <div className="pl-seg kb-scope-pick"><button className={scope === "private" ? "on" : ""} onClick={() => setScope("private")}>{tr("Riêng tôi")}</button><button className={scope === "org" ? "on" : ""} onClick={() => setScope("org")}>{tr("Cả tổ chức")}</button></div>
  );
  return (
    <div className="page"><div className="page-in kb">
      <div className="tk-top">
        <h1>{tr("Tri thức")}</h1>
        <div className="pl-seg"><button className={tab === "docs" ? "on" : ""} onClick={() => setTab("docs")}>{tr("Tài liệu")}</button><button className={tab === "memory" ? "on" : ""} onClick={() => setTab("memory")}>{tr("Trí nhớ nhóm")}</button><button className={tab === "search" ? "on" : ""} onClick={() => setTab("search")}>{tr("Thử tìm")}</button></div>
      </div>
      <p className="d kb-intro">{tr("Synchro tự tìm trong kho này mỗi khi bạn hỏi và trả lời kèm nguồn [1], [2]. Tài liệu của cả tổ chức do quản trị viên thêm, mọi người cùng dùng.")}</p>
      {!data ? <div className="empty"><span className="art-spin" /></div> : tab === "docs" ? <>
        <div className="kb-add">
          {scopePick}
          <span style={{ flex: 1 }} />
          {busy && <span className="kb-busy"><span className="art-spin sm" />{busy}</span>}
          <button className="btn" onClick={() => setPaste({ title: "", text: "" })}><I.Pencil size={14} />{tr("Dán văn bản")}</button>
          <button className="btn dark" onClick={() => file.current?.click()} disabled={!!busy}><I.Upload size={14} />{tr("Tải tài liệu lên")}</button>
          <input ref={file} type="file" multiple hidden accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.pptx,.html,.json" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
        </div>
        {!data.docs.length ? <div className="apps-empty"><I.Book size={22} /><b>{tr("Kho tài liệu đang trống")}</b><span>{tr("Tải lên quy trình, chính sách, hợp đồng mẫu, tài liệu sản phẩm… (PDF, Word, Excel, văn bản). Synchro sẽ trả lời dựa trên chúng và ghi rõ nguồn.")}</span></div> : (
          <div className="apps-list">
            {data.docs.map((d) => (
              <div key={d.id} className="apps-row" role="button" tabIndex={0} onClick={() => setOpen({ id: d.id })} onKeyDown={(e) => e.key === "Enter" && setOpen({ id: d.id })}>
                <span className="pl-mark" style={{ width: 36, height: 36 }}><I.File size={17} /></span>
                <div className="apps-t"><b data-notr>{d.title}</b><span>{kb(d.chars)} {tr("ký tự")} · {d.chunks} {tr("đoạn")} · {new Date(d.created_at).toLocaleDateString("vi-VN")}</span></div>
                <ScopeBadge s={d.scope} />
                {d.canEdit && <button className="icon-btn" aria-label="Xóa tài liệu" data-tip="Xóa tài liệu" onClick={(e) => { e.stopPropagation(); del(d.id); }}><I.Trash size={15} /></button>}
              </div>
            ))}
          </div>
        )}
      </> : tab === "memory" ? <>
        <form className="kb-mem-add" onSubmit={(e) => { e.preventDefault(); if (mem.trim()) addMem(); }}>
          <input className="field" value={mem} maxLength={500} onChange={(e) => setMem(e.target.value)} placeholder={tr("Ví dụ: Báo cáo gửi ban giám đốc luôn kèm bảng số liệu và kết luận ở đầu")} />
          {scopePick}
          <button className="btn dark" disabled={!mem.trim()}>{tr("Ghi nhớ")}</button>
        </form>
        {!data.memory.length ? <div className="apps-empty"><I.Book size={22} /><b>{tr("Chưa có trí nhớ nào")}</b><span>{tr("Những điều Synchro nên luôn nhớ khi làm việc với bạn hoặc cả tổ chức: quy ước, văn phong, tên viết tắt, người phụ trách…")}</span></div> : (
          <div className="apps-list">{data.memory.map((m) => (
            <div key={m.id} className="apps-row"><span className="pl-mark" style={{ width: 36, height: 36 }}><I.Book size={17} /></span><div className="apps-t"><b className="kb-mem-t">{m.content}</b><span>{new Date(m.created_at).toLocaleDateString("vi-VN")}</span></div><ScopeBadge s={m.scope} />
              {m.canEdit && <button className="icon-btn" aria-label="Xóa" data-tip="Xóa" onClick={() => del(m.id)}><I.Trash size={15} /></button>}</div>
          ))}</div>
        )}
      </> : <>
        <form className="kb-mem-add" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Gõ câu hỏi để xem Synchro tìm thấy đoạn nào")} />
          <button className="btn dark" disabled={!q.trim()}><I.Search size={14} />{tr("Tìm")}</button>
        </form>
        {hits && (!hits.length ? <div className="empty"><span>{tr("Không tìm thấy đoạn nào liên quan.")}</span></div> : (
          <div className="kb-hits">{hits.map((h) => (
            <button key={`${h.doc}-${h.chunk}`} className="kb-hit" onClick={() => setOpen({ id: h.doc, chunk: h.chunk })}><span className="kb-hit-h"><b>[{h.n}]</b><span data-notr>{h.title}</span><ScopeBadge s={h.scope} /></span><span className="kb-hit-t">{h.text}</span></button>
          ))}</div>
        ))}
      </>}
      {paste && (
        <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && setPaste(null)}>
          <form className="modal tk-modal" onSubmit={(e) => { e.preventDefault(); savePaste(); }}>
            <h2>{tr("Dán văn bản vào kho")}</h2>
            <label className="tk-l">{tr("Tên tài liệu")}<input className="field" value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} /></label>
            <label className="tk-l">{tr("Nội dung")}<textarea className="field" rows={10} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} /></label>
            <div className="modal-foot"><button type="button" className="btn" onClick={() => setPaste(null)}>{tr("Hủy")}</button><button className="btn dark" disabled={!!busy || !paste.title.trim() || paste.text.trim().length < 20}>{tr("Thêm vào kho")}</button></div>
          </form>
        </div>
      )}
      {open && <KbDocModal id={open.id} chunk={open.chunk} onClose={() => setOpen(null)} />}
    </div></div>
  );
}
