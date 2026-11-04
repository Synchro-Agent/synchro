"use client";
// Bảng lệnh ⌘K: một ô tìm cho mọi thứ — lệnh nhanh, đoạn chat, artifact, ứng dụng nội bộ, skill và thư viện.
// Tìm không cần gõ dấu ("bao cao" khớp "Báo cáo"), mũi tên lên / xuống để chọn, Enter để mở. Dữ liệu máy chủ tải một lần mỗi lần mở bảng.
import { cachedJson } from "./studios";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as I from "./icons";
import { tr } from "./i18n";
import { useFitPlaceholder } from "./phfit";

export type PaletteCmd = { id: string; label: string; icon: ReactNode; keys?: string; hay?: string; run: () => void };
export type PaletteGo = {
  chat: (id: number) => void;
  artifact: (conv: string, title: string) => void;
  app: (id: string) => void;
  /** name: mở Kho kỹ năng lọc sẵn theo skill / thư viện này. */
  skillHub: (name?: string) => void;
};
type Row = { key: string; group: string; label: string; sub?: string; icon: ReactNode; keys?: string; hay: string; run: () => void };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
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

export function CommandPalette({ chats, cmds, go, onClose }: { chats: { id: number; title: string; msgs: { text: string }[] }[]; cmds: PaletteCmd[]; go: PaletteGo; onClose: () => void }) {
  const [q, setQ] = useState("");
  const qRef = useRef<HTMLInputElement>(null);
  const ph = useFitPlaceholder(qRef, ["Tìm lệnh, đoạn chat, artifact, skill, tài liệu…", "Tìm lệnh, đoạn chat, skill…", "Tìm kiếm…"]);
  const [sel, setSel] = useState(0);
  const [rem, setRem] = useState<Remote | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    Promise.all([get("/api/artifacts"), get("/api/apps"), cachedJson<any>("/api/skills"), cachedJson<any>("/api/plugins?view=lite")]).then(([a, ap, sk, pl]) => {
      if (live) setRem({ arts: a.artifacts ?? [], apps: ap.apps ?? [], skills: sk.skills ?? [], libs: pl.plugins ?? [] });
    });
    return () => { live = false; };
  }, []);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const words = fold(q).split(/\s+/).filter(Boolean);
    const add = (r: Omit<Row, "hay"> & { hay?: string }) => out.push({ ...r, hay: fold(`${r.label} ${r.sub ?? ""} ${r.hay ?? ""}`) });
    for (const c of cmds) add({ key: "cmd:" + c.id, group: "Lệnh", label: c.label, icon: c.icon, keys: c.keys, hay: c.hay, run: c.run });
    for (const c of chats) {
      const hit = words.length ? c.msgs.find((m) => words.every((w) => fold(m.text).includes(w)))?.text : undefined;
      add({ key: "chat:" + c.id, group: "Đoạn chat", label: c.title, sub: hit ? hit.replace(/\s+/g, " ").slice(0, 80) : undefined, icon: <I.History size={16} />, hay: hit, run: () => go.chat(c.id) });
    }
    if (rem) {
      for (const a of rem.arts) add({ key: `art:${a.conv}:${a.title}`, group: "Artifact và ứng dụng", label: a.title, sub: tr("Artifact"), icon: <I.Shapes size={16} />, run: () => go.artifact(a.conv, a.title) });
      for (const a of rem.apps) add({ key: "app:" + a.id, group: "Artifact và ứng dụng", label: a.title, sub: tr(a.visibility === "org" ? "Ứng dụng của tổ chức" : "Ứng dụng"), icon: <I.GetApps size={16} />, run: () => go.app(a.id) });
      for (const s of rem.skills) add({ key: "skill:" + s.name, group: "Skill và thư viện", label: s.name, sub: s.description.slice(0, 90), icon: <I.Scroll size={16} />, run: () => go.skillHub(s.name) });
      for (const l of rem.libs) add({ key: "lib:" + l.name, group: "Skill và thư viện", label: l.name, sub: `${tr("Thư viện")} · ${l.skillCount} skill`, icon: <I.Plugins size={16} />, run: () => go.skillHub(l.name) });
    }
    // Chưa gõ gì: lệnh và vài đoạn chat gần đây. Đã gõ: mọi nhóm, mỗi nhóm tối đa 6 kết quả, nhóm theo thứ tự cố định.
    if (!words.length) return [...out.filter((r) => r.group === "Lệnh"), ...out.filter((r) => r.group === "Đoạn chat").slice(0, 6)];
    const order = ["Lệnh", "Đoạn chat", "Artifact và ứng dụng", "Skill và thư viện"];
    const scored = out.map((r) => ({ r, s: score(r.hay, words, r.label) })).filter((x) => x.s > 0);
    return order.flatMap((g) => scored.filter((x) => x.r.group === g).sort((a, b) => b.s - a.s).slice(0, 6).map((x) => x.r));
  }, [q, chats, cmds, rem, go]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const run = (r?: Row) => { if (!r) return; onClose(); r.run(); };

  let last = "";
  return (
    <div className="overlay top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal search pal" style={{ width: "min(640px, calc(100vw - 24px))" }} role="dialog" aria-label={tr("Bảng lệnh")}>
        <div className="s-box"><I.Search size={18} />
          <input ref={qRef} autoFocus placeholder={tr(ph)} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Tìm kiếm")}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((sel + 1) % Math.max(rows.length, 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((sel - 1 + rows.length) % Math.max(rows.length, 1)); }
              else if (e.key === "Enter") { e.preventDefault(); run(rows[sel]); }
              else if (e.key === "Escape") onClose();
            }} />
          {!rem && <span className="art-spin sm" />}
        </div>
        <div className="s-list" ref={list}>
          {rows.map((r, i) => {
            const head = r.group !== last ? (last = r.group) : null;
            return (
              <div key={r.key}>
                {head && <div className="pal-g">{tr(head)}</div>}
                <button data-i={i} className={`s-row ${i === sel ? "on" : ""}`} onMouseMove={() => sel !== i && setSel(i)} onClick={() => run(r)}>
                  <span className="pal-i">{r.icon}</span>
                  <span className="pal-t"><span data-notr={r.group === "Lệnh" ? undefined : true}>{r.label}</span>{r.sub && <span className="muted" data-notr> — {r.sub}</span>}</span>
                  {r.keys && <kbd className="pal-k">{r.keys}</kbd>}
                  {i === sel && <I.Enter size={14} />}
                </button>
              </div>
            );
          })}
          {q && rows.length === 0 && <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 14 }}>{tr("Không tìm thấy kết quả")}</div>}
        </div>
        <div className="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd>{tr("chọn")}</span><span><kbd>↵</kbd>{tr("mở")}</span><span><kbd>esc</kbd>{tr("đóng")}</span></div>
      </div>
    </div>
  );
}
