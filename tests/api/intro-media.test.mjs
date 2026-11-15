// Blueprint H3.9: phim giới thiệu ra khỏi git. Tự chạy được, không cần máy chủ:
// 1) hai tệp mp4 không còn trong git, .gitignore chặn thêm lại, ảnh chờ vẫn trong git; URL của ui/introfilm.tsx không đổi;
// 2) bộ nhớ đệm một tuần giống nhau ở next.config.ts và khối nginx trong docs/van-hanh.md (alias tới /var/www/synchro-media/intro/, ngoài thư mục app);
// 3) rsync --delete của deploy (EXCL trong ops/server-build.sh) không xóa bản sao cũ public/intro/*.mp4 trong thư mục app, vẫn xóa tệp cũ khác;
// 4) tools/fetch-intro.mjs: tải tệp thiếu, từ chối thứ không phải mp4 (không để lại tệp dở), không ghi đè tệp đã có, lấy được từ lịch sử git;
// 5) tests/ui/introfilm.mjs bỏ qua kèm lý do khi máy giả lập không có phim, tools/qa.mjs ghi bộ đó là bỏ qua.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fetchIntro, INTRO_FILES, isMp4 } from "../../tools/fetch-intro.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const src = (f) => fs.readFileSync(f, "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-intro-"));
const CACHE = "public, max-age=604800, stale-while-revalidate=2592000";

try {
  console.log("1. Git và URL");
  const tracked = spawnSync("git", ["ls-files", "public/intro"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  ok(!tracked.some((f) => f.endsWith(".mp4")), "không còn tệp mp4 nào của public/intro trong git", tracked);
  ok(tracked.includes("public/intro/synchro-intro-poster.jpg"), "ảnh chờ vẫn trong git (ux-pages kiểm /intro/synchro-intro-poster.jpg)", tracked);
  ok(src(".gitignore").split("\n").includes("/public/intro/*.mp4"), ".gitignore: /public/intro/*.mp4");
  const chk = spawnSync("git", ["check-ignore", "-q", "public/intro/synchro-intro.mp4"]);
  ok(chk.status === 0, "git check-ignore: public/intro/synchro-intro.mp4 bị bỏ qua", chk.status);
  const film = src("ui/introfilm.tsx");
  ok(film.includes('const SRC_720 = "/intro/synchro-intro-720.mp4", SRC_1080 = "/intro/synchro-intro.mp4";'), "ui/introfilm.tsx giữ nguyên hai URL /intro/…");
  ok(INTRO_FILES.length === 2 && INTRO_FILES.every((f) => film.includes(`"/intro/${f}"`)), "INTRO_FILES của tools/fetch-intro.mjs khớp URL của phim", INTRO_FILES);
  ok(/if \(v\.error && !v\.currentSrc\.endsWith\(SRC_1080\)\) \{ leave\(\); return; \}/.test(film), "bản 720p đã lỗi lúc tải trước (tệp thiếu): rời phim, không chờ mãi");

  console.log("2. Bộ nhớ đệm và nginx");
  const nc = src("next.config.ts");
  ok(/"\/intro\/:path\*"/.test(nc) && nc.includes(`value: "${CACHE}"`), "next.config.ts vẫn đặt Cache-Control cho /intro/:path*");
  const doc = src("docs/van-hanh.md");
  const block = /```nginx\n([\s\S]*?)```/.exec(doc.slice(doc.indexOf("## Phim giới thiệu")))?.[1] ?? "";
  ok(/location \^~ \/intro\/ \{/.test(block), "docs/van-hanh.md: khối location ^~ /intro/", block);
  ok(/^\s*alias \/var\/www\/synchro-media\/intro\/;$/m.test(block), "alias /var/www/synchro-media/intro/ (có dấu / cuối như location)", block);
  ok(block.includes(`add_header Cache-Control "${CACHE}";`), "khối nginx đặt cùng Cache-Control với next.config.ts", block);
  ok((block.match(/\{/g) ?? []).length === (block.match(/\}/g) ?? []).length, "khối nginx cân ngoặc");
  const media = "/var/www/synchro-media/";
  ok(!media.startsWith("/var/www/synchro/") && !media.startsWith("/var/www/synchro-incoming/"), "thư mục media nằm ngoài thư mục app và thư mục incoming");
  ok(/Phim giới thiệu/.test(src("README.md")) && src("README.md").includes("/var/www/synchro-media/intro/") && src("README.md").includes("tools/fetch-intro.mjs"), "README: mục Video giới thiệu nói chỗ phim ở production và cách lấy ở máy dev");

  console.log("3. Deploy không xóa phim");
  const sb = src("ops/server-build.sh");
  const line = /^EXCL=\((.*)\)$/m.exec(sb)?.[1] ?? "";
  ok(line.includes("--exclude '/public/intro/*.mp4'"), "EXCL của server-build.sh có /public/intro/*.mp4", line);
  const excl = [...line.matchAll(/--exclude ('([^']*)'|(\S+))/g)].flatMap((m) => ["--exclude", m[2] ?? m[3]]);
  const dy = src(".github/workflows/deploy.yml");
  ok(/--exclude '\/public\/intro\/\*\.mp4' \\\n\s*\.\/ \$\{\{ secrets\.VPS_USER \}\}@\$\{\{ secrets\.VPS_HOST \}\}:\/var\/www\/synchro-staging\//.test(dy), "rsync vào staging (deploy.yml) cũng loại public/intro/*.mp4");
  ok(/SYNCHRO_INTRO_FETCH: "0"/.test(dy), "job verify không tải phim (bộ API không cần)");
  if (spawnSync("rsync", ["--version"]).status === 0) {
    const s = path.join(tmp, "incoming"), a = path.join(tmp, "app");
    fs.mkdirSync(path.join(s, "public", "intro"), { recursive: true }); fs.mkdirSync(path.join(a, "public", "intro"), { recursive: true });
    fs.writeFileSync(path.join(s, "public", "intro", "synchro-intro-poster.jpg"), "new-poster-v2");
    fs.writeFileSync(path.join(a, "public", "intro", "synchro-intro-poster.jpg"), "old-poster");
    for (const f of INTRO_FILES) fs.writeFileSync(path.join(a, "public", "intro", f), "film");
    fs.writeFileSync(path.join(a, "public", "stale.txt"), "x");
    const r = spawnSync("rsync", ["-a", "--delete", ...excl, `${s}/`, `${a}/`], { encoding: "utf8" });
    ok(r.status === 0, "rsync -a --delete với EXCL chạy được", r.stderr);
    ok(INTRO_FILES.every((f) => fs.existsSync(path.join(a, "public", "intro", f))), "bản sao cũ của phim trong thư mục app còn nguyên sau rsync --delete");
    ok(!fs.existsSync(path.join(a, "public", "stale.txt")) && src(path.join(a, "public", "intro", "synchro-intro-poster.jpg")) === "new-poster-v2", "tệp cũ khác vẫn bị xóa, ảnh chờ mới vẫn được chép");
  } else console.log("  (không có rsync: bỏ qua bước chạy thử)");

  console.log("4. tools/fetch-intro.mjs");
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(200_000, 7)]);
  ok(isMp4(mp4) && !isMp4(Buffer.from("<!doctype html><html>")), "isMp4 nhận đầu tệp ftyp, từ chối HTML");
  const hits = [];
  let mode = "mp4";
  const srv = http.createServer((q, s) => {
    hits.push(q.url);
    if (mode === "html") { s.writeHead(200, { "content-type": "text/html" }); s.end("<!doctype html>" + "x".repeat(200_000)); return; }
    if (!q.url.startsWith("/intro/")) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { "content-type": "video/mp4" }); s.end(mp4);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const d1 = path.join(tmp, "dl");
  let res = await fetchIntro({ dir: d1, base, git: false });
  ok(res.missing.length === 0 && res.got.length === 2 && INTRO_FILES.every((f) => fs.statSync(path.join(d1, f)).size === mp4.length), "tải hai tệp còn thiếu", res);
  ok(hits.includes("/intro/synchro-intro-720.mp4") && hits.includes("/intro/synchro-intro.mp4"), "tải đúng URL /intro/<tệp>", hits);
  hits.length = 0;
  fs.writeFileSync(path.join(d1, "synchro-intro.mp4"), "của tôi");
  res = await fetchIntro({ dir: d1, base, git: false });
  ok(res.got.length === 0 && hits.length === 0 && src(path.join(d1, "synchro-intro.mp4")) === "của tôi", "không tải lại, không ghi đè tệp đã có", { res, hits });
  mode = "html";
  const d2 = path.join(tmp, "dl-html");
  res = await fetchIntro({ dir: d2, base, git: false });
  ok(res.got.length === 0 && res.missing.length === 2 && /không phải tệp mp4/.test(res.missing[0][1]), "máy chủ trả HTML: báo thiếu, không nhận", res);
  ok(fs.readdirSync(d2).length === 0, "không để lại tệp dở (.part) hay tệp sai", fs.readdirSync(d2));
  srv.close();
  res = await fetchIntro({ dir: path.join(tmp, "dl-off"), base: "http://127.0.0.1:9", git: false });
  ok(res.missing.length === 2 && res.got.length === 0, "không tới được máy chủ: báo thiếu, không ném lỗi", res);
  hits.length = 0;
  res = await fetchIntro({ dir: path.join(tmp, "dl-nonet"), git: false, net: false });
  ok(res.missing.length === 2 && hits.length === 0, "net: false (SYNCHRO_MOCK_OFFLINE): không tải mạng", res);
  // Lịch sử git: bản sao đầy đủ (máy dev) có commit cuối còn tệp; bản sao nông (CI) thì không, bỏ qua.
  const hasHist = spawnSync("git", ["rev-list", "-1", "HEAD", "--", "public/intro/synchro-intro-720.mp4"], { encoding: "utf8" }).stdout.trim();
  if (hasHist) {
    const d3 = path.join(tmp, "git");
    res = await fetchIntro({ dir: d3, base: "http://127.0.0.1:9" });
    const head = Buffer.alloc(12); const h = fs.openSync(path.join(d3, "synchro-intro-720.mp4"), "r"); fs.readSync(h, head, 0, 12, 0); fs.closeSync(h);
    ok(res.got.length === 2 && res.got.every(([, s]) => s === "git") && isMp4(head) && fs.statSync(path.join(d3, "synchro-intro.mp4")).size > 1_000_000, "lấy được từ lịch sử git, không cần mạng", res);
  } else console.log("  (bản sao nông, không có lịch sử của phim: bỏ qua bước lấy từ git)");
  const cli = spawnSync(process.execPath, ["tools/fetch-intro.mjs"], { encoding: "utf8", env: { ...process.env, SYNCHRO_INTRO_FETCH: "0" } });
  ok(cli.status === 0 && /SYNCHRO_INTRO_FETCH=0/.test(cli.stdout), "SYNCHRO_INTRO_FETCH=0: lệnh không lấy gì, thoát 0", cli.stdout + cli.stderr);
  ok(/fetchIntro\(\{ net: !process\.env\.SYNCHRO_MOCK_OFFLINE \}\)/.test(src("tools/dev-mock.mjs")) && src("tools/dev-mock.mjs").indexOf("fetchIntro({") < src("tools/dev-mock.mjs").indexOf('const next = spawn('), "dev:mock lấy phim trước khi bật Next");

  console.log("5. Kiểm thử giao diện khi thiếu phim");
  const ui = src("tests/ui/introfilm.mjs");
  ok(ui.indexOf("BỎ QUA: ") > 0 && ui.indexOf("BỎ QUA: ") < ui.indexOf("const chrome = spawn("), "tests/ui/introfilm.mjs kiểm phim trước khi mở Chrome, thiếu thì in BỎ QUA");
  const qa = src("tools/qa.mjs");
  ok(/\/\^BỎ QUA: \(\.\*\)\$\/m/.test(qa) && qa.includes("bỏ qua: ${r.skip}"), "tools/qa.mjs ghi bộ in BỎ QUA là bỏ qua kèm lý do");
  ok(/name: Tải phim giới thiệu[\s\S]*?run: node tools\/fetch-intro\.mjs/.test(src(".github/workflows/ui-qa.yml")), "ui-qa.yml tải phim trước khi chạy bộ giao diện");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); }
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
