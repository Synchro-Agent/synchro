// Sinh workspace/charts/synchro-charts.js (CommonJS, chạy trong sandbox run_code) từ đúng mã cấu hình biểu đồ của khung artifact
// (shared/design-engine/charts/echarts-presets.ts) và bảng màu 8 phong cách (shared/designpresets.ts): biểu đồ dựng bằng synchro-chart giống hệt biểu đồ trong artifact.
// Chạy: node scripts/gen-chart-presets.mjs        Kiểm (không ghi): node scripts/gen-chart-presets.mjs --check
import fs from "node:fs";
import { loadTs } from "../tests/lib/ts.mjs";

const { "design-engine/charts/echarts-presets": P, designpresets: D } = await loadTs(["design-engine/charts/echarts-presets", "designpresets"]);
const presets = Object.fromEntries(D.PRESETS.map((p) => [p.id, { bg: p.bg, surface: p.surface, ink: p.ink, muted: p.muted, accent: p.accent, accent2: p.accent2, neutral: p.neutral, line: p.line, pos: p.pos, neg: p.neg, font: D.FONT_SPEC[p.body].stack }]));
const out = `// TỆP SINH TỰ ĐỘNG bởi scripts/gen-chart-presets.mjs, đừng sửa tay: sửa app/design-engine/charts/echarts-presets.ts rồi chạy lại lệnh đó.
"use strict";
${P.CHART_PRESETS_JS.trim()}
var PRESETS = ${JSON.stringify(presets, null, 1)};
module.exports = { sxChartOption: sxChartOption, PRESETS: PRESETS };
`;
const file = "workspace/charts/synchro-charts.js";
if (process.argv.includes("--check")) {
  const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === out;
  console.log(same ? "khớp" : `${file} cũ: chạy node scripts/gen-chart-presets.mjs`);
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, out);
console.log(`đã ghi ${file} (${out.length} byte)`);
