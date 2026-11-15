// Kiểm đường dẫn sau mỗi lần chuyển thư mục (H3 — cấu trúc thư mục). Chỉ đọc mã nguồn, không cần máy chủ.
// 1. Mọi đường dẫn tệp trong repo được nhắc nguyên văn trong bộ kiểm thử, script, CI, cấu hình đều có thật: kiểm thử đọc mã theo đường dẫn
//    mà tệp đã chuyển đi thì không được lặng lẽ đọc rỗng.
// 2. Bộ quét mã nguồn (tests/lib/srcroots.mjs) thấy đủ số tệp tối thiểu: thiếu một gốc thì phép kiểm quét mã không thể qua vì không đọc gì.
// 3. server/: mỗi tệp mở đầu bằng import "server-only" (gói giao diện nhập nhầm thì bản build báo lỗi); không tệp "use client" nào nhập
//    (không chỉ kiểu) một tệp trong server/.
// 4. ui/ giữ mã giao diện; app/ chỉ giữ tệp của Next (và app/_shell/). 5. shared/ không mang dấu phía nào và chỉ nhập mã trong shared/.
// 6. ops/ và tools/: scripts/ chỉ còn tệp web chạy lúc chạy và lớp chuyển tiếp; deploy gọi ops/, harden giữ ops/ thuộc root.
import fs from "node:fs";
import path from "node:path";
import { authStoreFiles, chatEngineFiles, walkSrc } from "../lib/srcroots.mjs";

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
  ...["package.json", "eslint.config.mjs", "tsconfig.json", "next.config.ts", "instrumentation.ts", "instrumentation-node.ts", "ecosystem.config.cjs", "ops/setup.sh", "ops/setup.sh"].filter((f) => fs.existsSync(f)),
];
const REF = /(?<![\w$.@/-])(app|server|ui|shared|scripts|ops|tools|db|workspace)\/[\w@\[\]./-]+\.(tsx?|mjs|cjs|css|sh|py|sql|json|txt)\b/g;
// Có chủ ý không tồn tại: [tệp nhắc tới, đường dẫn]. Tệp giả do chính bài kiểm tạo (trong thư mục tạm), đường dẫn bên trong gói skill / video thử.
const ALLOW = [
  [/./, /^(app|server|ui|shared)\/zz-/],                                   // tệp giả trong phép kiểm bộ quét
  [/^tests\/api\/boot-fast\.test\.mjs$/, /^app\/api\/x\/route\.ts$/],     // route giả
  [/^tests\/api\/css-inline\.test\.mjs$/, /^app\/(a\.css|ui\.tsx)$/],     // CSS, tsx giả trong thư mục tạm
  [/^tests\/(api|ui)\/skill[\w-]*\.(test\.)?mjs$/, /^scripts\/[\w-]+\.py$/], // tệp bên trong một skill thử, không phải scripts/ của repo
  [/^tests\/api\/synchro-video\.test\.mjs$/, /^tools\/make\.py$/],          // tệp bên trong dự án video thử
  // Dòng đầu của workspace/charts/synchro-charts.js do script này sinh ra: tệp đó nằm trong mã băm image sandbox (ops/setup.sh), sửa chữ
  // ở đây thì phải sinh lại và dựng lại image. Giữ nguyên cho tới lần sửa chú thích workspace/ (cùng lúc với các chú thích cũ khác trong workspace/).
  [/^tools\/gen-chart-presets\.mjs$/, /^(app\/design-engine\/charts\/echarts-presets\.ts|scripts\/gen-chart-presets\.mjs)$/],
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

console.log("4. ui/ giữ mã giao diện; app/ chỉ giữ tệp của Next");
// Tệp "use client" chỉ nằm trong ui/, trừ các tệp đặc biệt của Next phải ở app/ (error, global-error, page…) và ba ranh giới client mỏng
// app/layout.tsx nhập (LAYOUT_SHELL, chỉ chuyển tiếp sang ui/). Ba tệp đó ở app/_shell/ cùng các tệp CSS tải đầu: bản build webpack xếp thứ
// tự tệp CSS tải đầu bằng một phép sắp xếp theo đường dẫn trộn lẫn component client với tệp CSS và với node_modules/ của bộ chữ (next
// flight-client-entry-plugin); chúng không cùng ở một thư mục xếp trước "node_modules" thì thứ tự <link> của bản production đổi (glass.css +
// features.css thôi đứng trước globals.css) và bên thắng của cascade đổi theo. app/_shell/ là thư mục riêng (gạch dưới): Next không coi là route.
const NEXT_SPECIAL = /^app\/(.+\/)?(page|layout|error|global-error|not-found|loading|template|default)\.tsx$/;
const SHELL_DIR = "app/_shell/";
const LAYOUT_SHELL = ["app/_shell/glass.tsx", "app/_shell/i18n.tsx", "app/_shell/chunkguard.tsx"];
const strays = clients.filter((f) => !f.startsWith("ui/") && !NEXT_SPECIAL.test(f) && !LAYOUT_SHELL.includes(f));
const FIRST_CSS = ["app/_shell/unbounded-preload.css", "app/_shell/globals.css", "app/_shell/glass.css", "app/_shell/synchro-ds.css", "app/_shell/features.css"];
ok([...LAYOUT_SHELL, ...FIRST_CSS].every((f) => fs.existsSync(f)), "ranh giới client của layout và CSS tải đầu cùng ở app/_shell/ (giữ thứ tự <link> của bản build)",
  [...LAYOUT_SHELL, ...FIRST_CSS].filter((f) => !fs.existsSync(f)).join(", "));
const layout = fs.readFileSync("app/layout.tsx", "utf8");
const layoutImports = [...layout.matchAll(/^import\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["'];/gm)].map((m) => m[1]);
const WANT_IMPORTS = ["./_shell/glass", "./_shell/i18n", "./_shell/chunkguard", "../server/langdetect", "next", "@fontsource-variable/unbounded/wght.css",
  "./_shell/unbounded-preload.css", "./_shell/globals.css", "./_shell/glass.css", "./_shell/synchro-ds.css", "./_shell/features.css"];
ok(JSON.stringify(layoutImports) === JSON.stringify(WANT_IMPORTS), "app/layout.tsx nhập đúng các tệp đó theo đúng thứ tự (thứ tự nạp CSS ở next dev)", layoutImports.join("\n"));
const thin = LAYOUT_SHELL.filter((f) => {
  const body = fs.readFileSync(f, "utf8").replace(/^\s*["']use client["'];?/, "").replace(/\/\/[^\n]*/g, "").trim();
  return !/^export\s+\{[^}]*\}\s+from\s+["']\.\.\/\.\.\/ui\/[\w-]+["'];$/.test(body);
});
ok(!thin.length, "ba ranh giới client trong app/_shell/ chỉ chuyển tiếp sang ui/ (một dòng export … from)", thin.join(", "));
ok(!css.some((f) => f.startsWith("app/") && !FIRST_CSS.includes(f) && f !== "app/_shell/tokens.css"), "CSS khác (tải chậm, vendor) nằm ở ui/styles/",
  css.filter((f) => f.startsWith("app/") && !FIRST_CSS.includes(f) && f !== "app/_shell/tokens.css").join(", "));
// app/ chỉ giữ route, layout, page, route handler, tệp đặc biệt và ảnh metadata của Next, cùng đúng các tệp đã kể trong app/_shell/.
const APP_OK = /^app\/(.+\/)?(page|layout|route|error|global-error|not-found|loading|template|default)\.tsx?$|^app\/manifest\.ts$|^app\/(favicon\.ico|icon\.svg|apple-icon\.png|(opengraph|twitter)-image\.(png|alt\.txt))$/;
const SHELL_FILES = [...LAYOUT_SHELL, ...FIRST_CSS, "app/_shell/tokens.css"];
const appFiles = walk("app", /./);
const appExtra = appFiles.filter((f) => (f.startsWith(SHELL_DIR) ? !SHELL_FILES.includes(f) : !APP_OK.test(f)));
ok(appFiles.length >= 140, `app/ có ${appFiles.length} tệp`);
ok(!appExtra.length, "app/ chỉ giữ tệp của Next (route, layout, page, tệp đặc biệt, ảnh metadata) và app/_shell/", appExtra.join("\n"));
ok(clients.filter((f) => f.startsWith("ui/")).length >= 120, `ui/ có ${clients.filter((f) => f.startsWith("ui/")).length} tệp "use client"`);
ok(!strays.length, `không tệp "use client" nào ngoài ui/ (trừ tệp đặc biệt của Next trong app/)`, strays.join(", "));
// Không tệp nào trong ui/ (kể cả tiện ích không mang "use client") nhập mã server/ ngoài kiểu.
const uiLeaks = [];
for (const f of [...src.keys()].filter((x) => x.startsWith("ui/"))) {
  for (const m of src.get(f).matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)([^;]*?)\s*from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const names = m[1]?.trim();
    if (names && /^\{[^}]*\}$/.test(names) && names.slice(1, -1).split(",").every((x) => !x.trim() || /^type\s/.test(x.trim()))) continue;
    const t = resolve(f, m[2] ?? m[3]);
    if (t?.startsWith("server/")) uiLeaks.push(`${f} → ${t}`);
  }
}
ok(!uiLeaks.length, "không tệp ui/ nào nhập mã server/", uiLeaks.join("\n"));

console.log("5. shared/ dùng được ở cả hai phía");
// Mã dùng chung (từ điển, dữ liệu thiết kế, danh mục, mdparse, kiểu trong shared/types/) không mang "use client" hay import "server-only",
// và chỉ nhập mã trong shared/ (kể cả kiểu): nhập mã server/ hay ui/ thì gói giao diện kéo theo mã máy chủ, hoặc máy chủ kéo theo mã trình duyệt.
const shared = [...src.keys()].filter((f) => f.startsWith("shared/"));
ok(shared.length >= 53, `shared/ có ${shared.length} tệp`);
const marked = shared.filter((f) => isClient(src.get(f)) || /^\s*import\s+["']server-only["']/m.test(src.get(f)));
ok(!marked.length, 'không tệp shared/ nào mang "use client" hay import "server-only"', marked.join(", "));
const IMPORTS = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|(?:^|\n)\s*import\s*["'](\.{1,2}\/[^"']+)["']/g;
const target = (f, spec) => resolve(f, spec) ?? P.normalize(P.join(P.dirname(f), spec));
const sharedLeaks = [];
for (const f of shared) for (const m of src.get(f).matchAll(IMPORTS)) {
  const t = target(f, m[3] ?? m[4] ?? m[5]);
  if (!t.startsWith("shared/")) sharedLeaks.push(`${f} → ${t}`);
}
ok(!sharedLeaks.length, "shared/ chỉ nhập mã trong shared/ (và gói npm), kể cả kiểu", sharedLeaks.join("\n"));
// Kiểu ui/ cần từ máy chủ nằm ở shared/types/. Còn lại: BootData (server/bootdata.ts) suy ra từ giá trị trả về của bootOf, chưa viết thành kiểu riêng.
const TYPE_FROM_SERVER = ["server/bootdata.ts"];
const uiTypes = [];
for (const f of [...src.keys()].filter((x) => x.startsWith("ui/"))) for (const m of src.get(f).matchAll(IMPORTS)) {
  const t = target(f, m[3] ?? m[4] ?? m[5]);
  if (t.startsWith("server/") && !TYPE_FROM_SERVER.includes(t)) uiTypes.push(`${f} → ${t}`);
}
ok(!uiTypes.length, `ui/ chỉ lấy kiểu từ server/ ở ${TYPE_FROM_SERVER.join(", ")}; kiểu khác ở shared/types/`, uiTypes.join("\n"));

console.log("6. ops/ (máy chủ, root chạy), tools/ (dev, kiểm thử, bộ sinh); scripts/ chỉ còn tệp web chạy lúc chạy và lớp chuyển tiếp");
// Tệp web chạy lúc chạy (spawn / import theo đường dẫn, bản đang chạy của màu cũ vẫn gọi trong lúc chuyển màu) ở lại scripts/.
const RUNTIME_SCRIPTS = ["extract-worker.mjs", "zipguard.mjs", "zipguard.d.mts", "ocr.py", "pdf_extract.py"];
// Lớp chuyển tiếp một bản phát hành: lệnh ngoài repo còn gọi đường dẫn cũ (/root/deploy-<sha>.sh, cron, SYNCHRO_BACKUP_HOOK).
const SHIMS = {
  "scripts/server-build.sh": "ops/server-build.sh", "scripts/backup.sh": "ops/backup.sh", "scripts/backup-offsite.sh": "ops/backup-offsite.sh",
  "scripts/watchdog.sh": "ops/watchdog.sh", "scripts/bluegreen-migrate.sh": "ops/bluegreen-migrate.sh", "scripts/create-admin.mjs": "ops/create-admin.mjs",
  "workspace/setup.sh": "ops/setup.sh",
};
const inScripts = walk("scripts", /./);
const strayScripts = inScripts.filter((f) => !RUNTIME_SCRIPTS.includes(P.basename(f)) && !SHIMS[f]);
ok(!strayScripts.length, "scripts/ chỉ còn tệp web chạy lúc chạy và lớp chuyển tiếp", strayScripts.join(", "));
ok(RUNTIME_SCRIPTS.every((f) => fs.existsSync(`scripts/${f}`)), "tệp web chạy lúc chạy còn ở scripts/", RUNTIME_SCRIPTS.filter((f) => !fs.existsSync(`scripts/${f}`)).join(", "));
const badShims = Object.entries(SHIMS).filter(([s, t]) => {
  if (!fs.existsSync(s) || !fs.existsSync(t)) return true;
  const body = fs.readFileSync(s, "utf8").replace(/^\s*(#|\/\/)[^\n]*\n/gm, "").trim();
  const want = t.endsWith(".mjs") ? `import "../${t}";` : `exec bash "$(dirname "\${BASH_SOURCE[0]}")/../${t}" "$@"`;
  return body !== want || (fs.statSync(s).mode & 0o111) !== (fs.statSync(t).mode & 0o111);
});
ok(!badShims.length, "lớp chuyển tiếp chỉ chuyển sang ops/ (một dòng, cùng quyền chạy)", badShims.map(([s]) => s).join(", "));
const deployYml = fs.readFileSync(".github/workflows/deploy.yml", "utf8");
ok(/synchro-incoming\/ops\/server-build\.sh \/var\/www\/synchro synchro pip && bash \/var\/www\/synchro\/ops\/setup\.sh/.test(deployYml)
  && /synchro-staging\/ops\/server-build\.sh/.test(deployYml), "deploy.yml gọi ops/server-build.sh và ops/setup.sh");
const sbuild = fs.readFileSync("ops/server-build.sh", "utf8");
ok(/for d in ops scripts workspace; do\n\s+if \[ -e "\$APP\/\$d" \]; then chown -R root:root "\$APP\/\$d"; chmod -R go-w "\$APP\/\$d"; fi/.test(sbuild),
  "harden: ops/, scripts/, workspace/ thuộc root (root chạy ops/*), bỏ qua thư mục chưa chép");
const setupSh = fs.readFileSync("ops/setup.sh", "utf8");
ok(/"\$APP\/ops\/watchdog\.sh"/.test(setupSh) && /%s\/ops\/backup\.sh/.test(setupSh) && /scripts\/backup\\\\\.sh#\$A_REP\/ops\/backup\.sh/.test(setupSh)
  && /SYNCHRO_BACKUP_HOOK=\/s#\$A_RE\/scripts\/backup-offsite/.test(setupSh), "ops/setup.sh cài watchdog, lịch sao lưu từ ops/ và sửa lịch / hook cũ tại chỗ");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts;
ok(pkg["dev:mock"] === "node tools/dev-mock.mjs" && pkg.qa === "node tools/qa.mjs" && pkg.lint === "node tools/lint.mjs", "package.json chạy tools/");

// Bước 6a: chatengine.ts tách thành server/chat/{prompt,approvals,tools,routing}.ts; tệp cũ chỉ còn là mặt tiền chuyển tiếp, nơi gọi không đổi.
// Mã mới của bộ xử lý chat phải vào một phần ở server/chat/ (kiểm thử dò chữ đọc cả nhóm qua chatEngineFiles / readChatEngine).
{
  const files = chatEngineFiles();
  const facade = fs.readFileSync("server/chatengine.ts", "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("//") && l !== 'import "server-only";');
  const extra = facade.filter((l) => !/^export (type )?\{ [\w, ]+ \} from "\.\.?\/[\w/]+";$/.test(l));
  ok(files.length >= 5 && !extra.length, "server/chatengine.ts chỉ chuyển tiếp (export … from), mã ở server/chat/", extra.join("\n"));
  const lines = files.slice(1).map((f) => fs.readFileSync(f, "utf8").split("\n").length);
  ok(lines.reduce((a, b) => a + b, 0) > 2000, `bốn phần ở server/chat/ còn đủ mã (${lines.join(" + ")} dòng)`);
}

// Bước 6b: authstore.ts tách thành server/db/{db,settings}.ts, server/ratelimit.ts, server/auth/*.ts; tệp cũ chỉ còn là mặt tiền chuyển tiếp.
// Một lớp AuthError duy nhất (instanceof trong handle() phải khớp mọi nơi ném), các phần tài khoản không nhập vòng nhau.
{
  const files = authStoreFiles();
  const facade = fs.readFileSync("server/authstore.ts", "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("//") && l !== 'import "server-only";');
  const extra = facade.filter((l) => !/^export (type )?\{ [\w, ]+ \} from "\.\.?\/[\w/]+";$/.test(l));
  ok(files.length >= 12 && !extra.length, "server/authstore.ts chỉ chuyển tiếp (export … from), mã ở server/db/, server/ratelimit.ts, server/auth/", extra.join("\n"));
  const lines = files.slice(1).map((f) => fs.readFileSync(f, "utf8").split("\n").length);
  ok(lines.reduce((a, b) => a + b, 0) > 1000, `các phần tài khoản còn đủ mã (${lines.join(" + ")} dòng)`);
  const cls = walkSrc(/\.tsx?$/).filter((f) => /^export class AuthError\b/m.test(fs.readFileSync(f, "utf8")));
  ok(cls.length === 1 && cls[0] === "server/auth/errors.ts", "AuthError khai báo đúng một nơi (server/auth/errors.ts)", cls.join(", "));
  // Đồ thị nhập giữa các phần (bỏ import type): không có vòng.
  const parts = files.slice(1), deps = new Map();
  for (const f of parts) {
    const src = fs.readFileSync(f, "utf8"), out = [];
    for (const m of src.matchAll(/^import (?!type )[^"]*from "(\.{1,2}\/[\w/.-]+)";$/gm)) {
      const t = P.normalize(P.join(P.dirname(f), m[1])) + ".ts";
      if (parts.includes(t)) out.push(t);
    }
    deps.set(f, out);
  }
  const cyc = [], state = new Map();
  const visit = (f, stack) => {
    if (state.get(f) === 2) return;
    if (state.get(f) === 1) { cyc.push([...stack.slice(stack.indexOf(f)), f].join(" → ")); return; }
    state.set(f, 1);
    for (const t of deps.get(f)) visit(t, [...stack, f]);
    state.set(f, 2);
  };
  for (const f of parts) visit(f, []);
  ok(!cyc.length, "các phần tài khoản không nhập vòng nhau", cyc.join("\n"));
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
