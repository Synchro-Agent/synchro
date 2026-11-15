// Sửa sau duyệt A3/B3 (tự chạy được, không cần máy chủ):
// 1) HTML trang chủ không chờ việc chậm: bootOf({ fast }) có hạn chờ danh sách model, số skill của studio chỉ lấy khi đã tính sẵn;
// 2) cài đặt Code đi trong gói khởi động (đồng bộ phiên Code chạy ngay cả ở thiết bị mới), lần tải dự phòng không phụ thuộc số phiên;
// 3) bộ đệm cachedJson tách theo tài khoản, đổi tài khoản / đăng xuất thì xóa;
// 4) phim giới thiệu: nút Toàn màn hình (mới đổi sang 1080p), 1080p lỗi thì quay về 720p;
// 5) /ts/*.wasm mang phiên bản trong URL, khớp gói npm; 6) scripts/budget.mjs: không đo bản build cũ, CSS ghi rõ chưa bắt buộc.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-bootfast-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.DATA_KEY = "k";
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const src = (f) => fs.readFileSync(f, "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  console.log("1. Gói khởi động nhanh cho HTML");
  const { authstore: A, bootdata: BD, plugins: PL } = await loadTs(["authstore", "bootdata", "plugins"]);
  const T = await BD.within(sleep(200).then(() => "muộn"), 20);
  ok(typeof T === "symbol", "within: quá hạn thì trả dấu hết giờ, không chờ", T);
  ok((await BD.within(Promise.resolve("kịp"), 50)) === "kịp", "within: xong trong hạn thì lấy kết quả");
  const t0 = Date.now(); await BD.within(new Promise(() => {}), 30);
  ok(Date.now() - t0 < 500, "within: lời hứa không bao giờ xong cũng không treo", Date.now() - t0);
  ok(BD.BOOT_DEADLINE_MS > 0 && BD.BOOT_DEADLINE_MS <= 300, "hạn chờ danh sách model của HTML ≤ 300 ms", BD.BOOT_DEADLINE_MS);

  const u = A.createUser({ email: "fast@synchro.test", name: "Fast", verified: true });
  ok(PL.studioSummaryCached(u.id) === null, "chưa tính số skill của studio: bản chỉ-đọc trả null (không dựng thư viện)");
  const fast0 = await BD.bootOf(u, { fast: true });
  ok(fast0.studios === null || (fast0.studios && fast0.studios.canInstall === false), "fast, chưa có sẵn: studios null để trình duyệt tự hỏi /api/plugins?view=meta", fast0.studios);
  ok(fast0.codePrefs && typeof fast0.codePrefs.sync === "boolean" && typeof fast0.codePrefs.archiveAfter === "number", "gói có cài đặt Code (cùng dạng /api/code/prefs)", fast0.codePrefs);
  const full = await BD.bootOf(u);
  ok(full.studios && typeof full.studios.studios === "object", "không fast (/api/bootstrap): dựng đủ studios", full.studios);
  const fast1 = await BD.bootOf(u, { fast: true });
  ok(JSON.stringify(fast1.studios) === JSON.stringify(full.studios), "đã tính sẵn: fast dùng lại đúng kết quả đó", { fast: fast1.studios, full: full.studios });
  const anon = await BD.bootOf(null, { fast: true });
  ok(anon.user === null && anon.codePrefs === null && anon.models === null, "chưa đăng nhập: không có phần nào của tài khoản");

  const page = src("app/page.tsx");
  ok(/bootFor\([^)]*\)[^;]*\{ fast: true \}/.test(page) || /\{ fast: true \}\)/.test(page), "app/page.tsx dựng gói bằng fast (không chờ CLI / mạng / thư viện skill)");
  const bd = src("server/bootdata.ts");
  ok(/o\.fast \? await within\(mp/.test(bd) && /studioSummaryCached/.test(bd), "bootOf fast: model có hạn, studio chỉ đọc bản đã tính");

  console.log("2. Cài đặt Code từ gói khởi động");
  const home = src("ui/home.tsx");
  ok(/seedCodePrefs\(b\.codePrefs\)/.test(home), "home gieo cài đặt Code từ boot");
  ok(!/codeListRef\.current\.length\) return; const t = setTimeout\(\(\) => setCpWant/.test(home) && /if \(!me\) return; const t = setTimeout\(\(\) => setCpWant\(true\), 5000\)/.test(home), "lần tải dự phòng sau 5 giây không phụ thuộc máy đã có phiên Code hay chưa");
  const cs = src("ui/codesync.ts");
  ok(/export function seedCodePrefs\(p: CodePrefs \| null \| undefined\) \{ if \(!p \|\| prefs\) return; prefs = p; emit\(\); \}/.test(cs), "seedCodePrefs không ghi đè bản đã tải");

  console.log("3. Bộ đệm cachedJson theo tài khoản");
  ok(/resetCodePrefs\(\); clearJsonCache\(\);/.test(home) && /setUserScope\(null\); reloadPrefs\(\); resetCodePrefs\(\); clearJsonCache\(\);/.test(home), "enterAccount và logout xóa bộ đệm cachedJson");
  const { jsoncache: ST, userscope: US } = await loadTs(["jsoncache", "userscope"]);
  const META = "/api/plugins?view=meta";
  ok(/export const META = "\/api\/plugins\?view=meta"/.test(src("ui/studios.ts")) && /from "\.\/jsoncache"/.test(src("ui/studios.ts")), "studios.ts dùng bộ đệm của jsoncache.ts");
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ admin: false, from: "net" }), { status: 200, headers: { "content-type": "application/json" } }); };
  US.setUserScope("admin-a");
  ST.seedJson(META, { admin: true, from: "seed" });
  ok((await ST.cachedJson(META)).admin === true && calls.length === 0, "cùng tài khoản: dùng bản đã gieo, không hỏi lại");
  US.setUserScope("user-b");
  const jb = await ST.cachedJson(META);
  ok(jb.admin === false && jb.from === "net" && calls.length === 1, "tài khoản khác trên cùng tab: không nhận bản của tài khoản trước (hỏi lại)", jb);
  US.setUserScope("admin-a");
  ok((await ST.cachedJson(META)).from === "seed", "khóa theo tài khoản: bản của mỗi người tách riêng");
  ST.clearJsonCache();
  ok((await ST.cachedJson(META)).from === "net" && calls.length === 2, "clearJsonCache bỏ hết bản đệm");

  console.log("4. Phim giới thiệu");
  const film = src("ui/introfilm.tsx");
  ok(/requestFullscreen\(\)/.test(film) && /className=\{`intro-btn fs/.test(film), "có nút Toàn màn hình (requestFullscreen)");
  ok(/const fullScreen = \(\) => !!document\.fullscreenElement;/.test(film) && /document\.addEventListener\("fullscreenchange", fs\)/.test(film), "chỉ đổi 1080p khi trang vào toàn màn hình (không đoán theo kích thước khung: Chrome ẩn, PWA)");
  ok(/!!document\.fullscreenEnabled && screen\.width >= 1280/.test(film), "nút Toàn màn hình chỉ trên màn ≥ 1280px (điện thoại không thêm nút)");
  ok(/const failed = \(\) => \{ if \(v\.currentSrc\.endsWith\(SRC_1080\)\) swapSrc\(v, SRC_720\); else leave\(\); \}/.test(film), "1080p tải lỗi: quay về 720p, không kết thúc phim");
  ok(/if \(document\.fullscreenElement\) \{ document\.exitFullscreen\(\)/.test(film), "rời phim khi đang toàn màn hình: thoát toàn màn hình trước khi logo bay về");
  ok(/\.intro-btn\.fs\{/.test(src("app/globals.css")), "nút Toàn màn hình có kiểu riêng (cạnh nút tiếng)");

  console.log("5. /ts mang phiên bản");
  const heavy = src("ui/heavy.ts");
  const rev = /export const TS_REV = "([^"]+)"/.exec(heavy)?.[1];
  const ver = (p) => JSON.parse(src(`node_modules/${p}/package.json`)).version;
  ok(rev === `${ver("web-tree-sitter")}-${ver("tree-sitter-wasms")}`, "TS_REV khớp phiên bản web-tree-sitter và tree-sitter-wasms đã cài", { rev, wts: ver("web-tree-sitter"), wasms: ver("tree-sitter-wasms") });
  ok(/locateFile: \(f: string\) => tsUrl\(f\)/.test(heavy) && /Language\.load\(tsUrl\(/.test(heavy) && /\?v=\$\{TS_REV\}/.test(heavy), "mọi URL /ts đi qua tsUrl (có ?v=)");
  const same = (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b));
  ok(same("public/ts/web-tree-sitter.wasm", "node_modules/web-tree-sitter/web-tree-sitter.wasm"), "public/ts/web-tree-sitter.wasm là đúng bản của gói npm");
  for (const f of fs.readdirSync("public/ts").filter((x) => x.startsWith("tree-sitter-"))) ok(same(`public/ts/${f}`, `node_modules/tree-sitter-wasms/out/${f}`), `public/ts/${f} là đúng bản của tree-sitter-wasms`);

  console.log("6. Ngân sách tải đầu");
  const B = await import(path.resolve("scripts/budget.mjs"));
  ok(B.ENFORCED.js === true && B.ENFORCED.css === false, "JS bắt buộc; CSS ghi rõ chưa bắt buộc tới B5", B.ENFORCED);
  const root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, "app/api/x"), { recursive: true }); fs.mkdirSync(path.join(root, ".next"), { recursive: true });
  ok(B.pickBuild(root) === null, "không có bản build: null (chưa đo)");
  const at = (f, sec) => { const t = new Date(Date.now() + sec * 1000); fs.utimesSync(f, t, t); };
  fs.writeFileSync(path.join(root, "app/page.tsx"), "x"); at(path.join(root, "app/page.tsx"), -100);
  fs.writeFileSync(path.join(root, ".next/app-build-manifest.json"), "{}"); at(path.join(root, ".next/app-build-manifest.json"), -50);
  ok(B.pickBuild(root)?.stale === false, "bản build mới hơn mã nguồn: đo được");
  at(path.join(root, "app/page.tsx"), -10);
  const st = B.pickBuild(root);
  ok(st?.stale === true && st.src.file.endsWith("page.tsx"), "mã nguồn sửa sau lần build: bản build cũ, không đo", st);
  at(path.join(root, "app/page.tsx"), -100);
  fs.writeFileSync(path.join(root, "app/api/x/route.ts"), "x"); at(path.join(root, "app/api/x/route.ts"), -1);
  ok(B.pickBuild(root)?.stale === false, "sửa app/api (không vào bản build trình duyệt) không làm bản build thành cũ");
  fs.mkdirSync(path.join(root, ".next-mockfast"), { recursive: true });
  fs.writeFileSync(path.join(root, ".next-mockfast/app-build-manifest.json"), "{}"); at(path.join(root, ".next-mockfast/app-build-manifest.json"), -500);
  ok(B.pickBuild(root)?.dir.endsWith(".next"), "có hai bản build: đo bản mới hơn, không ưu tiên .next-mockfast cũ");
  const qa = src("scripts/qa.mjs");
  ok(/CSS 45 KB gzip \(CHƯA BẮT BUỘC tới B5/.test(qa) && /chưa đo: không có bản build hoặc bản build cũ hơn mã nguồn/.test(qa), "qa ghi rõ CSS chưa bắt buộc và lý do chưa đo");

  console.log("7. Phông chữ");
  ok(!fs.readdirSync("public/fonts").some((f) => /^Anthropic/.test(f)), "không còn tệp phông Anthropic (Sans, Serif) trong public/fonts");
  ok(!/Anthropic Serif"|AnthropicSerif/.test(src("app/globals.css")), "globals.css không còn dùng Anthropic Serif");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
