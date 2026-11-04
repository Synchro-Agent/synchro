"use client";
// Bảng lệnh ⌘K: một ô tìm cho mọi thứ — lệnh nhanh, đoạn chat, artifact, ứng dụng nội bộ, skill và thư viện.
// Tìm không cần gõ dấu ("bao cao" khớp "Báo cáo"), mũi tên lên / xuống để chọn, Enter để mở. Dữ liệu máy chủ tải một lần mỗi lần mở bảng.
import { cachedJson } from "./studios";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as I from "./icons";
import { tr } from "./i18n";
import { useFitPlaceholder } from "./phfit";

export type PaletteCmd = { id: string; label: string; icon: ReactNode; keys?: string; hay?: string; run: () => void };
export type PaletteGo = {
  chat: (id: number) => void;
  artifact: (conv: string, title: string) => void;
  app: (id: string) => void;
  skillHub: (q?: string) => void;
  project: (id: number) => void;
};
export type PaletteProject = { id: number; name: string; desc?: string; archived?: boolean; ctx?: { name: string; kind: string; text?: string }[] };
type Row = { key: string; group: string; label: string; sub?: string; icon: ReactNode; keys?: string; hay: string; run: () => void; more?: boolean };
const PER_GROUP = 6;

const foldRaw = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
// Bỏ dấu tốn thời gian khi nhân với mọi tin của mọi đoạn chat ở từng phím gõ (500 đoạn chat: 300-600 ms trên máy yếu). Chỉ làm một lần: tiêu đề, nhãn nhớ theo chuỗi,
// nội dung tin nhớ theo chính đối tượng tin (tin đã xong không đổi, tin đang viết có đối tượng mới nên tự làm lại).
const shortFold = new Map<string, string>();
const fold = (s: string) => {
  let v = shortFold.get(s);
  if (v === undefined) { v = foldRaw(s); if (shortFold.size > 40_000) shortFold.clear(); shortFold.set(s, v); }
  return v;
};
const textFold = new WeakMap<object, string>();
const foldOf = (o: { text?: string }) => {
  let v = textFold.get(o);
  if (v === undefined) { v = foldRaw(o.text ?? ""); textFold.set(o, v); }
  return v;
};
// Cả đoạn chat gộp lại: từ khóa không có ở đây thì khỏi xét từng tin.
const chatFold = new WeakMap<object, string>();
const foldAll = (msgs: { text: string; files?: string[] }[]) => {
  let v = chatFold.get(msgs);
  if (v === undefined) { v = msgs.map((m) => `${foldOf(m)}\n${(m.files ?? []).map(fold).join("\n")}`).join("\n"); chatFold.set(msgs, v); }
  return v;
};
// Mọi từ của truy vấn đều phải có trong chuỗi; khớp ở đầu tiêu đề xếp trước.
function score(hay: string, q: string[], label: string) {
  if (!q.length) return 1;
  for (const w of q) if (!hay.includes(w)) return 0;
  const l = fold(label);
  return (l.startsWith(q[0]) ? 3 : 0) + (q.every((w) => l.includes(w)) ? 2 : 0) + 1;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (url: string): Promise<any> => fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

type Remote = {
  arts: { conv: string; title: string; type: string }[];
  apps: { id: string; title: string; visibility?: string }[];
  skills: { name: string; description: string }[];
  libs: { name: string; skillCount: number }[];
};

const MAX_SHOWN = 500;
export function CommandPalette({ chats, projects, cmds, go, onClose }: { chats: { id: number; title: string; msgs: { text: string; files?: string[] }[] }[]; projects?: PaletteProject[]; cmds: PaletteCmd[]; go: PaletteGo; onClose: () => void }) {
  const [q, setQ] = useState("");
  // Ô nhập luôn nhận chữ ngay; danh sách lọc lại sau, không chặn phím gõ.
  const dq = useDeferredValue(q);
  const qRef = useRef<HTMLInputElement>(null);
  const ph = useFitPlaceholder(qRef, ["Tìm lệnh, đoạn chat, artifact, skill, tài liệu…", "Tìm lệnh, đoạn chat, skill…", "Tìm kiếm…"]);
  const [sel, setSel] = useState(0);
  const [rem, setRem] = useState<Remote | null>(null);
  // Nhóm đã bấm "Xem tất cả": đổi từ khóa thì thu gọn lại.
  const [open, setOpen] = useState<string[]>([]);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    Promise.all([get("/api/artifacts"), get("/api/apps"), cachedJson<any>("/api/skills"), cachedJson<any>("/api/plugins?view=lite")]).then(([a, ap, sk, pl]) => {
      if (live) setRem({ arts: a.artifacts ?? [], apps: ap.apps ?? [], skills: sk.skills ?? [], libs: pl.plugins ?? [] });
    });
    return () => { live = false; };
  }, []);

  // Thư viện từ danh mục Claude (hàng nghìn tên) không tải sẵn: gõ từ 2 chữ thì hỏi máy chủ, chậm lại một nhịp để gõ mượt.
  const [catLibs, setCatLibs] = useState<Remote["libs"]>([]);
  useEffect(() => {
    const k = q.trim();
    if (k.length < 2) { setCatLibs([]); return; }
    let live = true;
    const t = setTimeout(() => { get(`/api/plugins?view=lite&q=${encodeURIComponent(k)}`).then((j) => { if (live) setCatLibs(j.plugins ?? []); }); }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const { rows, cuts } = useMemo(() => {
    const out: Row[] = [];
    const cuts: Record<string, number> = {};
    const words = fold(dq).split(/\s+/).filter(Boolean);
    // Một ký tự khớp gần như mọi tin: chỉ tìm trong tiêu đề.
    const deep = words.join("").length >= 2;
    const add = (r: Omit<Row, "hay"> & { hay?: string }) => out.push({ ...r, hay: fold(`${r.label} ${r.sub ?? ""} ${r.hay ?? ""}`) });
    for (const c of cmds) add({ key: "cmd:" + c.id, group: "Lệnh", label: c.label, icon: c.icon, keys: c.keys, hay: c.hay, run: c.run });
    for (const c of chats) {
      const any = deep && words.every((w) => foldAll(c.msgs).includes(w));
      const hit = any ? c.msgs.find((m) => words.every((w) => foldOf(m).includes(w)))?.text : undefined;
      // Tìm cả tên tệp đã đính kèm trong đoạn chat.
      const tl = deep ? fold(c.title) : "";
      const file = deep && !hit && (any || words.some((w) => tl.includes(w))) ? c.msgs.flatMap((m) => m.files ?? []).find((f) => words.every((w) => `${tl} ${fold(f)}`.includes(w))) : undefined;
      add({ key: "chat:" + c.id, group: "Đoạn chat", label: c.title, sub: hit ? hit.replace(/\s+/g, " ").slice(0, 80) : file, icon: file ? <I.Clip size={16} /> : <I.History size={16} />, hay: hit ?? file, run: () => go.chat(c.id) });
    }
    // Dự án và tài liệu trong dự án (tên tệp, nội dung văn bản): mở trang dự án.
    if (deep) for (const p of projects ?? []) {
      if (p.archived) continue;
      const doc = (p.ctx ?? []).find((d) => words.every((w) => `${fold(p.name)} ${fold(d.name)}`.includes(w) || ((d.text?.length ?? 0) < 400_000 && foldOf(d).includes(w))));
      add({ key: "proj:" + p.id, group: "Dự án", label: p.name, sub: doc?.name ?? p.desc?.slice(0, 80), icon: doc ? <I.Clip size={16} /> : <I.Folder size={16} />, hay: doc ? words.join(" ") : undefined, run: () => go.project(p.id) });
    }
    if (rem) {
      for (const a of rem.arts) add({ key: `art:${a.conv}:${a.title}`, group: "Artifact và ứng dụng", label: a.title, sub: tr("Artifact"), icon: <I.Shapes size={16} />, run: () => go.artifact(a.conv, a.title) });
      for (const a of rem.apps) add({ key: "app:" + a.id, group: "Artifact và ứng dụng", label: a.title, sub: tr(a.visibility === "org" ? "Ứng dụng dùng chung" : "Ứng dụng"), icon: <I.GetApps size={16} />, run: () => go.app(a.id) });
      for (const s of rem.skills) add({ key: "skill:" + s.name, group: "Skill và thư viện", label: s.name, sub: s.description.slice(0, 90), icon: <I.Scroll size={16} />, run: () => go.skillHub(s.name) });
      for (const l of [...rem.libs, ...catLibs]) add({ key: "lib:" + l.name, group: "Skill và thư viện", label: l.name, sub: `${tr("Thư viện")} · ${l.skillCount} skill`, icon: <I.Plugins size={16} />, run: () => go.skillHub(l.name) });
    }
    // Chưa gõ gì: lệnh và vài đoạn chat gần đây. Đã gõ: mọi nhóm, mỗi nhóm trước tiên hiện 6 kết quả kèm dòng "Xem tất cả N kết quả", nhóm theo thứ tự cố định.
    if (!words.length) return { cuts, rows: [...out.filter((r) => r.group === "Lệnh"), ...out.filter((r) => r.group === "Đoạn chat").slice(0, PER_GROUP)] };
    const order = ["Lệnh", "Đoạn chat", "Dự án", "Artifact và ứng dụng", "Skill và thư viện"];
    const scored = out.map((r) => ({ r, s: score(r.hay, words, r.label) })).filter((x) => x.s > 0);
    const rows = order.flatMap((g): Row[] => {
      const l = scored.filter((x) => x.r.group === g).sort((a, b) => b.s - a.s).map((x) => x.r);
      if (l.length <= PER_GROUP || open.includes(g)) { if (l.length > MAX_SHOWN) cuts[g] = l.length; return l.slice(0, MAX_SHOWN); }
      return [...l.slice(0, PER_GROUP), { key: "more:" + g, group: g, label: `${tr("Xem tất cả")} ${l.length} ${tr("kết quả")}`, icon: <I.Search size={16} />, hay: "", more: true, run: () => setOpen((o) => [...o, g]) }];
    });
    return { rows, cuts };
  }, [dq, chats, projects, cmds, rem, catLibs, go, open]);

  useEffect(() => { setSel(0); setOpen([]); }, [dq]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const run = (r?: Row) => { if (!r) return; if (r.more) { r.run(); return; } onClose(); r.run(); };

  let last = "";
  return (
    <div className="overlay top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal search pal" style={{ width: "min(640px, calc(100vw - 24px))" }} role="dialog" aria-label={tr("Bảng lệnh")}>
        <div className="s-box"><I.Search size={18} />
          <input ref={qRef} autoFocus placeholder={tr(ph)} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Tìm kiếm")}
            role="combobox" aria-expanded={rows.length > 0} aria-autocomplete="list" aria-controls="pal-list" aria-activedescendant={rows[sel] ? `pal-o-${sel}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((sel + 1) % Math.max(rows.length, 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((sel - 1 + rows.length) % Math.max(rows.length, 1)); }
              else if (e.key === "Enter") { e.preventDefault(); run(rows[sel]); }
              else if (e.key === "Escape") onClose();
            }} />
          {!rem && <span className="art-spin sm" />}
        </div>
        <div className="s-list" ref={list} id="pal-list" role="listbox" aria-label={tr("Kết quả")}>
          {rows.map((r, i) => {
            const head = r.group !== last ? (last = r.group) : null;
            return (
              <div key={r.key} role="presentation">
                {head && <div className="pal-g" role="presentation">{tr(head)}</div>}
                <button id={`pal-o-${i}`} role="option" aria-selected={i === sel} tabIndex={-1} data-i={i} className={`s-row ${i === sel ? "on" : ""}`} onMouseMove={() => sel !== i && setSel(i)} onClick={() => run(r)}>
                  <span className="pal-i">{r.icon}</span>
                  <span className="pal-t"><span data-notr={r.group === "Lệnh" || r.more ? undefined : true}>{r.label}</span>{r.sub && <span className="muted" data-notr> — {r.sub}</span>}</span>
                  {r.keys && <kbd className="pal-k">{r.keys}</kbd>}
                  {i === sel && <I.Enter size={14} />}
                </button>
                {cuts[r.group] && rows[i + 1]?.group !== r.group ? <div className="pal-cut" role="presentation">{tr("Đang hiện")} {MAX_SHOWN} / {cuts[r.group]} {tr("kết quả")}. {tr("Gõ thêm để thu hẹp.")}</div> : null}
              </div>
            );
          })}
          {dq && rows.length === 0 && <div className="muted" role="status" style={{ padding: 16, textAlign: "center", fontSize: 14 }}>{tr("Không tìm thấy kết quả")}</div>}
        </div>
        <div className="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd>{tr("chọn")}</span><span><kbd>↵</kbd>{tr("mở")}</span><span><kbd>esc</kbd>{tr("đóng")}</span></div>
      </div>
    </div>
  );
}
