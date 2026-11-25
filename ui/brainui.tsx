"use client";
// Bộ não: không gian riêng (menu tài khoản, ⌘K hay Cài đặt → Bộ não) để đi trong mạng ghi chú mà Synchro tự xây và
// tự chăm sóc từ các đoạn chat.
// - Đồ thị: mỗi chấm là một ghi chú, mỗi đường là một [[liên kết]]; chấm càng nhiều liên kết càng to. Màu trầm, chỉ sáng màu nhấn khi
//   rê chuột (ghi chú lân cận sáng theo, phần còn lại mờ dần); các chấm bung ra từ tâm rồi lắng lại như lò xo; kéo một chấm thì các chấm
//   nối với nó bị kéo theo; cuộn để phóng to êm, chữ hiện dần khi phóng to. Bảng cài đặt: lọc, nhóm màu, hiển thị, lực.
// - Ghi chú: thuộc tính, nội dung với [[liên kết]] (rê chuột để xem nhanh), nhúng ![[...]], đề mục, liên kết đến đây, gần nghĩa,
//   đồ thị cục bộ. Synchro tự viết các trang; bạn thêm "Ghi chú của bạn" hoặc ghi chú riêng.
// - Bảng, Hoạt động: việc dang dở, đoạn chat, chủ đề, tên riêng; những gì bộ não vừa tự học.
import "./styles/brainview.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAway } from "./clickaway";
import { apiFetch, statusText } from "./apierr";
import { rowKeys } from "./a11y";
import { SideToggle } from "./brand";
import { BulkBar, BulkButton, BulkCheck, bulkRow, each, useBulk, type BulkAct } from "./bulk";
import { Pager } from "./pager";
import * as I from "./icons";
import { ColorField } from "./colorpick";
import { type Chat, useApp, usePref } from "./store";
import { locale, tf, tr, trc } from "./i18n";
import { maxW } from "./breakpoints";

type Kind = "hub" | "about" | "model" | "chat" | "code" | "topic" | "entity" | "map" | "index" | "log" | "skill" | "connector" | "note" | "daily" | "rule" | "ghost" | "tag";
type GNode = { id: string; title: string; kind: Kind; tags: string[]; created: number; links: number; aliases?: string[]; pinned?: boolean };
type Stats = { notes: number; links: number; chats: number; topics: number; entities: number; maps: number; pending: number; failed?: number; learnError?: string | null; memories: number; learnedAt: number | null; gardenAt: number | null };
type Graph = { nodes: GNode[]; edges: { s: string; t: string }[]; stats: Stats; cfg: { gen: boolean; sens: boolean; autoIns: boolean } };
type Fact = { t: string; src?: string; at: number };
type NoteData = {
  note: { id: string; kind: Kind; title: string; body: string; createdAt: number; updatedAt: number; editable: boolean; generated: boolean; tags: string[];
    props: { date?: number; models?: Record<string, number>; userNote?: string; importance?: number; turns?: number; aliases?: string[]; tags?: string[]; pinned?: boolean; facts?: Fact[]; etype?: string; up?: string } };
  outgoing: { title: string; exists: boolean }[]; backlinks: { title: string; kind: Kind; context: string }[]; unlinked: { title: string; kind: Kind; context: string }[]; similar: { title: string; kind: Kind }[];
};

// Chữ trên đồ thị vẽ bằng canvas, bộ dịch giao diện không chạm tới: tên các ghi chú khung dịch ở đây. Tiêu đề người dùng và Synchro đặt theo nội dung giữ nguyên.
const noteLabel = (t: string) => (ENTRY.includes(t) ? entryName(t) : /^Nhật ký \d/.test(t) ? tr(t) : /^Bản đồ · /.test(t) ? tf("Bản đồ · {name}", { name: t.replace(/^Bản đồ · /, "") }) : t);
// Loại của một ghi chú (số ít: "Topic", "Your note"), khác tên nhóm số nhiều ở danh sách bên trái ("Topics", "Your notes"):
// mỗi loại một khóa ngữ cảnh "loại ghi chú" (trc), dịch lúc vẽ.
const kindName = (k: Kind): string => {
  switch (k) {
    case "hub": return trc("Trung tâm", "loại ghi chú");
    case "about": return trc("Về bạn", "loại ghi chú");
    case "model": return trc("Bán cầu", "loại ghi chú");
    case "chat": return trc("Đoạn chat", "loại ghi chú");
    case "code": return "Synchro Code";
    case "topic": return trc("Chủ đề", "loại ghi chú");
    case "entity": return trc("Tên riêng", "loại ghi chú");
    case "map": return trc("Bản đồ", "loại ghi chú");
    case "index": return trc("Mục lục", "loại ghi chú");
    case "log": return trc("Hoạt động", "loại ghi chú");
    case "skill": return "Skill";
    case "connector": return "Connector";
    case "note": return trc("Ghi chú của bạn", "loại ghi chú");
    case "daily": return trc("Nhật ký", "loại ghi chú");
    case "rule": return trc("Quy tắc hàng đầu", "loại ghi chú");
    case "ghost": return trc("Chưa có ghi chú", "loại ghi chú");
    case "tag": return trc("Thẻ", "loại ghi chú");
    default: return "";
  }
};
const KIND_ICON: Partial<Record<Kind, (p: { size?: number }) => React.ReactNode>> = {
  hub: I.Brain, about: I.User, model: I.Sparkle, chat: I.Chat2, code: I.Code, topic: I.Bulb, entity: I.Book, map: I.Layers, index: I.List, log: I.History,
  skill: I.Scroll, connector: I.Connectors, note: I.Pencil, daily: I.Calendar, rule: I.ShieldCheck, ghost: I.Ghost,
};
const KindIcon = ({ k, size = 14 }: { k: Kind; size?: number }) => { const Ic = KIND_ICON[k]; return Ic ? <span className="bw-ki" aria-hidden><Ic size={size} /></span> : <span className="bw-ki" aria-hidden>#</span>; };
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
const dateStr = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
const timeStr = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
const HUB_TITLE = "Bộ não";
const slug = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

const LoadRetry = ({ err, retry }: { err: string; retry: () => void }) => <div className="us-empty" role="alert"><span>{err}</span><button className="btn sm" onClick={retry}>{tr("Thử lại")}</button></div>;
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await apiFetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || statusText(r.status));
  return j as T;
}

// ---------------------------------------------------------------- cài đặt đồ thị (lưu trong trình duyệt, riêng đồ thị chung và cục bộ)
export type GS = {
  search: string; tags: boolean; orphans: boolean; existing: boolean; groups: { q: string; color: string }[];
  arrows: boolean; fade: number; size: number; thick: number; center: number; repel: number; link: number; dist: number;
  depth: number; inc: boolean; out: boolean; nbr: boolean;
};
const GS0: GS = { search: "", tags: false, orphans: true, existing: false, groups: [], arrows: false, fade: 0.5, size: 1, thick: 1, center: 0.5, repel: 10, link: 1, dist: 100, depth: 1, inc: true, out: true, nbr: true };
function useGS(key: string): [GS, (p: Partial<GS> | null) => void] {
  const [gs, set] = useState<GS>(GS0);
  useEffect(() => { try { const v = localStorage.getItem(`bn:graph:${key}`); if (v) set({ ...GS0, ...JSON.parse(v) }); } catch {} }, [key]);
  const upd = useCallback((p: Partial<GS> | null) => set((g) => { const n = p === null ? { ...GS0 } : { ...g, ...p }; try { localStorage.setItem(`bn:graph:${key}`, JSON.stringify(n)); } catch {} return n; }), [key]);
  return [gs, upd];
}
// Truy vấn của ô lọc và nhóm màu: chữ trong tên, tag:thẻ, loai:chu-de|ten-rieng|doan-chat|ban-do|ghi-chu|nhat-ky, file:tên.
const KQ: Record<string, Kind[]> = { "chu-de": ["topic"], topic: ["topic"], "ten-rieng": ["entity"], entity: ["entity"], "doan-chat": ["chat", "code"], chat: ["chat", "code"], "ban-do": ["map"], map: ["map"], "ghi-chu": ["note"], note: ["note"], "nhat-ky": ["daily"], daily: ["daily"], skill: ["skill"], connector: ["connector"], model: ["model"] };
function matcher(q: string): ((n: GNode) => boolean) | null {
  const toks = q.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const fs = toks.map((tk) => {
    const neg = tk.startsWith("-"), x = fold(neg ? tk.slice(1) : tk);
    const f: (n: GNode) => boolean = x.startsWith("tag:") ? (n) => n.tags.some((t) => fold(t) === x.slice(4).replace(/^#/, "") || fold(t).startsWith(`${x.slice(4).replace(/^#/, "")}/`))
      : x.startsWith("loai:") ? (n) => (KQ[x.slice(5)] ?? []).includes(n.kind)
      : x.startsWith("file:") ? (n) => fold(n.title).includes(x.slice(5))
      : (n) => fold(n.title).includes(x) || (n.aliases ?? []).some((a) => fold(a).includes(x));
    return neg ? (n: GNode) => !f(n) : f;
  });
  return (n) => fs.every((f) => f(n));
}

// ---------------------------------------------------------------- đồ thị: mô phỏng lực (kiểu d3-force) vẽ trên canvas
type P = { x: number; y: number; vx: number; vy: number; fx?: number | null; fy?: number | null };
const ALPHA_MIN = 0.001, ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300), VELOCITY_DECAY = 0.4;

export function BrainGraph({ data, gs, onOpen, focus, height = 420, active, cutoff, mini, onBg }: {
  data: Graph; gs: GS; onOpen: (title: string, ghost: boolean) => void; focus?: string | null; height?: number | string; active?: string | null; cutoff?: number | null; mini?: boolean; onBg?: () => void;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const pos = useRef(new Map<string, P>());
  const view = useRef({ k: 1, x: 0, y: 0 }), goal = useRef<{ k: number; x: number; y: number } | null>(null);
  const sim = useRef({ alpha: 1, target: 0 });
  const hover = useRef<string | null>(null), hl = useRef(0), hlNode = useRef<string | null>(null);
  const raf = useRef(0), dirty = useRef(true), touched = useRef(false), fitTick = useRef(0), hot = useRef(false);
  const [uilang] = usePref("uilang", "vi");
  useEffect(() => { dirty.current = true; }, [uilang]);
  const colors = useRef<Record<string, string>>({});

  // Ghi chú hiển thị: lọc, ghi chú lẻ, chỉ ghi chú đã có, thẻ thành chấm, đồ thị cục bộ (độ sâu, liên kết đến / đi / giữa lân cận).
  const { nodes, edges } = useMemo(() => {
    const m = matcher(gs.search);
    let ns = data.nodes.filter((n) => (!gs.existing || n.kind !== "ghost") && (cutoff == null || n.created <= cutoff));
    let es = data.edges.slice();
    if (gs.tags) {
      const tagNodes = new Map<string, GNode>();
      for (const n of ns) for (const tg of n.tags) { const id = `tag:${tg}`; if (!tagNodes.has(id)) tagNodes.set(id, { id, title: `#${tg}`, kind: "tag", tags: [], created: n.created, links: 0 }); es.push({ s: n.id, t: id }); }
      ns = [...ns, ...tagNodes.values()];
    }
    if (focus) {
      const start = ns.find((n) => n.title === focus)?.id;
      const keep = new Set(start ? [start] : []);
      let front = new Set(keep);
      for (let d = 0; d < Math.max(1, gs.depth); d++) {
        const next = new Set<string>();
        for (const e of es) {
          if (gs.out && front.has(e.s) && !keep.has(e.t)) next.add(e.t);
          if (gs.inc && front.has(e.t) && !keep.has(e.s)) next.add(e.s);
        }
        for (const x of next) keep.add(x);
        front = next;
      }
      ns = ns.filter((n) => keep.has(n.id));
      if (!gs.nbr && start) es = es.filter((e) => e.s === start || e.t === start);
    }
    if (m) { const ok = new Set(ns.filter((n) => m(n) || n.title === focus).map((n) => n.id)); ns = ns.filter((n) => ok.has(n.id)); }
    let ids = new Set(ns.map((n) => n.id));
    es = es.filter((e) => ids.has(e.s) && ids.has(e.t));
    if (!gs.orphans) { const linked = new Set(es.flatMap((e) => [e.s, e.t])); ns = ns.filter((n) => linked.has(n.id) || n.title === focus); ids = new Set(ns.map((n) => n.id)); es = es.filter((e) => ids.has(e.s) && ids.has(e.t)); }
    // Cỡ chấm theo số ghi chú trỏ tới nó (như Obsidian): trang được nhắc nhiều thì to, đoạn chat trỏ đi nhiều nơi vẫn nhỏ.
    const deg = new Map<string, number>();
    for (const e of es) deg.set(e.t, (deg.get(e.t) ?? 0) + 1);
    return { nodes: ns.map((n) => ({ ...n, links: deg.get(n.id) ?? 0 })), edges: es };
  }, [data, focus, cutoff, gs.search, gs.tags, gs.orphans, gs.existing, gs.depth, gs.inc, gs.out, gs.nbr]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const nbr = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) { (m.get(e.s) ?? m.set(e.s, new Set()).get(e.s)!).add(e.t); (m.get(e.t) ?? m.set(e.t, new Set()).get(e.t)!).add(e.s); }
    return m;
  }, [edges]);
  const groups = useMemo(() => gs.groups.map((g) => ({ f: matcher(g.q), color: g.color })).filter((g) => g.f), [gs.groups]);
  const radius = useCallback((n: GNode) => gs.size * (n.kind === "tag" ? 2.6 : 3 + Math.min(14, Math.sqrt(n.links) * 2.1)), [gs.size]);

  const readColors = useCallback(() => {
    const el = cv.current;
    if (!el) return;
    const cs = getComputedStyle(el), c: Record<string, string> = {};
    for (const v of ["--bn-node", "--bn-node-ghost", "--bn-node-tag", "--bn-accent", "--bn-line", "--bn-line-hi", "--bn-text", "--bn-bg"]) c[v] = cs.getPropertyValue(v).trim() || "#888";
    colors.current = c; dirty.current = true;
  }, []);
  const fill = (n: GNode) => {
    for (const g of groups) if (g.f!(n)) return g.color;
    return colors.current[n.kind === "ghost" ? "--bn-node-ghost" : n.kind === "tag" ? "--bn-node-tag" : "--bn-node"];
  };

  // Chấm mới bung ra từ tâm (hoặc từ chấm nó nối tới, khi đồ thị đã có sẵn); giữ vị trí cũ khi dữ liệu đổi.
  useEffect(() => {
    const P0 = pos.current;
    for (const nd of nodes) {
      if (P0.has(nd.id)) continue;
      const near = [...(nbr.get(nd.id) ?? [])].map((id) => P0.get(id)).find(Boolean);
      const a = Math.random() * Math.PI * 2, r = near ? 12 : Math.random() * 18;
      P0.set(nd.id, { x: (near?.x ?? 0) + Math.cos(a) * r, y: (near?.y ?? 0) + Math.sin(a) * r, vx: 0, vy: 0 });
    }
    sim.current.alpha = Math.max(sim.current.alpha, P0.size > nodes.length ? 0.5 : 1);
    dirty.current = true;
  }, [nodes, nbr]);

  const fit = useCallback((animate: boolean) => {
    const el = cv.current, ps = nodes.map((n) => pos.current.get(n.id)).filter((p): p is P => !!p);
    if (!el || !ps.length) return;
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const k = Math.min(1.8, Math.max(mini ? 0.04 : 0.2, Math.min(el.clientWidth / (maxX - minX + 140), el.clientHeight / (maxY - minY + 110))));
    const g = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k };
    if (animate) goal.current = g; else view.current = g;
    dirty.current = true;
  }, [nodes, mini]);

  // Một nhịp mô phỏng: đẩy nhau (lưới không gian cho đồ thị lớn), lò xo liên kết, hút về tâm, tránh chồng.
  const step = useCallback(() => {
    const s = sim.current;
    s.alpha += (s.target - s.alpha) * ALPHA_DECAY;
    const a = s.alpha, P0 = pos.current;
    const list = nodes.map((n) => [n, P0.get(n.id)!] as const).filter(([, p]) => p);
    const charge = -28 * gs.repel;
    const cell = 220, grid = new Map<string, (typeof list)[number][]>();
    const big = list.length > 350;
    if (big) for (const it of list) { const k = `${Math.floor(it[1].x / cell)},${Math.floor(it[1].y / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(it); }
    const repel = (p: P, o: P, rp: number, ro: number) => {
      let dx = o.x - p.x, dy = o.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < 1e-6) { dx = (Math.random() - 0.5) * 1e-3; dy = (Math.random() - 0.5) * 1e-3; d2 = dx * dx + dy * dy; }
      const d2c = Math.max(d2, 25), f = (charge * a) / d2c;
      p.vx += dx * f; p.vy += dy * f; o.vx -= dx * f; o.vy -= dy * f;
      const min = rp + ro + 3, d = Math.sqrt(d2);
      if (d < min) { const push = ((min - d) / d) * 0.35; p.vx -= dx * push; p.vy -= dy * push; o.vx += dx * push; o.vy += dy * push; }
    };
    if (big) {
      for (const [n, p] of list) {
        const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [m, o] of grid.get(`${cx + i},${cy + j}`) ?? []) if (m.id > n.id) repel(p, o, radius(n), radius(m));
      }
    } else for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) repel(list[i][1], list[j][1], radius(list[i][0]), radius(list[j][0]));
    const count = new Map<string, number>();
    for (const e of edges) { count.set(e.s, (count.get(e.s) ?? 0) + 1); count.set(e.t, (count.get(e.t) ?? 0) + 1); }
    for (const e of edges) {
      const p = P0.get(e.s), o = P0.get(e.t);
      if (!p || !o) continue;
      let dx = o.x + o.vx - p.x - p.vx, dy = o.y + o.vy - p.y - p.vy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const cs = count.get(e.s) ?? 1, ct = count.get(e.t) ?? 1, strength = (gs.link * 1) / Math.min(cs, ct), bias = cs / (cs + ct);
      const l = ((d - gs.dist) / d) * a * strength;
      dx *= l; dy *= l;
      o.vx -= dx * bias; o.vy -= dy * bias; p.vx += dx * (1 - bias); p.vy += dy * (1 - bias);
    }
    const cf = 0.006 + gs.center * 0.05;
    for (const [, p] of list) {
      p.vx -= p.x * cf * a; p.vy -= p.y * cf * a;
      if (p.fx != null) { p.x = p.fx; p.vx = 0; } else { p.vx *= 1 - VELOCITY_DECAY; p.x += p.vx; }
      if (p.fy != null) { p.y = p.fy; p.vy = 0; } else { p.vy *= 1 - VELOCITY_DECAY; p.y += p.vy; }
    }
    dirty.current = true;
  }, [nodes, edges, gs.repel, gs.link, gs.dist, gs.center, radius]);

  const draw = useCallback(() => {
    const el = cv.current;
    if (!el) return;
    const ctx = el.getContext("2d")!, dpr = window.devicePixelRatio || 1, w = el.clientWidth, h = el.clientHeight;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); }
    const { k, x: tx, y: ty } = view.current, C = colors.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2 + tx, h / 2 + ty); ctx.scale(k, k);
    const P0 = pos.current, hv = hlNode.current, near = hv ? nbr.get(hv) : null, t0 = hl.current;
    const lit = (id: string) => !hv || id === hv || !!near?.has(id);
    // Đường: xám mảnh; khi rê, đường của chấm đang rê sáng màu nhấn, đường khác mờ đi.
    for (const e of edges) {
      const a = P0.get(e.s), b = P0.get(e.t);
      if (!a || !b) continue;
      const on = !!hv && (e.s === hv || e.t === hv);
      ctx.globalAlpha = on ? 1 : 1 - 0.8 * t0;
      ctx.strokeStyle = on ? C["--bn-accent"] : C["--bn-line"];
      ctx.lineWidth = (gs.thick * (on ? 1.4 : 1)) / Math.max(0.6, k);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (gs.arrows) {
        const tn = byId.get(e.t); if (!tn) continue;
        const ang = Math.atan2(b.y - a.y, b.x - a.x), r = radius(tn) + 1.5, s = 4.5 / Math.max(0.7, k);
        const px = b.x - Math.cos(ang) * r, py = b.y - Math.sin(ang) * r;
        ctx.fillStyle = on ? C["--bn-accent"] : C["--bn-line"];
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.cos(ang - 0.45) * s, py - Math.sin(ang - 0.45) * s); ctx.lineTo(px - Math.cos(ang + 0.45) * s, py - Math.sin(ang + 0.45) * s); ctx.closePath(); ctx.fill();
      }
    }
    // Chấm: xám trầm; chấm đang rê / đang mở là màu nhấn.
    const thr = 0.35 + gs.fade * 1.5;
    for (const nd of nodes) {
      const p = P0.get(nd.id);
      if (!p) continue;
      const r = radius(nd), on = lit(nd.id);
      ctx.globalAlpha = on ? 1 : 1 - 0.8 * t0;
      const focusNode = nd.id === hv || nd.title === active;
      ctx.fillStyle = focusNode ? C["--bn-accent"] : fill(nd);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      if (nd.kind === "ghost") { ctx.fillStyle = C["--bn-bg"]; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, r - 1.4 / k), 0, Math.PI * 2); ctx.fill(); }
      // Chữ: hiện dần theo mức phóng (ngưỡng mờ chữ); chấm đang rê và lân cận luôn có chữ.
      const near1 = !!hv && on;
      const la = near1 ? 1 : Math.max(0, Math.min(1, (k - thr) / 0.35)) * (on ? 1 : 1 - 0.8 * t0);
      if (la > 0.02 && !mini) {
        const fs = 11 + (nd.kind === "hub" ? 2 : 0), shownT = noteLabel(nd.title), label = shownT.length > 40 ? `${shownT.slice(0, 39)}…` : shownT;
        ctx.font = `${nd.id === hv ? 600 : 400} ${fs}px var(--font-sans, system-ui), system-ui, -apple-system, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.globalAlpha = la; ctx.fillStyle = C["--bn-text"];
        ctx.fillText(label, p.x, p.y + r + 3);
      }
    }
    ctx.globalAlpha = 1;
  }, [nodes, edges, nbr, byId, active, mini, groups, gs.arrows, gs.thick, gs.fade, radius]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vòng khung hình: mô phỏng khi còn "nóng", chuyển dần độ sáng khi rê, thu phóng êm tới đích; vẽ lại khi có gì đổi.
  const frame = useCallback(() => {
    const s = sim.current;
    if (s.alpha > ALPHA_MIN || s.target > 0) { step(); hot.current = true; }
    else if (hot.current) { hot.current = false; if (!touched.current && nodes.length) fit(true); }
    const want = hover.current ? 1 : 0;
    if (hover.current) hlNode.current = hover.current;
    if (Math.abs(hl.current - want) > 0.01) { hl.current += (want - hl.current) * 0.18; dirty.current = true; } else if (hl.current !== want) { hl.current = want; if (!want) hlNode.current = null; dirty.current = true; }
    const gl = goal.current;
    if (gl) {
      const v = view.current;
      v.k += (gl.k - v.k) * 0.18; v.x += (gl.x - v.x) * 0.18; v.y += (gl.y - v.y) * 0.18;
      if (Math.abs(gl.k - v.k) < 0.002 && Math.abs(gl.x - v.x) < 0.5 && Math.abs(gl.y - v.y) < 0.5) { Object.assign(v, gl); goal.current = null; }
      dirty.current = true;
    }
    // Lúc đồ thị đang bung ra và lắng lại: khung tự căn theo (cho tới khi người dùng tự kéo / phóng), như máy quay lùi dần.
    if (!touched.current && nodes.length && s.alpha > ALPHA_MIN && ++fitTick.current % 20 === 0) fit(true);
    if (dirty.current) { dirty.current = false; draw(); }
    raf.current = requestAnimationFrame(frame);
  }, [step, draw, fit, nodes.length]);
  useEffect(() => {
    readColors();
    raf.current = requestAnimationFrame(frame);
    const mo = new MutationObserver(readColors);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const ro = new ResizeObserver(() => { dirty.current = true; });
    if (cv.current) ro.observe(cv.current);
    return () => { cancelAnimationFrame(raf.current); mo.disconnect(); ro.disconnect(); };
  }, [frame, readColors]);
  useEffect(() => { dirty.current = true; }, [gs, active]);
  // Lực đổi trong bảng cài đặt: hâm nóng lại để thấy đồ thị sắp xếp lại.
  useEffect(() => { sim.current.alpha = Math.max(sim.current.alpha, 0.5); }, [gs.center, gs.repel, gs.link, gs.dist, gs.size]);

  // Chuột: rê để sáng mối nối, kéo chấm (lân cận bị kéo theo), kéo nền để di chuyển, cuộn để phóng, bấm để mở ghi chú.
  const toWorld = (cx: number, cy: number) => {
    const el = cv.current!, b = el.getBoundingClientRect(), { k, x, y } = view.current;
    return { x: (cx - b.left - el.clientWidth / 2 - x) / k, y: (cy - b.top - el.clientHeight / 2 - y) / k };
  };
  const hit = (cx: number, cy: number) => {
    const w = toWorld(cx, cy), k = view.current.k;
    let best: string | null = null, bd = Infinity;
    for (const n of nodes) { const p = pos.current.get(n.id); if (!p) continue; const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < radius(n) + 5 / k && d < bd) { bd = d; best = n.id; } }
    return best;
  };
  const drag = useRef<{ id: string | null; sx: number; sy: number; moved: boolean; vx: number; vy: number } | null>(null);
  const down = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const id = hit(e.clientX, e.clientY);
    drag.current = { id, sx: e.clientX, sy: e.clientY, moved: false, vx: view.current.x, vy: view.current.y };
    touched.current = true; goal.current = null;
    if (id) { const p = pos.current.get(id)!; p.fx = p.x; p.fy = p.y; sim.current.target = 0.3; }
  };
  const move = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) { const id = hit(e.clientX, e.clientY); if (id !== hover.current) { hover.current = id; dirty.current = true; } (e.target as HTMLElement).style.cursor = id ? "pointer" : "grab"; return; }
    if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 3) g.moved = true;
    if (g.id) { const w = toWorld(e.clientX, e.clientY), p = pos.current.get(g.id)!; p.fx = w.x; p.fy = w.y; hover.current = g.id; }
    else { view.current.x = g.vx + e.clientX - g.sx; view.current.y = g.vy + e.clientY - g.sy; dirty.current = true; }
  };
  const up = () => {
    const g = drag.current;
    drag.current = null;
    if (!g) return;
    if (g.id) { const p = pos.current.get(g.id); if (p) { p.fx = null; p.fy = null; } sim.current.target = 0; }
    if (g.id && !g.moved) { const n = nodes.find((x) => x.id === g.id); if (n && n.kind !== "tag") onOpen(n.title, n.kind === "ghost"); }
    else if (!g.id && !g.moved) onBg?.();
  };
  useEffect(() => {
    const el = cv.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = goal.current ?? { ...view.current }, b = el.getBoundingClientRect(), mx = e.clientX - b.left - el.clientWidth / 2, my = e.clientY - b.top - el.clientHeight / 2;
      const k2 = Math.min(5, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0022)));
      goal.current = { k: k2, x: mx - ((mx - v.x) * k2) / v.k, y: my - ((my - v.y) * k2) / v.k };
      touched.current = true;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const zoom = (f: number) => { const v = goal.current ?? { ...view.current }; goal.current = { k: Math.min(5, Math.max(0.15, v.k * f)), x: v.x * f, y: v.y * f }; touched.current = true; };
  return (
    <div className={`bn-graph ${mini ? "mini" : ""}`} style={{ height }}>
      <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => { if (!drag.current) { hover.current = null; dirty.current = true; } }}
        role="img" aria-label={tf("Đồ thị bộ não: {notes} ghi chú, {links} liên kết", { notes: nodes.length, links: edges.length })} />
      {!mini && <div className="bn-zoom">
        <button className="icon-btn" aria-label={tr("Phóng to đồ thị")} onClick={() => zoom(1.3)}><I.Plus size={14} /></button>
        <button className="icon-btn" aria-label={tr("Thu nhỏ đồ thị")} onClick={() => zoom(1 / 1.3)}><I.Minus size={14} /></button>
        <button className="icon-btn" aria-label={trc("Vừa khung", "đồ thị")} onClick={() => { touched.current = false; fit(true); }}><I.Expand size={13} /></button>
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- bảng cài đặt đồ thị: Lọc · Nhóm · Hiển thị · Lực
const SWATCH = ["#8f86c9", "#6f9fc2", "#6fae8c", "#c2a35e", "#c48a7a", "#a58aa8", "#8d9aa6"];
function GraphPanel({ gs, set, local, onAnimate, onClose }: { gs: GS; set: (p: Partial<GS> | null) => void; local?: boolean; onAnimate?: () => void; onClose?: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ filter: true, groups: false, display: false, forces: false });
  // Gọi như hàm (không phải thành phần con) để ô nhập không bị dựng lại và mất con trỏ khi gõ.
  const sec = (k: string, t: string, children: React.ReactNode) => (
    <div className="bg-sec" key={k}>
      <button className="bg-h" aria-expanded={open[k]} onClick={() => setOpen({ ...open, [k]: !open[k] })}><I.ChevronR size={12} />{t}</button>
      {open[k] && <div className="bg-b">{children}</div>}
    </div>
  );
  const tog = (k: "tags" | "orphans" | "existing" | "arrows" | "inc" | "out" | "nbr", t: string) => (
    <label className="bg-row" key={k}><span>{t}</span><button role="switch" aria-checked={gs[k]} className={`bg-sw ${gs[k] ? "on" : ""}`} onClick={() => set({ [k]: !gs[k] })}><i /></button></label>
  );
  const sl = (k: "fade" | "size" | "thick" | "center" | "repel" | "link" | "dist" | "depth", t: string, min: number, max: number, st: number) => (
    <label className="bg-row col" key={k}><span>{t}</span><input type="range" min={min} max={max} step={st} value={gs[k]} style={{ "--p": `${((gs[k] - min) / (max - min)) * 100}%` } as React.CSSProperties} onChange={(e) => set({ [k]: Number(e.target.value) })} /></label>
  );
  return (
    <div className="bg-panel" role="dialog" aria-label={tr("Cài đặt đồ thị")}>
      <div className="bg-top">
        <b>{local ? tr("Đồ thị cục bộ") : trc("Đồ thị", "khung đồ thị")}</b>
        <button className="icon-btn" aria-label={tr("Đặt lại mặc định")} data-tip={tr("Đặt lại mặc định")} onClick={() => set(null)}><I.Retry size={13} /></button>
        {onClose && <button className="icon-btn" aria-label={tr("Đóng")} onClick={onClose}><I.X size={14} /></button>}
      </div>
      {sec("filter", trc("Lọc", "đồ thị"), <>
        {local && sl("depth", trc("Độ sâu", "đồ thị"), 1, 3, 1)}
        <input className="field bg-q" value={gs.search} onChange={(e) => set({ search: e.target.value })} placeholder={tr("Tìm ghi chú… (tag:, loai:, file:)")} />
        {local && <>{tog("inc", tr("Liên kết đến"))}{tog("out", tr("Liên kết đi"))}{tog("nbr", tr("Liên kết giữa lân cận"))}</>}
        {tog("tags", tr("Thẻ"))}
        {tog("orphans", tr("Ghi chú lẻ"))}
        {tog("existing", tr("Chỉ ghi chú đã có"))}
      </>)}
      {sec("groups", trc("Nhóm", "đồ thị"), <>
        {gs.groups.map((g, i) => (
          <div key={i} className="bg-grp">
            <ColorField size="sm" label={trc("Màu nhóm", "nhóm màu đồ thị")} value={g.color} onChange={(color) => set({ groups: gs.groups.map((x, j) => (j === i ? { ...x, color } : x)) })} />
            <input className="field" value={g.q} placeholder={tr("tag:thẻ, loai:chu-de, chữ…")} onChange={(e) => set({ groups: gs.groups.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
            <button className="icon-btn" aria-label={trc("Xóa nhóm", "nhóm màu đồ thị")} onClick={() => set({ groups: gs.groups.filter((_, j) => j !== i) })}><I.X size={12} /></button>
          </div>
        ))}
        <button className="btn sm" onClick={() => set({ groups: [...gs.groups, { q: "", color: SWATCH[gs.groups.length % SWATCH.length] }] })}><I.Plus size={12} />{trc("Nhóm mới", "nhóm màu đồ thị")}</button>
      </>)}
      {sec("display", trc("Hiển thị", "đồ thị"), <>
        {tog("arrows", trc("Mũi tên", "đồ thị"))}
        {sl("fade", tr("Ngưỡng mờ chữ"), 0, 1, 0.05)}
        {sl("size", trc("Cỡ nút", "đồ thị"), 0.4, 2.5, 0.05)}
        {sl("thick", tr("Độ dày liên kết"), 0.3, 3, 0.05)}
        {onAnimate && <button className="btn sm" onClick={onAnimate}><I.Play size={11} />{tr("Tua lại quá trình hình thành")}</button>}
      </>)}
      {sec("forces", trc("Lực", "đồ thị"), <>
        {sl("center", trc("Hút tâm", "đồ thị"), 0, 1, 0.02)}
        {sl("repel", trc("Đẩy nhau", "đồ thị"), 0, 20, 0.5)}
        {sl("link", tr("Lực liên kết"), 0, 1, 0.02)}
        {sl("dist", tr("Độ dài liên kết"), 30, 250, 5)}
      </>)}
    </div>
  );
}

// ---------------------------------------------------------------- xem nhanh khi rê chuột lên liên kết
const peekCache = new Map<string, NoteData | null>();
async function loadNote(title: string, fresh = false): Promise<NoteData | null> {
  if (!fresh && peekCache.has(fold(title))) return peekCache.get(fold(title)) ?? null;
  const r = await fetch(`/api/brain/note?title=${encodeURIComponent(title)}`, { cache: "no-store" }).catch(() => null);
  const j = r && r.ok ? ((await r.json()) as NoteData) : null;
  peekCache.set(fold(title), j);
  return j;
}
let peekTimer: ReturnType<typeof setTimeout> | null = null;
const peek = (title: string | null, el?: HTMLElement) => {
  if (peekTimer) clearTimeout(peekTimer);
  peekTimer = setTimeout(() => window.dispatchEvent(new CustomEvent("bn:peek", { detail: title && el ? { title, rect: el.getBoundingClientRect() } : null })), title ? 380 : 220);
};
function Peek({ onOpen }: { onOpen: (t: string) => void }) {
  const [p, setP] = useState<{ title: string; rect: DOMRect; d: NoteData | null } | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const det = (e as CustomEvent).detail as { title: string; rect: DOMRect } | null;
      if (!det) { setP(null); return; }
      setP({ ...det, d: peekCache.get(fold(det.title)) ?? null });
      void loadNote(det.title).then((d) => setP((cur) => (cur && cur.title === det.title ? { ...cur, d } : cur)));
    };
    window.addEventListener("bn:peek", h);
    return () => window.removeEventListener("bn:peek", h);
  }, []);
  if (!p) return null;
  const below = p.rect.bottom + 300 < window.innerHeight;
  const left = Math.max(12, Math.min(window.innerWidth - 392, p.rect.left));
  return (
    <div className="bn-peek" style={{ left, ...(below ? { top: p.rect.bottom + 6 } : { bottom: window.innerHeight - p.rect.top + 6 }) }}
      onMouseEnter={() => peekTimer && clearTimeout(peekTimer)} onMouseLeave={() => peek(null)}>
      <button className="bn-peek-h" onClick={() => { onOpen(p.title); setP(null); }} data-notr>{p.d?.note.title ?? p.title}<I.ChevronR size={12} /></button>
      {p.d ? <NoteMd text={p.d.note.body.slice(0, 1400)} exists={new Set()} onOpen={(t) => { onOpen(t); setP(null); }} depth={2} /> : peekCache.has(fold(p.title)) ? <p className="d">{tr("Chưa có ghi chú này.")}</p> : <span className="art-spin sm" />}
    </div>
  );
}

// ---------------------------------------------------------------- nội dung ghi chú: Markdown gọn với [[liên kết]], #thẻ, đề mục, ^khối
type Open = (title: string, sub?: string) => void;
function Inline({ t, exists, onOpen }: { t: string; exists: Set<string>; onOpen: Open }) {
  const parts = t.split(/(\[\[[^\]\n]+\]\]|\*\*[^*]+\*\*|`[^`]+`|(?:^|(?<=\s))#[\p{L}\p{N}][\p{L}\p{N}_\-/]*)/gu).filter((x) => x !== undefined && x !== "");
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[\[([^\]|#]*)(#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(p);
        if (m) {
          const title = m[1].trim(), sub = m[2]?.slice(1), ok = !title || !exists.size || exists.has(fold(title));
          const shown = m[3]?.trim() || (title ? `${title}${sub ? ` › ${sub.replace(/^\^/, "")}` : ""}` : sub?.replace(/^\^/, "") ?? "");
          // Thẻ <a> (không phải nút) để tên dài xuống dòng giữa chừng như chữ thường.
          return <a key={i} href={`#${encodeURIComponent(title)}`} className={`bn-link ${ok ? "" : "ghost"}`} data-notr onClick={(e) => { e.preventDefault(); onOpen(title, sub); }}
            onMouseEnter={(e) => title && peek(title, e.currentTarget)} onMouseLeave={() => peek(null)} onFocus={(e) => title && peek(title, e.currentTarget)} onBlur={() => peek(null)}>{shown}</a>;
        }
        if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return <code key={i} className="ic">{p.slice(1, -1)}</code>;
        if (/^#[\p{L}\p{N}]/u.test(p)) return <span key={i} className="bn-tag" data-notr>{p}</span>;
        return <span key={i} data-notr>{p}</span>;
      })}
    </>
  );
}
/** Cắt phần của một đề mục (#Đề mục) hoặc một khối (#^id) khỏi nội dung ghi chú. */
function section(body: string, sub?: string) {
  if (!sub) return body;
  if (sub.startsWith("^")) { const id = sub.slice(1); const line = body.split("\n").find((l) => new RegExp(`\\s\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`).test(l)); return line ? line.replace(/\s\^[\w-]+\s*$/, "") : ""; }
  const m = new RegExp(`^(#{1,6})\\s+${sub.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").exec(body);
  if (!m) return "";
  const rest = body.slice(m.index + m[0].length), end = new RegExp(`^#{1,${m[1].length}}\\s`, "m").exec(rest);
  return rest.slice(0, end ? end.index : undefined).trim();
}
// Nhúng ghi chú khác (![[Ghi chú]], ![[Ghi chú#Đề mục]], ![[Ghi chú#^khối]]): hiện ngay nội dung, cập nhật theo ghi chú gốc.
function Embed({ target, exists, onOpen, depth }: { target: string; exists: Set<string>; onOpen: Open; depth: number }) {
  const [title, ...rest] = target.split("#"), sub = rest.join("#") || undefined;
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => { void loadNote(title.trim(), true).then((j) => setBody(j ? section(j.note.body, sub).trim() : "")); }, [title, sub]);
  return (
    <div className="bn-embed">
      <button className="bn-embed-h" onClick={() => onOpen(title.trim(), sub)} data-notr>{target}<I.ChevronR size={12} /></button>
      {body === null ? <span className="art-spin sm" /> : body ? <NoteMd text={body} exists={exists} onOpen={onOpen} depth={depth + 1} /> : <p className="d">{tr("Chưa có ghi chú này.")}</p>}
    </div>
  );
}
function NoteMd({ text, exists, onOpen, depth = 0, onTask }: { text: string; exists: Set<string>; onOpen: Open; depth?: number; onTask?: (task: string, done: boolean) => void }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: { box: "" | " " | "x"; t: string; id?: string }[] = [];
  const blockId = (s: string) => { const m = /\s\^([\w-]+)\s*$/.exec(s); return m ? { t: s.slice(0, m.index), id: m[1] } : { t: s }; };
  const flush = () => {
    if (!list.length) return;
    out.push(<ul key={`u${out.length}`} className="bn-ul">{list.map((x, i) => (
      <li key={i} className={x.box ? "box" : ""} id={x.id && depth === 0 ? `blk-${x.id}` : undefined}>
        {x.box && <button type="button" className={`bn-box ${x.box === "x" ? "on" : ""}`} aria-label={x.box === "x" ? tr("Đánh dấu chưa xong") : tr("Đánh dấu đã xong")} disabled={!onTask} onClick={() => onTask?.(x.t, x.box !== "x")}>{x.box === "x" && <I.Check size={10} />}</button>}
        <span className={x.box === "x" ? "bn-done" : ""}><Inline t={x.t} exists={exists} onOpen={onOpen} /></span>
      </li>))}</ul>);
    list = [];
  };
  for (const l of lines) {
    const li = /^\s*[-*]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(l);
    if (li) { const b = blockId(li[2]); list.push({ box: li[1] === undefined ? "" : li[1].toLowerCase() === "x" ? "x" : " ", t: b.t, id: b.id }); continue; }
    flush();
    const em = /^\s*!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/.exec(l);
    if (em) { out.push(depth < 1 ? <Embed key={out.length} target={em[1]} exists={exists} onOpen={onOpen} depth={depth} /> : <p key={out.length} className="bn-p"><Inline t={`[[${em[1]}]]`} exists={exists} onOpen={onOpen} /></p>); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) out.push(<div key={out.length} id={depth === 0 ? `h-${slug(h[2])}` : undefined} className={`bn-h h${Math.min(3, h[1].length)}`}><Inline t={h[2]} exists={exists} onOpen={onOpen} /></div>);
    else if (/^\s*>/.test(l)) out.push(<blockquote key={out.length} className="bn-q"><Inline t={l.replace(/^\s*>\s?/, "")} exists={exists} onOpen={onOpen} /></blockquote>);
    else if (/^\s*---+\s*$/.test(l)) out.push(<hr key={out.length} className="bn-hr" />);
    else if (l.trim()) { const b = blockId(l); out.push(<p key={out.length} className="bn-p" id={b.id && depth === 0 ? `blk-${b.id}` : undefined}><Inline t={b.t} exists={exists} onOpen={onOpen} /></p>); }
  }
  flush();
  return <div className="bn-md">{out}</div>;
}
/** Chữ trơn cho đoạn trích: bỏ dấu Markdown, [[liên kết|tên]] → tên. */
const plain = (t: string) => t.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a).replace(/\*\*|__|`|^#+\s*/gm, "").replace(/\s+/g, " ").trim();
const outline = (body: string) => body.split("\n").map((l) => /^(#{1,6})\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ level: m[1].length, text: m[2].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_x, a, b) => b || a) }));

// ---------------------------------------------------------------- một ghi chú: thuộc tính, nội dung, sửa phần của bạn
function NoteView({ title, sub, exists, onOpen, onChanged, onLoaded }: { title: string; sub?: string; exists: Set<string>; onOpen: Open; onChanged: () => void; onLoaded: (d: NoteData | null) => void }) {
  const say = useApp().say;
  const [d, setD] = useState<NoteData | null>(null);
  const [missing, setMissing] = useState(false);
  const [edit, setEdit] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [prop, setProp] = useState<{ aliases: string; tags: string } | null>(null);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Menu "…": đóng khi bấm ra ngoài hoặc Esc.
  useEffect(() => {
    if (!more) return;
    const h = (e: MouseEvent) => { if (isAway(moreRef.current, e.target)) setMore(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setMore(false);
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [more]);
  const load = useCallback(() => {
    void loadNote(title, true).then((j) => { setD(j); setMissing(!j); onLoaded(j); });
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setD(null); setEdit(null); setMissing(false); setProp(null); setMore(false); load(); }, [load]);
  // Mở theo #đề mục / #^khối: cuộn tới và nháy sáng chỗ đó.
  useEffect(() => {
    if (!d || !sub) return;
    const el = body.current?.querySelector<HTMLElement>(sub.startsWith("^") ? `#blk-${CSS.escape(sub.slice(1))}` : `#h-${CSS.escape(slug(sub))}`);
    if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("bn-flash"); setTimeout(() => el.classList.remove("bn-flash"), 1600); }
  }, [d, sub]);
  const call = async (method: string, path: string, b: unknown, ok?: string) => {
    setBusy(true);
    try { const j = await api<NoteData>(method, path, b); if (j?.note) { setD(j); peekCache.set(fold(j.note.title), j); onLoaded(j); } onChanged(); if (ok) say(ok); return j; }
    catch (e) { say((e as Error).message); return null; } finally { setBusy(false); }
  };
  // Việc trong ghi chú: nhật ký chép việc từ nhánh đoạn chat ("… (từ [[Nhánh]])") nên đánh dấu ở nhánh gốc.
  const task = (raw: string, done: boolean) => {
    const from = /\(từ \[\[([^\]|]+)/.exec(raw)?.[1];
    const text = raw.replace(/\s*\(từ \[\[.*$/, "").trim();
    void api("POST", "/api/brain/task", { title: from ?? d?.note.title, task: text, done }).then(() => { load(); onChanged(); say(done ? tr("Đã đánh dấu xong") : tr("Đã đánh dấu chưa xong")); }).catch((e) => say((e as Error).message));
  };
  const saveProps = () => { if (!prop || !d) return; void call("PUT", "/api/brain/note", { title: d.note.title, aliases: prop.aliases.split(",").map((x) => x.trim()).filter(Boolean), tags: prop.tags.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) }, tr("Đã lưu thuộc tính")).then((j) => j && setProp(null)); };
  const save = async () => {
    if (!edit) return;
    const b = missing ? { title, newTitle: edit.title || title, body: edit.body } : d!.note.generated ? { title, userNote: edit.body } : { title, newTitle: edit.title, body: edit.body };
    const j = await call("PUT", "/api/brain/note", b, tr("Đã lưu ghi chú"));
    if (j) { setEdit(null); setMissing(false); if (j.note.title !== title) onOpen(j.note.title); }
  };
  const app = useApp();
  const del = () => d && app.confirm(tf("Xóa “{title}”?", { title: d.note.title }), tr("Các liên kết tới nó sẽ thành ghi chú chưa có. Synchro có thể viết lại trang này khi học thêm."), tr("Xóa"),
    () => { void api("DELETE", `/api/brain/note?title=${encodeURIComponent(d.note.title)}`).then(() => { peekCache.delete(fold(d.note.title)); onChanged(); onOpen(""); say(tr("Đã xóa ghi chú")); }).catch((e) => say((e as Error).message)); });
  const n = d?.note;
  const sources = n ? [...new Set((n.props.facts ?? []).map((f) => f.src).filter(Boolean))] as string[] : [];
  const name = n?.title ?? title;
  // Đường dẫn: trung tâm › bản đồ chứa nó (nếu có) › ghi chú này.
  const crumbs = [HUB_TITLE, ...(n?.props.up ? [n.props.up] : [])].filter((c) => fold(c) !== fold(name));
  const rows: [string, React.ReactNode][] = n ? [
    ...(n.kind === "entity" && n.props.etype ? [[trc("Loại", "ghi chú"), <span key="t" data-notr>{n.props.etype}</span>] as [string, React.ReactNode]] : []),
    ...(n.props.up ? [[trc("Thuộc", "ghi chú"), <Inline key="u" t={`[[${n.props.up}]]`} exists={exists} onOpen={onOpen} />] as [string, React.ReactNode]] : []),
    ...(n.props.aliases?.length ? [[trc("Tên khác", "ghi chú"), <span key="a" className="bn-chips">{n.props.aliases.map((x) => <span key={x} className="bn-alias" data-notr>{x}</span>)}</span>] as [string, React.ReactNode]] : []),
    ...(n.tags.length ? [[tr("Thẻ"), <span key="g" className="bn-chips">{n.tags.map((x) => <span key={x} className="bn-tag" data-notr>#{x}</span>)}</span>] as [string, React.ReactNode]] : []),
    ...(n.props.models ? [["Model", <span key="m" data-notr>{Object.keys(n.props.models).map((m) => m.split("/").slice(1).join("/") || m).join(", ")}</span>] as [string, React.ReactNode]] : []),
    ...(n.props.turns ? [[trc("Tin nhắn", "ghi chú"), <span key="n">{n.props.turns}</span>] as [string, React.ReactNode]] : []),
    ...(sources.length ? [[tr("Nguồn"), <span key="s">{tf("{n} đoạn chat", { n: sources.length })}</span>] as [string, React.ReactNode]] : []),
    [tr("Tạo lúc"), <span key="c">{dateStr(n.createdAt)}</span>],
  ] : [];
  return (
    <article className="bn-note" aria-label={name} ref={body}>
      <div className="bn-note-top">
        <nav className="bn-crumbs" aria-label={trc("Đường dẫn", "ghi chú")}>
          {crumbs.map((c) => <span key={c} className="bn-crumb"><button onClick={() => onOpen(c)} data-notr>{c}</button><I.ChevronR size={11} /></span>)}
          <span className="bn-crumb now" data-notr>{name}</span>
        </nav>
        {(n || missing) && !edit && (
          <div className="bn-tools">
            <button className="btn sm" onClick={() => setEdit(missing ? { title, body: "" } : { title: n!.title, body: n!.generated ? n!.props.userNote ?? "" : n!.body })}><I.Pencil size={13} />{missing ? tr("Tạo ghi chú") : n!.generated ? trc("Ghi chú của bạn", "loại ghi chú") : tr("Sửa")}</button>
            {n && n.kind !== "rule" && <button className={`icon-btn ${n.props.pinned ? "on" : ""}`} aria-label={n.props.pinned ? tr("Bỏ ghim") : tr("Ghim lên đầu")} data-tip={n.props.pinned ? tr("Bỏ ghim") : tr("Ghim lên đầu")} onClick={() => void call("PUT", "/api/brain/note", { title: n.title, pinned: !n.props.pinned })}>{n.props.pinned ? <I.M icon="PinOff" size={15} /> : <I.M icon="Pin" size={15} />}</button>}
            {n && (
              <div className="bn-more-w" ref={moreRef}>
                <button className={`icon-btn ${more ? "on" : ""}`} aria-label={tr("Thêm thao tác")} aria-expanded={more} onClick={() => setMore(!more)}><I.Dots size={15} /></button>
                {more && (
                  <div className="bn-more" role="menu">
                    <button role="menuitem" onClick={() => { setMore(false); setProp({ aliases: (n.props.aliases ?? []).join(", "), tags: (n.props.tags ?? []).join(" ") }); }}><I.Pencil size={14} />{tr("Sửa tên khác và thẻ")}</button>
                    {n.editable && <button role="menuitem" className="danger" onClick={() => { setMore(false); del(); }}><I.Trash size={14} />{tr("Xóa ghi chú")}</button>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <h1 className="bn-title" data-notr>{name}</h1>
      <div className="bn-sub">
        {n && <><span className="bn-kind"><KindIcon k={n.kind} size={12} />{kindName(n.kind)}</span><span>{tf("Cập nhật {date}", { date: dateStr(n.updatedAt) })}</span></>}
        {missing && <span className="bn-kind"><KindIcon k="ghost" size={12} />{kindName("ghost")}</span>}
      </div>
      {n && !prop && rows.length > 1 && (
        <dl className="bn-props" aria-label={trc("Thuộc tính", "ghi chú")}>
          {rows.map(([k, v]) => <div key={k} className="bn-prop"><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {n && prop && (
        <div className="bn-props-f">
          <label>{tr("Tên khác (cách nhau bằng dấu phẩy)")}<input className="field" autoFocus value={prop.aliases} onChange={(e) => setProp({ ...prop, aliases: e.target.value })} placeholder={tr("ví dụ: An ninh mạng, ATTT")} /></label>
          <label>{tr("Thẻ")}<input className="field" value={prop.tags} onChange={(e) => setProp({ ...prop, tags: e.target.value })} placeholder="ke-hoach/tuan muc-tieu" /></label>
          <div className="bn-edit-a"><button className="btn sm" onClick={() => setProp(null)}>{tr("Hủy")}</button><button className="btn sm dark" disabled={busy} onClick={saveProps}>{tr("Lưu")}</button></div>
        </div>
      )}
      {!d && !missing && <div className="us-empty"><span className="art-spin sm" /></div>}
      {n?.kind === "rule" && !edit && <p className="bn-empty">{tr("Synchro đặt quy tắc này lên đầu lời nhắc của mọi model, ở mọi nơi bạn trò chuyện: chat, Synchro Code, việc tự động trong Hộp thư và giọng nói. Quy tắc luôn được ghim và không bị xóa, kể cả khi xóa bộ não.")}</p>}
      {missing && !edit && <p className="bn-empty">{tr("Ghi chú này chưa có: các ghi chú khác đang trỏ tới nó. Synchro sẽ viết trang này khi biết thêm về nó, hoặc bạn tự tạo.")}</p>}
      {edit ? (
        <div className="bn-edit">
          {(missing || (n && !n.generated && n.kind !== "rule")) && <input className="field" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label={tr("Tên ghi chú")} />}
          <textarea className="textarea" autoFocus value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={10}
            placeholder={tr("Viết bằng Markdown. Gõ [[Tên ghi chú]] để nối tới ghi chú khác, #thẻ để gắn thẻ.")} />
          {n?.generated && <p className="d">{tr("Synchro tự viết phần còn lại của trang này từ các đoạn chat; phần bạn viết nằm ở mục “Ghi chú của bạn”.")}</p>}
          {n?.kind === "rule" && <p className="d">{tr("Để trống thì Synchro dùng lại bản mặc định.")}</p>}
          <div className="bn-edit-a"><button className="btn" onClick={() => setEdit(null)} disabled={busy}>{tr("Hủy")}</button><button className="btn dark" onClick={save} disabled={busy}>{busy ? <span className="art-spin sm" /> : null}{tr("Lưu")}</button></div>
        </div>
      ) : n && <div className="bn-body"><NoteMd text={n.body} exists={exists} onOpen={onOpen} onTask={n.kind === "chat" || n.kind === "code" || n.kind === "daily" || n.kind === "note" ? task : undefined} /></div>}
    </article>
  );
}

// ---------------------------------------------------------------- khung bên phải của ghi chú
function NoteSide({ d, graph, exists, onOpen }: { d: NoteData; graph: Graph; exists: Set<string>; onOpen: Open }) {
  const [gs, setGs] = useGS("local");
  const [panel, setPanel] = useState(false);
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const kindOf = useMemo(() => new Map(graph.nodes.map((x) => [fold(x.title), x.kind] as const)), [graph]);
  // Gọi như hàm (không phải thành phần con) để đồ thị cục bộ không bị dựng lại mỗi lần khung đổi.
  const sec = (k: string, t: string, n: number | undefined, children: React.ReactNode, extra?: React.ReactNode) => (
    <section className="bw-sec" key={k}>
      <div className="bw-sec-h">
        <button aria-expanded={!shut[k]} onClick={() => setShut({ ...shut, [k]: !shut[k] })}><I.ChevronR size={11} /><span>{t}</span>{n !== undefined && <em>{n}</em>}</button>
        {extra}
      </div>
      {!shut[k] && <div className="bw-sec-b">{children}</div>}
    </section>
  );
  const row = (title: string, kind: Kind, ctx?: React.ReactNode, ghost = false) => (
    <button key={title} className={`bw-row ${ghost ? "ghost" : ""}`} onClick={() => onOpen(title)} onMouseEnter={(e) => !ghost && peek(title, e.currentTarget)} onMouseLeave={() => peek(null)}>
      <KindIcon k={ghost ? "ghost" : kind} size={13} />
      <span><b data-notr>{title}</b>{ctx && <small>{ctx}</small>}</span>
    </button>
  );
  const none = (t: string) => <p className="bw-none">{t}</p>;
  const heads = outline(d.note.body);
  return (
    <>
      {sec("lg", tr("Đồ thị cục bộ"), undefined, (
        <div className="bw-local">
          <BrainGraph data={graph} gs={gs} focus={d.note.title} active={d.note.title} height={220} onOpen={(t) => onOpen(t)} />
          {panel && <GraphPanel gs={gs} set={setGs} local onClose={() => setPanel(false)} />}
        </div>
      ), <button className={`icon-btn bw-sec-x ${panel ? "on" : ""}`} aria-label={tr("Cài đặt đồ thị cục bộ")} data-tip={tr("Cài đặt")} onClick={() => setPanel(!panel)}><I.Sliders size={13} /></button>)}
      {sec("back", tr("Liên kết đến đây"), d.backlinks.length, d.backlinks.length
        ? d.backlinks.map((b) => row(b.title, b.kind, b.context ? <span data-notr>{b.context.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, x, y) => y || x).replace(/\*\*/g, "")}</span> : undefined))
        : none(tr("Chưa có ghi chú nào trỏ tới đây.")))}
      {sec("go", tr("Liên kết đi"), d.outgoing.length, d.outgoing.length
        ? d.outgoing.map((o) => row(o.title, kindOf.get(fold(o.title)) ?? "note", o.exists ? undefined : tr("Chưa có ghi chú"), !o.exists))
        : none(tr("Ghi chú này chưa nối tới đâu.")))}
      {d.unlinked.length > 0 && sec("unl", tr("Nhắc tới (chưa nối)"), d.unlinked.length, <>
        <p className="bw-none">{tr("Synchro tự nối dần các chỗ nhắc tên trong trang nó viết; chỗ nhắc trong ghi chú riêng của bạn giữ nguyên.")}</p>
        {d.unlinked.map((b) => row(b.title, b.kind, <span data-notr>{b.context}</span>))}
      </>)}
      {heads.length > 0 && sec("out", trc("Đề mục", "ghi chú"), heads.length, (
        <div className="bw-outline">{heads.map((h, i) => <button key={i} style={{ paddingLeft: (h.level - 1) * 14 + 10 }} onClick={() => onOpen(d.note.title, h.text)} data-notr>{h.text}</button>)}</div>
      ))}
      {d.similar.length > 0 && sec("sim", trc("Gần nghĩa", "ghi chú"), d.similar.length, d.similar.map((x) => row(x.title, x.kind)))}
    </>
  );
}

// ---------------------------------------------------------------- Bảng: xem ghi chú theo thuộc tính
type ChatRow = { title: string; kind: Kind; date: number; models: string[]; topics: string[]; importance: number | null; turns: number; tasks: number; distilled: boolean };
type TaskRow = { task: string; title: string; kind: Kind; date: number; done?: boolean };
type WikiRow = { title: string; links: number; aliases: string[]; updatedAt: number; facts: number; type: string; up: string; desc: string };
function Bases({ onOpen, version }: { onOpen: Open; version: number }) {
  const say = useApp().say;
  const [view, setView] = useState<"tasks" | "chats" | "topics" | "entities">("tasks");
  const [rows, setRows] = useState<unknown[] | null>(null);
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: "date", dir: -1 });
  const [showDone, setShowDone] = useState(false);
  // Không tải được: báo lỗi và cho thử lại, không hiện bảng trống như thể chưa có gì.
  const [err, setErr] = useState("");
  const [again, setAgain] = useState(0);
  useEffect(() => { setRows(null); setErr(""); api<{ rows?: unknown[] }>("GET", `/api/brain?table=${view}`).then((j) => setRows(j.rows ?? [])).catch((e) => setErr((e as Error).message)); }, [view, version, again]);
  const toggle = (r: TaskRow) => void api<{ rows: TaskRow[] }>("POST", "/api/brain/task", { title: r.title, task: r.task, done: !r.done }).then((j) => setRows(j.rows)).catch((e) => say((e as Error).message));
  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => { const x = (a as Record<string, unknown>)[sort.k], y = (b as Record<string, unknown>)[sort.k]; return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))) * sort.dir; }), [rows, sort]);
  const th = (k: string, label: string) => <th><button onClick={() => setSort({ k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : -1 })}>{label}{sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></th>;
  const tasks = (sorted as TaskRow[]).filter((r) => showDone || !r.done);
  const link = (t: string) => <button className="bn-link" onClick={() => onOpen(t)} onMouseEnter={(e) => peek(t, e.currentTarget)} onMouseLeave={() => peek(null)} data-notr>{t}</button>;
  if (err) return <div className="bn-bases"><LoadRetry err={err} retry={() => setAgain((n) => n + 1)} /></div>;
  return (
    <div className="bn-bases">
      <header className="bw-page-h">
        <h2>{trc("Bảng", "trang bộ não")}</h2>
        <p>{tr("Xem cả bộ não theo hàng và cột: việc còn dang dở, đoạn chat, chủ đề, tên riêng. Bấm tiêu đề cột để sắp xếp.")}</p>
      </header>
      <div className="bn-filter">
        {([["tasks", tr("Việc dang dở")], ["chats", trc("Đoạn chat", "nhóm ghi chú")], ["topics", trc("Chủ đề", "nhóm ghi chú")], ["entities", trc("Tên riêng", "nhóm ghi chú")]] as const).map(([k, l]) => <button key={k} className={`bn-chip ${view === k ? "on" : ""}`} aria-pressed={view === k} onClick={() => { setView(k); setSort({ k: k === "tasks" || k === "chats" ? "date" : "links", dir: -1 }); }}>{l}</button>)}
        {view === "tasks" && <label className="bn-check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />{tr("Hiện cả việc đã xong")}</label>}
      </div>
      {rows === null ? <div className="us-empty"><span className="art-spin sm" /></div> : view === "tasks" ? (
        tasks.length ? <div className="bn-tasks">{tasks.map((r, i) => (
          <div key={`${r.title}-${i}`} className={`bn-task ${r.done ? "done" : ""}`}>
            <button className={`bn-box ${r.done ? "on" : ""}`} aria-label={r.done ? tr("Đánh dấu chưa xong") : tr("Đánh dấu đã xong")} onClick={() => toggle(r)}>{r.done && <I.Check size={10} />}</button>
            <span data-notr>{r.task}</span>{link(r.title)}
          </div>
        ))}</div> : <p className="d">{tr("Không còn việc nào dang dở. Việc còn dở dang trong các đoạn chat sẽ tự hiện ở đây.")}</p>
      ) : view === "chats" ? (
        <div className="bn-table-w"><table className="bn-table"><thead><tr>{th("title", tr("Đoạn chat"))}{th("date", tr("Ngày"))}<th>Model</th><th>{trc("Chủ đề", "nhóm ghi chú")}</th>{th("importance", trc("Quan trọng", "cột bảng"))}{th("tasks", trc("Việc dở", "cột bảng"))}</tr></thead>
          <tbody>{(sorted as ChatRow[]).map((r) => <tr key={r.title}><td>{link(r.title)}</td><td>{dateStr(r.date)}</td><td data-notr>{r.models.join(", ")}</td><td>{r.topics.map((x) => <span key={x}>{link(x)} </span>)}</td><td>{r.importance ?? "–"}</td><td>{r.tasks || ""}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="bn-table-w"><table className="bn-table"><thead><tr>{th("title", view === "topics" ? trc("Chủ đề", "loại ghi chú") : trc("Tên riêng", "loại ghi chú"))}{view === "entities" && <th>{trc("Loại", "ghi chú")}</th>}{th("links", trc("Liên kết", "cột bảng"))}{th("facts", tr("Điều đã biết"))}{view === "topics" && <th>{trc("Thuộc", "ghi chú")}</th>}<th>{trc("Tóm lược", "cột bảng")}</th></tr></thead>
          <tbody>{(sorted as WikiRow[]).map((r) => <tr key={r.title}><td>{link(r.title)}</td>{view === "entities" && <td data-notr>{r.type}</td>}<td>{r.links}</td><td>{r.facts || ""}</td>{view === "topics" && <td>{r.up ? link(r.up) : ""}</td>}<td data-notr>{r.desc}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Hoạt động: những gì bộ não vừa tự học, tự sắp xếp
// Mỗi loại việc một biểu tượng: học từ đoạn chat, biên soạn, gộp, tự nối, xếp bản đồ, chân dung, hướng dẫn, tổng hợp.
const ACT: [RegExp, (p: { size?: number }) => React.ReactNode, () => string][] = [
  [/^Học từ/, I.Book, () => trc("Học", "hoạt động bộ não")], [/^Biên soạn/, I.Pencil, () => trc("Biên soạn", "hoạt động bộ não")], [/^Gộp/, I.Merge, () => trc("Gộp", "hoạt động bộ não")],
  [/^Tự nối/, I.Connect, () => trc("Nối", "hoạt động bộ não")], [/^Xếp chủ đề/, I.Layers, () => trc("Bản đồ", "hoạt động bộ não")], [/chân dung/, I.User, () => trc("Chân dung", "hoạt động bộ não")],
  [/^Tự cập nhật Hướng dẫn/, I.Sparkle, () => trc("Hướng dẫn", "hoạt động bộ não")], [/^Tổng hợp/, I.Brain, () => trc("Tổng hợp", "hoạt động bộ não")],
];
function Activity({ onOpen, version }: { onOpen: Open; version: number }) {
  const [rows, setRows] = useState<{ at: number; text: string }[] | null>(null);
  const [err, setErr] = useState("");
  const [again, setAgain] = useState(0);
  useEffect(() => { setErr(""); api<{ log?: { at: number; text: string }[] }>("GET", "/api/brain?log=1").then((j) => setRows(j.log ?? [])).catch((e) => setErr((e as Error).message)); }, [version, again]);
  const head = (
    <header className="bw-page-h">
      <h2>{trc("Hoạt động", "trang bộ não")}</h2>
      <p>{tr("Những gì bộ não tự học và tự sắp xếp, mới nhất trước. Bạn không cần làm gì: Synchro tự chạy sau mỗi đoạn chat và định kỳ.")}</p>
    </header>
  );
  if (err && !rows) return <div className="bw-act-page">{head}<LoadRetry err={err} retry={() => setAgain((n) => n + 1)} /></div>;
  if (!rows) return <div className="bw-act-page">{head}<div className="us-empty"><span className="art-spin sm" /></div></div>;
  if (!rows.length) return <div className="bw-act-page">{head}<p className="bn-empty">{tr("Bộ não chưa học gì. Sau mỗi đoạn chat, Synchro tự học và ghi lại ở đây.")}</p></div>;
  const days = new Map<string, typeof rows>();
  for (const r of rows) { const k = dateStr(r.at); if (!days.has(k)) days.set(k, []); days.get(k)!.push(r); }
  return (
    <div className="bw-act-page">
      {head}
      <div className="bw-activity">
        {[...days].map(([k, rs]) => (
          <section key={k}>
            <h3>{k}</h3>
            <ol>
              {rs.map((r, i) => {
                const a = ACT.find(([re]) => re.test(r.text)), Ic = a?.[1] ?? I.Brain;
                return (
                  <li key={i} className="bw-act">
                    <time>{timeStr(r.at)}</time>
                    <span className="bw-act-ic" data-tip={a ? a[2]() : tr("Bộ não")}><Ic size={13} /></span>
                    <div className="bw-act-t"><Inline t={r.text} exists={new Set()} onOpen={onOpen} /></div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- không gian Bộ não (toàn trang)
// Lối vào: tên thật của ghi chú → nhãn hiện theo ngôn ngữ giao diện.
// Ghi chú khung luôn có, mở nhanh ở danh sách bên trái (tên dịch bằng tr khi hiện, kể cả trên đồ thị).
// "Về bạn", "Mục lục" là chữ ngắn dễ trùng (tiêu đề người dùng đặt): dịch theo ngữ cảnh, không để khóa trần cho bộ dịch trang.
const ENTRY_NAME: Record<string, () => string> = {
  "Quy tắc hàng đầu": () => tr("Quy tắc hàng đầu"),
  "Bộ não": () => tr("Bộ não"),
  "Về bạn": () => trc("Về bạn", "lối vào bộ não"),
  "Mục lục": () => trc("Mục lục", "lối vào bộ não"),
  "Hoạt động bộ não": () => tr("Hoạt động bộ não"),
};
const ENTRY = Object.keys(ENTRY_NAME);
const entryName = (t: string) => ENTRY_NAME[t]?.() ?? t;
export function BrainWorkspace({ initial, onInitial, sideOpen = true, onSide }: { initial?: string | null; onInitial?: () => void; sideOpen?: boolean; onSide?: () => void }) {
  const app = useApp();
  const [g, setG] = useState<Graph | null>(null);
  const [ver, setVer] = useState(0);
  const [tab, setTab] = useState<"graph" | "note" | "bases" | "activity">("graph");
  const [hist, setHist] = useState<{ list: { title: string; sub?: string }[]; i: number }>({ list: [], i: -1 });
  const [cur, setCur] = useState<NoteData | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ title: string; kind: Kind; snippet: string }[] | null>(null);
  const [gs, setGs] = useGS("global");
  const [panel, setPanel] = useState(false);
  const [cut, setCut] = useState<number | null>(null);
  const [side, setSide] = useState<"" | "left" | "right">("");
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [fold0, setFold0] = useState<Record<string, boolean>>({ chat: true, tags: true, daily: true });
  const [findOpen, setFindOpen] = useState(false);
  // Cột liên kết bên phải ẩn / hiện được trên màn rộng (nhớ theo trình duyệt); trên điện thoại nó là ngăn kéo.
  const [rightOff, setRightOff] = useState(false);
  useEffect(() => { try { setRightOff(localStorage.getItem("bn:right-off") === "1"); } catch {} }, []);
  const setRight = (off: boolean) => { setRightOff(off); try { localStorage.setItem("bn:right-off", off ? "1" : "0"); } catch {} };
  const narrow = () => typeof window !== "undefined" && window.matchMedia(maxW("md")).matches;
  const [sel, setSel] = useState(0);
  const findRef = useRef<HTMLDivElement>(null);
  // Kết quả mới về thì chọn lại mục đầu; chọn bằng phím thì cuộn mục đó vào tầm nhìn.
  useEffect(() => setSel(0), [found]);
  useEffect(() => { findRef.current?.querySelector(".bw-find-it.on")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  useEffect(() => {
    if (!findOpen) return;
    const h = (e: MouseEvent) => { if (isAway(findRef.current, e.target)) setFindOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [findOpen]);
  // Lỗi mạng hay lỗi máy chủ: báo rõ kèm nút thử lại, không quay mãi. Đã có dữ liệu thì giữ dữ liệu cũ và thôi báo khi đọc lại được.
  const [loadErr, setLoadErr] = useState(false);
  const [relearning, setRelearning] = useState(false);
  const load = useCallback(() => fetch("/api/brain", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.nodes) { setG(j); setVer((v) => v + 1); setLoadErr(false); } else setLoadErr(true); }).catch(() => setLoadErr(true)), []);
  // Chọn hàng loạt ở cột trái: ghim / bỏ ghim / xóa nhiều ghi chú (quy tắc hàng đầu và trang hệ thống không chọn được).
  const pickable = (g?.nodes ?? []).filter((n) => ["map", "topic", "entity", "note", "chat", "code", "daily"].includes(n.kind));
  const bkN = useBulk(pickable, (n) => n.title);
  // Mỗi nhóm ở cột trái chia trang gọn 15 mục (thay cho cắt ở 60 mục "tìm để mở").
  const [gpg, setGpg] = useState<Record<string, number>>({});
  const noteActs: BulkAct<GNode>[] = [
    { id: "pin", label: tr("Ghim"), icon: <I.M icon="Pin" size={15} />, when: (l) => l.some((n) => !n.pinned), run: async (l) => { await each(l.filter((n) => !n.pinned), (n) => api("PUT", "/api/brain/note", { title: n.title, pinned: true })); await load(); } },
    { id: "unpin", label: tr("Bỏ ghim"), icon: <I.M icon="PinOff" size={15} />, when: (l) => l.some((n) => n.pinned), run: async (l) => { await each(l.filter((n) => n.pinned), (n) => api("PUT", "/api/brain/note", { title: n.title, pinned: false })); await load(); } },
    { id: "del", label: tr("Xóa"), icon: <I.Trash size={15} />, danger: true,
      confirm: (l) => ({ title: tf("Xóa {n} ghi chú?", { n: l.length }), text: tr("Các liên kết tới chúng sẽ thành ghi chú chưa có. Synchro có thể viết lại các trang này khi học thêm."), ok: tr("Xóa") }),
      run: async (l) => { await each(l, (n) => api("DELETE", `/api/brain/note?title=${encodeURIComponent(n.title)}`)); if (at && l.some((n) => n.title === at.title)) setTab("graph"); await load(); app.say(tf("Đã xóa {n} ghi chú", { n: l.length })); } },
  ];
  useEffect(() => { void load(); fetch("/api/brain?tags=1", { cache: "no-store" }).then((r) => r.json()).then((j) => setTags(j.tags ?? [])).catch(() => {}); }, [load]);
  // Bộ não tự học ở nền: đọc lại định kỳ (dày hơn khi còn đoạn chat chờ học) để thấy nó lớn dần.
  useEffect(() => { const t = setInterval(load, g?.stats.pending ? 15_000 : 60_000); return () => clearInterval(t); }, [g?.stats.pending, load]);
  const at = hist.i >= 0 ? hist.list[hist.i] : null;
  const open: Open = useCallback((title, sub) => {
    peek(null);
    if (!title) { setTab("graph"); setCur(null); return; }
    setHist((h) => (h.list[h.i]?.title === title && h.list[h.i]?.sub === sub ? h : { list: [...h.list.slice(0, h.i + 1), { title, sub }].slice(-50), i: Math.min(h.i + 1, 49) }));
    setCur((c) => (c && fold(c.note.title) === fold(title) ? c : null)); setTab("note"); setSide("");
  }, []);
  useEffect(() => { if (initial) { open(initial); onInitial?.(); } }, [initial, open, onInitial]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound(null); return; }
    const t0 = setTimeout(() => { fetch(`/api/brain?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setFound(j.results ?? [])).catch(() => setFound([])); }, 220);
    return () => clearTimeout(t0);
  }, [q, ver]);
  // Phím tắt: ⌘/Ctrl+[ ] lùi / tiến, "/" để tìm.
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "[") { e.preventDefault(); setHist((h) => ({ ...h, i: Math.max(0, h.i - 1) })); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "]") { e.preventDefault(); setHist((h) => ({ ...h, i: Math.min(h.list.length - 1, h.i + 1) })); }
      else if ((e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o")) && !(e.target as HTMLElement).closest("input,textarea,[contenteditable]")) { e.preventDefault(); search.current?.focus(); setFindOpen(true); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const exists = useMemo(() => new Set((g?.nodes ?? []).filter((n) => n.kind !== "ghost").flatMap((n) => [n.title, ...(n.aliases ?? [])]).map(fold)), [g]);
  const today = () => { const d = new Date(); return `Nhật ký ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  // Tua lại: ghi chú hiện dần theo thứ tự được tạo, bung ra từ tâm như lúc bộ não hình thành.
  const animate = () => {
    if (!g) return;
    const ts = g.nodes.filter((n) => n.kind !== "ghost").map((n) => n.created).sort((a, b) => a - b);
    if (ts.length < 2) return;
    const t0 = ts[0], t1 = ts[ts.length - 1], start = performance.now(), dur = 7000;
    setTab("graph");
    const step = () => { const f = Math.min(1, (performance.now() - start) / dur); setCut(f >= 1 ? null : t0 + (t1 - t0) * f); if (f < 1) requestAnimationFrame(step); };
    setCut(t0); requestAnimationFrame(step);
  };
  const s = g?.stats;
  const byKind = (k: Kind[]) => (g?.nodes ?? []).filter((n) => k.includes(n.kind));
  // Nhóm trong cột trái: gọi như hàm để không dựng lại khi danh sách đổi.
  const GRP = 15;
  const pageOf = (k: string, list: GNode[]) => Math.min(gpg[k] ?? 1, Math.max(1, Math.ceil(list.length / GRP)));
  const grp = (k: string, t: string, list: GNode[], _limit = 60, add?: React.ReactNode) => !list.length && !add ? null : (
    <section className="bw-grp" key={k}>
      <div className="bw-grp-h">
        <button aria-expanded={!fold0[k]} onClick={() => setFold0({ ...fold0, [k]: !fold0[k] })}><I.ChevronR size={11} /><span>{t}</span></button>
        {add}<em>{list.length}</em>
      </div>
      {!fold0[k] && <div className="bw-grp-b">{list.slice((pageOf(k, list) - 1) * GRP, pageOf(k, list) * GRP).map((n) => (
        <button key={n.id} className={`bw-item ${at?.title === n.title && tab === "note" ? "on" : ""}`} onClick={() => open(n.title)} title={n.title} {...(n.kind === "rule" ? {} : bulkRow(bkN, n))}>
          {bkN.on && n.kind !== "rule" ? <BulkCheck on={bkN.has(n)} /> : <KindIcon k={n.kind} size={13} />}<span data-notr>{n.title}</span>{n.pinned && k !== "pin" && <I.Pin size={11} />}
        </button>))}
        {list.length > GRP && <Pager compact page={pageOf(k, list)} pages={Math.ceil(list.length / GRP)} from={(pageOf(k, list) - 1) * GRP + 1} to={Math.min(pageOf(k, list) * GRP, list.length)} total={list.length} onPage={(n) => setGpg({ ...gpg, [k]: n })} />}
      </div>}
    </section>
  );
  const failed = s?.failed ?? 0;
  const relearn = () => { setRelearning(true); void fetch("/api/brain/distill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retry: true }) }).then(() => load()).catch(() => {}).finally(() => setRelearning(false)); };
  const status = !s ? "" : s.pending ? tf("Đang học {n} đoạn chat", { n: s.pending }) : s.learnedAt ? tf("Đã học lúc {time}", { time: timeStr(s.learnedAt) }) : tr("Chưa học đoạn chat nào");
  const statusTip = s?.learnedAt ? tf("Lần học gần nhất: {time}, {date}. Synchro tự học sau mỗi đoạn chat.", { time: timeStr(s.learnedAt), date: dateStr(s.learnedAt) }) : tr("Synchro tự học sau mỗi đoạn chat.");
  const byLinks = (a: GNode, b: GNode) => b.links - a.links || a.title.localeCompare(b.title, "vi");
  // Ô tìm nhanh: gõ để tìm (có toán tử), ↑ ↓ để chọn, Enter để mở, Esc để đóng; chưa gõ thì hiện các ghi chú vừa mở.
  const recent = [...new Set([...hist.list].reverse().map((h) => h.title))].slice(0, 6).map((t) => ({ title: t, kind: (g?.nodes.find((n) => n.title === t)?.kind ?? "note") as Kind, snippet: "" }));
  const items = q.trim().length >= 2 ? found ?? [] : recent;
  const pickAt = (i: number) => { const it = items[i]; if (!it) return; open(it.title); setFindOpen(false); setQ(""); search.current?.blur(); };
  const findKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((x) => Math.max(0, Math.min(items.length - 1, x + 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pickAt(sel); }
    else if (e.key === "Escape") { setFindOpen(false); search.current?.blur(); }
  };
  const view = (k: typeof tab, label: string, disabled = false) => (
    <button role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} disabled={disabled} onClick={() => setTab(k)}>{label}</button>
  );
  return (
    <div className={`bw ${side ? `show-${side}` : ""} ${rightOff ? "no-right" : ""}`}>
      <Peek onOpen={open} />
      <header className="bw-top">
        <div className="bw-top-l">
          {!sideOpen && onSide && <SideToggle onClick={onSide} />}
          <button className="icon-btn bw-only-m" aria-label={tr("Danh sách ghi chú")} onClick={() => setSide(side === "left" ? "" : "left")}><I.List size={16} /></button>
          <span className="bw-brand"><I.Brain size={17} /><b>{tr("Bộ não")}</b></span>
          <span className="bw-nav">
            <button className="icon-btn" aria-label={trc("Lùi", "lịch sử ghi chú")} data-tip={trc("Lùi (⌘[)", "lịch sử ghi chú")} disabled={hist.i <= 0} onClick={() => { setHist((h) => ({ ...h, i: h.i - 1 })); setTab("note"); }}><I.Back size={15} /></button>
            <button className="icon-btn bw-fwd" aria-label={trc("Tiến", "lịch sử ghi chú")} data-tip={trc("Tiến (⌘])", "lịch sử ghi chú")} disabled={hist.i >= hist.list.length - 1} onClick={() => { setHist((h) => ({ ...h, i: h.i + 1 })); setTab("note"); }}><I.Back size={15} /></button>
          </span>
        </div>
        <div className="bw-views" role="tablist" aria-label={tr("Chế độ xem")}>
          {view("graph", trc("Đồ thị", "trang bộ não"))}{view("note", trc("Ghi chú", "trang bộ não"), !at)}{view("bases", trc("Bảng", "trang bộ não"))}{view("activity", trc("Hoạt động", "trang bộ não"))}
        </div>
        <div className="bw-top-r">
          <div className={`bw-find ${findOpen ? "open" : ""}`} ref={findRef}>
            <I.Search size={14} />
            <input ref={search} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); setFindOpen(true); }} onFocus={() => setFindOpen(true)} onKeyDown={findKey}
              placeholder={tr("Tìm trong bộ não")} aria-label={tr("Tìm trong bộ não")} role="combobox" aria-expanded={findOpen} aria-controls="bw-find-list" />
            {!q && <kbd>/</kbd>}
            {q && <button className="bw-find-x" aria-label={tr("Xóa ô tìm")} onClick={() => { setQ(""); search.current?.focus(); }}><I.X size={12} /></button>}
            {findOpen && (
              <div className="bw-find-pop" id="bw-find-list" role="listbox">
                {(q.trim().length >= 2 || items.length > 0) && <div className="bw-find-h">{q.trim().length >= 2 ? (found ? tf("{n} kết quả", { n: found.length }) : trc("Đang tìm…", "tìm ghi chú")) : trc("Vừa mở", "tìm ghi chú")}</div>}
                {items.map((r, i) => (
                  <button key={r.title} role="option" aria-selected={i === sel} className={`bw-find-it ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pickAt(i)}>
                    <KindIcon k={r.kind} size={14} /><span><b data-notr>{r.title}</b>{r.snippet && <small data-notr>{plain(r.snippet)}</small>}</span><em>{kindName(r.kind) || null}</em>
                  </button>
                ))}
                {!items.length && !(q.trim().length >= 2 && !found) && <p className="bw-none">{q.trim().length >= 2 ? tr("Không có ghi chú nào khớp.") : tr("Gõ để tìm ghi chú, chủ đề, đoạn chat…")}</p>}
                <div className="bw-find-f">{tr("Lọc được: tag:thẻ · loai:chu-de / ten-rieng / ban-do / doan-chat · task-todo: · \"cụm từ\" · -loại trừ")}</div>
              </div>
            )}
          </div>
          <span className={`bw-status ${s?.pending ? "busy" : ""}`} data-tip={statusTip}>{s?.pending ? <span className="bw-pulse" /> : <span className="bw-dot" />}<span className="bw-status-t">{status}</span></span>
          {/* Học lỗi (gói hết hạn, hết hạn mức): nói ra thay vì để "Đã học lúc…" trông như đã cập nhật đủ. */}
          {failed > 0 && <span className="bw-failed" data-tip={s?.learnError ? tf("Lỗi gần nhất: {learnError}", { learnError: s.learnError }) : undefined}><I.Alert size={13} /><span>{tf("Chưa học được {n} đoạn chat", { n: failed })}</span><button className="lnk" disabled={relearning} onClick={relearn}>{relearning ? trc("Đang học…", "bộ não") : trc("Học lại", "bộ não")}</button></span>}
          {tab === "note" && <button className={`icon-btn bw-rt ${narrow() ? (side === "right" ? "on" : "") : rightOff ? "" : "on"}`} aria-label={tr("Liên kết của ghi chú")} data-tip={narrow() ? undefined : rightOff ? tr("Hiện liên kết của ghi chú") : tr("Ẩn liên kết của ghi chú")}
            aria-pressed={narrow() ? side === "right" : !rightOff} onClick={() => narrow() ? setSide(side === "right" ? "" : "right") : setRight(!rightOff)}><I.PanelR size={16} /></button>}
        </div>
      </header>
      <aside className="bw-left" aria-label={tr("Khám phá bộ não")}>
        {!g ? (loadErr ? <div className="us-empty" role="alert"><span>{tr("Không tải được Bộ não.")}</span><button className="btn sm" onClick={() => { setLoadErr(false); void load(); }}>{tr("Thử lại")}</button></div> : <div className="us-empty"><span className="art-spin sm" /></div>) : (
          <>
            {pickable.length > 0 && <div className="bk-head bw-bk"><BulkButton b={bkN} compact /></div>}
            <nav className="bw-entry">
              {ENTRY.map((t) => { const n = g.nodes.find((x) => x.title === t); return n ? <button key={t} className={`bw-item ${at?.title === t && tab === "note" ? "on" : ""}`} onClick={() => open(t)}><KindIcon k={n.kind} size={14} /><span>{entryName(t)}</span>{n.pinned && <I.Pin size={11} />}</button> : null; })}
              {g.nodes.some((n) => n.title === today()) && <button className={`bw-item ${at?.title === today() && tab === "note" ? "on" : ""}`} onClick={() => open(today())}><KindIcon k="daily" size={14} /><span>{tr("Hôm nay")}</span></button>}
            </nav>
            {grp("pin", tr("Đã ghim"), (g.nodes ?? []).filter((n) => n.pinned && n.kind !== "rule"))}
            {grp("map", trc("Bản đồ", "nhóm ghi chú"), byKind(["map"]))}
            {grp("topic", trc("Chủ đề", "nhóm ghi chú"), byKind(["topic"]).sort(byLinks))}
            {grp("entity", trc("Tên riêng", "nhóm ghi chú"), byKind(["entity"]).sort(byLinks))}
            {grp("note", trc("Ghi chú của bạn", "nhóm ghi chú"), byKind(["note"]).sort((a, b) => b.created - a.created), 60,
              <button className="bw-grp-add" aria-label={tr("Ghi chú mới")} data-tip={tr("Ghi chú mới")} onClick={() => open(tr("Ghi chú mới"))}><I.Plus size={13} /></button>)}
            {grp("chat", trc("Đoạn chat", "nhóm ghi chú"), byKind(["chat", "code"]).sort((a, b) => b.created - a.created), 80)}
            {grp("daily", trc("Nhật ký", "nhóm ghi chú"), byKind(["daily"]).sort((a, b) => b.title.localeCompare(a.title)), 30)}
            {tags.length > 0 && <section className="bw-grp">
              <div className="bw-grp-h"><button aria-expanded={!fold0.tags} onClick={() => setFold0({ ...fold0, tags: !fold0.tags })}><I.ChevronR size={11} /><span>{tr("Thẻ")}</span></button><em>{tags.length}</em></div>
              {!fold0.tags && <div className="bw-tags">{tags.slice(0, 40).map((t) => <button key={t.tag} className="bn-tag" onClick={() => { setQ(`tag:${t.tag}`); setFindOpen(true); search.current?.focus(); }} data-notr>#{t.tag}<em>{t.count}</em></button>)}</div>}
            </section>}
            <BulkBar b={bkN} acts={noteActs} noun="ghi chú" compact />
            {g.stats.chats === 0 && <p className="bw-hint">{tr("Bộ não tự lớn lên sau mỗi đoạn chat: chủ đề, tên riêng và chân dung của bạn sẽ hiện ở đây.")}</p>}
          </>
        )}
      </aside>
      <div className="bw-main">
        <h1 className="sr-only">{tr("Bộ não")}</h1>
        {!g ? <div className="us-empty"><span className="art-spin sm" /></div> : <>
          {/* Đồ thị luôn chạy (ẩn khi xem tab khác) để quay lại vẫn y nguyên như lúc rời đi. */}
          <div className="bw-graph" hidden={tab !== "graph"}>
            <BrainGraph data={g} gs={gs} cutoff={cut} active={null} height="100%" onOpen={(t) => open(t)} onBg={() => setPanel(false)} />
            <button className={`bw-gear ${panel ? "on" : ""}`} aria-expanded={panel} onClick={() => setPanel(!panel)}><I.Sliders size={14} />{tr("Tùy chỉnh")}</button>
            {panel && <GraphPanel gs={gs} set={setGs} onAnimate={animate} onClose={() => setPanel(false)} />}
            {s && <div className="bw-count"><span><b>{s.notes}</b>{tr("ghi chú")}</span><span><b>{s.links}</b>{trc("liên kết", "số đếm bộ não")}</span><span><b>{s.topics}</b>{trc("chủ đề", "số đếm bộ não")}</span><span><b>{s.entities}</b>{trc("tên riêng", "số đếm bộ não")}</span></div>}
            {!g.cfg.gen && <p className="bn-off">{tr("Đang tắt học từ đoạn chat (Cài đặt → Bộ não), nên bộ não không lớn thêm.")}</p>}
          </div>
          {tab === "note" && at ? <div className="bw-reader"><NoteView key={`${at.title}`} title={at.title} sub={at.sub} exists={exists} onOpen={open} onChanged={() => void load()} onLoaded={setCur} /></div>
            : tab === "bases" ? <div className="bw-pad"><Bases onOpen={open} version={ver} /></div> : tab === "activity" ? <div className="bw-pad"><Activity onOpen={open} version={ver} /></div> : null}
        </>}
      </div>
      {tab === "note" && cur && g && <aside className="bw-right" aria-label={tr("Liên kết của ghi chú")}><NoteSide d={cur} graph={g} exists={exists} onOpen={open} /></aside>}
      {side && <button className="bw-scrim" aria-label={tr("Đóng")} onClick={() => setSide("")} />}
    </div>
  );
}

// ---------------------------------------------------------------- Cài đặt → Bộ não: tổng quan, bật tắt, dữ liệu
export function BrainSettings({ memory }: { memory: React.ReactNode }) {
  const app = useApp();
  const [g, setG] = useState<Graph | null>(null);
  const [gs] = useGS("mini");
  const [err, setErr] = useState("");
  const load = useCallback(() => { setErr(""); return api<Graph>("GET", "/api/brain").then((j) => { if (j?.nodes) setG(j); }).catch((e) => setErr((e as Error).message)); }, []);
  useEffect(() => { void load(); }, [load]);
  const openBrain = (title?: string) => window.dispatchEvent(new CustomEvent("synchro:brain", { detail: { title: title ?? null } }));
  const setAuto = (on: boolean) => void api("PUT", "/api/brain/instructions", { auto: on }).then(() => { void load(); app.say(on ? tr("Synchro sẽ tự cập nhật hướng dẫn từ các đoạn chat") : tr("Đã tắt tự cập nhật hướng dẫn")); }).catch((e) => app.say(e.message));
  const wipe = () => app.confirm(tr("Xóa toàn bộ bộ não?"), tr("Synchro quên sạch mọi điều về bạn: ghi chú, liên kết, chủ đề, hoạt động, ký ức dài hạn, bộ nhớ dự án, phần tự giới thiệu và hướng dẫn (cả lịch sử), tên gọi. Chỉ giữ Quy tắc hàng đầu và những gì có lúc tạo tài khoản (họ tên, lĩnh vực). Các đoạn chat vẫn còn."), tr("Xóa"),
    () => { void api<Graph>("DELETE", "/api/brain").then((j) => { setG({ ...j, cfg: g?.cfg ?? j.cfg }); window.dispatchEvent(new Event("synchro:forget")); app.say(tr("Đã xóa bộ não")); }).catch((e) => app.say(e.message)); });
  const s = g?.stats;
  return (
    <div className="bn">
      <h3 style={{ marginTop: 0 }}>{tr("Bộ não")}</h3>
      <p className="d" style={{ margin: "-4px 0 12px" }}>{tr("Sau mỗi đoạn chat, Synchro tự rút ra phần tinh túy và nối nó vào bộ não chung: trang chủ đề, tên riêng, chân dung của bạn, các đoạn chat liên quan. Định kỳ nó tự gộp điều trùng, tự nối liên kết, xếp chủ đề vào bản đồ và tự cập nhật Hướng dẫn cho Synchro. Claude, ChatGPT, Gemini, Grok và DeepSeek là các bán cầu dùng chung bộ não này. Bộ não lưu trên máy chủ của bạn.")}</p>
      {s && <div className="bn-stats">
        <span><b>{s.notes}</b>{tr("ghi chú")}</span><span><b>{s.links}</b>{trc("liên kết", "số đếm bộ não")}</span><span><b>{s.chats}</b>{tr("đoạn chat đã học")}</span>
        <span><b>{s.topics}</b>{trc("chủ đề", "số đếm bộ não")}</span><span><b>{s.entities}</b>{trc("tên riêng", "số đếm bộ não")}</span>
        {s.pending > 0 && <span className="wait"><b>{s.pending}</b>{trc("đang học", "số đếm bộ não")}</span>}
      </div>}
      {g ? <div className="bn-mini" role="button" tabIndex={0} aria-label={tr("Mở bộ não")} onKeyDown={rowKeys(() => openBrain())}>
        <BrainGraph data={g} gs={gs} mini height={220} onOpen={(t) => openBrain(t)} onBg={() => openBrain()} />
      </div> : err ? <LoadRetry err={err} retry={() => void load()} /> : <div className="us-empty"><span className="art-spin sm" /></div>}
      <div className="bn-acts" style={{ margin: "12px 0 18px" }}>
        <button className="btn dark" onClick={() => openBrain()}><I.Brain size={14} />{tr("Mở bộ não")}</button>
        <a className="btn" href="/api/brain/export" download><I.Download size={13} />{tr("Tải bộ não về (.zip Markdown)")}</a>
        <button className="btn danger-t" onClick={wipe}><I.Trash size={13} />{tr("Xóa bộ não")}</button>
      </div>
      {g && <label className="bn-auto">
        <span><b>{tr("Tự cập nhật Hướng dẫn cho Synchro")}</b><small>{tr("Từ những gì bộ não biết về bạn (thói quen, chuyên ngành, cách bạn muốn được trả lời), Synchro tự viết lại phần hướng dẫn ở Cài đặt → Tài khoản. Bản bạn tự viết luôn được giữ ý; các bản cũ nằm trong lịch sử để quay lại.")}</small></span>
        <button role="switch" aria-checked={g.cfg.autoIns} className={`bg-sw ${g.cfg.autoIns ? "on" : ""}`} onClick={() => setAuto(!g.cfg.autoIns)}><i /></button>
      </label>}
      <div className="bn-mem">{memory}</div>
    </div>
  );
}

