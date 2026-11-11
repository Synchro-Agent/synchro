#!/usr/bin/env node
// synchro-chart: biểu đồ của bộ thiết kế Synchro dựng ở sandbox bằng ECharts SSR (không trình duyệt, không mạng) → SVG vector, hoặc PNG qua rsvg-convert.
// Cùng dữ liệu và cùng cấu hình với biểu đồ trong artifact (data-sx-chart), dùng cho Word, PDF, ảnh, slide python-pptx khi cần hình.
//   synchro-chart <spec.json> <ra.svg|ra.png> [--width 960] [--height 540] [--preset swiss-grid] [--scale 2] [--transparent]
//   synchro-chart example        in ví dụ dữ liệu của 8 loại
//   synchro-chart presets        in tên các phong cách
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const echarts = require("echarts");
const { sxChartOption, PRESETS } = require("./synchro-charts.js");
const EXAMPLES = {
  bar: { type: "bar", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "2025", data: [120, 132, 101, 134] }, { name: "2026", data: [140, 152, 171, 190] }], highlight: "2026", unit: " tỷ" },
  line: { type: "line", labels: ["T1", "T2", "T3", "T4", "T5", "T6"], series: [{ name: "Người dùng", data: [12, 18, 25, 31, 44, 58] }] },
  area: { type: "area", labels: ["T1", "T2", "T3", "T4"], series: [{ name: "Doanh thu", data: [5, 8, 7, 12] }] },
  doughnut: { type: "doughnut", labels: ["Bắc", "Trung", "Nam"], series: [{ name: "Tỷ trọng", data: [42, 18, 40] }] },
  pie: { type: "pie", labels: ["A", "B"], series: [{ name: "Phần", data: [70, 30] }] },
  waterfall: { type: "waterfall", labels: ["Đầu kỳ", "Doanh thu", "Giá vốn", "Chi phí", "Cuối kỳ"], series: [{ name: "Dòng tiền", data: [500, 320, -180, -90, 0] }], total: true },
  sankey: { type: "sankey", nodes: [{ name: "Quảng cáo" }, { name: "Dùng thử" }, { name: "Trả phí" }], links: [{ source: "Quảng cáo", target: "Dùng thử", value: 60 }, { source: "Dùng thử", target: "Trả phí", value: 30 }] },
  radar: { type: "radar", labels: ["Tốc độ", "Giá", "Hỗ trợ", "Tính năng"], series: [{ name: "Synchro", data: [9, 7, 8, 9] }], highlight: 0 },
};
const [cmd, out, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "-h" || cmd === "--help") { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 6).join("\n")); process.exit(cmd ? 0 : 2); }
if (cmd === "example") { console.log(JSON.stringify(EXAMPLES, null, 1)); process.exit(0); }
if (cmd === "presets") { console.log(Object.keys(PRESETS).join("\n")); process.exit(0); }
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
if (!out) { console.error("Thiếu tệp ra (.svg hoặc .png)."); process.exit(2); }
let spec;
try { spec = JSON.parse(fs.readFileSync(cmd, "utf8")); } catch (e) { console.error(`Không đọc được ${cmd}: ${e.message}`); process.exit(2); }
const preset = opt("preset", "swiss-grid");
if (!PRESETS[preset]) { console.error(`Không có phong cách ${preset}. Có: ${Object.keys(PRESETS).join(", ")}`); process.exit(2); }
const width = Math.max(200, Math.min(4000, Number(opt("width", 960)) || 960)), height = Math.max(150, Math.min(4000, Number(opt("height", 540)) || 540));
const tk = { ...PRESETS[preset], bg: PRESETS[preset].surface, motion: false };
const option = sxChartOption(spec, tk);
if (!option) { console.error(`Loại biểu đồ "${spec.type}" không có. Có: ${Object.keys(EXAMPLES).join(", ")}`); process.exit(2); }
const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width, height });
chart.setOption({ ...option, backgroundColor: rest.includes("--transparent") ? "transparent" : PRESETS[preset].surface });
let svg = chart.renderToSVGString();
chart.dispose();
// Số liệu thẳng cột: chữ số đều nhau như trong artifact.
svg = svg.replace(/<svg\b([^>]*)>/, `<svg$1><style>text{font-variant-numeric:tabular-nums lining-nums}</style>`);
if (out.endsWith(".png")) {
  const scale = Math.max(1, Math.min(4, Number(opt("scale", 2)) || 2));
  const r = spawnSync("rsvg-convert", ["-z", String(scale), "-o", out], { input: svg });
  if (r.status !== 0) { console.error(`rsvg-convert lỗi: ${String(r.stderr).slice(0, 300)}`); process.exit(1); }
} else fs.writeFileSync(out, svg);
console.log(`${out} ${width}×${height}${out.endsWith(".png") ? ` ×${opt("scale", 2)}` : ""} (${spec.type}, ${preset})`);
