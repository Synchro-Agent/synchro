// A3 (một lệnh khởi động thay cho tám) và B3 (giảm tải lần đầu). Tự chạy được, không cần máy chủ:
// 1) gói khởi động (server/bootdata.ts) và /api/bootstrap trên cơ sở dữ liệu tạm: đủ phần, ETag theo người dùng, 304 khi khớp;
// 2) lần hỏi đoạn chat bắt đầu sớm chỉ dùng khi đúng tài khoản và đúng mốc;
// 3) mã nguồn: trang chủ là server component dựng sẵn gói, các kho được gieo, các lệnh hỏi đầu được hoãn, phần tải đầu không kéo
//    router / artkit / speech/data / usageui; 4) ngân sách tải đầu (tools/budget.mjs) đọc đúng bản build.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { loadTs } from "../lib/ts.mjs";
import { SRC_ROOTS } from "../lib/srcroots.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-boot-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const src = (f) => fs.readFileSync(f, "utf8");

try {
  console.log("1. Gói khởi động và /api/bootstrap");
  const { authstore: A, bootdata: BD, "api/bootstrap/route": R, chatsynccore: CS } = await loadTs(["authstore", "bootdata", "api/bootstrap/route", "chatsynccore"]);
  const anon = await BD.bootOf(null);
  ok(anon.user === null && anon.models === null && anon.caps === null && anon.studios === null && anon.inboxCount === null && typeof anon.providers === "object" && typeof anon.signupOpen === "boolean", "chưa đăng nhập: chỉ phần của /api/auth/me", anon);
  const u = A.createUser({ email: "boot@synchro.test", name: "Boot", verified: true });
  const b = await BD.bootOf(u);
  for (const k of ["user", "providers", "signupOpen", "speechReady", "models", "caps", "studios", "inboxCount"]) ok(k in b && b[k] !== undefined, `có phần ${k}`);
  ok(b.user?.id === u.id && !("password_hash" in b.user), "user là bản công khai của tài khoản", b.user);
  ok(b.caps && typeof b.caps.caps === "object" && "locks" in b.caps, "caps cùng dạng /api/caps", b.caps);
  ok(b.studios && typeof b.studios.admin === "boolean" && typeof b.studios.canInstall === "boolean" && typeof b.studios.studios === "object", "studios cùng dạng /api/plugins?view=meta", b.studios);
  ok(b.inboxCount && b.inboxCount.unread === 0 && b.inboxCount.pending === 0 && Array.isArray(b.inboxCount.fresh),
    "inboxCount cùng dạng /api/autopilot?count=1", b.inboxCount);
  ok(b.models && Array.isArray(b.models.providers) && Array.isArray(b.models.allowed) && "default" in b.models && "replaced" in b.models, "models cùng dạng /api/models", b.models);
  ok(JSON.stringify(JSON.parse(JSON.stringify(b))) === JSON.stringify(b), "gói chỉ có dữ liệu JSON (truyền được từ server component sang client)");

  const body = JSON.stringify(b);
  ok(BD.bootEtag(u.id, body) === BD.bootEtag(u.id, body), "ETag ổn định cho cùng nội dung");
  ok(BD.bootEtag(u.id, body) !== BD.bootEtag("khac", body), "ETag theo người dùng: cùng nội dung, khác tài khoản thì khác");
  ok(BD.bootEtag(u.id, body) !== BD.bootEtag(u.id, body + " "), "nội dung đổi thì ETag đổi");
  const tag = BD.bootEtag(u.id, body);
  ok(BD.etagMatch(tag, tag) && BD.etagMatch(`"x", ${tag}`, tag) && BD.etagMatch(tag.replace(/^W\//, ""), tag) && BD.etagMatch("*", tag), "If-None-Match: khớp nguyên, trong danh sách, bỏ W/, dấu *");
  ok(!BD.etagMatch(null, tag) && !BD.etagMatch('"khac"', tag), "If-None-Match khác hoặc không có: không khớp");

  const setCookie = A.createSession(u, new Request("http://synchro.test/"), "password");
  const cookie = /synchro_session=[^;]+/.exec(setCookie)?.[0];
  ok(!!cookie, "tạo được phiên thử", setCookie);
  const r1 = await R.GET(new Request("http://synchro.test/api/bootstrap", { headers: { cookie } }));
  const j1 = await r1.json();
  const et = r1.headers.get("etag");
  ok(r1.status === 200 && j1.user?.id === u.id && !!et && /^W\/"/.test(et), "200 kèm ETag yếu", { status: r1.status, et });
  ok(/private/.test(r1.headers.get("cache-control") ?? "") && /cookie/i.test(r1.headers.get("vary") ?? ""), "Cache-Control private, Vary: Cookie", r1.headers.get("cache-control"));
  ok(!!r1.headers.get("server-timing"), "có Server-Timing như mọi /api");
  const r2 = await R.GET(new Request("http://synchro.test/api/bootstrap", { headers: { cookie, "if-none-match": et } }));
  ok(r2.status === 304 && (await r2.text()) === "" && r2.headers.get("etag") === et, "If-None-Match khớp: 304 không thân", r2.status);
  const r3 = await R.GET(new Request("http://synchro.test/api/bootstrap", { headers: { "if-none-match": et } }));
  const j3 = await r3.json();
  ok(r3.status === 200 && j3.user === null && r3.headers.get("etag") !== et, "không cookie: không dùng lại ETag của người khác, user null", { status: r3.status });

  console.log("2. Lần hỏi đoạn chat bắt đầu sớm");
  ok(CS.earlyUsable({ uid: "a", since: 5 }, "a", 5), "đúng tài khoản, đúng mốc: dùng");
  ok(!CS.earlyUsable({ uid: "a", since: 5 }, "b", 5), "khác tài khoản: bỏ");
  ok(!CS.earlyUsable({ uid: "a", since: 5 }, "a", 7), "khác mốc since: bỏ");
  ok(!CS.earlyUsable(null, "a", 0), "không có lần hỏi sớm: không dùng");

  console.log("3. Mã nguồn trang chủ");
  const page = src("app/page.tsx"), home = src("ui/home.tsx");
  ok(!/^"use client"/.test(page) && /cookies\(\)/.test(page) && /bootFor\(/.test(page) && /<Home boot=\{boot\} \/>/.test(page), "app/page.tsx: server component đọc cookie, dựng gói, truyền <Home boot>");
  ok(/^"use client"/.test(home) && /export default function Home\(\{ boot \}/.test(home), "ui/home.tsx: thân trang (client) nhận boot");
  ok(/seedModels\(b\.models\)/.test(home) && /seedCaps\(b\.caps\)/.test(home) && /seedMeta\(b\.studios\)/.test(home)
    && /seedInboxCount\(b\.inboxCount\)/.test(home), "gieo models, caps, studios, số mục Autopilot từ boot");
  // Hiệu ứng mở app tách sang ui/homehooks.ts (blueprint B2 bước 8): Home gọi useBoot({ boot: bootRef.current … }) và usePageSetup(boot).
  const hooks = src("ui/homehooks.ts");
  ok(/tries === undefined \? live\.current\.boot : null/.test(hooks) && /useBoot\(\{ boot: bootRef\.current/.test(home), "lần đầu dùng gói dựng sẵn, lần thử lại mới hỏi /api/auth/me");
  ok(/prefetchChats\(boot\.user\.id\)/.test(hooks) && /usePageSetup\(boot\)/.test(home), "hỏi /api/chats?since= ngay lúc hydrate");
  ok(/useCodePrefs\(cpWant\)/.test(home) && !/useCodePrefs\(\)/.test(home), "/api/code/prefs hoãn tới khi cần");
  ok(/const needBrw = view === "chat" \|\| brwFor !== null/.test(home) && !/if \(me\) fetch\("\/api\/browser"\)/.test(home), "/api/browser hoãn tới khi mở đoạn chat / khung trình duyệt");
  for (const f of ["ui/studios.ts", "ui/ghadd.tsx", "ui/skillsui.tsx"]) ok(!/fetch\("\/api\/plugins\?view=meta"\)/.test(src(f)) && /cachedJson<PluginsMeta>\(META\)/.test(src(f)), `${f}: view=meta qua cachedJson`);
  ok(/export async function restyle|const restyle = async/.test(home) && /import\("(?:\.\.?\/)+(?:app\/|shared\/)?artkit"\)/.test(home), "đổi phong cách: artkit tải khi bấm");

  // Phần tải đầu: các tệp import tĩnh từ layout + page + home (giống tests/api/css-split.test.mjs).
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "api" ? [] : walk(path.join(d, e.name))) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  const all = Object.fromEntries(SRC_ROOTS.filter((r) => fs.existsSync(r)).flatMap(walk).map((f) => [f, src(f)]));
  const resolve = (from, spec) => { if (!spec.startsWith(".")) return null; const p = path.join(path.dirname(from), spec); return [`${p}.tsx`, `${p}.ts`, `${p}/index.ts`].find((x) => all[x] !== undefined) ?? null; };
  const imports = (f) => [...all[f].replace(/^import type .*$/gm, "").matchAll(/^(?:import|export)\s[^;'"]*?from\s+["']([^"']+)["']/gm)].map((m) => resolve(f, m[1])).filter(Boolean);
  const first = new Set(["ui/home.tsx", "app/layout.tsx"]), q = [...first];
  while (q.length) for (const n of imports(q.pop())) if (!first.has(n)) { first.add(n); q.push(n); }
  for (const f of ["server/router.ts", "shared/artkit.ts", "shared/speech/data.ts", "ui/usageui.tsx", "ui/settings.tsx"]) ok(!first.has(f), `${f} không nằm trong phần tải đầu`);
  ok(first.has("ui/usagering.tsx") && first.has("shared/vendor.ts") === false, "vòng Mức dùng (usagering.tsx) có sẵn; vendor.ts chỉ theo trang Mức dùng");

  console.log("4. Ngân sách tải đầu (tools/budget.mjs)");
  const B = await import(path.resolve("tools/budget.mjs"));
  const dist = path.join(tmp, "dist");
  fs.mkdirSync(path.join(dist, "static/chunks/app"), { recursive: true }); fs.mkdirSync(path.join(dist, "static/css"), { recursive: true });
  const put = (f, s) => fs.writeFileSync(path.join(dist, f), s);
  put("build-manifest.json", JSON.stringify({ rootMainFiles: ["static/chunks/main.js"], polyfillFiles: ["static/chunks/poly.js"] }));
  put("app-build-manifest.json", JSON.stringify({ pages: { "/layout": ["static/chunks/main.js", "static/css/a.css"], "/page": ["static/chunks/app/page.js"], "/settings/page": ["static/chunks/big.js"] } }));
  const rnd = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(33 + ((i * 7919) % 90))).join("");
  put("static/chunks/main.js", rnd(4000)); put("static/chunks/app/page.js", "x".repeat(50000)); put("static/chunks/big.js", rnd(900000)); put("static/chunks/poly.js", rnd(90000)); put("static/css/a.css", "a{b:c}".repeat(1000));
  const files = B.firstLoadFiles(dist);
  ok(files.js.length === 2 && !files.js.includes("static/chunks/big.js") && !files.js.includes("static/chunks/poly.js") && files.css.length === 1, "chỉ tính tệp của layout + trang chủ, không tính polyfill và trang khác", files);
  const m = B.measure(dist);
  const gz = (f) => zlib.gzipSync(fs.readFileSync(path.join(dist, f)), { level: 9 }).length;
  ok(m.js === gz("static/chunks/main.js") + gz("static/chunks/app/page.js") && m.css === gz("static/css/a.css"), "cộng kích thước gzip", m);
  ok(m.over.length === 0, "trong ngân sách thì không báo vượt");
  ok(B.measure(dist, "/page", { js: 10, css: 10 }).over.join() === "js,css", "vượt ngân sách thì báo đúng phần vượt");
  ok(B.BUDGET.js === 350 * 1024 && B.BUDGET.css === 45 * 1024, "ngân sách đúng blueprint: JS 350 KB, CSS 45 KB gzip");
  ok(B.CEIL.js >= B.BUDGET.js && B.CEIL.css >= B.BUDGET.css && B.CEIL.js <= 360 * 1024 && B.CEIL.css <= 105 * 1024, "trần chống tăng lại không thấp hơn ngân sách, không cao hơn số đo trước khi giảm (JS 376 KB, CSS 104 KB)", B.CEIL);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
