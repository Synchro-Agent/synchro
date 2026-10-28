"use client";
// Bộ não: không gian riêng (thanh bên → Bộ não) để đi trong mạng ghi chú mà Synchro tự xây và tự chăm sóc từ các đoạn chat.
// - Đồ thị: mỗi chấm là một ghi chú, mỗi đường là một [[liên kết]]; chấm càng nhiều liên kết càng to. Màu trầm, chỉ sáng màu nhấn khi
//   rê chuột (ghi chú lân cận sáng theo, phần còn lại mờ dần); các chấm bung ra từ tâm rồi lắng lại như lò xo; kéo một chấm thì các chấm
//   nối với nó bị kéo theo; cuộn để phóng to êm, chữ hiện dần khi phóng to. Bảng cài đặt: lọc, nhóm màu, hiển thị, lực.
// - Ghi chú: thuộc tính, nội dung với [[liên kết]] (rê chuột để xem nhanh), nhúng ![[...]], đề mục, liên kết đến đây, gần nghĩa,
//   đồ thị cục bộ. Synchro tự viết các trang; bạn thêm "Ghi chú của bạn" hoặc ghi chú riêng.
// - Bảng, Hoạt động: việc dang dở, đoạn chat, chủ đề, tên riêng; những gì bộ não vừa tự học.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as I from "./icons";
import { type Chat, useApp } from "./store";
import { getLang } from "./i18n";

type Kind = "hub" | "about" | "model" | "chat" | "code" | "topic" | "entity" | "map" | "index" | "log" | "skill" | "connector" | "note" | "daily" | "ghost" | "tag";
type GNode = { id: string; title: string; kind: Kind; tags: string[]; created: number; links: number; aliases?: string[]; pinned?: boolean };
type Stats = { notes: number; links: number; chats: number; topics: number; entities: number; maps: number; pending: number; memories: number; learnedAt: number | null; gardenAt: number | null };
type Graph = { nodes: GNode[]; edges: { s: string; t: string }[]; stats: Stats; cfg: { gen: boolean; sens: boolean; autoIns: boolean } };
type Fact = { t: string; src?: string; at: number };
type NoteData = {
  note: { id: string; kind: Kind; title: string; body: string; createdAt: number; updatedAt: number; editable: boolean; generated: boolean; tags: string[];
    props: { date?: number; models?: Record<string, number>; userNote?: string; importance?: number; turns?: number; aliases?: string[]; tags?: string[]; pinned?: boolean; facts?: Fact[]; etype?: string; up?: string } };
  outgoing: { title: string; exists: boolean }[]; backlinks: { title: string; kind: Kind; context: string }[]; unlinked: { title: string; kind: Kind; context: string }[]; similar: { title: string; kind: Kind }[];
};

const en = () => getLang() === "en";
const L = (vi: string, e: string) => (en() ? e : vi);
const KIND: Record<Kind, [string, string]> = {
  hub: ["Trung tâm", "Hub"], about: ["Về bạn", "About you"], model: ["Bán cầu", "Hemisphere"], chat: ["Đoạn chat", "Chat"], code: ["Synchro Code", "Synchro Code"],
  topic: ["Chủ đề", "Topic"], entity: ["Tên riêng", "Entity"], map: ["Bản đồ", "Map"], index: ["Mục lục", "Index"], log: ["Hoạt động", "Activity"],
  skill: ["Skill", "Skill"], connector: ["Connector", "Connector"], note: ["Ghi chú của bạn", "Your note"], daily: ["Nhật ký", "Daily note"], ghost: ["Chưa có ghi chú", "Not created yet"], tag: ["Thẻ", "Tag"],
};
const KIND_ICON: Partial<Record<Kind, (p: { size?: number }) => React.ReactNode>> = {
  hub: I.Brain, about: I.User, model: I.Sparkle, chat: I.Chat2, code: I.Code, topic: I.Bulb, entity: I.Book, map: I.Layers, index: I.List, log: I.History,
  skill: I.Scroll, connector: I.Connectors, note: I.Pencil, daily: I.Calendar, ghost: I.Ghost,
};
const KindIcon = ({ k, size = 14 }: { k: Kind; size?: number }) => { const Ic = KIND_ICON[k]; return Ic ? <span className="bw-ki" aria-hidden><Ic size={size} /></span> : <span className="bw-ki" aria-hidden>#</span>; };
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
const dateStr = (ms: number) => new Date(ms).toLocaleDateString(en() ? "en-US" : "vi-VN", { day: "numeric", month: "short", year: "numeric" });
const timeStr = (ms: number) => new Date(ms).toLocaleTimeString(en() ? "en-US" : "vi-VN", { hour: "2-digit", minute: "2-digit" });
const slug = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Lỗi ${r.status}`);
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
    const k = Math.min(1.8, Math.max(0.2, Math.min(el.clientWidth / (maxX - minX + 140), el.clientHeight / (maxY - minY + 110))));
    const g = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k };
    if (animate) goal.current = g; else view.current = g;
    dirty.current = true;
  }, [nodes]);

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
        const fs = 11 + (nd.kind === "hub" ? 2 : 0), label = nd.title.length > 40 ? `${nd.title.slice(0, 39)}…` : nd.title;
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
        role="img" aria-label={L(`Đồ thị bộ não: ${nodes.length} ghi chú, ${edges.length} liên kết`, `Brain graph: ${nodes.length} notes, ${edges.length} links`)} />
      {!mini && <div className="bn-zoom">
        <button className="icon-btn" aria-label={L("Phóng to", "Zoom in")} onClick={() => zoom(1.3)}><I.Plus size={14} /></button>
        <button className="icon-btn" aria-label={L("Thu nhỏ", "Zoom out")} onClick={() => zoom(1 / 1.3)}><I.Minus size={14} /></button>
        <button className="icon-btn" aria-label={L("Vừa khung", "Fit to view")} onClick={() => { touched.current = false; fit(true); }}><I.Expand size={13} /></button>
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
    <label className="bg-row col" key={k}><span>{t}</span><input type="range" min={min} max={max} step={st} value={gs[k]} onChange={(e) => set({ [k]: Number(e.target.value) })} /></label>
  );
  return (
    <div className="bg-panel" role="dialog" aria-label={L("Cài đặt đồ thị", "Graph settings")}>
      <div className="bg-top">
        <b>{local ? L("Đồ thị cục bộ", "Local graph") : L("Đồ thị", "Graph")}</b>
        <button className="icon-btn" aria-label={L("Đặt lại mặc định", "Restore defaults")} data-tip={L("Đặt lại mặc định", "Restore defaults")} onClick={() => set(null)}><I.Retry size={13} /></button>
        {onClose && <button className="icon-btn" aria-label={L("Đóng", "Close")} onClick={onClose}><I.X size={14} /></button>}
      </div>
      {sec("filter", L("Lọc", "Filters"), <>
        {local && sl("depth", L("Độ sâu", "Depth"), 1, 3, 1)}
        <input className="field bg-q" value={gs.search} onChange={(e) => set({ search: e.target.value })} placeholder={L("Tìm ghi chú… (tag:, loai:, file:)", "Search notes… (tag:, kind:, file:)")} />
        {local && <>{tog("inc", L("Liên kết đến", "Incoming links"))}{tog("out", L("Liên kết đi", "Outgoing links"))}{tog("nbr", L("Liên kết giữa lân cận", "Neighbor links"))}</>}
        {tog("tags", L("Thẻ", "Tags"))}
        {tog("orphans", L("Ghi chú lẻ", "Orphans"))}
        {tog("existing", L("Chỉ ghi chú đã có", "Existing notes only"))}
      </>)}
      {sec("groups", L("Nhóm", "Groups"), <>
        {gs.groups.map((g, i) => (
          <div key={i} className="bg-grp">
            <input type="color" value={g.color} aria-label={L("Màu nhóm", "Group color")} onChange={(e) => set({ groups: gs.groups.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
            <input className="field" value={g.q} placeholder={L("tag:thẻ, loai:chu-de, chữ…", "tag:x, kind:topic, text…")} onChange={(e) => set({ groups: gs.groups.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
            <button className="icon-btn" aria-label={L("Xóa nhóm", "Delete group")} onClick={() => set({ groups: gs.groups.filter((_, j) => j !== i) })}><I.X size={12} /></button>
          </div>
        ))}
        <button className="btn sm" onClick={() => set({ groups: [...gs.groups, { q: "", color: SWATCH[gs.groups.length % SWATCH.length] }] })}><I.Plus size={12} />{L("Nhóm mới", "New group")}</button>
      </>)}
      {sec("display", L("Hiển thị", "Display"), <>
        {tog("arrows", L("Mũi tên", "Arrows"))}
        {sl("fade", L("Ngưỡng mờ chữ", "Text fade threshold"), 0, 1, 0.05)}
        {sl("size", L("Cỡ nút", "Node size"), 0.4, 2.5, 0.05)}
        {sl("thick", L("Độ dày liên kết", "Link thickness"), 0.3, 3, 0.05)}
        {onAnimate && <button className="btn sm" onClick={onAnimate}><I.Play size={11} />{L("Tua lại quá trình hình thành", "Animate")}</button>}
      </>)}
      {sec("forces", L("Lực", "Forces"), <>
        {sl("center", L("Hút tâm", "Center force"), 0, 1, 0.02)}
        {sl("repel", L("Đẩy nhau", "Repel force"), 0, 20, 0.5)}
        {sl("link", L("Lực liên kết", "Link force"), 0, 1, 0.02)}
        {sl("dist", L("Độ dài liên kết", "Link distance"), 30, 250, 5)}
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
      {p.d ? <NoteMd text={p.d.note.body.slice(0, 1400)} exists={new Set()} onOpen={(t) => { onOpen(t); setP(null); }} depth={2} /> : peekCache.has(fold(p.title)) ? <p className="d">{L("Chưa có ghi chú này.", "This note doesn't exist yet.")}</p> : <span className="art-spin sm" />}
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
          return <button key={i} type="button" className={`bn-link ${ok ? "" : "ghost"}`} data-notr onClick={() => onOpen(title, sub)}
            onMouseEnter={(e) => title && peek(title, e.currentTarget)} onMouseLeave={() => peek(null)} onFocus={(e) => title && peek(title, e.currentTarget)} onBlur={() => peek(null)}>{shown}</button>;
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
      {body === null ? <span className="art-spin sm" /> : body ? <NoteMd text={body} exists={exists} onOpen={onOpen} depth={depth + 1} /> : <p className="d">{L("Chưa có ghi chú này.", "This note doesn't exist yet.")}</p>}
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
        {x.box && <button type="button" className={`bn-box ${x.box === "x" ? "on" : ""}`} aria-label={x.box === "x" ? L("Đánh dấu chưa xong", "Mark as not done") : L("Đánh dấu đã xong", "Mark as done")} disabled={!onTask} onClick={() => onTask?.(x.t, x.box !== "x")}>{x.box === "x" && <I.Check size={10} />}</button>}
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
const outline = (body: string) => body.split("\n").map((l) => /^(#{1,6})\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ level: m[1].length, text: m[2].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_x, a, b) => b || a) }));

// ---------------------------------------------------------------- một ghi chú: thuộc tính, nội dung, sửa phần của bạn
function NoteView({ title, sub, exists, onOpen, onChanged, onLoaded }: { title: string; sub?: string; exists: Set<string>; onOpen: Open; onChanged: () => void; onLoaded: (d: NoteData | null) => void }) {
  const say = useApp().say;
  const [d, setD] = useState<NoteData | null>(null);
  const [missing, setMissing] = useState(false);
  const [edit, setEdit] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [prop, setProp] = useState<{ aliases: string; tags: string } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const load = useCallback(() => {
    void loadNote(title, true).then((j) => { setD(j); setMissing(!j); onLoaded(j); });
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setD(null); setEdit(null); setMissing(false); setProp(null); load(); }, [load]);
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
    void api("POST", "/api/brain/task", { title: from ?? d?.note.title, task: text, done }).then(() => { load(); onChanged(); say(done ? L("Đã đánh dấu xong", "Marked as done") : L("Đã đánh dấu chưa xong", "Marked as not done")); }).catch((e) => say((e as Error).message));
  };
  const saveProps = () => { if (!prop || !d) return; void call("PUT", "/api/brain/note", { title: d.note.title, aliases: prop.aliases.split(",").map((x) => x.trim()).filter(Boolean), tags: prop.tags.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) }, L("Đã lưu thuộc tính", "Properties saved")).then((j) => j && setProp(null)); };
  const save = async () => {
    if (!edit) return;
    const b = missing ? { title, newTitle: edit.title || title, body: edit.body } : d!.note.generated ? { title, userNote: edit.body } : { title, newTitle: edit.title, body: edit.body };
    const j = await call("PUT", "/api/brain/note", b, L("Đã lưu ghi chú", "Note saved"));
    if (j) { setEdit(null); setMissing(false); if (j.note.title !== title) onOpen(j.note.title); }
  };
  const app = useApp();
  const del = () => d && app.confirm(L(`Xóa “${d.note.title}”?`, `Delete “${d.note.title}”?`), L("Các liên kết tới nó sẽ thành ghi chú chưa có. Synchro có thể viết lại trang này khi học thêm.", "Links to it will point to a note that doesn't exist. Synchro may write this page again as it learns."), L("Xóa", "Delete"),
    () => { void api("DELETE", `/api/brain/note?title=${encodeURIComponent(d.note.title)}`).then(() => { peekCache.delete(fold(d.note.title)); onChanged(); onOpen(""); say(L("Đã xóa ghi chú", "Note deleted")); }).catch((e) => say((e as Error).message)); });
  const n = d?.note;
  const sources = n ? [...new Set((n.props.facts ?? []).map((f) => f.src).filter(Boolean))] as string[] : [];
  return (
    <article className="bn-note" aria-label={title} ref={body}>
      <div className="bn-note-h">
        {n && <span className="bn-kind"><KindIcon k={n.kind} size={12} />{KIND[n.kind][en() ? 1 : 0]}</span>}
        {missing && <span className="bn-kind"><KindIcon k="ghost" size={12} />{KIND.ghost[en() ? 1 : 0]}</span>}
        <span className="bn-note-x">
          {(n || missing) && !edit && <button className="btn sm" onClick={() => setEdit(missing ? { title, body: "" } : { title: n!.title, body: n!.generated ? n!.props.userNote ?? "" : n!.body })}><I.Pencil size={13} />{missing ? L("Tạo ghi chú", "Create note") : n!.generated ? L("Thêm ghi chú của bạn", "Add your note") : L("Sửa", "Edit")}</button>}
          {n && !edit && <button className={`icon-btn ${n.props.pinned ? "on" : ""}`} aria-label={n.props.pinned ? L("Bỏ ghim", "Unpin") : L("Ghim lên đầu", "Pin to top")} data-tip={n.props.pinned ? L("Bỏ ghim", "Unpin") : L("Ghim lên đầu", "Pin to top")} onClick={() => void call("PUT", "/api/brain/note", { title: n.title, pinned: !n.props.pinned })}>{n.props.pinned ? <I.PinOff size={14} /> : <I.Pin size={14} />}</button>}
          {n && n.editable && !edit && <button className="icon-btn" aria-label={L("Xóa ghi chú", "Delete note")} data-tip={L("Xóa ghi chú", "Delete note")} onClick={del}><I.Trash size={14} /></button>}
        </span>
      </div>
      <h1 className="bn-title" data-notr>{n?.title ?? title}</h1>
      {n && (
        <div className="bn-props" aria-label={L("Thuộc tính", "Properties")}>
          {n.kind === "entity" && n.props.etype && <div className="bn-prop"><span>{L("Loại", "Type")}</span><b data-notr>{n.props.etype}</b></div>}
          {n.props.up && <div className="bn-prop"><span>{L("Thuộc", "Up")}</span><b><Inline t={`[[${n.props.up}]]`} exists={exists} onOpen={onOpen} /></b></div>}
          <div className="bn-prop"><span>{L("Tên khác", "Aliases")}</span><b>{n.props.aliases?.length ? n.props.aliases.map((a) => <span key={a} className="bn-alias" data-notr>{a}</span>) : <em>{L("chưa có", "none")}</em>}</b></div>
          <div className="bn-prop"><span>{L("Thẻ", "Tags")}</span><b>{n.tags.length ? n.tags.map((t) => <span key={t} className="bn-tag" data-notr>#{t}</span>) : <em>{L("chưa có", "none")}</em>}</b></div>
          {sources.length > 0 && <div className="bn-prop"><span>{L("Nguồn", "Sources")}</span><b>{L(`${sources.length} đoạn chat`, `${sources.length} chats`)}</b></div>}
          {n.props.turns ? <div className="bn-prop"><span>{L("Tin nhắn", "Messages")}</span><b>{n.props.turns}</b></div> : null}
          {n.props.models && <div className="bn-prop"><span>Model</span><b data-notr>{Object.keys(n.props.models).map((m) => m.split("/").slice(1).join("/") || m).join(", ")}</b></div>}
          <div className="bn-prop"><span>{L("Cập nhật", "Updated")}</span><b>{dateStr(n.updatedAt)}{n.updatedAt - n.createdAt > 60_000 ? ` · ${L("tạo", "created")} ${dateStr(n.createdAt)}` : ""}</b></div>
          {!prop ? <button className="bn-props-b" onClick={() => setProp({ aliases: (n.props.aliases ?? []).join(", "), tags: (n.props.tags ?? []).join(" ") })}>{L("Sửa tên khác và thẻ", "Edit aliases and tags")}</button> : (
            <div className="bn-props-f">
              <label>{L("Tên khác (cách nhau bằng dấu phẩy)", "Aliases (comma-separated)")}<input className="field" value={prop.aliases} onChange={(e) => setProp({ ...prop, aliases: e.target.value })} placeholder={L("ví dụ: An ninh mạng, ATTT", "e.g. Infosec, Security")} /></label>
              <label>{L("Thẻ", "Tags")}<input className="field" value={prop.tags} onChange={(e) => setProp({ ...prop, tags: e.target.value })} placeholder="ke-hoach/tuan muc-tieu" /></label>
              <div className="bn-edit-a"><button className="btn sm" onClick={() => setProp(null)}>{L("Hủy", "Cancel")}</button><button className="btn sm dark" disabled={busy} onClick={saveProps}>{L("Lưu", "Save")}</button></div>
            </div>
          )}
        </div>
      )}
      {!d && !missing && <div className="us-empty"><span className="art-spin sm" /></div>}
      {missing && !edit && <p className="d">{L("Ghi chú này chưa có: các ghi chú khác đang trỏ tới nó. Synchro sẽ viết trang này khi biết thêm về nó, hoặc bạn tự tạo.", "This note doesn't exist yet, but other notes link to it. Synchro writes it once it learns more, or you can create it.")}</p>}
      {edit ? (
        <div className="bn-edit">
          {(missing || (n && !n.generated)) && <input className="field" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label={L("Tên ghi chú", "Note title")} />}
          <textarea className="textarea" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={10}
            placeholder={L("Viết bằng Markdown. Gõ [[Tên ghi chú]] để nối tới ghi chú khác, #thẻ để gắn thẻ.", "Write in Markdown. Type [[Note name]] to link another note, #tag to tag it.")} />
          {n?.generated && <p className="d">{L("Synchro tự viết phần còn lại của trang này từ các đoạn chat; phần bạn viết nằm ở mục “Ghi chú của bạn”.", "Synchro writes the rest of this page from your chats; what you write goes under “Your note”.")}</p>}
          <div className="bn-edit-a"><button className="btn" onClick={() => setEdit(null)} disabled={busy}>{L("Hủy", "Cancel")}</button><button className="btn dark" onClick={save} disabled={busy}>{busy ? <span className="art-spin sm" /> : null}{L("Lưu", "Save")}</button></div>
        </div>
      ) : n && <NoteMd text={n.body} exists={exists} onOpen={onOpen} onTask={n.kind === "chat" || n.kind === "code" || n.kind === "daily" || n.kind === "note" ? task : undefined} />}
    </article>
  );
}

// ---------------------------------------------------------------- khung bên phải của ghi chú
function NoteSide({ d, graph, exists, onOpen }: { d: NoteData; graph: Graph; exists: Set<string>; onOpen: Open }) {
  const [gs, setGs] = useGS("local");
  const [panel, setPanel] = useState(false);
  const [shut, setShut] = useState<Record<string, boolean>>({});
  // Gọi như hàm (không phải thành phần con) để đồ thị cục bộ không bị dựng lại mỗi lần khung đổi.
  const sec = (k: string, t: string, n: number | undefined, children: React.ReactNode) => (
    <section className="bw-sec" key={k}>
      <button className="bw-sec-h" aria-expanded={!shut[k]} onClick={() => setShut({ ...shut, [k]: !shut[k] })}><I.ChevronR size={11} />{t}{n !== undefined && <em>{n}</em>}</button>
      {!shut[k] && <div className="bw-sec-b">{children}</div>}
    </section>
  );
  const ref = (title: string, kind: Kind, ctx?: React.ReactNode) => (
    <div key={title} className="bn-ref" role="button" tabIndex={0} onClick={() => onOpen(title)} onKeyDown={(e) => e.key === "Enter" && onOpen(title)}>
      <KindIcon k={kind} size={12} /><span><b data-notr>{title}</b>{ctx && <small>{ctx}</small>}</span>
    </div>
  );
  const heads = outline(d.note.body);
  return (
    <>
      {sec("back", L("Liên kết đến đây", "Backlinks"), d.backlinks.length, <>
        {d.backlinks.length ? d.backlinks.map((b) => ref(b.title, b.kind, b.context ? <Inline t={b.context} exists={exists} onOpen={onOpen} /> : undefined)) : <p className="d">{L("Chưa có ghi chú nào trỏ tới đây.", "No notes link here yet.")}</p>}
      </>)}
      {d.unlinked.length > 0 && sec("unl", L("Nhắc tới (chưa nối)", "Unlinked mentions"), d.unlinked.length, <>
        <p className="d sm">{L("Synchro tự nối dần các chỗ nhắc tên trong trang nó viết; chỗ nhắc trong ghi chú riêng của bạn giữ nguyên.", "Synchro links mentions in the pages it writes on its own; mentions in your own notes stay as you wrote them.")}</p>
        {d.unlinked.map((b) => ref(b.title, b.kind, <span data-notr>{b.context}</span>))}
      </>)}
      {heads.length > 0 && sec("out", L("Đề mục", "Outline"), heads.length, <>
        <div className="bw-outline">{heads.map((h, i) => <button key={i} style={{ paddingLeft: (h.level - 1) * 12 + 6 }} onClick={() => onOpen(d.note.title, h.text)} data-notr>{h.text}</button>)}</div>
      </>)}
      {sec("go", L("Liên kết đi", "Outgoing links"), d.outgoing.length, <>
        {d.outgoing.length ? <div className="bw-chips">{d.outgoing.map((o) => <button key={o.title} className={`bn-link ${o.exists ? "" : "ghost"}`} onClick={() => onOpen(o.title)} onMouseEnter={(e) => peek(o.title, e.currentTarget)} onMouseLeave={() => peek(null)} data-notr>{o.title}</button>)}</div> : <p className="d">{L("Ghi chú này chưa nối tới đâu.", "This note doesn't link anywhere yet.")}</p>}
      </>)}
      {d.similar.length > 0 && sec("sim", L("Gần nghĩa", "Related"), d.similar.length, <>
        {d.similar.map((s) => ref(s.title, s.kind))}
      </>)}
      {sec("lg", L("Đồ thị cục bộ", "Local graph"), undefined, <>
        <div className="bw-local">
          <BrainGraph data={graph} gs={gs} focus={d.note.title} active={d.note.title} height={230} onOpen={(t) => onOpen(t)} />
          <button className="icon-btn bw-gear" aria-label={L("Cài đặt đồ thị cục bộ", "Local graph settings")} onClick={() => setPanel(!panel)}><I.Sliders size={13} /></button>
          {panel && <GraphPanel gs={gs} set={setGs} local onClose={() => setPanel(false)} />}
        </div>
      </>)}
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
  useEffect(() => { setRows(null); fetch(`/api/brain?table=${view}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setRows(j.rows ?? [])).catch(() => setRows([])); }, [view, version]);
  const toggle = (r: TaskRow) => void api<{ rows: TaskRow[] }>("POST", "/api/brain/task", { title: r.title, task: r.task, done: !r.done }).then((j) => setRows(j.rows)).catch((e) => say((e as Error).message));
  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => { const x = (a as Record<string, unknown>)[sort.k], y = (b as Record<string, unknown>)[sort.k]; return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))) * sort.dir; }), [rows, sort]);
  const th = (k: string, label: string) => <th><button onClick={() => setSort({ k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : -1 })}>{label}{sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></th>;
  const tasks = (sorted as TaskRow[]).filter((r) => showDone || !r.done);
  const link = (t: string) => <button className="bn-link" onClick={() => onOpen(t)} onMouseEnter={(e) => peek(t, e.currentTarget)} onMouseLeave={() => peek(null)} data-notr>{t}</button>;
  return (
    <div className="bn-bases">
      <div className="bn-filter">
        {([["tasks", L("Việc dang dở", "Open tasks")], ["chats", L("Đoạn chat", "Chats")], ["topics", L("Chủ đề", "Topics")], ["entities", L("Tên riêng", "Entities")]] as const).map(([k, l]) => <button key={k} className={`bn-chip ${view === k ? "on" : ""}`} aria-pressed={view === k} onClick={() => { setView(k); setSort({ k: k === "tasks" || k === "chats" ? "date" : "links", dir: -1 }); }}>{l}</button>)}
        {view === "tasks" && <label className="bn-check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />{L("Hiện cả việc đã xong", "Show done")}</label>}
      </div>
      {rows === null ? <div className="us-empty"><span className="art-spin sm" /></div> : view === "tasks" ? (
        tasks.length ? <div className="bn-tasks">{tasks.map((r, i) => (
          <div key={`${r.title}-${i}`} className={`bn-task ${r.done ? "done" : ""}`}>
            <button className={`bn-box ${r.done ? "on" : ""}`} aria-label={r.done ? L("Đánh dấu chưa xong", "Mark as not done") : L("Đánh dấu đã xong", "Mark as done")} onClick={() => toggle(r)}>{r.done && <I.Check size={10} />}</button>
            <span data-notr>{r.task}</span>{link(r.title)}
          </div>
        ))}</div> : <p className="d">{L("Không còn việc nào dang dở. Việc còn dở dang trong các đoạn chat sẽ tự hiện ở đây.", "Nothing open. Unfinished tasks from your chats show up here automatically.")}</p>
      ) : view === "chats" ? (
        <div className="bn-table-w"><table className="bn-table"><thead><tr>{th("title", L("Đoạn chat", "Chat"))}{th("date", L("Ngày", "Date"))}<th>Model</th><th>{L("Chủ đề", "Topics")}</th>{th("importance", L("Quan trọng", "Importance"))}{th("tasks", L("Việc dở", "Open"))}</tr></thead>
          <tbody>{(sorted as ChatRow[]).map((r) => <tr key={r.title}><td>{link(r.title)}</td><td>{dateStr(r.date)}</td><td data-notr>{r.models.join(", ")}</td><td>{r.topics.map((x) => <span key={x}>{link(x)} </span>)}</td><td>{r.importance ?? "–"}</td><td>{r.tasks || ""}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="bn-table-w"><table className="bn-table"><thead><tr>{th("title", view === "topics" ? L("Chủ đề", "Topic") : L("Tên riêng", "Entity"))}{view === "entities" && <th>{L("Loại", "Type")}</th>}{th("links", L("Liên kết", "Links"))}{th("facts", L("Điều đã biết", "Facts"))}{view === "topics" && <th>{L("Thuộc", "Up")}</th>}<th>{L("Tóm lược", "Summary")}</th></tr></thead>
          <tbody>{(sorted as WikiRow[]).map((r) => <tr key={r.title}><td>{link(r.title)}</td>{view === "entities" && <td data-notr>{r.type}</td>}<td>{r.links}</td><td>{r.facts || ""}</td>{view === "topics" && <td>{r.up ? link(r.up) : ""}</td>}<td data-notr>{r.desc}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Hoạt động: những gì bộ não vừa tự học, tự sắp xếp
function Activity({ onOpen, version }: { onOpen: Open; version: number }) {
  const [rows, setRows] = useState<{ at: number; text: string }[] | null>(null);
  useEffect(() => { fetch("/api/brain?log=1", { cache: "no-store" }).then((r) => r.json()).then((j) => setRows(j.log ?? [])).catch(() => setRows([])); }, [version]);
  if (!rows) return <div className="us-empty"><span className="art-spin sm" /></div>;
  if (!rows.length) return <p className="d">{L("Bộ não chưa học gì. Sau mỗi đoạn chat, Synchro tự học và ghi lại ở đây.", "Nothing learned yet. After each chat, Synchro learns on its own and logs it here.")}</p>;
  const days = new Map<string, typeof rows>();
  for (const r of rows) { const k = dateStr(r.at); if (!days.has(k)) days.set(k, []); days.get(k)!.push(r); }
  return (
    <div className="bw-activity">
      {[...days].map(([k, rs]) => (
        <section key={k}><h3>{k}</h3>{rs.map((r, i) => <div key={i} className="bw-act"><time>{timeStr(r.at)}</time><span><Inline t={r.text} exists={new Set()} onOpen={onOpen} /></span></div>)}</section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- không gian Bộ não (toàn trang)
// Lối vào: tên thật của ghi chú → nhãn hiện theo ngôn ngữ giao diện.
const ENTRY: Record<string, [string, string]> = { "Bộ não": ["Bộ não", "Brain"], "Về bạn": ["Về bạn", "About you"], "Mục lục": ["Mục lục", "Index"], "Hoạt động bộ não": ["Hoạt động bộ não", "Brain activity"] };
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
  const [fold0, setFold0] = useState<Record<string, boolean>>({ chat: true, tags: true });
  const load = useCallback(() => fetch("/api/brain", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j?.nodes) { setG(j); setVer((v) => v + 1); } }).catch(() => {}), []);
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
      else if (e.key === "/" && !(e.target as HTMLElement).closest("input,textarea,[contenteditable]")) { e.preventDefault(); search.current?.focus(); }
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
  const Group = ({ k, t, list, limit = 60 }: { k: string; t: string; list: GNode[]; limit?: number }) => !list.length ? null : (
    <section className="bw-grp">
      <button className="bw-grp-h" aria-expanded={!fold0[k]} onClick={() => setFold0({ ...fold0, [k]: !fold0[k] })}><I.ChevronR size={11} />{t}<em>{list.length}</em></button>
      {!fold0[k] && list.slice(0, limit).map((n) => <button key={n.id} className={`bw-item ${at?.title === n.title && tab === "note" ? "on" : ""}`} onClick={() => open(n.title)} data-notr><KindIcon k={n.kind} size={12} /><span>{n.title}</span>{n.pinned && <I.Pin size={10} />}</button>)}
    </section>
  );
  const status = !s ? "" : s.pending ? L(`Đang học ${s.pending} đoạn chat…`, `Learning ${s.pending} chats…`) : s.learnedAt ? L(`Học lần cuối ${timeStr(s.learnedAt)} · ${dateStr(s.learnedAt)}`, `Last learned ${timeStr(s.learnedAt)} · ${dateStr(s.learnedAt)}`) : L("Chưa học đoạn chat nào", "Nothing learned yet");
  const byLinks = (a: GNode, b: GNode) => b.links - a.links || a.title.localeCompare(b.title, "vi");
  return (
    <div className={`bw ${side ? `show-${side}` : ""}`}>
      <Peek onOpen={open} />
      <header className="bw-top">
        {!sideOpen && onSide && <button className="icon-btn side-toggle" onClick={onSide} aria-label={L("Mở thanh bên", "Open sidebar")}><I.Panel /></button>}
        <button className="icon-btn bw-only-m" aria-label={L("Danh sách ghi chú", "Notes list")} onClick={() => setSide(side === "left" ? "" : "left")}><I.Panel size={15} /></button>
        <button className="icon-btn" aria-label={L("Lùi", "Back")} disabled={hist.i <= 0 || tab !== "note"} onClick={() => setHist((h) => ({ ...h, i: h.i - 1 }))}><I.Back size={15} /></button>
        <button className="icon-btn bw-fwd" aria-label={L("Tiến", "Forward")} disabled={hist.i >= hist.list.length - 1 || tab !== "note"} onClick={() => setHist((h) => ({ ...h, i: h.i + 1 }))}><I.Back size={15} /></button>
        <div className="bw-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "graph"} className={tab === "graph" ? "on" : ""} onClick={() => setTab("graph")}>{L("Đồ thị", "Graph")}</button>
          {at && <button role="tab" aria-selected={tab === "note"} className={tab === "note" ? "on" : ""} onClick={() => setTab("note")} data-notr>{at.title.length > 26 ? `${at.title.slice(0, 25)}…` : at.title}</button>}
          <button role="tab" aria-selected={tab === "bases"} className={tab === "bases" ? "on" : ""} onClick={() => setTab("bases")}>{L("Bảng", "Tables")}</button>
          <button role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>{L("Hoạt động", "Activity")}</button>
        </div>
        <span className={`bw-status ${s?.pending ? "busy" : ""}`}>{s?.pending ? <span className="bw-pulse" /> : <I.Brain size={13} />}{status}</span>
        {tab === "note" && <button className="icon-btn bw-only-m" aria-label={L("Liên kết của ghi chú", "Note links")} onClick={() => setSide(side === "right" ? "" : "right")}><I.PanelR size={15} /></button>}
      </header>
      <aside className="bw-left" aria-label={L("Khám phá bộ não", "Explore the brain")}>
        <span className="bn-search"><I.Search size={13} /><input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Tìm… (/)", "Search… (/)")} /></span>
        {found ? (
          <div className="bw-found">{found.length ? found.map((r) => <button key={r.title} className="bw-item tall" onClick={() => { open(r.title); }}><KindIcon k={r.kind} size={12} /><span><b data-notr>{r.title}</b><small data-notr>{r.snippet}</small></span></button>)
            : <p className="d">{L("Không có ghi chú nào khớp.", "No matching notes.")}</p>}
            <p className="d sm">{L("Lọc được: tag:thẻ, loai:chu-de / ten-rieng / ban-do / doan-chat, task-todo:, \"cụm từ\", -loại trừ.", "Filters: tag:x, kind:topic / entity / map / chat, task-todo:, \"phrase\", -exclude.")}</p>
          </div>
        ) : !g ? <div className="us-empty"><span className="art-spin sm" /></div> : (
          <div className="bw-tree">
            <section className="bw-grp">
              {Object.entries(ENTRY).map(([t, lb]) => { const n = g.nodes.find((x) => x.title === t); return n ? <button key={t} className={`bw-item ${at?.title === t && tab === "note" ? "on" : ""}`} onClick={() => open(t)}><KindIcon k={n.kind} size={12} /><span>{L(...lb)}</span></button> : null; })}
              {g.nodes.some((n) => n.title === today()) && <button className="bw-item" onClick={() => open(today())}><KindIcon k="daily" size={12} /><span>{L("Hôm nay", "Today")}</span></button>}
              <button className="bw-item new" onClick={() => open(L("Ghi chú mới", "New note"))}><I.Plus size={12} /><span>{L("Ghi chú mới", "New note")}</span></button>
            </section>
            <Group k="pin" t={L("Đã ghim", "Pinned")} list={(g.nodes ?? []).filter((n) => n.pinned)} />
            <Group k="map" t={L("Bản đồ", "Maps")} list={byKind(["map"])} />
            <Group k="topic" t={L("Chủ đề", "Topics")} list={byKind(["topic"]).sort(byLinks)} />
            <Group k="entity" t={L("Tên riêng", "Entities")} list={byKind(["entity"]).sort(byLinks)} />
            <Group k="note" t={L("Ghi chú của bạn", "Your notes")} list={byKind(["note"]).sort((a, b) => b.created - a.created)} />
            <Group k="chat" t={L("Đoạn chat", "Chats")} list={byKind(["chat", "code"]).sort((a, b) => b.created - a.created)} limit={80} />
            <Group k="daily" t={L("Nhật ký", "Daily notes")} list={byKind(["daily"]).sort((a, b) => b.title.localeCompare(a.title))} limit={30} />
            {tags.length > 0 && <section className="bw-grp">
              <button className="bw-grp-h" aria-expanded={!fold0.tags} onClick={() => setFold0({ ...fold0, tags: !fold0.tags })}><I.ChevronR size={11} />{L("Thẻ", "Tags")}<em>{tags.length}</em></button>
              {!fold0.tags && <div className="bn-tags">{tags.slice(0, 40).map((t) => <button key={t.tag} className="bn-tag" onClick={() => setQ(`tag:${t.tag}`)} data-notr>#{t.tag} <em>{t.count}</em></button>)}</div>}
            </section>}
          </div>
        )}
      </aside>
      <main className="bw-main">
        {!g ? <div className="us-empty"><span className="art-spin sm" /></div> : <>
          {/* Đồ thị luôn chạy (ẩn khi xem tab khác) để quay lại vẫn y nguyên như lúc rời đi. */}
          <div className="bw-graph" hidden={tab !== "graph"}>
            <BrainGraph data={g} gs={gs} cutoff={cut} active={null} height="100%" onOpen={(t) => open(t)} onBg={() => setPanel(false)} />
            <button className={`icon-btn bw-gear ${panel ? "on" : ""}`} aria-label={L("Cài đặt đồ thị", "Graph settings")} data-tip={L("Cài đặt đồ thị", "Graph settings")} onClick={() => setPanel(!panel)}><I.Sliders size={14} /></button>
            {panel && <GraphPanel gs={gs} set={setGs} onAnimate={animate} onClose={() => setPanel(false)} />}
            {s && <div className="bw-count">{L(`${s.notes} ghi chú · ${s.links} liên kết · ${s.topics} chủ đề · ${s.entities} tên riêng`, `${s.notes} notes · ${s.links} links · ${s.topics} topics · ${s.entities} entities`)}</div>}
            {!g.cfg.gen && <p className="bn-off">{L("Đang tắt học từ đoạn chat (Cài đặt → Bộ não), nên bộ não không lớn thêm.", "Learning from chats is off (Settings → Brain), so the brain isn't growing.")}</p>}
          </div>
          {tab === "note" && at ? <div className="bw-reader"><NoteView key={`${at.title}`} title={at.title} sub={at.sub} exists={exists} onOpen={open} onChanged={() => void load()} onLoaded={setCur} /></div>
            : tab === "bases" ? <div className="bw-pad"><Bases onOpen={open} version={ver} /></div> : tab === "activity" ? <div className="bw-pad"><Activity onOpen={open} version={ver} /></div> : null}
        </>}
      </main>
      {tab === "note" && cur && g && <aside className="bw-right" aria-label={L("Liên kết của ghi chú", "Note links")}><NoteSide d={cur} graph={g} exists={exists} onOpen={open} /></aside>}
      {side && <button className="bw-scrim" aria-label={L("Đóng", "Close")} onClick={() => setSide("")} />}
    </div>
  );
}

// ---------------------------------------------------------------- Cài đặt → Bộ não: tổng quan, bật tắt, dữ liệu
export function BrainSettings({ memory }: { memory: React.ReactNode }) {
  const app = useApp();
  const [g, setG] = useState<Graph | null>(null);
  const [gs] = useGS("mini");
  const load = useCallback(() => fetch("/api/brain", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j?.nodes) setG(j); }).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  const openBrain = (title?: string) => window.dispatchEvent(new CustomEvent("synchro:brain", { detail: { title: title ?? null } }));
  const setAuto = (on: boolean) => void api("PUT", "/api/brain/instructions", { auto: on }).then(() => { void load(); app.say(on ? L("Synchro sẽ tự cập nhật hướng dẫn từ các đoạn chat", "Synchro will update your instructions from your chats") : L("Đã tắt tự cập nhật hướng dẫn", "Automatic instruction updates are off")); }).catch((e) => app.say(e.message));
  const wipe = () => app.confirm(L("Xóa toàn bộ bộ não?", "Delete the whole brain?"), L("Mọi ghi chú, liên kết, trang chủ đề và hoạt động sẽ bị xóa. Ký ức dài hạn giữ nguyên. Đoạn chat trong trình duyệt không bị ảnh hưởng.", "All notes, links, topic pages and activity will be deleted. Long-term memories stay. Chats in your browser are not affected."), L("Xóa", "Delete"),
    () => { void api<Graph>("DELETE", "/api/brain").then((j) => { setG({ ...j, cfg: g?.cfg ?? j.cfg }); app.say(L("Đã xóa bộ não", "Brain deleted")); }).catch((e) => app.say(e.message)); });
  const s = g?.stats;
  return (
    <div className="bn">
      <h3 style={{ marginTop: 0 }}>{L("Bộ não", "Brain")}</h3>
      <p className="d" style={{ margin: "-4px 0 12px" }}>{L("Sau mỗi đoạn chat, Synchro tự rút ra phần tinh túy và nối nó vào bộ não chung: trang chủ đề, tên riêng, chân dung của bạn, các đoạn chat liên quan. Định kỳ nó tự gộp điều trùng, tự nối liên kết, xếp chủ đề vào bản đồ và tự cập nhật Hướng dẫn cho Synchro. Claude, ChatGPT và Gemini là ba bán cầu dùng chung bộ não này. Bộ não lưu trên máy chủ của bạn.",
        "After every chat, Synchro distills what matters and links it into one shared brain: topic pages, named things, your portrait, related chats. It regularly merges duplicates, links mentions, sorts topics into maps and updates your Instructions for Synchro on its own. Claude, ChatGPT and Gemini are three hemispheres of the same brain. It's stored on your server.")}</p>
      {s && <div className="bn-stats">
        <span><b>{s.notes}</b>{L("ghi chú", "notes")}</span><span><b>{s.links}</b>{L("liên kết", "links")}</span><span><b>{s.chats}</b>{L("đoạn chat đã học", "chats learned")}</span>
        <span><b>{s.topics}</b>{L("chủ đề", "topics")}</span><span><b>{s.entities}</b>{L("tên riêng", "entities")}</span>
        {s.pending > 0 && <span className="wait"><b>{s.pending}</b>{L("đang học", "learning")}</span>}
      </div>}
      {g ? <div className="bn-mini" role="button" tabIndex={0} aria-label={L("Mở bộ não", "Open the brain")} onKeyDown={(e) => e.key === "Enter" && openBrain()}>
        <BrainGraph data={g} gs={gs} mini height={220} onOpen={(t) => openBrain(t)} onBg={() => openBrain()} />
      </div> : <div className="us-empty"><span className="art-spin sm" /></div>}
      <div className="bn-acts" style={{ margin: "12px 0 18px" }}>
        <button className="btn dark" onClick={() => openBrain()}><I.Brain size={14} />{L("Mở bộ não", "Open the brain")}</button>
        <a className="btn" href="/api/brain/export" download><I.Download size={13} />{L("Tải bộ não về (.zip Markdown)", "Download the brain (.zip Markdown)")}</a>
        <button className="btn danger-t" onClick={wipe}><I.Trash size={13} />{L("Xóa bộ não", "Delete the brain")}</button>
      </div>
      {g && <label className="bn-auto">
        <span><b>{L("Tự cập nhật Hướng dẫn cho Synchro", "Update Instructions for Synchro automatically")}</b><small>{L("Từ những gì bộ não biết về bạn (thói quen, chuyên ngành, cách bạn muốn được trả lời), Synchro tự viết lại phần hướng dẫn ở Cài đặt → Tài khoản. Bản bạn tự viết luôn được giữ ý; các bản cũ nằm trong lịch sử để quay lại.", "From what the brain knows about you (habits, fields, how you like answers), Synchro rewrites your instructions in Settings → Account. What you wrote yourself is always kept; older versions stay in the history.")}</small></span>
        <button role="switch" aria-checked={g.cfg.autoIns} className={`bg-sw ${g.cfg.autoIns ? "on" : ""}`} onClick={() => setAuto(!g.cfg.autoIns)}><i /></button>
      </label>}
      <div className="bn-mem">{memory}</div>
    </div>
  );
}

/**
 * Tự nạp các đoạn chat cũ đang nằm trong trình duyệt lên bộ não (không có nút bấm): mỗi lần 10 đoạn, cách nhau 20 giây, đoạn đã gửi
 * được nhớ trong trình duyệt. Không gửi đoạn chat ẩn danh; máy chủ bỏ qua khi người dùng tắt học.
 */
export function useBrainSync(chats: Chat[], on: boolean) {
  const ref = useRef(chats);
  ref.current = chats;
  useEffect(() => {
    if (!on) return;
    let stop = false, timer: ReturnType<typeof setTimeout> | null = null;
    const KEY = "bn:synced";
    const read = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { return new Set<string>(); } };
    const run = async () => {
      const done = read();
      const todo = ref.current.filter((c) => !c.inc && !done.has(String(c.id)) && c.msgs.some((m) => m.role === "user" && m.text?.trim())).slice(0, 10);
      if (todo.length) {
        try {
          const r = await fetch("/api/brain/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chats: todo.map((c) => ({ id: String(c.id), title: c.title, msgs: c.msgs.filter((m) => m.text?.trim()).map((m) => ({ role: m.role, text: m.text })) })) }) });
          const j = r.ok ? await r.json() : null;
          if (j && !j.off) { for (const c of todo) done.add(String(c.id)); try { localStorage.setItem(KEY, JSON.stringify([...done].slice(-5000))); } catch {} }
          if (!j || j.off) return;
        } catch { return; }
      }
      if (!stop && todo.length) timer = setTimeout(run, 20_000);
    };
    timer = setTimeout(run, 8000);
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [on, chats.length]);
}
