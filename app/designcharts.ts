// Biểu đồ điền sẵn cho slide, tài liệu, trang: model đưa số liệu, Synchro vẽ SVG theo quy tắc tỉ lệ dữ liệu / mực (data-ink): không lưới dọc, không khung, không 3D,
// cột thường màu trung tính, chỉ phần tiêu đề nói tới (highlight) dùng màu nhấn gốc của phong cách (--sx-vivid), ghi số thẳng trên hình thay cho trục, nhãn trực tiếp thay chú giải.
// Sáu loại theo bảng của chủ dự án (bar, line, doughnut bo tròn, waterfall, sankey, radar); chọn loại theo FT Visual Vocabulary (CHART_RULE).
// Màu, phông lấy từ biến của bộ thiết kế nên đổi phong cách là biểu đồ đổi theo. Xuất PowerPoint: biểu đồ nằm trong ảnh nền của slide, chữ ngoài biểu đồ vẫn sửa được.
// Tệp thuần; designtemplates.ts gắn biểu đồ vào slide (slide-chart) và tài liệu (trường chart của mỗi phần).
import { arr, esc, nid, num, obj, rich, str, type Ctx, type Props } from "./tplkit";

const W = 640, H = 360;
const fmt = (n: number, unit = "") => `${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("vi-VN") : (Math.round(n * 10) / 10).toLocaleString("vi-VN")}${unit}`;
const T = (x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: string; weight?: number } = {}) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${o.anchor ?? "middle"}" style="font-size:${o.size ?? 15}px;fill:${o.fill ?? "var(--sx-muted)"};font-weight:${o.weight ?? 500};font-family:var(--sx-body);font-variant-numeric:tabular-nums">${esc(s)}</text>`;
const NEU = (i: number) => (i % 3 === 0 ? "var(--sx-neutral)" : `color-mix(in oklab,var(--sx-neutral) ${i % 3 === 1 ? 60 : 35}%,var(--sx-surface))`);
const VIVID = "var(--sx-vivid)";
type Series = { name: string; data: number[] };
function seriesOf(p: Props): { labels: string[]; series: Series[] } {
  const labels = arr(p.labels, 24).map((x) => str(x, 40));
  let series = arr(p.series, 6).map(obj).map((s) => ({ name: str(s.name, 40), data: arr(s.data, 24).map(num) }));
  if (!series.length && Array.isArray(p.values)) series = [{ name: str(p.name, 40), data: arr(p.values, 24).map(num) }];
  return { labels, series };
}
// Phần được nhấn: theo nhãn hay chỉ số; không nêu thì giá trị lớn nhất (cột / tròn) hoặc chuỗi đầu (đường, radar).
const hlIndex = (p: Props, labels: string[], fallback: number) => { const h = p.highlight; if (typeof h === "number") return h; const i = labels.indexOf(str(h, 40)); return i >= 0 ? i : fallback; };
const nice = (v: number) => { if (v <= 0) return 1; const e = 10 ** Math.floor(Math.log10(v)), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };

function bar(p: Props, unit: string) {
  const { labels, series } = seriesOf(p), n = labels.length || (series[0]?.data.length ?? 0);
  if (!n || !series.length) return "";
  const all = series.flatMap((s) => s.data), max = Math.max(0, ...all), min = Math.min(0, ...all), hl = hlIndex(p, labels, series[0].data.indexOf(Math.max(...series[0].data)));
  const horiz = p.horizontal === true || n > 8 || labels.some((l) => l.length > 14);
  if (horiz) {
    const lw = 170, top = 8, rowH = Math.min(40, (H - top * 2) / n), span = max - min || 1, x0 = lw + ((0 - min) / span) * (W - lw - 70);
    return labels.map((l, i) => { const v = series[0].data[i] ?? 0, y = top + i * rowH, w = (Math.abs(v) / span) * (W - lw - 70), x = v >= 0 ? x0 : x0 - w, c = i === hl ? VIVID : NEU(0);
      return `${T(lw - 10, y + rowH * 0.62, l, { anchor: "end", fill: "var(--sx-ink)" })}<rect x="${x.toFixed(1)}" y="${(y + rowH * 0.18).toFixed(1)}" width="${Math.max(1, w).toFixed(1)}" height="${(rowH * 0.64).toFixed(1)}" rx="3" style="fill:${c}"/>${T(v >= 0 ? x + w + 6 : x - 6, y + rowH * 0.62, fmt(v, unit), { anchor: v >= 0 ? "start" : "end", fill: "var(--sx-ink)", weight: i === hl ? 700 : 500 })}`; }).join("");
  }
  const top = 28, bot = H - 34, span = max - min || 1, y = (v: number) => top + ((max - v) / span) * (bot - top), band = (W - 16) / n, k = series.length, bw = (band * 0.66) / k;
  let out = `<line x1="8" x2="${W - 8}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" style="stroke:var(--sx-line);stroke-width:1"/>`;
  for (let i = 0; i < n; i++) {
    const bx = 8 + i * band + band * 0.17;
    series.forEach((s, j) => { const v = s.data[i] ?? 0, x = bx + j * bw, c = k > 1 ? (j === 0 ? VIVID : NEU(j)) : i === hl ? VIVID : NEU(0);
      out += `<rect x="${x.toFixed(1)}" y="${Math.min(y(v), y(0)).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(1, Math.abs(y(v) - y(0))).toFixed(1)}" rx="3" style="fill:${c}"/>`;
      if (k === 1 || n * k <= 12) out += T(x + bw / 2 - 1, v >= 0 ? y(v) - 7 : y(v) + 16, fmt(v, unit), { size: k > 1 ? 14 : 15, fill: "var(--sx-ink)", weight: i === hl && k === 1 ? 700 : 500 }); });
    out += T(8 + i * band + band / 2, H - 12, labels[i] ?? "", { size: 14 });
  }
  return out + (k > 1 ? series.map((s, j) => `<rect x="${8 + j * 130}" y="2" width="10" height="10" rx="2" style="fill:${j === 0 ? VIVID : NEU(j)}"/>${T(22 + j * 130, 11, s.name, { anchor: "start", size: 14 })}`).join("") : "");
}
function line(p: Props, unit: string) {
  const { labels, series } = seriesOf(p), n = Math.max(labels.length, ...series.map((s) => s.data.length));
  if (n < 2 || !series.length) return "";
  const all = series.flatMap((s) => s.data), hi = Math.max(...all), lo = Math.min(...all), pad = (hi - lo) * 0.12 || 1, max = hi + pad, min = lo - pad * (lo >= 0 && lo - pad < 0 ? 0 : 1);
  const L = 12, R = W - 120, top = 20, bot = H - 34, x = (i: number) => L + (i / (n - 1)) * (R - L), y = (v: number) => top + ((max - v) / (max - min || 1)) * (bot - top), hl = hlIndex(p, series.map((s) => s.name), 0);
  let out = [0.25, 0.5, 0.75].map((f) => { const yy = top + f * (bot - top); return `<line x1="${L}" x2="${R}" y1="${yy}" y2="${yy}" style="stroke:var(--sx-line);stroke-width:1;stroke-dasharray:2 4"/>${T(R + 6, yy + 4, fmt(max - f * (max - min), unit), { anchor: "start", size: 14 })}`; }).join("");
  const order = series.map((_, i) => i).sort((a, b) => (a === hl ? 1 : b === hl ? -1 : 0));
  for (const j of order) {
    const s = series[j], c = j === hl ? VIVID : "var(--sx-muted)", last = s.data.length - 1;
    out += `<path d="${s.data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("")}" pathLength="1" class="sx-draw" style="fill:none;stroke:${c};stroke-width:${j === hl ? 3 : 2};stroke-linejoin:round;stroke-linecap:round"/><circle cx="${x(last).toFixed(1)}" cy="${y(s.data[last]).toFixed(1)}" r="${j === hl ? 4.5 : 3}" style="fill:${c}"/>`;
    if (series.length > 1 || s.name) out += T(x(last) + 10, y(s.data[last]) + 4, `${s.name ? `${s.name} ` : ""}${fmt(s.data[last], unit)}`, { anchor: "start", size: 14, fill: j === hl ? "var(--sx-ink)" : "var(--sx-muted)", weight: j === hl ? 700 : 500 });
  }
  const step = Math.ceil(n / 8);
  return out + labels.map((l, i) => (i % step === 0 || i === n - 1 ? T(x(i), H - 12, l, { size: 14 }) : "")).join("");
}
function doughnut(p: Props, unit: string) {
  const { labels, series } = seriesOf(p), vals = (series[0]?.data ?? []).slice(0, 6).map((v) => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0);
  if (!vals.length || !total) return "";
  const hl = hlIndex(p, labels, vals.indexOf(Math.max(...vals))), cx = 180, cy = 180, r = 118, sw = 42, cap = (sw / 2 / (2 * Math.PI * r)) * 100;
  let acc = 0, out = `<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:none;stroke:var(--sx-raised);stroke-width:${sw}"/>`;
  vals.forEach((v, i) => {
    const pct = (v / total) * 100, round = pct > cap * 2 + 3, gap = vals.length > 1 ? (round ? cap * 2 + 1.2 : 1.2) : 0, len = Math.max(0.2, pct - gap), c = i === hl ? VIVID : NEU(i);
    out += `<circle cx="${cx}" cy="${cy}" r="${r}" pathLength="100" transform="rotate(${(-90 + ((acc + gap / 2) / 100) * 360).toFixed(2)} ${cx} ${cy})" style="fill:none;stroke:${c};stroke-width:${sw};stroke-linecap:${round ? "round" : "butt"};stroke-dasharray:${len.toFixed(2)} ${(100 - len).toFixed(2)}"/>`;
    acc += pct;
  });
  out += T(cx, cy + 4, `${Math.round((vals[hl] / total) * 100)}%`, { size: 40, fill: "var(--sx-ink)", weight: 800 }) + T(cx, cy + 30, labels[hl] ?? "", { size: 15 });
  return out + vals.map((v, i) => { const yy = 70 + i * 40; return `<rect x="350" y="${yy - 11}" width="14" height="14" rx="4" style="fill:${i === hl ? VIVID : NEU(i)}"/>${T(374, yy + 1, labels[i] ?? "", { anchor: "start", fill: "var(--sx-ink)", weight: i === hl ? 700 : 500 })}${T(W - 12, yy + 1, `${Math.round((v / total) * 100)}% · ${fmt(v, unit)}`, { anchor: "end", size: 14 })}`; }).join("");
}
function waterfall(p: Props, unit: string) {
  const labels = arr(p.labels, 14).map((x) => str(x, 30)), deltas = arr(p.values, 14).map(num), start = obj(p.start), s0 = num(start.value);
  if (!deltas.length) return "";
  const steps: { label: string; from: number; to: number; kind: "total" | "up" | "down" }[] = [];
  let run = s0;
  if (str(start.label) || s0) steps.push({ label: str(start.label, 30) || "Đầu kỳ", from: 0, to: s0, kind: "total" });
  deltas.forEach((d, i) => { steps.push({ label: labels[i] ?? "", from: run, to: run + d, kind: d >= 0 ? "up" : "down" }); run += d; });
  steps.push({ label: str(p.endLabel, 30) || "Cuối kỳ", from: 0, to: run, kind: "total" });
  const hi = Math.max(0, ...steps.map((s) => Math.max(s.from, s.to))), lo = Math.min(0, ...steps.map((s) => Math.min(s.from, s.to)));
  const top = 26, bot = H - 34, y = (v: number) => top + ((hi - v) / (hi - lo || 1)) * (bot - top), band = (W - 16) / steps.length, bw = band * 0.64;
  return `<line x1="8" x2="${W - 8}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--sx-line)"/>` + steps.map((s, i) => {
    const x = 8 + i * band + (band - bw) / 2, c = s.kind === "total" ? (i === steps.length - 1 ? VIVID : NEU(0)) : s.kind === "up" ? "var(--sx-pos)" : "var(--sx-neg)";
    const conn = i < steps.length - 1 ? `<line x1="${(x + bw).toFixed(1)}" x2="${(x + band).toFixed(1)}" y1="${y(s.to).toFixed(1)}" y2="${y(s.to).toFixed(1)}" style="stroke:var(--sx-muted);stroke-width:1;stroke-dasharray:3 3"/>` : "";
    const v = s.kind === "total" ? fmt(s.to, unit) : `${s.to >= s.from ? "+" : "−"}${fmt(Math.abs(s.to - s.from), unit)}`;
    return `<rect x="${x.toFixed(1)}" y="${Math.min(y(s.from), y(s.to)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y(s.to) - y(s.from))).toFixed(1)}" rx="2" style="fill:${c}"/>${conn}${T(x + bw / 2, Math.min(y(s.from), y(s.to)) - 7, v, { size: 14, fill: "var(--sx-ink)", weight: s.kind === "total" ? 700 : 500 })}${T(x + bw / 2, H - 12, s.label, { size: 14 })}`;
  }).join("");
}
function sankey(p: Props, unit: string) {
  const links = arr(p.links, 40).map(obj).map((l) => ({ from: str(l.from, 30), to: str(l.to, 30), v: Math.max(0, num(l.value)) })).filter((l) => l.from && l.to && l.v && l.from !== l.to);
  if (!links.length) return "";
  const names = [...new Set(links.flatMap((l) => [l.from, l.to]))], layer = new Map(names.map((n) => [n, 0]));
  for (let k = 0; k < names.length; k++) for (const l of links) if (layer.get(l.to)! <= layer.get(l.from)!) layer.set(l.to, layer.get(l.from)! + 1); // tầng theo đường dài nhất (đồ thị có vòng thì dừng sau n lượt)
  const cols = Math.max(...layer.values()) + 1, val = (n: string) => Math.max(links.filter((l) => l.to === n).reduce((a, l) => a + l.v, 0), links.filter((l) => l.from === n).reduce((a, l) => a + l.v, 0));
  const byCol = [...Array(cols)].map((_, c) => names.filter((n) => layer.get(n) === c)), gap = 14, top = 10, bot = H - 10;
  const scale = Math.min(...byCol.map((c) => (bot - top - gap * (c.length - 1)) / c.reduce((a, n) => a + val(n), 0)));
  const nw = 14, x = (c: number) => 120 + (c / Math.max(1, cols - 1)) * (W - 240 - nw), pos = new Map<string, { x: number; y: number; h: number; o: number; i: number }>();
  byCol.forEach((c, ci) => { const used = c.reduce((a, n) => a + val(n) * scale, 0) + gap * (c.length - 1); let yy = top + (bot - top - used) / 2; for (const n of c) { const h = val(n) * scale; pos.set(n, { x: x(ci), y: yy, h, o: 0, i: 0 }); yy += h + gap; } });
  const hl = str(p.highlight, 30);
  let out = links.map((l) => { const a = pos.get(l.from)!, b = pos.get(l.to)!, h = l.v * scale, y1 = a.y + a.o + h / 2, y2 = b.y + b.i + h / 2; a.o += h; b.i += h; const mx = (a.x + nw + b.x) / 2, on = hl && (l.from === hl || l.to === hl);
    return `<path d="M${(a.x + nw).toFixed(1)} ${y1.toFixed(1)}C${mx.toFixed(1)} ${y1.toFixed(1)} ${mx.toFixed(1)} ${y2.toFixed(1)} ${b.x.toFixed(1)} ${y2.toFixed(1)}" style="fill:none;stroke:${on ? VIVID : "var(--sx-muted)"};stroke-opacity:${on ? 0.6 : 0.3};stroke-width:${Math.max(1, h).toFixed(1)}"/>`; }).join("");
  for (const [n, q] of pos) { const last = layer.get(n) === cols - 1; out += `<rect x="${q.x.toFixed(1)}" y="${q.y.toFixed(1)}" width="${nw}" height="${Math.max(1, q.h).toFixed(1)}" rx="2" style="fill:${n === hl ? VIVID : "var(--sx-muted)"}"/>${T(last ? q.x + nw + 8 : q.x - 8, q.y + q.h / 2 + 4, `${n} ${fmt(val(n), unit)}`, { anchor: last ? "start" : "end", size: 14, fill: "var(--sx-ink)", weight: n === hl ? 700 : 500 })}`; }
  return out;
}
function radar(p: Props) {
  const { labels, series } = seriesOf(p), n = labels.length;
  if (n < 3 || !series.length) return "";
  const max = num(p.max) || nice(Math.max(...series.flatMap((s) => s.data))), cx = W / 2, cy = H / 2 + 6, r = 128, hl = hlIndex(p, series.map((s) => s.name), 0);
  const pt = (i: number, f: number) => [cx + Math.sin((i / n) * 2 * Math.PI) * r * f, cy - Math.cos((i / n) * 2 * Math.PI) * r * f];
  let out = [0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${labels.map((_, i) => pt(i, f).map((v) => v.toFixed(1)).join(",")).join(" ")}" style="fill:none;stroke:var(--sx-line);stroke-width:1"/>`).join("");
  out += labels.map((l, i) => { const [x2, y2] = pt(i, 1), [lx, ly] = pt(i, 1.14); return `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" style="stroke:var(--sx-line)"/>${T(lx, ly + 4, l, { size: 14, anchor: Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end" })}`; }).join("");
  const order = series.map((_, i) => i).sort((a, b) => (a === hl ? 1 : b === hl ? -1 : 0));
  out += order.map((j) => { const s = series[j], c = j === hl ? VIVID : "var(--sx-muted)"; return `<polygon points="${labels.map((_, i) => pt(i, Math.min(1, Math.max(0, (s.data[i] ?? 0) / max))).map((v) => v.toFixed(1)).join(",")).join(" ")}" style="fill:${c};fill-opacity:${j === hl ? 0.2 : 0.06};stroke:${c};stroke-width:${j === hl ? 2.5 : 1.5};stroke-linejoin:round"/>`; }).join("");
  return out + (series.length > 1 ? series.map((s, j) => `<rect x="8" y="${6 + j * 20}" width="10" height="10" rx="2" style="fill:${j === hl ? VIVID : "var(--sx-muted)"}"/>${T(24, 15 + j * 20, s.name, { anchor: "start", size: 14, fill: j === hl ? "var(--sx-ink)" : "var(--sx-muted)" })}`).join("") : "");
}

export const CHART_KINDS = ["bar", "line", "doughnut", "waterfall", "sankey", "radar"] as const;
const DRAW: Record<string, (p: Props, unit: string) => string> = { bar, column: bar, line, area: line, doughnut, donut: doughnut, pie: doughnut, waterfall, sankey, radar };
/** Biểu đồ thành <figure> có tiêu đề, SVG và nguồn; số liệu không vẽ được thì rỗng (không vỡ trang). */
export function renderChart(v: unknown, c: Ctx, field = "chart", cls = "") {
  const p = obj(v), kind = str(p.kind ?? p.type, 20).toLowerCase(), draw = DRAW[kind];
  if (!draw) return "";
  const body = draw(p, str(p.unit, 8));
  if (!body) return "";
  const title = str(p.title, 160);
  return `<figure class="sx-chart sx-keep ${cls}" data-sx-chart="${esc(kind)}">${title ? `<figcaption class="sx-h3" ${nid(c, `${field}.title`)}>${rich(title, 160)}</figcaption>` : ""}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title || kind)}" preserveAspectRatio="xMidYMid meet">${title ? `<title>${esc(title)}</title>` : ""}${body}</svg>${str(p.source) ? `<p class="sx-source" ${nid(c, `${field}.source`)}>${rich(p.source, 200)}</p>` : ""}</figure>`;
}
export const CHART_CSS = `.sx-chart{margin:0;display:flex;flex-direction:column;gap:calc(8*var(--sx-u));min-height:0}.sx-chart svg{width:100%;height:auto;max-height:100%;display:block;overflow:visible}
.sx-tpl-chart .sx-chart{flex:1 1 0;min-height:0}.sx-tpl-chart .sx-chart svg{flex:1 1 0;min-height:0;height:100%}`;
// Chọn loại biểu đồ theo câu hỏi dữ liệu (FT Visual Vocabulary), gửi model cùng thực đơn mẫu.
export const CHART_RULE = `Biểu đồ điền sẵn (thay cho tự vẽ SVG / thư viện): "chart":{"kind":…,"title":"câu kết luận","labels":[…],"series":[{"name","data":[…]}] hoặc "values":[…],"unit":"%","highlight":"nhãn hay chuỗi cần nhấn","source":"…"}; waterfall: values là phần tăng giảm + start:{label,value}, endLabel; sankey: links:[{from,to,value}]; radar: max?. Chọn loại theo câu hỏi (FT Visual Vocabulary): so sánh độ lớn, xếp hạng → bar (nhãn dài tự nằm ngang); thay đổi theo thời gian → line (≤4 chuỗi); phần của tổng → doughnut ≤5 phần; cộng trừ dồn từ đầu kỳ tới cuối kỳ → waterfall; dòng chảy giữa các nhóm → sankey; nhiều tiêu chí của 2-3 đối tượng → radar (3-8 trục). Tự vẽ thì giữ cùng luật: không lưới dọc, cột xám, một phần nhấn.`;
