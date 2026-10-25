"use client";
// Biểu đồ ngay trong chat (Cài đặt → Khả năng → Hình minh họa trong chat): model viết khối ```chart chứa JSON,
// ở đây vẽ bằng SVG. Theo quy tắc trực quan hóa dữ liệu: bảng màu phân loại cố định thứ tự (đã kiểm tra mù màu),
// một trục, cột ≤ 24px bo 4px ở đầu, đường 2px, chú giải khi ≥ 2 chuỗi, tooltip khi rê chuột, và chế độ xem bảng.
import { useEffect, useMemo, useRef, useState } from "react";
import { tr } from "./i18n";

export type ChartSpec = { type: "bar" | "line" | "area" | "pie" | "donut" | "scatter"; title?: string; x: string; y: string[]; unit?: string; stacked?: boolean; data: Record<string, unknown>[] };
const SLOTS = 8;

export function parseChart(src: string): ChartSpec | string {
  let j: Record<string, unknown>;
  try { j = JSON.parse(src); } catch { return "JSON không hợp lệ"; }
  const type = String(j.type ?? "bar") as ChartSpec["type"];
  if (!["bar", "line", "area", "pie", "donut", "scatter"].includes(type)) return `Không hỗ trợ kiểu biểu đồ "${type}"`;
  const data = Array.isArray(j.data) ? (j.data as unknown[]).filter((r): r is Record<string, unknown> => !!r && typeof r === "object").slice(0, 500) : [];
  if (!data.length) return "Không có dữ liệu";
  const keys = Object.keys(data[0]);
  const x = typeof j.x === "string" && keys.includes(j.x) ? j.x : keys.find((k) => typeof data[0][k] === "string") ?? keys[0];
  let y = (Array.isArray(j.y) ? j.y : typeof j.y === "string" ? [j.y] : []).filter((k): k is string => typeof k === "string" && keys.includes(k));
  if (!y.length) y = keys.filter((k) => k !== x && data.some((r) => typeof r[k] === "number"));
  if (!y.length) return "Không có cột số liệu";
  const cap = type === "scatter" ? 3 : type === "pie" || type === "donut" ? 1 : SLOTS;
  return { type, title: typeof j.title === "string" ? j.title.slice(0, 160) : undefined, x, y: y.slice(0, cap), unit: typeof j.unit === "string" ? j.unit.slice(0, 20) : undefined, stacked: j.stacked === true, data };
}

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);
const compact = (v: number) => {
  const a = Math.abs(v);
  const f = (n: number, s: string) => `${(v / n).toFixed(Math.abs(v / n) < 10 ? 1 : 0).replace(/\.0$/, "")}${s}`;
  return a >= 1e9 ? f(1e9, "B") : a >= 1e6 ? f(1e6, "M") : a >= 1e3 ? f(1e3, "K") : String(Math.round(v * 100) / 100);
};
const full = (v: number | null) => (v === null ? "–" : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));
function niceTicks(lo: number, hi: number, n = 5) {
  if (lo === hi) { hi = lo + 1; }
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), r = step0 / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const t: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) t.push(Math.round(v / step) * step);
  return t;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

type Tip = { x: number; y: number; title: string; rows: { i: number; name: string; v: number | null }[] } | null;

export function ChartView({ spec }: { spec: ChartSpec }) {
  const [ref, w] = useWidth();
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [table, setTable] = useState(false);
  const [tip, setTip] = useState<Tip>(null);
  const pie = spec.type === "pie" || spec.type === "donut";
  const series = spec.y.map((name, i) => ({ name, i })).filter((s) => !hidden.has(s.i));
  const H = 260, padL = 44, padR = 16, padT = 12, padB = 40;
  const iw = Math.max(80, w - padL - padR), ih = H - padT - padB;
  const xs = spec.data.map((r) => String(r[spec.x] ?? ""));
  const xNum = spec.type === "scatter" && spec.data.every((r) => num(r[spec.x]) !== null);

  const dom = useMemo(() => {
    let lo = 0, hi = 0;
    spec.data.forEach((r) => {
      if (spec.stacked && spec.type !== "line" && spec.type !== "scatter") {
        let pos = 0, neg = 0;
        series.forEach((s) => { const v = num(r[s.name]) ?? 0; if (v >= 0) pos += v; else neg += v; });
        hi = Math.max(hi, pos); lo = Math.min(lo, neg);
      } else series.forEach((s) => { const v = num(r[s.name]); if (v !== null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } });
    });
    return niceTicks(lo, hi);
  }, [spec, series]); // eslint-disable-line react-hooks/exhaustive-deps
  const y0 = dom[0], y1 = dom[dom.length - 1];
  const sy = (v: number) => padT + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const xDom = xNum ? niceTicks(Math.min(...spec.data.map((r) => num(r[spec.x])!)), Math.max(...spec.data.map((r) => num(r[spec.x])!)), 6) : [];
  const n = spec.data.length;
  const band = iw / Math.max(1, n);
  const sx = (i: number) => (xNum ? padL + ((num(spec.data[i][spec.x])! - xDom[0]) / (xDom[xDom.length - 1] - xDom[0] || 1)) * iw : padL + band * i + band / 2);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 72))));
  const u = spec.unit ? ` ${spec.unit}` : "";
  // Tooltip đặt ngay trên điểm cao nhất của cột đang rê chuột (không che tiêu đề).
  const colTop = (i: number) => {
    let top = padT + ih;
    for (const s of series) { const v = num(spec.data[i][s.name]); if (v !== null) top = Math.min(top, sy(spec.stacked ? series.reduce((a, x) => a + Math.max(0, num(spec.data[i][x.name]) ?? 0), 0) : v)); }
    return Math.max(56, top - 6);
  };
  const rowTip = (i: number, cx: number, cy: number) => setTip({ x: cx, y: cy, title: xs[i], rows: series.map((s) => ({ i: s.i, name: s.name, v: num(spec.data[i][s.name]) })) });

  let plot: React.ReactNode = null;
  if (pie) {
    const s = spec.y[0];
    let rows = spec.data.map((r, i) => ({ i, label: xs[i], v: Math.max(0, num(r[s]) ?? 0) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
    // Quá 6 lát: gộp phần nhỏ vào "Khác" thay vì tạo màu mới.
    if (rows.length > 6) { const rest = rows.slice(5).reduce((a, r) => a + r.v, 0); rows = [...rows.slice(0, 5), { i: -1, label: tr("Khác"), v: rest }]; }
    const total = rows.reduce((a, r) => a + r.v, 0) || 1;
    const R = Math.min(ih + 20, iw / 2) / 2, cx = padL + iw / 2 - 60, cy = H / 2 - 6, r0 = spec.type === "donut" ? R * 0.6 : 0;
    let a = -Math.PI / 2;
    plot = (
      <>
        {rows.map((r, k) => {
          const a2 = a + (r.v / total) * Math.PI * 2, large = a2 - a > Math.PI ? 1 : 0;
          const p = (ang: number, rr: number) => `${cx + rr * Math.cos(ang)},${cy + rr * Math.sin(ang)}`;
          const d = rows.length === 1 ? `M${cx - R},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0${r0 ? `M${cx - r0},${cy}a${r0},${r0} 0 1,1 ${2 * r0},0a${r0},${r0} 0 1,1 ${-2 * r0},0` : ""}`
            : `M${p(a, R)}A${R},${R} 0 ${large} 1 ${p(a2, R)}${r0 ? `L${p(a2, r0)}A${r0},${r0} 0 ${large} 0 ${p(a, r0)}` : `L${cx},${cy}`}Z`;
          const mid = (a + a2) / 2;
          a = a2;
          return <path key={k} d={d} className={`vz-s${k % SLOTS}`} fill="currentColor" fillRule="evenodd" stroke="var(--vz-surface)" strokeWidth={2}
            onMouseMove={() => setTip({ x: cx + R * 0.7 * Math.cos(mid), y: cy + R * 0.7 * Math.sin(mid), title: r.label, rows: [{ i: k, name: s, v: r.v }] })} onMouseLeave={() => setTip(null)} />;
        })}
        {spec.type === "donut" && <text x={cx} y={cy + 5} textAnchor="middle" className="vz-hero">{compact(total)}{u}</text>}
        <g transform={`translate(${cx + R + 24},${cy - rows.length * 11})`}>
          {rows.map((r, k) => <g key={k} transform={`translate(0,${k * 22})`}><rect width={10} height={10} rx={2} y={-1} className={`vz-s${k % SLOTS}`} fill="currentColor" /><text x={16} y={8} className="vz-lbl">{r.label.slice(0, 24)} · {Math.round((r.v / total) * 100)}%</text></g>)}
        </g>
      </>
    );
  } else {
    const grid = dom.map((t) => <g key={t}><line x1={padL} x2={padL + iw} y1={sy(t)} y2={sy(t)} className="vz-grid" /><text x={padL - 8} y={sy(t) + 4} textAnchor="end" className="vz-tick">{compact(t)}</text></g>);
    const xt = xNum ? xDom.map((t) => <text key={t} x={padL + ((t - xDom[0]) / (xDom[xDom.length - 1] - xDom[0] || 1)) * iw} y={H - padB + 18} textAnchor="middle" className="vz-tick">{compact(t)}</text>)
      : xs.map((t, i) => (i % every ? null : <text key={i} x={sx(i)} y={H - padB + 18} textAnchor="middle" className="vz-tick">{t.length > 12 ? t.slice(0, 11) + "…" : t}</text>));
    let marks: React.ReactNode = null;
    if (spec.type === "bar") {
      const groups = spec.stacked ? 1 : series.length;
      const bw = Math.min(24, Math.max(3, (band * 0.72) / groups - 2));
      marks = spec.data.map((r, i) => {
        let pos = 0, neg = 0;
        return <g key={i}>{series.map((s, k) => {
          const v = num(r[s.name]); if (v === null) return null;
          let top: number, bot: number;
          if (spec.stacked) { const base = v >= 0 ? pos : neg; if (v >= 0) pos += v; else neg += v; top = sy(v >= 0 ? base + v : base); bot = sy(v >= 0 ? base : base + v); }
          else { top = sy(Math.max(v, 0)); bot = sy(Math.min(v, 0)); }
          const x = spec.stacked ? sx(i) - bw / 2 : sx(i) - (groups * (bw + 2) - 2) / 2 + k * (bw + 2);
          const h = Math.max(1, bot - top - (spec.stacked ? 2 : 0)), rr = Math.min(4, h / 2, bw / 2), up = v >= 0;
          // Bo 4px ở đầu dữ liệu, vuông ở gốc.
          const d = up ? `M${x},${top + h}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${top + h}Z`
            : `M${x},${top}V${top + h - rr}Q${x},${top + h} ${x + rr},${top + h}H${x + bw - rr}Q${x + bw},${top + h} ${x + bw},${top + h - rr}V${top}Z`;
          return <path key={s.i} d={d} className={`vz-s${s.i % SLOTS}`} fill="currentColor" />;
        })}</g>;
      });
    } else if (spec.type === "scatter") {
      marks = series.map((s) => spec.data.map((r, i) => { const v = num(r[s.name]); return v === null ? null : <circle key={`${s.i}-${i}`} cx={sx(i)} cy={sy(v)} r={4.5} className={`vz-s${s.i % SLOTS}`} fill="currentColor" stroke="var(--vz-surface)" strokeWidth={2} onMouseMove={() => rowTip(i, sx(i), sy(v))} onMouseLeave={() => setTip(null)} />; }));
    } else {
      const acc = spec.data.map(() => 0);
      marks = series.map((s) => {
        const pts = spec.data.map((r, i) => { const v = num(r[s.name]); if (v === null) return null; const base = spec.stacked && spec.type === "area" ? acc[i] : 0; if (spec.stacked && spec.type === "area") acc[i] += v; return [sx(i), sy(base + v), sy(base)] as const; });
        const ok = pts.filter((p): p is readonly [number, number, number] => !!p);
        if (!ok.length) return null;
        const line = ok.map((p, k) => `${k ? "L" : "M"}${p[0]},${p[1]}`).join("");
        const area = spec.type === "area" ? `${line}${[...ok].reverse().map((p) => `L${p[0]},${p[2]}`).join("")}Z` : "";
        const last = ok[ok.length - 1];
        return <g key={s.i} className={`vz-s${s.i % SLOTS}`}>
          {area && <path d={area} fill="currentColor" opacity={0.12} />}
          <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={last[0]} cy={last[1]} r={4} fill="currentColor" stroke="var(--vz-surface)" strokeWidth={2} />
        </g>;
      });
    }
    // Vùng rê chuột: cả cột của mỗi điểm trên trục ngang (lớn hơn dấu vẽ), có đường dóng cho line/area.
    const hits = spec.type === "scatter" ? null : spec.data.map((_, i) => <rect key={i} x={sx(i) - band / 2} y={padT} width={band} height={ih} fill="transparent"
      onMouseMove={() => rowTip(i, sx(i), colTop(i))} onMouseLeave={() => setTip(null)} />);
    const tipI = tip ? xs.indexOf(tip.title) : -1;
    plot = <>
      {grid}
      <line x1={padL} x2={padL + iw} y1={sy(Math.max(y0, Math.min(0, y1)))} y2={sy(Math.max(y0, Math.min(0, y1)))} className="vz-axis" />
      {(spec.type === "line" || spec.type === "area") && tip && tipI >= 0 && <line x1={sx(tipI)} x2={sx(tipI)} y1={padT} y2={padT + ih} className="vz-cross" />}
      {marks}{xt}{hits}
    </>;
  }
  return (
    <figure className="vz" ref={ref}>
      <figcaption className="vz-head">
        <span className="vz-title">{spec.title ?? spec.y.join(", ")}{spec.unit && <em> ({spec.unit})</em>}</span>
        <button className="vz-btn" onClick={() => setTable(!table)}>{tr(table ? "Xem biểu đồ" : "Xem bảng")}</button>
      </figcaption>
      {!pie && spec.y.length > 1 && <div className="vz-legend">{spec.y.map((name, i) => (
        <button key={name} className={hidden.has(i) ? "off" : ""} onClick={() => setHidden((h) => { const n2 = new Set(h); if (n2.has(i)) n2.delete(i); else if (n2.size < spec.y.length - 1) n2.add(i); return n2; })}>
          <i className={`vz-s${i % SLOTS}`} />{name}
        </button>
      ))}</div>}
      {table ? (
        <div className="md-tbl vz-table"><table><thead><tr><th>{spec.x}</th>{spec.y.map((y) => <th key={y}>{y}</th>)}</tr></thead>
          <tbody>{spec.data.map((r, i) => <tr key={i}><td>{String(r[spec.x] ?? "")}</td>{spec.y.map((y) => <td key={y}>{full(num(r[y]))}</td>)}</tr>)}</tbody></table></div>
      ) : (
        <div className="vz-plot">
          <svg width={w} height={H} role="img" aria-label={spec.title ?? "chart"}>{plot}</svg>
          {tip && <div className="vz-tip" style={{ left: Math.min(Math.max(tip.x, 70), w - 70), top: Math.max(tip.y - 12, 0) }}>
            <b>{tip.title}</b>{tip.rows.map((r) => <span key={r.i}><i className={`vz-s${(pie ? r.i : r.i) % SLOTS}`} />{r.name}<em>{full(r.v)}{u}</em></span>)}
          </div>}
        </div>
      )}
    </figure>
  );
}
