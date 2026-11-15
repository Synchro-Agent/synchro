// Biểu đồ ECharts và sơ đồ D2 trong image sandbox: ghim phiên bản và mã băm (workspace/Dockerfile, workspace/charts/package*.json), cấu hình biểu đồ trong sandbox
// giống hệt khung artifact (sinh từ shared/design-engine/charts/echarts-presets.ts), setup.sh dựng lại image khi tệp biểu đồ đổi, ECharts trong public/vendor đúng bản npm.
// Không cần máy chủ. Phần chạy thật: bước tự kiểm tra biểu đồ / D2 lúc build image (không mạng).
import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const read = (p) => fs.readFileSync(p, "utf8");

console.log("1. ECharts: một bản 6.1.0 ở mọi nơi");
{
  const pkg = JSON.parse(read("workspace/charts/package.json")), lock = JSON.parse(read("workspace/charts/package-lock.json"));
  ok(pkg.dependencies.echarts === "6.1.0" && Object.keys(pkg.dependencies).length === 1, "sandbox: echarts 6.1.0 đúng bản, không ^ ~", JSON.stringify(pkg.dependencies));
  const e = lock.packages["node_modules/echarts"], z = lock.packages["node_modules/zrender"];
  ok(e?.version === "6.1.0" && e.integrity === "sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==" && /^sha512-/.test(z?.integrity ?? ""), "package-lock: mã băm sha512 đúng bản phát hành npm");
  const { artkit } = await loadTs(["artkit"]);
  const v = fs.readFileSync("public/vendor/echarts-6.1.0.min.js"), sri = "sha384-" + crypto.createHash("sha384").update(v).digest("base64");
  ok(artkit.ECHARTS[0] === "echarts-6.1.0.min.js" && artkit.ECHARTS[1] === "echarts@6.1.0/dist/echarts.min.js" && artkit.ECHARTS[2] === sri, "khung artifact: tệp vendor khớp SRI ghim (dự phòng jsDelivr cùng mã)", sri);
  ok(/echarts 6\.1\.0 \(Apache-2\.0/.test(read("public/vendor/README.md")), "README vendor ghi giấy phép");
}

console.log("2. Cấu hình biểu đồ trong sandbox giống khung artifact");
{
  const r = spawnSync(process.execPath, ["scripts/gen-chart-presets.mjs", "--check"], { encoding: "utf8" });
  ok(r.status === 0, "workspace/charts/synchro-charts.js khớp shared/design-engine/charts/echarts-presets.ts", r.stdout + r.stderr);
  const m = { exports: {} };
  new Function("module", "exports", read("workspace/charts/synchro-charts.js"))(m, m.exports);
  const { sxChartOption, PRESETS } = m.exports;
  ok(Object.keys(PRESETS).length === 8 && PRESETS["midnight-tech"].accent === "#818CF8", "đủ 8 phong cách với màu của bộ thiết kế");
  const types = ["bar", "line", "area", "pie", "doughnut", "waterfall", "sankey", "radar"];
  const spec = (t) => t === "sankey" ? { type: t, nodes: [{ name: "A" }, { name: "B" }], links: [{ source: "A", target: "B", value: 3 }] } : { type: t, labels: ["a", "b", "c"], series: [{ name: "s", data: [3, -1, 2] }], total: t === "waterfall" };
  ok(types.every((t) => sxChartOption(spec(t), PRESETS["swiss-grid"])?.series?.length), "8 loại đều có cấu hình", types.filter((t) => !sxChartOption(spec(t), {})).join(","));
  ok(sxChartOption({ type: "pie3d" }, {}) === null, "loại không có: null (CLI báo lỗi rõ)");
  const d = sxChartOption({ type: "doughnut", labels: ["a", "b"], series: [{ name: "s", data: [1, 2] }] }, {});
  ok(String(d.series[0].radius) === "55%,78%" && d.series[0].itemStyle.borderRadius === 8, "doughnut bo góc đúng mẫu (bán kính 55–78%, bo 8)");
  const w = sxChartOption({ type: "waterfall", labels: ["Đầu", "+", "−", "Cuối"], series: [{ name: "x", data: [100, 30, -20, 0] }], total: true }, {});
  ok(JSON.stringify(w.series.map((s) => s.data)) === JSON.stringify([[0, 100, 110, 0], ["-", 30, "-", "-"], ["-", "-", 20, "-"], [100, "-", "-", 110]]), "waterfall: nền trong suốt, tăng, giảm, tổng đúng số", JSON.stringify(w.series.map((s) => s.data)));
  ok(!/"/.test(sxChartOption({ type: "bar", labels: ["a"], series: [{ name: "s", data: [1] }] }, { font: '"Inter", sans-serif' }).textStyle.fontFamily), "tên phông không còn nháy kép (SVG dựng ở máy chủ không hỏng thuộc tính)");
}

console.log("3. Dockerfile và setup.sh");
{
  const d = read("workspace/Dockerfile"), s = read("workspace/setup.sh");
  ok(/COPY charts\/package\.json charts\/package-lock\.json[\s\S]{0,200}npm ci --omit=dev/.test(d), "ECharts cài bằng npm ci theo lockfile");
  ok(/d2-v0\.9\.0-linux-amd64\.tar\.gz[\s\S]{0,200}5669ddc46b99e942cc96078f4a4e36d5e62103348f4c05179ede27802fdd87a9/.test(d), "D2 v0.9.0 linux-amd64 ghim mã băm của SHA256SUMS");
  ok(/d2 --version \| grep -qx v0\.9\.0/.test(d) && /synchro-chart c-\$t\.json/.test(d) && /d2 --layout=elk s\.d2/.test(d), "tự kiểm tra lúc build: 8 loại biểu đồ, PNG, require(\"echarts\"), D2 tiếng Việt");
  ok(/\/opt\/synchro\/charts\/node_modules/.test(d) && !/tala/i.test(d.replace(/TALA là phần mềm thương mại nên không dùng/g, "")), "require(\"echarts\") ở mọi thư mục; không dùng TALA");
  ok(/CHART_FILES=.*find charts -type f -not -path 'charts\/node_modules\/\*'/.test(s) && /\$REMOTION_FILES \$DOC_FILES \$CHART_FILES/.test(s), "setup.sh: đổi tệp biểu đồ thì dựng lại image");
  ok(/charts\/node_modules/.test(read("workspace/.dockerignore")), ".dockerignore bỏ node_modules của biểu đồ");
  const c = read("server/coderun.ts");
  ok(/synchro-chart spec\.json/.test(c) && /d2 --layout=elk/.test(c) && /openpyxl\.chart/.test(c), "hướng dẫn model: synchro-chart, ECharts SSR, biểu đồ gốc Office, D2");
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
