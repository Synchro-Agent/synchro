"use client";

import GlassFolder from "./glass-folder";
import { useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { Fade, Menu } from "./ui";
import { useApp, type Chat, type Project } from "./store";
import { chunkText, extractText } from "./llm";
import { UploadModal } from "./modals";
import { useFileMenu, saveBlob } from "./filemenu";
import { ghConnect } from "./wsclient";

type Say = (t: string) => void;

// Bật skill riêng cho dự án: model chỉ dùng các skill này khi chat trong dự án (cộng với skill bật cho mọi đoạn chat).
type PSkill = { name: string; description: string; enabled: boolean; projects: string[] };
function ProjectSkills({ pid, say }: { pid: number; say: Say }) {
  const [list, setList] = useState<PSkill[] | null>(null);
  useEffect(() => {
    fetch("/api/skills", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { skills: [] })).then((j) => setList(j.skills ?? [])).catch(() => setList([]));
  }, []);
  const flip = async (s: PSkill, on: boolean) => {
    const id = String(pid);
    setList((l) => l?.map((x) => (x.name === s.name ? { ...x, projects: on ? [...x.projects, id] : x.projects.filter((p) => p !== id) } : x)) ?? null);
    const r = await fetch(`/api/skills/${encodeURIComponent(s.name)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: id, enabled: on }) });
    if (!r.ok) say((await r.json().catch(() => ({}))).error || "Không lưu được thay đổi");
    else say(on ? `Đã bật ${s.name} trong dự án` : `Đã tắt ${s.name} trong dự án`);
  };
  return (
    <section>
      <div className="pj-sh"><h3>Kỹ năng</h3></div>
      {list === null ? <p className="muted">Đang tải…</p> : list.length === 0 ? <p className="muted">Chưa có skill nào. Tải lên trong Tùy chỉnh → Kỹ năng.</p> : (
        <ul className="pj-skills">
          {list.map((s) => {
            const on = s.projects.includes(String(pid));
            return (
              <li key={s.name}>
                <div className="pj-sk-t"><b data-notr>{s.name}</b><span>{s.enabled ? "Đang bật cho mọi đoạn chat" : on ? "Chỉ bật trong dự án này" : "Đang tắt"}</span></div>
                {s.enabled ? <span className="pj-sk-all">Mọi nơi</span> : <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={`Bật ${s.name} trong dự án`} onClick={() => flip(s, !on)} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export const projUpd = (p: Project, chats: Chat[]) => Math.max(p.upd ?? p.id, ...chats.filter((c) => c.project === p.id).map((c) => c.id));

export function ago(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

function useAway(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  });
  return ref;
}

const Archive = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.8" y="3.8" width="14.4" height="3.6" rx="1" /><path d="M4 7.4V15a1.4 1.4 0 001.4 1.4h9.2A1.4 1.4 0 0016 15V7.4M8 10.6h4" /></svg>
);
const Github = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor"><path d="M10 1.8a8.2 8.2 0 00-2.6 16c.4.1.6-.2.6-.4v-1.5c-2.3.5-2.8-1-2.8-1-.4-1-.9-1.2-.9-1.2-.8-.5.1-.5.1-.5.8.1 1.3.9 1.3.9.7 1.300 1.900.9 2.300.7.1-.5.3-.9.5-1.100-1.800-.2-3.700-.9-3.700-4 0-.9.3-1.600.9-2.200-.1-.2-.4-1 .1-2.100 0 0 .7-.2 2.200.8a7.600 7.600 0 014 0c1.500-1 2.200-.8 2.200-.8.4 1.100.2 1.900.1 2.100.5.6.9 1.300.9 2.200 0 3.100-1.900 3.800-3.700 4 .3.3.6.8.6 1.500v2.200c0 .2.2.5.6.4A8.200 8.200 0 0010 1.800z" /></svg>
);
const TextIn = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5.5" width="15" height="9" rx="1.8" /><path d="M6 8.5h3.5M6 11.5h6" /></svg>
);
const Clipx = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M16 9.4l-5.6 5.6a3.6 3.6 0 01-5.100-5.100l6-6a2.400 2.400 0 013.400 3.400l-6 6a1.200 1.200 0 01-1.700-1.700l5.400-5.400" /></svg>
);
const Bubble = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.500c-4.700 0-8.500 3.200-8.500 7.200 0 1.800.8 3.400 2.100 4.700L4.800 20l4.200-1.800c1 .3 2 .4 3 .4 4.700 0 8.500-3.200 8.500-7.200S16.700 3.500 12 3.500z" /><path d="M8.500 10.800h.01M12 10.800h.01M15.500 10.800h.01" strokeWidth="2" /></svg>
);
const Lock = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="4.500" y="9" width="11" height="7.500" rx="1.800" /><path d="M7 9V6.800a3 3 0 016 0V9" /></svg>
);

export function EmptyArt() {
  return (
    <svg width="96" height="96" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="6" width="17" height="17" rx="1.500" /><rect x="26" y="6" width="17" height="17" rx="1.500" /><rect x="6" y="26" width="17" height="14" rx="1.500" />
      <rect x="22" y="22" width="14" height="14" rx="1.500" fill="currentColor" fillOpacity=".28" />
      <g transform="translate(26 20) scale(1.5)"><path d="M18 11v-1a2 2 0 0 0-4 0M14 10V9a2 2 0 0 0-4 0v1M10 9.500V4a2 2 0 0 0-4 0v10M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.800 0-4.500-.86-5.990-2.340l-3.600-3.600a2 2 0 0 1 2.830-2.820L7 15" /></g>
    </svg>
  );
}

const fmtSize = (n: number) => (n < 1000 ? `${n} B` : n < 1e6 ? `${(n / 1000).toFixed(1).replace(".", ",")} kB` : `${(n / 1e6).toFixed(1).replace(".", ",")} MB`);

export function ProjMenu({ p, open, style, pin, onPin, onEdit, onArchive, onDelete }: {
  p: Project; open: boolean; style?: React.CSSProperties; pin?: boolean;
  onPin: () => void; onEdit: () => void; onArchive: () => void; onDelete: () => void;
}) {
  return (
    <Menu open={open} className="down" style={{ width: 250, ...style }}>
      {pin && <button className="menu-item" onClick={onPin}>{p.pinned ? <I.PinOff /> : <I.Pin />}{p.pinned ? "Bỏ ghim" : "Ghim"}</button>}
      <button className="menu-item" onClick={onEdit}><I.Pencil />Chỉnh sửa thông tin chi tiết</button>
      <hr />
      <button className="menu-item" onClick={onArchive}><Archive />{p.archived ? "Bỏ lưu trữ" : "Lưu trữ"}</button>
      <button className="menu-item del" onClick={onDelete}><I.Trash />Xóa</button>
    </Menu>
  );
}

type Sort = "upd" | "created" | "alpha";

export function ProjectsPage({ projects, chats, onNew, onOpen, patch, onEdit, onDelete, say }: {
  projects: Project[]; chats: Chat[]; onNew: () => void; onOpen: (id: number) => void;
  patch: (id: number, f: Partial<Project>) => void; onEdit: (id: number) => void; onDelete: (id: number) => void; say: Say;
}) {
  const [q, setQ] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("upd");
  const [group, setGroup] = useState(false);
  const [sMenu, setSMenu] = useState(false);
  const [arch, setArch] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const sRef = useAway(() => setSMenu(false));
  const mRef = useAway(() => setMenu(null));
  const list = projects
    .filter((x) => !!x.archived === arch && (!q || x.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (sort === "alpha" ? a.name.localeCompare(b.name) : sort === "created" ? b.id - a.id : projUpd(b, chats) - projUpd(a, chats)));
  const archCount = projects.filter((x) => x.archived).length;
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const PRESETS = ["aurora", "ember", "dusk", "glacier", "verdant"] as const;
  const card = (x: Project) => {
    const files = (x.ctx ?? []).map((c) => ({
      name: c.name,
      meta: c.kind === "text" ? "TXT" : `${(c.name.split(".").pop() ?? "").toUpperCase()}${c.size ? " · " + (c.size < 1e6 ? (c.size / 1000).toFixed(1) + " kB" : (c.size / 1e6).toFixed(1) + " MB") : ""}`,
    }));
    return (
      <div key={x.id} className="pj-gcard" ref={menu === x.id ? mRef : undefined}
        onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setCtxPos({ x: e.clientX - r.left, y: e.clientY - r.top }); setMenu(x.id); }}>
        <GlassFolder key={x.id + ":" + files.map((f) => f.name).join("|")} label={x.name} meta={`Cập nhật ${ago(projUpd(x, chats))}`}
          art={PRESETS[x.id % PRESETS.length]} seed={(x.id % 97) + 1} files={files} action="none" appear={false} width={132}
          onActivate={() => onOpen(x.id)} />
        <div className="pj-gname"><b>{x.name}{x.pinned && <span className="pj-pin"><I.Pin size={12} /></span>}</b><span>Cập nhật {ago(projUpd(x, chats))}</span></div>
        <div onClick={(e) => e.stopPropagation()}>
          <ProjMenu p={x} open={menu === x.id} pin style={{ top: ctxPos?.y ?? 40, left: ctxPos?.x ?? 40, width: 236 }}
            onPin={() => { patch(x.id, { pinned: !x.pinned }); setMenu(null); say(x.pinned ? "Đã bỏ ghim dự án" : "Đã ghim dự án"); }}
            onEdit={() => { setMenu(null); onEdit(x.id); }}
            onArchive={() => { patch(x.id, { archived: !x.archived }); setMenu(null); say(x.archived ? "Đã bỏ lưu trữ dự án" : "Đã lưu trữ dự án"); }}
            onDelete={() => { setMenu(null); onDelete(x.id); }} />
        </div>
      </div>
    );
  };
  const sorts: [Sort, string][] = [["upd", "Cập nhật lần cuối"], ["created", "Ngày tạo"], ["alpha", "Theo bảng chữ cái"]];
  const empty = list.length === 0;
  return (
    <div className="page"><div className="pj-in">
      <div className="pj-head">
        <h1>{arch ? "Dự án đã lưu trữ" : "Dự án"}</h1>
        <div className="pj-tools">
          {q !== null ? (
            <div className="pj-search"><I.Search size={16} /><input autoFocus placeholder="Tìm kiếm dự án..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ(null)} /><button className="icon-btn" aria-label="Xóa" onClick={() => setQ(null)}><I.X size={16} /></button></div>
          ) : (
            <button className="icon-btn" aria-label="Tìm kiếm" onClick={() => setQ("")}><I.Search /></button>
          )}
          <div ref={sRef} style={{ position: "relative" }}>
            <button className="icon-btn" aria-label="Sắp xếp" onClick={() => setSMenu(!sMenu)}><I.Sort /></button>
            <Menu open={sMenu} className="down" style={{ top: 38, right: 0, width: 210 }}>
              {sorts.map(([k, l]) => <button key={k} className="menu-item" onClick={() => { setSort(k); setSMenu(false); }}>{l}{sort === k && <span className="ck"><I.Check size={16} /></span>}</button>)}
              <hr />
              <button className="menu-item" onClick={() => { setGroup(!group); setSMenu(false); }}>Nhóm theo loại{group && <span className="ck"><I.Check size={16} /></span>}</button>
            </Menu>
          </div>
          <button className="btn dark pj-new" onClick={onNew}>Dự án mới</button>
        </div>
      </div>
      {empty ? (
        <div className="pj-empty">
          <EmptyArt />
          <h2>{q ? "Không tìm thấy dự án" : arch ? "Chưa có dự án nào được lưu trữ" : "Bạn muốn bắt đầu một dự án?"}</h2>
          {!q && !arch && <p>Tải tài liệu lên, thiết lập hướng dẫn tùy chỉnh và sắp xếp các cuộc trò chuyện ở cùng một nơi.</p>}
          {!q && !arch && <button className="btn dark pj-new big" onClick={onNew}>Dự án mới</button>}
        </div>
      ) : group ? (
        [["Đã ghim", list.filter((x) => x.pinned)], ["Dự án của bạn", list.filter((x) => !x.pinned)]].map(([t, l]) => (l as Project[]).length > 0 && (
          <section key={t as string}><div className="pj-sec">{t as string}</div><div className="pj-grid pj-gridf">{(l as Project[]).map(card)}</div></section>
        ))
      ) : (
        <div className="pj-grid pj-gridf">{list.map(card)}</div>
      )}
      {(archCount > 0 || arch) && <button className="lnk pj-arch" onClick={() => setArch(!arch)}>{arch ? "← Quay lại dự án" : `Xem dự án đã lưu trữ (${archCount})`}</button>}
    </div></div>
  );
}

export function InsModal({ init, onClose, onSave }: { init: string; onClose: () => void; onSave: (t: string) => void }) {
  const [v, setV] = useState(init);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pj-modal">
        <h2>Đặt hướng dẫn cho dự án</h2>
        <p className="pj-hint">Cung cấp cho Synchro hướng dẫn và thông tin liên quan cho các đoạn chat trong dự án này. Hướng dẫn này sẽ áp dụng cùng với <a>hướng dẫn trong hồ sơ</a> của bạn và phong cách được chọn trong đoạn chat.</p>
        <textarea className="field" autoFocus rows={9} placeholder="Hãy suy nghĩ từng bước và trình bày lập luận cho các vấn đề phức tạp. Sử dụng ví dụ cụ thể." value={v} onChange={(e) => setV(e.target.value)} />
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn dark" disabled={v.trim() === init.trim()} style={v.trim() === init.trim() ? { opacity: 0.4 } : undefined} onClick={() => onSave(v.trim())}>Lưu hướng dẫn</button>
        </div>
      </div>
    </div>
  );
}

export function TextCtxModal({ onClose, onSave }: { onClose: () => void; onSave: (n: string, t: string) => void }) {
  const [n, setN] = useState("");
  const [t, setT] = useState("");
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pj-modal">
        <h2>Thêm nội dung văn bản</h2>
        <label>Tiêu đề</label>
        <input className="field" autoFocus placeholder="Ví dụ: Ghi chú cuộc họp" value={n} onChange={(e) => setN(e.target.value)} />
        <label>Nội dung</label>
        <textarea className="field" rows={8} placeholder="Dán hoặc nhập nội dung bạn muốn Synchro tham khảo" value={t} onChange={(e) => setT(e.target.value)} />
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn dark" disabled={!t.trim()} style={!t.trim() ? { opacity: 0.4 } : undefined} onClick={() => onSave(n.trim() || "Nội dung văn bản", t.trim())}>Thêm</button>
        </div>
      </div>
    </div>
  );
}

export function MemModal({ mem, onClose, onDelete }: { mem: { id: number; content: string }[]; onClose: () => void; onDelete: (id: number) => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pj-modal">
        <h2>Bộ nhớ dự án</h2>
        <p className="pj-hint">Synchro tự ghi nhớ thông tin bền vững từ các đoạn chat trong dự án này. Bạn có thể xóa bất kỳ mục nào.</p>
        {mem.length === 0 ? <p className="muted" style={{ margin: "18px 0" }}>Bộ nhớ dự án sẽ hiển thị ở đây sau vài đoạn chat.</p> : (
          <div className="pj-memlist">{mem.map((m) => <div key={m.id} className="pj-memitem"><span>{m.content}</span><button className="icon-btn" aria-label="Xóa" onClick={() => onDelete(m.id)}><I.Trash size={15} /></button></div>)}</div>
        )}
        <div className="modal-foot"><button className="btn dark" onClick={onClose}>Xong</button></div>
      </div>
    </div>
  );
}

export function ProjectPage({ proj, chats, composer, patch, onBack, onOpenChat, onEdit, onDelete, say }: {
  proj: Project; chats: Chat[]; composer: React.ReactNode; patch: (id: number, f: Partial<Project>) => void;
  onBack: () => void; onOpenChat: (id: number) => void; onEdit: () => void; onDelete: () => void; say: Say;
}) {
  const [ins, setIns] = useState(false);
  const [txt, setTxt] = useState(false);
  const [menu, setMenu] = useState(false);
  const canSkills = useApp().me?.perms.features.skills !== false;
  const [add, setAdd] = useState(false);
  const mRef = useAway(() => setMenu(false));
  const aRef = useAway(() => setAdd(false));
  const fRef = useRef<HTMLInputElement>(null);
  const ctx = proj.ctx ?? [];
  const mine = chats.filter((c) => c.project === proj.id && !c.inc);
  const mem = proj.mem ?? [];
  const [busyCtx, setBusyCtx] = useState(false);
  const [sq, setSq] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [drag, setDrag] = useState(false);
  const toggle = (id: number) => setSel((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const shownCtx = ctx.filter((c) => !sq || c.name.toLowerCase().includes(sq.toLowerCase()));
  const pct = Math.max(1, Math.ceil(ctx.reduce((n, c) => n + (c.chars ?? 0), 0) / 10000));
  const [memOpen, setMemOpen] = useState(false);
  const [upl, setUpl] = useState(false);
  const [ghOpen, setGhOpen] = useState(false);
  const fm = useFileMenu(say);
  const addCtx = (n: string, kind: "file" | "text", text: string) => patch(proj.id, { ctx: [...(proj.ctx ?? []), { id: Date.now() + Math.random(), name: n, kind, text, chars: text.length, chunks: chunkText(text) }] });
  const addFiles = async (fs: File[]) => {
    let ok = 0;
    setBusyCtx(true);
    const t0 = Date.now();
    let acc = proj.ctx ?? [];
    for (const f of fs) {
      let t = "";
      try { t = await extractText(f); } catch {}
      saveBlob(f.name, f);
      if (!t.trim()) say(`Không trích được chữ từ "${f.name}" — AI sẽ chưa đọc được tệp này`);
      acc = [...acc, { id: Date.now() + Math.random(), name: f.name, kind: "file", text: t, chars: t.length, size: f.size, chunks: chunkText(t) }];
      ok++;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, 900 - (Date.now() - t0))));
    setBusyCtx(false);
    if (ok) { patch(proj.id, { ctx: acc }); say(`Đã thêm ${ok} tệp`); }
  };
  return (
    <div className="page"><div className="pj-in">
      <div className="pj-crumb"><button onClick={onBack}>Dự án</button><span>/</span><b>{proj.name}</b></div>
      <div className="pj-title">
        <h1>{proj.name}</h1>
        <div className="pj-tools">
          <button className={`icon-btn pj-pinbtn ${proj.pinned ? "on" : ""}`} data-tip={proj.pinned ? "Bỏ ghim dự án" : "Ghim dự án"} aria-label={proj.pinned ? "Bỏ ghim dự án" : "Ghim dự án"} onClick={() => { patch(proj.id, { pinned: !proj.pinned }); say(proj.pinned ? "Đã bỏ ghim dự án" : "Đã ghim dự án"); }}>{proj.pinned ? <I.PinOff /> : <I.Pin />}</button>
          <div ref={mRef} style={{ position: "relative" }}>
            <button className="icon-btn" aria-label="Tùy chọn" onClick={() => setMenu(!menu)}>⋮</button>
            <ProjMenu p={proj} open={menu} style={{ top: 38, right: 0 }} onPin={() => {}}
              onEdit={() => { setMenu(false); onEdit(); }}
              onArchive={() => { patch(proj.id, { archived: !proj.archived }); setMenu(false); say(proj.archived ? "Đã bỏ lưu trữ dự án" : "Đã lưu trữ dự án"); if (!proj.archived) onBack(); }}
              onDelete={() => { setMenu(false); onDelete(); }} />
          </div>
        </div>
      </div>
      {proj.desc && <p className="muted pj-desc">{proj.desc}</p>}
      <div className="pj-cols">
        <div className="pj-main">
          {composer}
          {mine.length === 0 ? (
            <div className="pj-chats-empty"><Bubble /><p>Synchro sử dụng cùng một nguồn kiến thức mỗi khi bạn trò chuyện với Synchro trong dự án này.</p></div>
          ) : (
            <div className="pj-chats">{mine.map((c) => <button key={c.id} className="pj-chat" onClick={() => onOpenChat(c.id)}><b>{c.title}</b><span>{ago(c.id)}</span></button>)}</div>
          )}
        </div>
        <aside className="pj-side">
          <section>
            <div className="pj-sh"><h3>Hướng dẫn</h3><button className="icon-btn" aria-label={proj.ins ? "Chỉnh sửa hướng dẫn" : "Đặt hướng dẫn"} onClick={() => setIns(true)}>{proj.ins ? <I.Pencil size={16} /> : <I.Plus size={16} />}</button></div>
            <p className={`pj-ins ${proj.ins ? "" : "muted"}`}>{proj.ins || "Thêm hướng dẫn để điều chỉnh câu trả lời của Synchro"}</p>
          </section>
          <section>
            <div className="pj-sh"><h3>Bộ nhớ</h3><button className="pj-memlink" onClick={() => setMemOpen(true)}>Xem bộ nhớ</button></div>
            {mem.length === 0 ? <p className="muted">Bộ nhớ dự án sẽ hiển thị ở đây sau vài đoạn chat.</p> : <ul className="pj-mem">{mem.slice(-3).map((m) => <li key={m.id}>{m.content}</li>)}</ul>}
          </section>
          {canSkills && <ProjectSkills pid={proj.id} say={say} />}
          <section>
            <div className="pj-sh"><h3>Ngữ cảnh</h3>
              {busyCtx ? <span className="pj-spin" aria-label="Đang tải" /> : (
                <>
                  {ctx.length > 0 && <button className={`icon-btn ${sq !== null ? "on" : ""}`} data-tip="Tìm kiếm tệp" aria-label="Tìm kiếm tệp" onClick={() => setSq(sq === null ? "" : null)}><I.Search size={16} /></button>}
                  <div ref={aRef} style={{ position: "relative" }}>
                    <button className="icon-btn" aria-label="Thêm ngữ cảnh" onClick={() => setAdd(!add)}><I.Plus size={16} /></button>
                    <Menu open={add} className="down" style={{ top: 34, right: 0, width: 230 }}>
                      <button className="menu-item" onClick={() => { setAdd(false); setUpl(true); }}><Clipx />Tải lên từ thiết bị</button>
                      <button className="menu-item" onClick={() => { setAdd(false); setTxt(true); }}><TextIn />Thêm nội dung văn bản</button>
                      <hr />
                      <button className="menu-item" onClick={() => { setAdd(false); setGhOpen(true); }}><Github />GitHub</button>
                    </Menu>
                  </div>
                </>
              )}
            </div>
            <input ref={fRef} type="file" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) addFiles(fs); }} />
            {fm.node}
            {upl && <UploadModal say={say} onClose={() => setUpl(false)} onFiles={(f) => { setUpl(false); addFiles(f); }} />}
            {ghOpen && <GitHubImport say={say} onClose={() => setGhOpen(false)} onFiles={(f) => void addFiles(f)} />}
            {sq !== null && ctx.length > 0 && <input className="pj-fsearch" autoFocus placeholder="Tìm kiếm tệp..." value={sq} onChange={(e) => setSq(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setSq(null)} />}
            {ctx.length > 0 && (
              <div className="pj-usage">
                <div className="pj-bar"><i style={{ width: `${Math.max(pct, 1.5)}%` }} /></div>
                <div className="pj-usage-t"><span>Đã dùng {pct}% dung lượng dự án</span><span className="pj-info" data-tip="Tệp và văn bản trong dự án được dùng làm ngữ cảnh cho mọi đoạn chat" tabIndex={0}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="10" cy="10" r="7.500" /><path d="M10 9v4.500M10 6.600v.01" /></svg></span></div>
              </div>
            )}
            {sel.size > 0 && (
              <div className="pj-selbar">
                <span className="pj-cb on"><I.Check size={12} /></span>
                <span className="pj-sel-n">Đã chọn {sel.size}</span>
                <button className="icon-btn" data-tip={`Xóa ${sel.size} mục đã chọn`} aria-label="Xóa mục đã chọn" onClick={() => { patch(proj.id, { ctx: ctx.filter((x) => !sel.has(x.id)) }); setSel(new Set()); }}><I.Trash size={16} /></button>
                <button className="icon-btn pj-sel-x" aria-label="Bỏ chọn" onClick={() => setSel(new Set())}><I.X size={16} /></button>
              </div>
            )}
            {ctx.length === 0 && !busyCtx ? (
              <div className={`pj-ctx-empty ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); const fs = Array.from(e.dataTransfer.files); if (fs.length) addFiles(fs); }}>
                <div className="pj-art" aria-hidden>
                  <span className="pj-c1"><i /><i /><i /></span><span className="pj-c2"><i /><i /><i /></span><span className="pj-c4" /><span className="pj-c3"><i /><i /><i /><b>+</b></span>
                </div>
                <p>Thêm tệp PDF, tài liệu hoặc văn bản khác để tham khảo trong dự án này.</p>
              </div>
            ) : (
              <div className="pj-files">
                {shownCtx.map((c) => {
                  const ext = (c.kind === "text" ? "TXT" : (c.name.split(".").pop() ?? "").slice(0, 4).toUpperCase()) || "FILE";
                  return (
                    <div key={c.id} className={`pj-file ${sel.has(c.id) ? "sel" : ""} ${sel.size ? "selmode" : ""}`} onContextMenu={(e) => fm.open(e, c.name, c.text)} onClick={() => sel.size && toggle(c.id)}>
                      <button className="pj-file-x" aria-label="Xóa" onClick={(e) => { e.stopPropagation(); patch(proj.id, { ctx: ctx.filter((x) => x.id !== c.id) }); }}><I.X size={12} /></button>
                      <b title={c.name}>{c.name}</b>
                      <span>{fmtSize(c.size ?? c.chars ?? 0)}</span>
                      <div className="pj-file-f"><em>{ext}</em><button className={`pj-cb ${sel.has(c.id) ? "on" : ""}`} aria-label="Chọn" onClick={(e) => { e.stopPropagation(); toggle(c.id); }}>{sel.has(c.id) && <I.Check size={12} />}</button></div>
                    </div>
                  );
                })}
                {busyCtx && <div className="pj-file sk"><i /><i /><u /></div>}
                {sq && shownCtx.length === 0 && <p className="muted" style={{ gridColumn: "1/-1" }}>Không tìm thấy tệp</p>}
              </div>
            )}
          </section>
        </aside>
      </div>
      <Fade show={ins}><InsModal init={proj.ins ?? ""} onClose={() => setIns(false)} onSave={(t) => { patch(proj.id, { ins: t }); setIns(false); say("Đã lưu hướng dẫn"); }} /></Fade>
      <Fade show={memOpen}><MemModal mem={mem} onClose={() => setMemOpen(false)} onDelete={(id) => patch(proj.id, { mem: mem.filter((m) => m.id !== id) })} /></Fade>
      <Fade show={txt}><TextCtxModal onClose={() => setTxt(false)} onSave={(n, t) => { addCtx(n, "text", t); setTxt(false); say("Đã thêm nội dung văn bản"); }} /></Fade>
    </div></div>
  );
}

// Thêm tệp từ repo GitHub vào ngữ cảnh dự án: kết nối GitHub (nếu chưa), chọn repo, chọn tệp (sẵn README, tài liệu và tệp nhỏ ở gốc).
type GhFile = { path: string; size: number };
function GitHubImport({ onClose, onFiles, say }: { onClose: () => void; onFiles: (f: File[]) => void; say: Say }) {
  const [st, setSt] = useState<{ linked: boolean; configured: boolean; allowed: boolean } | null>(null);
  const [repos, setRepos] = useState<{ full: string; branch: string; desc: string | null; private: boolean }[] | null>(null);
  const [q, setQ] = useState("");
  const [repo, setRepo] = useState<{ full: string; branch: string } | null>(null);
  const [files, setFiles] = useState<GhFile[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [fq, setFq] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const load = () => fetch("/api/github", { cache: "no-store" }).then((r) => r.json()).then(setSt).catch(() => setErr("Không đọc được trạng thái GitHub."));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!st?.linked || repo) return;
    const t = setTimeout(() => fetch(`/api/github?repos=1&q=${encodeURIComponent(q)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setRepos(j.repos ?? [])).catch(() => setRepos([])), 250);
    return () => clearTimeout(t);
  }, [st?.linked, q, repo]);
  const open = async (r: { full: string; branch: string }) => {
    setRepo(r); setFiles(null); setErr("");
    try {
      const j = await fetch(`/api/github?tree=${encodeURIComponent(r.full)}&ref=${encodeURIComponent(r.branch)}`, { cache: "no-store" }).then((x) => x.json());
      if (j.error) throw new Error(j.error);
      const list: GhFile[] = j.files ?? [];
      setFiles(list);
      // Chọn sẵn: README, tài liệu (docs/), tệp cấu hình ở gốc — tối đa 25 tệp, mỗi tệp dưới 60 KB.
      const pre = list.filter((f) => f.size < 60_000 && (/(^|\/)readme/i.test(f.path) || /^docs?\//i.test(f.path) || !f.path.includes("/"))).slice(0, 25);
      setSel(new Set(pre.map((f) => f.path)));
    } catch (e) { setErr((e as Error).message); }
  };
  const add = async () => {
    if (!repo) return;
    setBusy("add"); setErr("");
    try {
      const r = await fetch("/api/github", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: repo.full, ref: repo.branch, paths: [...sel] }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
      const out = (j.files as { path: string; text: string }[]).map((f) => new File([f.text], `${repo.full.split("/")[1]}/${f.path}`, { type: "text/plain" }));
      if (!out.length) throw new Error("Không lấy được tệp nào.");
      onFiles(out); say(`Đã thêm ${out.length} tệp từ ${repo.full}`); onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
  const shown = (files ?? []).filter((f) => !fq || f.path.toLowerCase().includes(fq.toLowerCase())).slice(0, 400);
  const total = (files ?? []).filter((f) => sel.has(f.path)).reduce((n, f) => n + f.size, 0);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal gh-imp" role="dialog" aria-modal="true" aria-label="Thêm từ GitHub">
        <button className="icon-btn" style={{ position: "absolute", top: 12, right: 12 }} onClick={onClose} aria-label="Đóng"><I.X size={16} /></button>
        <h2 style={{ fontSize: 16 }}>{repo ? repo.full : "Thêm từ GitHub"}</h2>
        {!st ? <p className="d">Đang kiểm tra kết nối GitHub…</p> : !st.configured ? <p className="d">Máy chủ chưa cấu hình đăng nhập GitHub (GITHUB_CLIENT_ID).</p> : !st.allowed ? <p className="d">Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code (cần cho GitHub).</p> : !st.linked ? (
          <>
            <p className="d">Kết nối tài khoản GitHub để chọn repo. Synchro chỉ đọc các tệp bạn chọn.</p>
            <div className="modal-foot"><button className="btn dark" disabled={!!busy} onClick={async () => { setBusy("link"); const e = await ghConnect(); setBusy(""); if (e && e !== "timeout") setErr(e); void load(); }}>{busy === "link" ? "Đang chờ GitHub…" : "Kết nối GitHub"}</button></div>
          </>
        ) : !repo ? (
          <>
            <input className="field" autoFocus placeholder="Tìm repo…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="gh-list">
              {repos === null && <p className="d">Đang tải repo…</p>}
              {repos?.length === 0 && <p className="d">Không có repo khớp.</p>}
              {repos?.map((r) => <button key={r.full} className="gh-row" onClick={() => open(r)}><b data-notr>{r.full}</b>{r.private && <span className="pill">Riêng tư</span>}<small data-notr>{r.desc ?? ""}</small></button>)}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8 }}><button className="btn" onClick={() => { setRepo(null); setFiles(null); }}><I.Back size={14} />Repo khác</button><input className="field" style={{ flex: 1 }} placeholder="Lọc tệp…" value={fq} onChange={(e) => setFq(e.target.value)} /></div>
            <div className="gh-list">
              {files === null && !err && <p className="d">Đang đọc cây thư mục…</p>}
              {shown.map((f) => (
                <label key={f.path} className="gh-file"><input type="checkbox" checked={sel.has(f.path)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(f.path); else n.delete(f.path); setSel(n); }} /><span data-notr>{f.path}</span><small>{kb(f.size)}</small></label>
              ))}
            </div>
            <div className="modal-foot"><span className="d" style={{ marginRight: "auto" }}>{sel.size} tệp · {kb(total)} {sel.size > 80 || total > 2_000_000 ? "· tối đa 80 tệp, 2 MB" : ""}</span><button className="btn dark" disabled={!sel.size || sel.size > 80 || !!busy} onClick={add}>{busy === "add" ? "Đang lấy tệp…" : `Thêm ${sel.size} tệp`}</button></div>
          </>
        )}
        {err && <div className="api-err" role="alert"><I.Alert size={14} /><span>{err}</span></div>}
      </div>
    </div>
  );
}
