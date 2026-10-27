"use client";
// Cài đặt → Bộ não: bộ não tổng hợp của Synchro, liên kết thông tin theo cách của Obsidian.
// - Đồ thị: mỗi chấm là một ghi chú, mỗi đường là một [[liên kết]]; chấm càng nhiều liên kết càng to. Rê chuột để sáng các mối nối,
//   bấm để mở ghi chú, kéo để sắp lại, cuộn để phóng to; lọc theo loại, tìm theo tên, phát lại quá trình bộ não hình thành.
// - Ghi chú: nội dung với [[liên kết]] bấm được, "Liên kết đến đây" (backlink), "Nhắc tới mà chưa nối", đồ thị quanh ghi chú.
// - Ký ức: ký ức dài hạn rút từ đoạn chat (bộ nhớ cũ), bật tắt học.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as I from "./icons";
import { useApp } from "./store";
import { getLang } from "./i18n";

type Kind = "hub" | "about" | "model" | "chat" | "code" | "topic" | "skill" | "connector" | "note" | "ghost";
type GNode = { id: string; title: string; kind: Kind; tags: string[]; created: number; links: number };
type Graph = { nodes: GNode[]; edges: { s: string; t: string }[]; stats: { notes: number; links: number; chats: number; topics: number; pending: number; memories: number }; cfg: { gen: boolean; sens: boolean } };
type NoteData = {
  note: { id: string; kind: Kind; title: string; body: string; props: { date?: number; models?: Record<string, number>; userNote?: string; importance?: number; turns?: number }; createdAt: number; updatedAt: number; editable: boolean; generated: boolean; tags: string[] };
  outgoing: { title: string; exists: boolean }[]; backlinks: { title: string; kind: Kind; context: string }[]; unlinked: { title: string; kind: Kind; context: string }[];
};

const en = () => getLang() === "en";
const L = (vi: string, e: string) => (en() ? e : vi);
const KIND: Record<Kind, [string, string]> = {
  hub: ["Trung tâm", "Hub"], about: ["Về bạn", "About you"], model: ["Bán cầu", "Hemisphere"], chat: ["Đoạn chat", "Chat"], code: ["Synchro Code", "Synchro Code"],
  topic: ["Chủ đề", "Topic"], skill: ["Skill", "Skill"], connector: ["Connector", "Connector"], note: ["Ghi chú của bạn", "Your note"], ghost: ["Chưa có ghi chú", "Not created yet"],
};
// Màu theo loại ghi chú (bán cầu theo màu hãng); đọc từ biến CSS để đúng cả giao diện sáng và tối.
const COLOR_VAR: Record<Kind, string> = { hub: "--bn-hub", about: "--bn-about", model: "--bn-model", chat: "--bn-chat", code: "--bn-code", topic: "--bn-topic", skill: "--bn-tool", connector: "--bn-tool", note: "--bn-note", ghost: "--bn-ghost" };
const HEMI_VAR: Record<string, string> = { Claude: "--vc-claude", ChatGPT: "--vc-gpt", Gemini: "--vc-gemini" };
const FILTERS: { k: string; kinds: Kind[]; label: [string, string] }[] = [
  { k: "chat", kinds: ["chat", "code"], label: ["Đoạn chat", "Chats"] }, { k: "topic", kinds: ["topic"], label: ["Chủ đề", "Topics"] },
  { k: "tool", kinds: ["skill", "connector"], label: ["Skill & connector", "Skills & connectors"] }, { k: "note", kinds: ["note"], label: ["Ghi chú riêng", "Your notes"] },
  { k: "ghost", kinds: ["ghost"], label: ["Chưa có ghi chú", "Not created yet"] },
];
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
const dateStr = (ms: number) => new Date(ms).toLocaleDateString(en() ? "en-US" : "vi-VN", { day: "numeric", month: "short", year: "numeric" });

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Lỗi ${r.status}`);
  return j as T;
}

// ---------------------------------------------------------------- đồ thị (canvas, mô phỏng lực như Obsidian)
type P = { x: number; y: number; vx: number; vy: number; fixed?: boolean };
const radius = (n: GNode) => (n.kind === "hub" ? 11 : n.kind === "model" ? 8 : n.kind === "about" ? 6.5 : 3.2 + Math.min(7, Math.sqrt(n.links) * 1.5));

export function BrainGraph({ data, onOpen, focus, depth = 1, height = 420, hidden, query, cutoff, active }: {
  data: Graph; onOpen: (title: string, ghost: boolean) => void; focus?: string | null; depth?: number; height?: number | string; hidden?: Set<Kind>; query?: string; cutoff?: number | null; active?: string | null;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const pos = useRef(new Map<string, P>());
  const view = useRef({ k: 1, x: 0, y: 0 });
  const alpha = useRef(1);
  const hover = useRef<string | null>(null);
  const raf = useRef(0);
  const colors = useRef<Record<string, string>>({});
  // Đồ thị quanh một ghi chú: chỉ các ghi chú cách nó tối đa `depth` liên kết.
  const { nodes, edges } = useMemo(() => {
    let ns = data.nodes.filter((n) => !hidden?.has(n.kind) && (cutoff == null || n.created <= cutoff));
    if (focus) {
      const start = data.nodes.find((n) => n.title === focus)?.id;
      const keep = new Set(start ? [start] : []);
      for (let d = 0; d < depth; d++) for (const e of data.edges) { if (keep.has(e.s)) keep.add(e.t); else if (keep.has(e.t)) keep.add(e.s); }
      ns = ns.filter((n) => keep.has(n.id));
    }
    const ids = new Set(ns.map((n) => n.id));
    return { nodes: ns, edges: data.edges.filter((e) => ids.has(e.s) && ids.has(e.t)) };
  }, [data, focus, depth, hidden, cutoff]);
  const nbr = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) { (m.get(e.s) ?? m.set(e.s, new Set()).get(e.s)!).add(e.t); (m.get(e.t) ?? m.set(e.t, new Set()).get(e.t)!).add(e.s); }
    return m;
  }, [edges]);
  const q = fold(query ?? "");

  const readColors = useCallback(() => {
    const el = cv.current;
    if (!el) return;
    const cs = getComputedStyle(el), c: Record<string, string> = {};
    for (const v of [...Object.values(COLOR_VAR), ...Object.values(HEMI_VAR), "--bn-edge", "--bn-label", "--bn-label-bg", "--bn-ring"]) c[v] = cs.getPropertyValue(v).trim() || "#888";
    colors.current = c;
  }, []);
  const colorOf = (n: GNode) => colors.current[n.kind === "model" ? HEMI_VAR[n.title] ?? COLOR_VAR.model : COLOR_VAR[n.kind]];

  // Vị trí ban đầu: trung tâm ở giữa, bán cầu quanh trung tâm, còn lại rải theo vòng; giữ vị trí cũ khi dữ liệu đổi.
  useEffect(() => {
    const P0 = pos.current, n = nodes.length;
    nodes.forEach((nd, i) => {
      if (P0.has(nd.id)) return;
      const a = (i / Math.max(1, n)) * Math.PI * 2, r = nd.kind === "hub" ? 0 : nd.kind === "model" || nd.kind === "about" ? 70 : 140 + (i % 5) * 18;
      P0.set(nd.id, { x: Math.cos(a) * r + (Math.random() - 0.5) * 10, y: Math.sin(a) * r + (Math.random() - 0.5) * 10, vx: 0, vy: 0 });
    });
    alpha.current = Math.max(alpha.current, 0.8);
  }, [nodes]);

  const draw = useCallback(() => {
    const el = cv.current;
    if (!el) return;
    const ctx = el.getContext("2d")!, dpr = window.devicePixelRatio || 1, w = el.clientWidth, h = el.clientHeight;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); }
    const { k, x: tx, y: ty } = view.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2 + tx, h / 2 + ty); ctx.scale(k, k);
    const P0 = pos.current, hv = hover.current ?? active ?? null, near = hv ? nbr.get(hv) : null;
    const lit = (id: string) => !hv || id === hv || !!near?.has(id);
    const match = (nd: GNode) => !q || fold(nd.title).includes(q);
    ctx.lineWidth = 1 / k;
    for (const e of edges) {
      const a = P0.get(e.s), b = P0.get(e.t);
      if (!a || !b) continue;
      const on = hv && (e.s === hv || e.t === hv);
      ctx.strokeStyle = colors.current["--bn-edge"]; ctx.globalAlpha = on ? 0.95 : hv ? 0.12 : 0.5; ctx.lineWidth = (on ? 1.6 : 1) / k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const few = nodes.length <= 12;
    for (const nd of nodes) {
      const p = P0.get(nd.id);
      if (!p) continue;
      const r = radius(nd), on = lit(nd.id) && match(nd);
      ctx.globalAlpha = on ? 1 : 0.18;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (nd.kind === "ghost") { ctx.strokeStyle = colorOf(nd); ctx.lineWidth = 1.2 / k; ctx.stroke(); }
      else { ctx.fillStyle = colorOf(nd); ctx.fill(); }
      if (nd.id === hv || nd.title === active) { ctx.strokeStyle = colors.current["--bn-ring"]; ctx.lineWidth = 2 / k; ctx.beginPath(); ctx.arc(p.x, p.y, r + 3 / k, 0, Math.PI * 2); ctx.stroke(); }
      // Nhãn: luôn hiện với trung tâm, bán cầu, chủ đề và khi đang rê; còn lại hiện khi phóng to (như "text fade" của Obsidian).
      const show = few || nd.kind === "hub" || nd.kind === "model" || nd.kind === "topic" || nd.kind === "about" || nd.id === hv || !!near?.has(nd.id) || k > 1.6 || (!!q && match(nd));
      if (show && on) {
        const fs = 11 / k, label = nd.title.length > 34 ? `${nd.title.slice(0, 33)}…` : nd.title;
        ctx.font = `${nd.kind === "hub" ? 600 : 450} ${fs}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        const tw = ctx.measureText(label).width;
        ctx.globalAlpha = 0.85; ctx.fillStyle = colors.current["--bn-label-bg"]; ctx.fillRect(p.x - tw / 2 - 2 / k, p.y + r + 2 / k, tw + 4 / k, fs + 3 / k);
        ctx.globalAlpha = 1; ctx.fillStyle = colors.current["--bn-label"]; ctx.fillText(label, p.x, p.y + r + 3 / k);
      }
    }
    ctx.globalAlpha = 1;
  }, [nodes, edges, nbr, q, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mô phỏng lực: đẩy nhau, kéo theo liên kết, hút về giữa; dừng khi đã ổn định.
  const fitted = useRef(false);
  const fit = useCallback(() => {
    const el = cv.current, ps = nodes.map((n) => pos.current.get(n.id)).filter((p): p is P => !!p);
    if (!el || !ps.length) return;
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const k = Math.min(1.6, Math.max(0.3, Math.min(el.clientWidth / (maxX - minX + 120), el.clientHeight / (maxY - minY + 90))));
    view.current = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k };
    fitted.current = true;
  }, [nodes]);
  const tick = useCallback(() => {
    const P0 = pos.current, list = nodes.map((n) => [n, P0.get(n.id)!] as const).filter(([, p]) => p);
    const a = alpha.current;
    if (a > 0.004) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const p = list[i][1], o = list[j][1];
        let dx = p.x - o.x, dy = p.y - o.y, d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
        const f = Math.min(10, 2600 / d2) * a, d = Math.sqrt(d2);
        p.vx += (dx / d) * f; p.vy += (dy / d) * f; o.vx -= (dx / d) * f; o.vy -= (dy / d) * f;
      }
      for (const e of edges) {
        const p = P0.get(e.s), o = P0.get(e.t);
        if (!p || !o) continue;
        const dx = o.x - p.x, dy = o.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 78) * 0.025 * a;
        p.vx += (dx / d) * f; p.vy += (dy / d) * f; o.vx -= (dx / d) * f; o.vy -= (dy / d) * f;
      }
      for (const [n, p] of list) {
        p.vx -= p.x * 0.012 * a * (n.kind === "hub" ? 6 : 1); p.vy -= p.y * 0.012 * a * (n.kind === "hub" ? 6 : 1);
        if (p.fixed) { p.vx = 0; p.vy = 0; continue; }
        p.vx *= 0.82; p.vy *= 0.82; p.x += p.vx; p.y += p.vy;
      }
      alpha.current = a * 0.985;
      // Lần đầu ổn định: tự căn để thấy toàn bộ đồ thị (cho tới khi người dùng tự kéo / phóng to).
      if (alpha.current < 0.06 && !fitted.current && list.length) fit();
    }
    draw();
    raf.current = requestAnimationFrame(tick);
  }, [nodes, edges, draw, fit]);
  useEffect(() => {
    readColors();
    raf.current = requestAnimationFrame(tick);
    const mo = new MutationObserver(() => { readColors(); draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => { cancelAnimationFrame(raf.current); mo.disconnect(); };
  }, [tick, readColors, draw]);

  // Chuột: rê để sáng mối nối, kéo chấm để sắp lại, kéo nền để di chuyển, cuộn để phóng to, bấm để mở ghi chú.
  const toWorld = (cx: number, cy: number) => {
    const el = cv.current!, b = el.getBoundingClientRect(), { k, x, y } = view.current;
    return { x: (cx - b.left - el.clientWidth / 2 - x) / k, y: (cy - b.top - el.clientHeight / 2 - y) / k };
  };
  const hit = (cx: number, cy: number) => {
    const w = toWorld(cx, cy), k = view.current.k;
    let best: string | null = null, bd = Infinity;
    for (const n of nodes) { const p = pos.current.get(n.id); if (!p) continue; const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < radius(n) + 6 / k && d < bd) { bd = d; best = n.id; } }
    return best;
  };
  const drag = useRef<{ id: string | null; sx: number; sy: number; moved: boolean; vx: number; vy: number } | null>(null);
  const down = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const id = hit(e.clientX, e.clientY);
    drag.current = { id, sx: e.clientX, sy: e.clientY, moved: false, vx: view.current.x, vy: view.current.y };
    fitted.current = true;
    if (id) { pos.current.get(id)!.fixed = true; alpha.current = Math.max(alpha.current, 0.3); }
  };
  const move = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) { const id = hit(e.clientX, e.clientY); if (id !== hover.current) { hover.current = id; draw(); } (e.target as HTMLElement).style.cursor = id ? "pointer" : "grab"; return; }
    if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 3) g.moved = true;
    if (g.id) { const w = toWorld(e.clientX, e.clientY), p = pos.current.get(g.id)!; p.x = w.x; p.y = w.y; alpha.current = Math.max(alpha.current, 0.25); }
    else { view.current.x = g.vx + e.clientX - g.sx; view.current.y = g.vy + e.clientY - g.sy; draw(); }
  };
  const up = () => {
    const g = drag.current;
    drag.current = null;
    if (!g) return;
    if (g.id) pos.current.get(g.id)!.fixed = false;
    if (g.id && !g.moved) { const n = nodes.find((x) => x.id === g.id); if (n) onOpen(n.title, n.kind === "ghost"); }
  };
  useEffect(() => {
    const el = cv.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current, b = el.getBoundingClientRect(), mx = e.clientX - b.left - el.clientWidth / 2, my = e.clientY - b.top - el.clientHeight / 2;
      const k2 = Math.min(4, Math.max(0.25, v.k * Math.exp(-e.deltaY * 0.0015)));
      v.x = mx - ((mx - v.x) * k2) / v.k; v.y = my - ((my - v.y) * k2) / v.k; v.k = k2;
      fitted.current = true;
      draw();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [draw]);
  const zoom = (f: number) => { const v = view.current; v.k = Math.min(4, Math.max(0.25, v.k * f)); v.x *= f; v.y *= f; draw(); };
  return (
    <div className="bn-graph" style={{ height }}>
      <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => { if (!drag.current) { hover.current = null; draw(); } }}
        role="img" aria-label={L(`Đồ thị bộ não: ${nodes.length} ghi chú, ${edges.length} liên kết`, `Brain graph: ${nodes.length} notes, ${edges.length} links`)} />
      <div className="bn-zoom">
        <button className="icon-btn" aria-label={L("Phóng to", "Zoom in")} onClick={() => zoom(1.25)}><I.Plus size={14} /></button>
        <button className="icon-btn" aria-label={L("Thu nhỏ", "Zoom out")} onClick={() => zoom(0.8)}><I.Minus size={14} /></button>
        <button className="icon-btn" aria-label={L("Vừa khung", "Fit to view")} onClick={() => { fit(); draw(); }}><I.Retry size={13} /></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- nội dung ghi chú: Markdown gọn với [[liên kết]] và #thẻ
function Inline({ t, exists, onOpen }: { t: string; exists: Set<string>; onOpen: (title: string) => void }) {
  const parts = t.split(/(\[\[[^\]\n]+\]\]|\*\*[^*]+\*\*|`[^`]+`|(?:^|(?<=\s))#[\p{L}\p{N}][\p{L}\p{N}_\-/]*)/gu).filter((x) => x !== undefined && x !== "");
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(p);
        if (m) { const title = m[1].trim(), ok = exists.has(fold(title)); return <button key={i} type="button" className={`bn-link ${ok ? "" : "ghost"}`} data-notr title={ok ? title : L("Chưa có ghi chú này. Bấm để tạo.", "This note doesn't exist yet. Click to create it.")} onClick={() => onOpen(title)}>{m[2]?.trim() || title}</button>; }
        if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return <code key={i} className="ic">{p.slice(1, -1)}</code>;
        if (/^#[\p{L}\p{N}]/u.test(p)) return <span key={i} className="bn-tag" data-notr>{p}</span>;
        return <span key={i} data-notr>{p}</span>;
      })}
    </>
  );
}
function NoteMd({ text, exists, onOpen }: { text: string; exists: Set<string>; onOpen: (title: string) => void }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: { box: boolean; t: string }[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`} className="bn-ul">{list.map((x, i) => <li key={i} className={x.box ? "box" : ""}>{x.box && <span className="bn-box" aria-hidden />}<Inline t={x.t} exists={exists} onOpen={onOpen} /></li>)}</ul>); list = []; } };
  for (const l of lines) {
    const li = /^\s*[-*]\s+(\[ \]\s+)?(.*)$/.exec(l);
    if (li) { list.push({ box: !!li[1], t: li[2] }); continue; }
    flush();
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) out.push(<div key={out.length} className={`bn-h h${h[1].length}`}><Inline t={h[2]} exists={exists} onOpen={onOpen} /></div>);
    else if (l.trim()) out.push(<p key={out.length} className="bn-p"><Inline t={l} exists={exists} onOpen={onOpen} /></p>);
  }
  flush();
  return <div className="bn-md">{out}</div>;
}

function NoteView({ title, graph, onOpen, onClose, onChanged }: { title: string; graph: Graph; onOpen: (t: string) => void; onClose: () => void; onChanged: () => void }) {
  const say = useApp().say;
  const [d, setD] = useState<NoteData | null>(null);
  const [missing, setMissing] = useState(false);
  const [edit, setEdit] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const exists = useMemo(() => new Set(graph.nodes.filter((n) => n.kind !== "ghost").map((n) => fold(n.title))), [graph]);
  useEffect(() => {
    setD(null); setEdit(null); setMissing(false);
    fetch(`/api/brain/note?title=${encodeURIComponent(title)}`, { cache: "no-store" }).then(async (r) => { if (r.status === 404) { setMissing(true); return; } setD(await r.json()); }).catch(() => {});
  }, [title, graph]);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const body = missing ? { title, newTitle: edit.title || title, body: edit.body } : d!.note.generated ? { title, userNote: edit.body } : { title, newTitle: edit.title, body: edit.body };
      const j = await api<NoteData>("PUT", "/api/brain/note", body);
      setD(j); setEdit(null); setMissing(false); onChanged();
      if (j.note.title !== title) onOpen(j.note.title);
      say(L("Đã lưu ghi chú", "Note saved"));
    } catch (e) { say((e as Error).message); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!d || !confirm(L(`Xóa ghi chú “${d.note.title}”? Các liên kết tới nó sẽ thành ghi chú chưa có.`, `Delete “${d.note.title}”? Links to it will point to a note that doesn't exist.`))) return;
    try { await api("DELETE", `/api/brain/note?title=${encodeURIComponent(d.note.title)}`); onChanged(); onClose(); say(L("Đã xóa ghi chú", "Note deleted")); } catch (e) { say((e as Error).message); }
  };
  const n = d?.note;
  return (
    <section className="bn-note" aria-label={title}>
      <div className="bn-note-h">
        {n && <span className={`bn-kind k-${n.kind}`}>{KIND[n.kind][en() ? 1 : 0]}</span>}
        {missing && <span className="bn-kind k-ghost">{KIND.ghost[en() ? 1 : 0]}</span>}
        <span className="bn-note-x">
          {(n || missing) && !edit && <button className="btn sm" onClick={() => setEdit(missing ? { title, body: "" } : { title: n!.title, body: n!.generated ? n!.props.userNote ?? "" : n!.body })}><I.Pencil size={13} />{missing ? L("Tạo ghi chú", "Create note") : n!.generated ? L("Thêm ghi chú của bạn", "Add your note") : L("Sửa", "Edit")}</button>}
          {n && n.editable && !edit && n.kind !== "about" && <button className="icon-btn" aria-label={L("Xóa ghi chú", "Delete note")} onClick={del}><I.Trash size={14} /></button>}
          <button className="icon-btn" aria-label={L("Đóng", "Close")} onClick={onClose}><I.X size={15} /></button>
        </span>
      </div>
      <h2 className="bn-title" data-notr>{n?.title ?? title}</h2>
      {n && <div className="bn-meta">
        <span>{L("Tạo", "Created")} {dateStr(n.createdAt)}</span>{n.updatedAt - n.createdAt > 60_000 && <span>{L("Cập nhật", "Updated")} {dateStr(n.updatedAt)}</span>}
        {n.props.turns ? <span>{n.props.turns} {L("tin nhắn", "messages")}</span> : null}
        {n.tags.map((t) => <span key={t} className="bn-tag" data-notr>#{t}</span>)}
      </div>}
      {!d && !missing && <div className="us-empty"><span className="art-spin sm" /></div>}
      {missing && !edit && <p className="d">{L("Ghi chú này chưa có: các ghi chú khác đang trỏ tới nó. Tạo ghi chú để viết về nó; các liên kết sẽ tự nối vào.", "This note doesn't exist yet, but other notes link to it. Create it and those links connect automatically.")}</p>}
      {edit ? (
        <div className="bn-edit">
          {(missing || (n && !n.generated)) && <input className="field" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label={L("Tên ghi chú", "Note title")} />}
          <textarea className="textarea" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={9}
            placeholder={L("Viết bằng Markdown. Gõ [[Tên ghi chú]] để nối tới ghi chú khác, #thẻ để gắn thẻ.", "Write in Markdown. Type [[Note name]] to link another note, #tag to tag it.")} />
          {n?.generated && <p className="d">{L("Synchro tự viết phần còn lại của ghi chú này từ các đoạn chat; phần bạn viết nằm ở mục “Ghi chú của bạn”.", "Synchro writes the rest of this note from your chats; what you write goes under “Your note”.")}</p>}
          <div className="bn-edit-a"><button className="btn" onClick={() => setEdit(null)} disabled={busy}>{L("Hủy", "Cancel")}</button><button className="btn dark" onClick={save} disabled={busy}>{busy ? <span className="art-spin sm" /> : null}{L("Lưu", "Save")}</button></div>
        </div>
      ) : n && <NoteMd text={n.body} exists={exists} onOpen={onOpen} />}
      {d && (
        <>
          <div className="bn-sec">
            <b>{L("Liên kết đến đây", "Linked mentions")} <em>{d.backlinks.length}</em></b>
            {d.backlinks.length ? d.backlinks.map((b) => (
              <div key={b.title} className="bn-ref" role="button" tabIndex={0} onClick={() => onOpen(b.title)} onKeyDown={(e) => e.key === "Enter" && onOpen(b.title)}><span className={`bn-dot k-${b.kind}`} /><span><b data-notr>{b.title}</b>{b.context && <small><Inline t={b.context} exists={exists} onOpen={onOpen} /></small>}</span></div>
            )) : <p className="d">{L("Chưa có ghi chú nào trỏ tới đây.", "No notes link here yet.")}</p>}
          </div>
          {d.unlinked.length > 0 && <div className="bn-sec">
            <b>{L("Nhắc tới mà chưa nối", "Unlinked mentions")} <em>{d.unlinked.length}</em></b>
            {d.unlinked.map((b) => <button key={b.title} className="bn-ref" onClick={() => onOpen(b.title)}><span className={`bn-dot k-${b.kind}`} /><span><b data-notr>{b.title}</b>{b.context && <small data-notr>{b.context}</small>}</span></button>)}
          </div>}
          <div className="bn-sec">
            <b>{L("Quanh ghi chú này", "Local graph")}</b>
            <BrainGraph data={graph} focus={n?.title} depth={1} height={190} active={n?.title} onOpen={(t) => onOpen(t)} />
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Cài đặt → Bộ não
export function BrainSettings({ memory }: { memory: React.ReactNode }) {
  const app = useApp();
  const [g, setG] = useState<Graph | null>(null);
  const [tab, setTab] = useState<"graph" | "notes" | "memory">("graph");
  const [open, setOpen] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<Kind>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [imp, setImp] = useState<{ done: number; total: number } | null>(null);
  const [cut, setCut] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const load = useCallback(() => fetch("/api/brain", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j?.nodes) setG(j); }).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  // Đang có đoạn chat chờ chưng cất: đọc lại mỗi 15 giây để thấy bộ não lớn dần.
  useEffect(() => { if (!g?.stats.pending) return; const t = setInterval(load, 15_000); return () => clearInterval(t); }, [g?.stats.pending, load]);
  useEffect(() => { if (!full) return; const k = (e: KeyboardEvent) => e.key === "Escape" && setFull(false); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [full]);
  const distill = async () => {
    setBusy("distill");
    try { const j = await api<Graph & { done: number }>("POST", "/api/brain/distill", {}); setG(j); app.say(j.done ? L(`Đã chưng cất ${j.done} đoạn chat`, `Distilled ${j.done} chats`) : L("Không có đoạn chat nào đang chờ", "Nothing waiting to distill")); }
    catch (e) { app.say((e as Error).message); } finally { setBusy(""); }
  };
  // Nạp các đoạn chat đang lưu trong trình duyệt (không gồm ẩn danh) lên bộ não, từng đợt 20 đoạn.
  const importOld = async () => {
    const chats = app.chats.filter((c) => !c.inc && c.msgs.some((m) => m.role === "user")).slice(0, 300);
    if (!chats.length) { app.say(L("Trình duyệt này chưa có đoạn chat nào để nạp", "No chats in this browser to import")); return; }
    setImp({ done: 0, total: chats.length });
    let queued = 0;
    for (let i = 0; i < chats.length; i += 20) {
      const part = chats.slice(i, i + 20).map((c) => ({ id: String(c.id), title: c.title, msgs: c.msgs.filter((m) => m.text?.trim()).map((m) => ({ role: m.role, text: m.text })) }));
      try { queued += (await api<{ queued: number }>("POST", "/api/brain/import", { chats: part })).queued; } catch (e) { app.say((e as Error).message); break; }
      setImp({ done: Math.min(chats.length, i + 20), total: chats.length });
    }
    setImp(null);
    app.say(L(`Đã nạp ${queued} đoạn chat; Synchro đang chưng cất dần ở nền`, `Imported ${queued} chats; Synchro is distilling them in the background`));
    void load();
  };
  const wipe = () => app.confirm(L("Xóa toàn bộ bộ não?", "Delete the whole brain?"), L("Mọi ghi chú, liên kết và nhánh đoạn chat sẽ bị xóa. Ký ức dài hạn (mục Ký ức) giữ nguyên. Đoạn chat trong trình duyệt không bị ảnh hưởng.", "All notes, links and chat branches will be deleted. Long-term memories (Memory tab) stay. Chats in your browser are not affected."), L("Xóa", "Delete"),
    () => { void api<Graph>("DELETE", "/api/brain").then((j) => { setG(j); setOpen(null); app.say(L("Đã xóa bộ não", "Brain deleted")); }).catch((e) => app.say(e.message)); });
  // Phát lại quá trình hình thành: ghi chú hiện dần theo thứ tự được tạo (time-lapse của Obsidian).
  const replay = () => {
    if (!g) return;
    const ts = g.nodes.filter((n) => n.kind !== "ghost").map((n) => n.created).sort((a, b) => a - b);
    if (ts.length < 2) return;
    const t0 = ts[0], t1 = ts[ts.length - 1], start = performance.now(), dur = 6000;
    const step = () => { const f = Math.min(1, (performance.now() - start) / dur); setCut(f >= 1 ? null : t0 + (t1 - t0) * f); if (f < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const toggle = (kinds: Kind[]) => setHidden((h) => { const n = new Set(h); const off = kinds.every((k) => n.has(k)); for (const k of kinds) off ? n.delete(k) : n.add(k); return n; });
  const s = g?.stats;
  const notes = useMemo(() => (g?.nodes ?? []).filter((n) => n.kind !== "ghost" && (!q || fold(n.title).includes(fold(q)))).sort((a, b) => b.created - a.created), [g, q]);
  const legend: [string, string][] = [["--bn-hub", L("Trung tâm", "Hub")], ["--vc-claude", "Claude"], ["--vc-gpt", "ChatGPT"], ["--vc-gemini", "Gemini"], ["--bn-topic", L("Chủ đề", "Topic")], ["--bn-chat", L("Đoạn chat", "Chat")], ["--bn-tool", "Skill · Connector"], ["--bn-note", L("Ghi chú riêng", "Your note")]];
  return (
    <div className="bn">
      <h3 style={{ marginTop: 0 }}>{L("Bộ não", "Brain")}</h3>
      <p className="d" style={{ margin: "-4px 0 12px" }}>{L("Bộ não chung của Synchro: mỗi đoạn chat được chưng cất thành một ghi chú, nối bằng liên kết tới chủ đề, model đã nghĩ cùng, skill và connector đã dùng, và các đoạn chat liên quan. Tất cả tụ về một trung tâm. Claude, ChatGPT và Gemini là ba bán cầu dùng chung bộ não này. Bộ não lưu trên máy chủ của bạn.",
        "Synchro's shared brain: every chat is distilled into a note, linked to its topics, the model that thought it through, the skills and connectors it used, and related chats. Everything links back to one hub. Claude, ChatGPT and Gemini are three hemispheres of the same brain. It's stored on your server.")}</p>
      {s && <div className="bn-stats">
        <span><b>{s.notes}</b>{L("ghi chú", "notes")}</span><span><b>{s.links}</b>{L("liên kết", "links")}</span><span><b>{s.chats}</b>{L("đoạn chat đã chưng cất", "chats distilled")}</span>
        <span><b>{s.topics}</b>{L("chủ đề", "topics")}</span><span><b>{s.memories}</b>{L("ký ức", "memories")}</span>
        {s.pending > 0 && <span className="wait"><b>{s.pending}</b>{L("đang chờ chưng cất", "waiting")}</span>}
      </div>}
      <div className="bn-bar">
        <div className="bn-tabs" role="tablist">
          {([["graph", L("Đồ thị", "Graph")], ["notes", L("Ghi chú", "Notes")], ["memory", L("Ký ức", "Memory")]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div className="bn-acts">
          <button className="btn sm" onClick={distill} disabled={!!busy || !g?.cfg.gen}>{busy === "distill" ? <span className="art-spin sm" /> : <I.Sparkle size={13} />}{L("Chưng cất ngay", "Distill now")}</button>
          <button className="btn sm" onClick={importOld} disabled={!!imp || !g?.cfg.gen}>{imp ? `${imp.done}/${imp.total}` : <><I.Upload size={13} />{L("Nạp đoạn chat cũ", "Import old chats")}</>}</button>
          <a className="btn sm" href="/api/brain/export" download><I.Download size={13} />{L("Tải về cho Obsidian", "Export for Obsidian")}</a>
          <button className="icon-btn" aria-label={L("Xóa bộ não", "Delete brain")} data-tip={L("Xóa bộ não", "Delete brain")} onClick={wipe}><I.Trash size={14} /></button>
        </div>
      </div>
      {!g?.cfg.gen && g && <p className="bn-off">{L("Đang tắt học từ đoạn chat (mục Ký ức), nên bộ não không lớn thêm.", "Learning from chats is off (Memory tab), so the brain isn't growing.")}</p>}
      {tab === "memory" ? <div className="bn-mem">{memory}</div> : !g ? <div className="us-empty"><span className="art-spin sm" /></div> : (
        <div className={`bn-main ${open ? "split" : ""} ${full ? "full" : ""}`}>
          <div className="bn-left">
            {tab === "graph" ? (
              <>
                <div className="bn-filter">
                  <span className="bn-search"><I.Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Tìm ghi chú", "Search notes")} /></span>
                  {FILTERS.map((f) => <button key={f.k} className={`bn-chip ${f.kinds.every((k) => hidden.has(k)) ? "" : "on"}`} aria-pressed={!f.kinds.every((k) => hidden.has(k))} onClick={() => toggle(f.kinds)}>{L(...f.label)}</button>)}
                  <button className="bn-chip" onClick={replay} disabled={cut !== null}><I.Play size={11} />{L("Phát lại", "Replay")}</button>
                  <button className="icon-btn" aria-label={full ? L("Thu nhỏ", "Exit full screen") : L("Toàn màn hình", "Full screen")} onClick={() => setFull(!full)}>{full ? <I.X size={14} /> : <I.Expand size={14} />}</button>
                </div>
                <BrainGraph data={g} hidden={hidden} query={q} cutoff={cut} active={open} height={full ? "calc(100dvh - 120px)" : 440} onOpen={(t) => setOpen(t)} />
                <div className="bn-legend">{legend.map(([v, l]) => <span key={v}><i style={{ background: `var(${v})` }} />{l}</span>)}<span><i className="ghost" />{L("Chưa có ghi chú", "Not created yet")}</span></div>
              </>
            ) : (
              <div className="bn-list">
                <span className="bn-search"><I.Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Tìm ghi chú", "Search notes")} /></span>
                <button className="bn-new" onClick={() => setOpen(L("Ghi chú mới", "New note"))}><I.Plus size={13} />{L("Ghi chú mới", "New note")}</button>
                {notes.map((n) => <button key={n.id} className={`bn-row ${open === n.title ? "on" : ""}`} onClick={() => setOpen(n.title)}><span className={`bn-dot k-${n.kind}`} style={n.kind === "model" ? { background: `var(${HEMI_VAR[n.title]})` } : undefined} /><span data-notr>{n.title}</span><em>{n.links}</em></button>)}
              </div>
            )}
          </div>
          {open && <NoteView title={open} graph={g} onOpen={(t) => setOpen(t)} onClose={() => setOpen(null)} onChanged={() => void load()} />}
        </div>
      )}
    </div>
  );
}
