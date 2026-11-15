// Kiểm đường dẫn sau mỗi lần chuyển thư mục (H3 — cấu trúc thư mục). Chỉ đọc mã nguồn, không cần máy chủ.
// 1. Mọi đường dẫn tệp trong repo được nhắc nguyên văn trong bộ kiểm thử, script, CI, cấu hình đều có thật: kiểm thử đọc mã theo đường dẫn
//    mà tệp đã chuyển đi thì không được lặng lẽ đọc rỗng.
// 2. Bộ quét mã nguồn (tests/lib/srcroots.mjs) thấy đủ số tệp tối thiểu: thiếu một gốc thì phép kiểm quét mã không thể qua vì không đọc gì.
// 3. server/: mỗi tệp mở đầu bằng import "server-only" (gói giao diện nhập nhầm thì bản build báo lỗi); không tệp "use client" nào nhập
//    (không chỉ kiểu) một tệp trong server/.
import fs from "node:fs";
import path from "node:path";
import { walkSrc } from "../lib/srcroots.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 4000)); };
const P = path.posix;

const walk = (d, re, out = []) => {
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (["node_modules", "vendor-3d", "fixtures"].includes(e.name) || e.name.startsWith(".next")) continue;
    const p = P.join(d, e.name);
    if (e.isDirectory()) walk(p, re, out); else if (re.test(e.name)) out.push(p);
  }
  return out;
};

console.log("1. Đường dẫn nhắc trong kiểm thử, script, CI, cấu hình đều có thật");
const scanned = [
  ...walk("tests", /\.(mjs|cjs|js)$/), ...walk("scripts", /\.(mjs|cjs|js|sh|py)$/), ...walk("tools", /\.(mjs|cjs|js|sh|py)$/), ...walk("ops", /\.(mjs|cjs|js|sh|py)$/),
  ...walk(".github/workflows", /\.ya?ml$/),
  ...["package.json", "eslint.config.mjs", "tsconfig.json", "next.config.ts", "instrumentation.ts", "instrumentation-node.ts", "ecosystem.config.cjs", "workspace/setup.sh", "ops/setup.sh"].filter((f) => fs.existsSync(f)),
];
const REF = /(?<![\w$.@/-])(app|server|ui|shared|scripts|ops|tools|db|workspace)\/[\w@\[\]./-]+\.(tsx?|mjs|cjs|css|sh|py|sql|json|txt)\b/g;
// Có chủ ý không tồn tại: [tệp nhắc tới, đường dẫn]. Tệp giả do chính bài kiểm tạo (trong thư mục tạm), đường dẫn bên trong gói skill / video thử.
const ALLOW = [
  [/./, /^(app|server|ui|shared)\/zz-/],                                   // tệp giả trong phép kiểm bộ quét
  [/^tests\/api\/boot-fast\.test\.mjs$/, /^app\/api\/x\/route\.ts$/],     // route giả
  [/^tests\/api\/css-inline\.test\.mjs$/, /^app\/a\.css$/],               // CSS giả trong thư mục tạm
  [/^tests\/(api|ui)\/skill[\w-]*\.(test\.)?mjs$/, /^scripts\/[\w-]+\.py$/], // tệp bên trong một skill thử, không phải scripts/ của repo
  [/^tests\/api\/synchro-video\.test\.mjs$/, /^tools\/make\.py$/],          // tệp bên trong dự án video thử
];
const missing = [];
for (const f of scanned.filter((x) => x !== "tests/api/paths-guard.test.mjs")) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(REF)) {
    const ref = m[0];
    if (ALLOW.some(([fr, rr]) => fr.test(f) && rr.test(ref)) || fs.existsSync(ref)) continue;
    missing.push(`${f}: ${ref}`);
  }
}
ok(scanned.length > 300, `quét ${scanned.length} tệp`);
ok(!missing.length, `mọi đường dẫn nhắc tới đều có thật (${missing.length} thiếu)`, missing.join("\n"));

console.log("2. Bộ quét mã nguồn thấy đủ tệp");
const ts = walkSrc(/\.tsx?$/).filter((f) => !f.endsWith(".d.ts"));
const css = walkSrc(/\.css$/);
const src = new Map(ts.map((f) => [f, fs.readFileSync(f, "utf8")]));
const isClient = (s) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(s);
const clients = [...src].filter(([, s]) => isClient(s)).map(([f]) => f);
const ddl = [...src].filter(([, s]) => /CREATE TABLE/.test(s)).length;
ok(ts.length >= 500, `≥ 500 tệp .ts/.tsx (${ts.length})`);
ok(css.length >= 15, `≥ 15 tệp .css (${css.length})`);
ok(clients.length >= 128, `≥ 128 tệp "use client" (${clients.length})`);
ok(ddl >= 36 || fs.existsSync("db/migrations"), `≥ 36 tệp có CREATE TABLE (${ddl})`);

console.log("3. server/ chỉ chạy ở máy chủ");
const server = [...src.keys()].filter((f) => f.startsWith("server/") && !f.startsWith("server/bin/"));
const noMark = server.filter((f) => {
  // Dòng lệnh đầu tiên (bỏ chú thích đầu tệp) phải là import "server-only".
  const body = src.get(f).replace(/^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*/, "");
  return !/^import\s+["']server-only["'];/.test(body);
});
ok(server.length >= 1, `server/ có ${server.length} tệp`);
ok(!noMark.length, `mọi tệp server/ mở đầu bằng import "server-only"`, noMark.join(", "));
const resolve = (from, spec) => {
  const b = P.normalize(P.join(P.dirname(from), spec));
  return [b, `${b}.ts`, `${b}.tsx`, `${b}/index.ts`, `${b}/index.tsx`].find((x) => src.has(x)) ?? null;
};
const leaks = [];
for (const f of clients) {
  for (const m of src.get(f).matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)([^;]*?)\s*from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const names = m[1]?.trim();
    if (names && /^\{[^}]*\}$/.test(names) && names.slice(1, -1).split(",").every((x) => !x.trim() || /^type\s/.test(x.trim()))) continue;
    const t = resolve(f, m[2] ?? m[3]);
    if (t?.startsWith("server/")) leaks.push(`${f} → ${t}`);
  }
}
ok(!leaks.length, `không tệp "use client" nào nhập mã server/ (${clients.length} tệp)`, leaks.join("\n"));

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
