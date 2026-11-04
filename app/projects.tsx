"use client";

import GlassFolder from "./glass-folder";
import { useEffect, useRef, useState } from "react";
import * as I from "./icons";
import { Fade, Menu } from "./ui";
import { useApp, type Chat, type Project } from "./store";
import { extractText, PROJECT_CTX_LIMIT } from "./llm";
import { tr } from "./i18n";
import { UploadModal } from "./modals";
import { useFileMenu, saveBlob } from "./filemenu";
import { ghConnect } from "./wsclient";
import { BulkBar, BulkButton, BulkCheck, bulkRow, useBulk, type BulkAct } from "./bulk";
import { PageBar, usePage } from "./pager";

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

// Icon riêng của Dự án: Phosphor như phần còn lại của app (app/icons.tsx).
const Archive = ({ size = 18 }: { size?: number }) => <I.Archive size={size} />;
const Github = ({ size = 18 }: { size?: number }) => <I.GitHub size={size} />;
const TextIn = ({ size = 18 }: { size?: number }) => <I.TextIn size={size} />;
const Clipx = ({ size = 18 }: { size?: number }) => <I.Clip size={size} />;
const Bubble = ({ size = 22 }: { size?: number }) => <I.Chat2 size={size} />;
const Lock = ({ size = 14 }: { size?: number }) => <I.Lock size={size} />;

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
      {pin && <button className="menu-item" onClick={onPin}>{p.pinned ? <I.M icon="PinOff" /> : <I.M icon="Pin" />}{p.pinned ? "Bỏ ghim" : "Ghim"}</button>}
      <button className="menu-item" onClick={onEdit}><I.Pencil />Chỉnh sửa thông tin chi tiết</button>
      <hr />
      <button className="menu-item" onClick={onArchive}><Archive />{p.archived ? "Bỏ lưu trữ" : "Lưu trữ"}</button>
      <button className="menu-item del" onClick={onDelete}><I.Trash />Xóa</button>
    </Menu>
  );
}

type Sort = "upd" | "created" | "alpha";

export function ProjectsPage({ projects, chats, onNew, onOpen, patch, onEdit, onDelete, onDeleteMany, say }: {
  projects: Project[]; chats: Chat[]; onNew: () => void; onOpen: (id: number) => void;
  patch: (id: number, f: Partial<Project>) => void; onEdit: (id: number) => void; onDelete: (id: number) => void; onDeleteMany: (ids: number[]) => void; say: Say;
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
  // Chọn hàng loạt: ghim, lưu trữ / bỏ lưu trữ, xóa nhiều dự án cùng lúc.
  const bk = useBulk(list, (x) => x.id);
  const pg = usePage(list, 24, `${arch}|${q}|${sort}|${group}`);
  const acts: BulkAct<Project>[] = [
    { id: "pin", label: "Ghim", icon: <I.Pin size={14} />, when: (l) => l.some((x) => !x.pinned), run: (l) => { l.forEach((x) => !x.pinned && patch(x.id, { pinned: true })); say(`Đã ghim ${l.length} dự án`); } },
    { id: "unpin", label: "Bỏ ghim", icon: <I.PinOff size={14} />, when: (l) => l.some((x) => x.pinned), run: (l) => { l.forEach((x) => x.pinned && patch(x.id, { pinned: false })); say(`Đã bỏ ghim ${l.length} dự án`); } },
    { id: "arch", label: "Lưu trữ", icon: <Archive />, when: (l) => l.some((x) => !x.archived), run: (l) => { l.forEach((x) => patch(x.id, { archived: true })); say(`Đã lưu trữ ${l.length} dự án`); } },
    { id: "unarch", label: "Bỏ lưu trữ", icon: <I.Restore size={14} />, when: (l) => l.some((x) => x.archived), run: (l) => { l.forEach((x) => patch(x.id, { archived: false })); say(`Đã bỏ lưu trữ ${l.length} dự án`); } },
    { id: "del", label: "Xóa", icon: <I.Trash size={14} />, danger: true, confirm: (l) => ({ title: `Xóa ${l.length} dự án?`, text: "Các dự án sẽ bị xóa. Các đoạn chat bên trong vẫn được giữ lại.", ok: "Xóa" }), run: (l) => { onDeleteMany(l.map((x) => x.id)); say(`Đã xóa ${l.length} dự án`); } },
  ];
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const PRESETS = ["aurora", "ember", "dusk", "glacier", "verdant"] as const;
  const card = (x: Project) => {
    const files = (x.ctx ?? []).map((c) => ({
      name: c.name,
      meta: c.kind === "text" ? "TXT" : `${(c.name.split(".").pop() ?? "").toUpperCase()}${c.size ? " · " + (c.size < 1e6 ? (c.size / 1000).toFixed(1) + " kB" : (c.size / 1e6).toFixed(1) + " MB") : ""}`,
    }));
    return (
      <div key={x.id} className="pj-gcard" ref={menu === x.id ? mRef : undefined} {...bulkRow(bk, x)}
        onContextMenu={(e) => { if (bk.on) { e.preventDefault(); return; } e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setCtxPos({ x: e.clientX - r.left, y: e.clientY - r.top }); setMenu(x.id); }}>
        <GlassFolder key={x.id + ":" + files.map((f) => f.name).join("|")} label={x.name} meta={`Cập nhật ${ago(projUpd(x, chats))}`}
          art={PRESETS[x.id % PRESETS.length]} seed={(x.id % 97) + 1} files={files} action="none" appear={false} width={132}
          onActivate={() => onOpen(x.id)} />
        {bk.on && <BulkCheck on={bk.has(x)} />}
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
  const live = projects.filter((x) => !x.archived).length;
  // Ô "Dự án mới" cùng dáng thư mục, nằm cuối mặt bàn.
  const slot = !arch && !q && !bk.on && (
    <button key="new" className="pj-slot" onClick={onNew}>
      <span className="pj-slot-f" aria-hidden><i /><I.Plus size={20} /></span>
      <span className="pj-gname"><b>Dự án mới</b></span>
    </button>
  );
  return (
    <div className="page ds-page sy-proj"><div className="page-in pj-in">
      <header className="ds-head">
        <div className="ds-head-t"><h1>Dự án</h1><p>Mỗi dự án giữ hướng dẫn, tệp và bộ nhớ riêng cho mọi đoạn chat bên trong.</p></div>
        <div className="ds-acts"><button className="btn dark pj-new" onClick={onNew}><I.Plus size={16} />Dự án mới</button></div>
      </header>
      <div className="ds-bar">
        <div className="ds-seg" role="tablist">
          <button role="tab" aria-selected={!arch} className={!arch ? "on" : ""} onClick={() => setArch(false)}>Đang dùng<i>{live}</i></button>
          <button role="tab" aria-selected={arch} className={arch ? "on" : ""} onClick={() => setArch(true)}>Lưu trữ<i>{archCount}</i></button>
        </div>
        <div className="ds-acts">
          <BulkButton b={bk} />
          <label className="ds-search"><I.Search size={16} /><input placeholder="Tìm dự án" value={q ?? ""} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ(null)} />{q && <button className="ds-clear" aria-label="Xóa" onClick={() => setQ(null)}><I.X size={14} /></button>}</label>
          <div ref={sRef} style={{ position: "relative" }}>
            <button className="btn ds-sort" aria-label="Sắp xếp" onClick={() => setSMenu(!sMenu)}><I.Sort size={15} /><span>{sorts.find(([k]) => k === sort)![1]}</span><I.Chevron size={14} /></button>
            <Menu open={sMenu} className="down" style={{ top: 42, right: 0, width: 220 }}>
              {sorts.map(([k, l]) => <button key={k} className="menu-item" onClick={() => { setSort(k); setSMenu(false); }}>{l}{sort === k && <span className="ck"><I.Check size={16} /></span>}</button>)}
              <hr />
              <button className="menu-item" onClick={() => { setGroup(!group); setSMenu(false); }}>Nhóm theo loại{group && <span className="ck"><I.Check size={16} /></span>}</button>
            </Menu>
          </div>
        </div>
      </div>
      <div className="pj-desk">
        {empty && !slot ? (
          <div className="pj-empty">
            <EmptyArt />
            <h2>{q ? "Không tìm thấy dự án" : "Chưa có dự án nào được lưu trữ"}</h2>
          </div>
        ) : empty && !projects.some((x) => !x.archived) ? (
          <div className="pj-empty">
            <EmptyArt />
            <h2>Bạn muốn bắt đầu một dự án?</h2>
            <p>Tải tài liệu lên, thiết lập hướng dẫn tùy chỉnh và sắp xếp các cuộc trò chuyện ở cùng một nơi.</p>
            <button className="btn dark pj-new big" onClick={onNew}>Dự án mới</button>
          </div>
        ) : group ? (
          [["Đã ghim", list.filter((x) => x.pinned)], ["Dự án của bạn", list.filter((x) => !x.pinned)]].map(([t, l], gi) => ((l as Project[]).length > 0 || gi === 1) && (
            <section key={t as string} className="pj-group"><div className="ds-sec"><h2>{t as string}</h2><i>{(l as Project[]).length}</i></div><div className="pj-grid pj-gridf">{(l as Project[]).map(card)}{gi === 1 && slot}</div></section>
          ))
        ) : (
          <div className="pj-grid pj-gridf">{pg.items.map(card)}{pg.page === pg.pages && slot}</div>
        )}
      </div>
      {!group && <PageBar pg={pg} />}
      <BulkBar b={bk} acts={acts} noun="dự án" />
    </div></div>
  );
}

export function InsModal({ init, onClose, onSave }: { init: string; onClose: () => void; onSave: (t: string) => void }) {
  const [v, setV] = useState(init);
  const { openSettings } = useApp();
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pj-modal">
        <h2>Đặt hướng dẫn cho dự án</h2>
        <p className="pj-hint">Cung cấp cho Synchro hướng dẫn và thông tin liên quan cho các đoạn chat trong dự án này. Hướng dẫn này sẽ áp dụng cùng với <button type="button" className="lnk" onClick={() => { onClose(); openSettings?.("Account"); }}>hướng dẫn trong hồ sơ</button> của bạn và phong cách được chọn trong đoạn chat.</p>
        <textarea className="field" autoFocus aria-label="Hướng dẫn" rows={9} placeholder="Hãy suy nghĩ từng bước và trình bày lập luận cho các vấn đề phức tạp. Sử dụng ví dụ cụ thể." value={v} onChange={(e) => setV(e.target.value)} />
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
        <input className="field" autoFocus aria-label="Tiêu đề" placeholder="Ví dụ: Ghi chú cuộc họp" value={n} onChange={(e) => setN(e.target.value)} />
        <label>Nội dung</label>
        <textarea className="field" aria-label="Nội dung" rows={8} placeholder="Dán hoặc nhập nội dung bạn muốn Synchro tham khảo" value={t} onChange={(e) => setT(e.target.value)} />
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

type PTab = "chats" | "ins" | "mem" | "skills" | "ctx";
export function ProjectPage({ proj, chats, composer, patch, onBack, onOpenChat, onEdit, onDelete, onChats, say }: {
  proj: Project; chats: Chat[]; composer: React.ReactNode; patch: (id: number, f: Partial<Project>) => void;
  onBack: () => void; onOpenChat: (id: number) => void; onEdit: () => void; onDelete: () => void; onChats: (ids: number[], op: "unlink" | "delete") => void; say: Say;
}) {
  const [ins, setIns] = useState(false);
  const [txt, setTxt] = useState(false);
  const [menu, setMenu] = useState(false);
  const app = useApp();
  const canSkills = app.me?.perms.features.skills !== false;
  const [add, setAdd] = useState(false);
  const mRef = useAway(() => setMenu(false));
  const aRef = useAway(() => setAdd(false));
  const fRef = useRef<HTMLInputElement>(null);
  const ctx = proj.ctx ?? [];
  const mine = chats.filter((c) => c.project === proj.id && !c.inc);
  const mem = proj.mem ?? [];
  // Chọn hàng loạt: đoạn chat trong dự án (gỡ khỏi dự án, xóa) và bộ nhớ dự án (xóa nhiều mục).
  const bkC = useBulk(mine, (c) => c.id);
  const bkM = useBulk(mem, (m) => m.id);
  const pgC = usePage(mine, 10), pgMem = usePage(mem, 10);
  const chatActs: BulkAct<Chat>[] = [
    { id: "unlink", label: "Gỡ khỏi dự án", icon: <I.Layers size={14} />, run: (l) => { onChats(l.map((c) => c.id), "unlink"); say(`Đã gỡ ${l.length} đoạn chat khỏi dự án`); } },
    { id: "del", label: "Xóa", icon: <I.Trash size={14} />, danger: true, confirm: (l) => ({ title: `Xóa ${l.length} đoạn chat?`, text: "Các đoạn chat đã chọn sẽ bị xóa khỏi mọi thiết bị, cùng với ghi chú trong Bộ não và liên kết chia sẻ. Không hoàn tác được.", ok: "Xóa" }), run: (l) => { onChats(l.map((c) => c.id), "delete"); say(`Đã xóa ${l.length} đoạn chat`); } },
  ];
  const memActs: BulkAct<{ id: number; content: string }>[] = [
    { id: "del", label: "Xóa", icon: <I.Trash size={14} />, danger: true, confirm: (l) => ({ title: `Xóa ${l.length} mục bộ nhớ?`, text: "Synchro sẽ không dùng các mục này trong dự án nữa.", ok: "Xóa" }), run: (l) => { const ids = new Set(l.map((m) => m.id)); patch(proj.id, { mem: mem.filter((m) => !ids.has(m.id)) }); say(`Đã xóa ${l.length} mục bộ nhớ`); } },
  ];
  const [busyCtx, setBusyCtx] = useState(false);
  const [sq, setSq] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [drag, setDrag] = useState(false);
  const toggle = (id: number) => setSel((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const shownCtx = ctx.filter((c) => !sq || c.name.toLowerCase().includes(sq.toLowerCase()));
  // Dung lượng thật của dự án: tổng số ký tự ngữ cảnh so với giới hạn (đầy thì không thêm được). Dự án cũ đang vượt giới hạn vẫn giữ nguyên, chỉ không thêm được nữa.
  const usedChars = ctx.reduce((n, c) => n + (c.chars ?? 0), 0);
  const pct = Math.min(100, Math.max(1, Math.ceil((usedChars / PROJECT_CTX_LIMIT) * 100)));
  const delCtx = (ids: number[], after?: () => void) => {
    const del = new Set(ids), one = ctx.find((x) => del.has(x.id));
    app.confirm(ids.length > 1 ? `${tr("Xóa")} ${ids.length} ${tr("mục ngữ cảnh?")}` : `${tr("Xóa")} “${one?.name ?? ""}”?`, "Synchro sẽ không dùng nội dung này trong dự án nữa. Không hoàn tác được.", "Xóa", () => { patch(proj.id, { ctx: ctx.filter((x) => !del.has(x.id)) }); after?.(); });
  };
  const [memOpen, setMemOpen] = useState(false);
  const [tab, setTab] = useState<PTab>("chats");
  const [upl, setUpl] = useState(false);
  const [ghOpen, setGhOpen] = useState(false);
  const fm = useFileMenu(say);
  const addCtx = (n: string, kind: "file" | "text", text: string) => {
    if (usedChars + text.length > PROJECT_CTX_LIMIT) return say("Dự án đã đầy dung lượng ngữ cảnh. Hãy xóa bớt tệp hoặc tạo dự án mới");
    patch(proj.id, { ctx: [...(proj.ctx ?? []), { id: Date.now() + Math.random(), name: n, kind, text, chars: text.length }] });
  };
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
      if (acc.reduce((n, c) => n + (c.chars ?? 0), 0) + t.length > PROJECT_CTX_LIMIT) { say(`"${f.name}" ${tr("không được thêm: dự án đã đầy dung lượng ngữ cảnh")}`); continue; }
      acc = [...acc, { id: Date.now() + Math.random(), name: f.name, kind: "file", text: t, chars: t.length, size: f.size }];
      ok++;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, 900 - (Date.now() - t0))));
    setBusyCtx(false);
    if (ok) { patch(proj.id, { ctx: acc }); say(`Đã thêm ${ok} tệp`); }
  };
  const PRESETS = ["aurora", "ember", "dusk", "glacier", "verdant"] as const;
  const tabs: [PTab, string, number | null][] = [["chats", "Đoạn chat", mine.length], ["ins", "Hướng dẫn", null], ["mem", "Bộ nhớ", mem.length], ...(canSkills ? [["skills", "Kỹ năng", null] as [PTab, string, null]] : []), ["ctx", "Ngữ cảnh", ctx.length]];
  return (
    <div className="page ds-page sy-projpage"><div className="page-in pj-in">
      <nav className="pj-crumb"><button onClick={onBack}>Dự án</button><I.ChevronR size={13} /><b>{proj.name}</b></nav>
      <header className="pj-hero">
        <div className="pj-hero-f">
          <GlassFolder key={proj.id + ":" + ctx.map((c) => c.name).join("|")} label={proj.name} meta="" art={PRESETS[proj.id % PRESETS.length]} seed={(proj.id % 97) + 1}
            files={ctx.map((c) => ({ name: c.name, meta: c.kind === "text" ? "TXT" : (c.name.split(".").pop() ?? "").toUpperCase() }))} action="none" appear={false} width={88} />
        </div>
        <div className="pj-hero-t">
          <h1>{proj.name}</h1>
          {proj.desc && <p>{proj.desc}</p>}
          <div className="pj-facts"><span><I.Clock size={13} />Cập nhật {ago(projUpd(proj, chats))}</span><span>{mine.length} đoạn chat</span><span>{ctx.length} tệp ngữ cảnh</span><span>{mem.length} mục ghi nhớ</span></div>
        </div>
        <div className="ds-acts pj-tools">
          <button className={`icon-btn pj-pinbtn ${proj.pinned ? "on" : ""}`} data-tip={proj.pinned ? "Bỏ ghim dự án" : "Ghim dự án"} aria-label={proj.pinned ? "Bỏ ghim dự án" : "Ghim dự án"} onClick={() => { patch(proj.id, { pinned: !proj.pinned }); say(proj.pinned ? "Đã bỏ ghim dự án" : "Đã ghim dự án"); }}>{proj.pinned ? <I.M icon="PinOff" /> : <I.M icon="Pin" />}</button>
          <div ref={mRef} style={{ position: "relative" }}>
            <button className="icon-btn" aria-label="Tùy chọn" onClick={() => setMenu(!menu)}><I.Dots size={18} /></button>
            <ProjMenu p={proj} open={menu} style={{ top: 42, right: 0 }} onPin={() => {}}
              onEdit={() => { setMenu(false); onEdit(); }}
              onArchive={() => { patch(proj.id, { archived: !proj.archived }); setMenu(false); say(proj.archived ? "Đã bỏ lưu trữ dự án" : "Đã lưu trữ dự án"); if (!proj.archived) onBack(); }}
              onDelete={() => { setMenu(false); onDelete(); }} />
          </div>
        </div>
      </header>
      <div className="pj-compose">{composer}</div>
      <div className="ds-bar pj-tabbar">
        <div className="ds-seg" role="tablist">
          {tabs.map(([k, l, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}{n !== null && <i>{n}</i>}</button>)}
        </div>
        <div className="ds-acts">
          {tab === "ins" && <button className="btn" onClick={() => setIns(true)}>{proj.ins ? <I.M icon="Pencil" size={15} /> : <I.M icon="Plus" size={15} />}{proj.ins ? "Chỉnh sửa hướng dẫn" : "Đặt hướng dẫn"}</button>}
          {tab === "mem" && <button className="btn pj-memlink" onClick={() => setMemOpen(true)}>Xem bộ nhớ</button>}
          {tab === "ctx" && (busyCtx ? <span className="pj-spin" aria-label="Đang tải" /> : (
            <>
              {ctx.length > 0 && <button className={`icon-btn ${sq !== null ? "on" : ""}`} data-tip="Tìm kiếm tệp" aria-label="Tìm kiếm tệp" onClick={() => setSq(sq === null ? "" : null)}><I.Search size={16} /></button>}
              <div ref={aRef} style={{ position: "relative" }}>
                <button className="btn dark" aria-label="Thêm ngữ cảnh" onClick={() => setAdd(!add)}><I.Plus size={15} />Thêm ngữ cảnh</button>
                <Menu open={add} className="down" style={{ top: 42, right: 0, width: 230 }}>
                  <button className="menu-item" onClick={() => { setAdd(false); setUpl(true); }}><Clipx />Tải lên từ thiết bị</button>
                  <button className="menu-item" onClick={() => { setAdd(false); setTxt(true); }}><TextIn />Thêm nội dung văn bản</button>
                  <hr />
                  <button className="menu-item" onClick={() => { setAdd(false); setGhOpen(true); }}><Github />GitHub</button>
                </Menu>
              </div>
            </>
          ))}
        </div>
      </div>
      <div className="pj-panel" key={tab}>
        {tab === "chats" && (mine.length === 0 ? (
          <div className="pj-chats-empty"><Bubble /><p>Synchro sử dụng cùng một nguồn kiến thức mỗi khi bạn trò chuyện với Synchro trong dự án này.</p></div>
        ) : (
          <><div className="bk-head"><span className="bk-head-n">{mine.length} đoạn chat</span><BulkButton b={bkC} compact /></div>
          <div className="pj-chats">{pgC.items.map((c) => <button key={c.id} className="pj-chat" onClick={() => onOpenChat(c.id)} {...bulkRow(bkC, c)}>{bkC.on ? <BulkCheck on={bkC.has(c)} /> : <span className="pj-chat-ic"><Bubble size={16} /></span>}<b>{c.title}</b><span>{ago(c.id)}</span>{!bkC.on && <I.ChevronR size={14} />}</button>)}</div>
          <PageBar pg={pgC} />
          <BulkBar b={bkC} acts={chatActs} noun="đoạn chat" /></>
        ))}
        {tab === "ins" && <div className="pj-note"><p className={`pj-ins ${proj.ins ? "" : "muted"}`}>{proj.ins || "Thêm hướng dẫn để điều chỉnh câu trả lời của Synchro"}</p></div>}
        {tab === "mem" && (mem.length === 0 ? <div className="pj-note"><p className="muted">Bộ nhớ dự án sẽ hiển thị ở đây sau vài đoạn chat.</p></div> : <><div className="bk-head"><span className="bk-head-n">{mem.length} mục</span><BulkButton b={bkM} compact /></div><ul className="pj-mem pj-list">{pgMem.items.map((m) => <li key={m.id} {...bulkRow(bkM, m)}>{bkM.on && <BulkCheck on={bkM.has(m)} />}{m.content}</li>)}</ul><PageBar pg={pgMem} /><BulkBar b={bkM} acts={memActs} noun="mục" /></>)}
        {tab === "skills" && canSkills && <ProjectSkills pid={proj.id} say={say} />}
        {tab === "ctx" && (
          <section className="pj-ctx">
            <input ref={fRef} type="file" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) addFiles(fs); }} />
            {fm.node}
            {upl && <UploadModal say={say} onClose={() => setUpl(false)} onFiles={(f) => { setUpl(false); addFiles(f); }} />}
            {ghOpen && <GitHubImport say={say} onClose={() => setGhOpen(false)} onFiles={(f) => void addFiles(f)} />}
            {sq !== null && ctx.length > 0 && <input className="pj-fsearch" autoFocus placeholder="Tìm kiếm tệp..." value={sq} onChange={(e) => setSq(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setSq(null)} />}
            {ctx.length > 0 && (
              <div className="pj-usage">
                <div className="pj-bar"><i style={{ width: `${Math.max(pct, 1.5)}%` }} /></div>
                <div className="pj-usage-t"><span>Đã dùng {pct}% dung lượng dự án</span><span className="pj-info" data-tip="Tệp và văn bản trong dự án được dùng làm ngữ cảnh cho mọi đoạn chat. Mỗi dự án chứa tối đa 2 triệu ký tự." tabIndex={0}><I.InfoCircle size={16} /></span></div>
              </div>
            )}
            {sel.size > 0 && (
              <div className="pj-selbar">
                <span className="pj-cb on"><I.Check size={12} /></span>
                <span className="pj-sel-n">Đã chọn {sel.size}</span>
                <button className="icon-btn" data-tip={`Xóa ${sel.size} mục đã chọn`} aria-label="Xóa mục đã chọn" onClick={() => delCtx([...sel], () => setSel(new Set()))}><I.Trash size={16} /></button>
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
                    <div key={c.id} className={`pj-file ${sel.has(c.id) ? "is-sel" : ""} ${sel.size ? "selmode" : ""}`} onContextMenu={(e) => fm.open(e, c.name, c.text)} onClick={() => sel.size && toggle(c.id)}>
                      <button className="pj-file-x" aria-label="Xóa" onClick={(e) => { e.stopPropagation(); delCtx([c.id]); }}><I.X size={12} /></button>
                      <b title={c.name}>{c.name}</b>
                      <span>{fmtSize(c.size ?? c.chars ?? 0)}</span>
                      {/* Tệp không trích được chữ (ảnh, PDF scan hỏng): vẫn giữ tệp, nhưng nói rõ để không tưởng model đã đọc. */}
                      {c.chars === 0 && !c.chunks?.length && <span className="pj-file-warn" data-tip="Không trích được chữ từ tệp này nên model không đọc được">Model chưa đọc được</span>}
                      <div className="pj-file-f"><em>{ext}</em><button className={`pj-cb ${sel.has(c.id) ? "on" : ""}`} aria-label="Chọn" onClick={(e) => { e.stopPropagation(); toggle(c.id); }}>{sel.has(c.id) && <I.Check size={12} />}</button></div>
                    </div>
                  );
                })}
                {busyCtx && <div className="pj-file sk"><i /><i /><u /></div>}
                {sq && shownCtx.length === 0 && <p className="muted" style={{ gridColumn: "1/-1" }}>Không tìm thấy tệp</p>}
              </div>
            )}
          </section>
        )}
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
