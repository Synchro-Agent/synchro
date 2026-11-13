// Deploy xanh/lam (A5): vai trò primary/secondary (app/role.ts), tắt êm khi nhận SIGTERM (app/drain.ts), và các hàm shell đổi upstream nginx,
// màu sống, node_modules (scripts/bluegreen-lib.sh) với nginx / pm2 / curl giả trên PATH. Tự chạy được, không cần máy chủ.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-bg-"));
const { role: R, drain: D } = await loadTs(["role", "drain"]);

// ---------------- Vai trò ----------------
console.log("Vai trò primary / secondary");
{
  R.resetRoleForTest();
  let n = 0;
  const env = {};
  R.startRole(() => { n++; }, { env });
  R.startRole(() => { n++; }, { env });
  ok(n === 1 && R.isPrimary(), "một tiến trình (SYNCHRO_ROLE trống): primary ngay, việc nền chạy đúng một lần", { n, role: R.role() });
}
{
  R.resetRoleForTest();
  const live = path.join(tmp, "live-color"), lock = path.join(tmp, "primary.pid");
  fs.writeFileSync(live, "blue 3000 /var/www/synchro\n");
  fs.writeFileSync(lock, "424242 blue\n");
  const env = { SYNCHRO_ROLE: "secondary", SYNCHRO_COLOR: "green", SYNCHRO_LIVE_FILE: live, SYNCHRO_PRIMARY_LOCK: lock, SYNCHRO_ROLE_POLL_MS: "20" };
  let oldAlive = true, n = 0;
  const alive = (pid) => (pid === 424242 ? oldAlive : pid === process.pid);
  R.startRole(() => { n++; }, { env, alive });
  await sleep(120);
  ok(R.role() === "secondary" && n === 0, "secondary lúc bật: không litestream, không bộ hẹn giờ (việc nền chưa chạy)", { role: R.role(), n });
  fs.writeFileSync(live, "green 3002 /var/www/synchro\n");
  await sleep(120);
  ok(n === 0, "nginx đã sang green nhưng bản cũ còn giữ khóa (đang chạy nốt lượt): chưa nhận vai, chưa chạy lại lượt dở dang", n);
  oldAlive = false;
  await sleep(120);
  ok(n === 1 && R.isPrimary() && env.SYNCHRO_ROLE === "primary", "bản cũ thoát: nhận vai primary, việc nền chạy một lần", { n, role: R.role(), env: env.SYNCHRO_ROLE });
  ok(fs.readFileSync(lock, "utf8").startsWith(`${process.pid} green`), "giữ khóa primary bằng pid của mình", fs.readFileSync(lock, "utf8"));
  await sleep(100);
  R.startRole(() => { n++; }, { env, alive });
  ok(n === 1, "không chạy việc nền lần hai (nhịp kiểm tra sau, gọi startRole lại)", n);
  R.releasePrimary();
  ok(!fs.existsSync(lock), "thoát: bỏ khóa primary để màu kế tiếp nhận vai ngay");
}
{
  const live = path.join(tmp, "live2"), lock = path.join(tmp, "lock2");
  fs.writeFileSync(live, "green 3002 /x\n");
  ok(R.canPromote({ color: "green", liveFile: live, lockFile: lock }, 1234, () => true), "không có khóa (watchdog khởi động lại màu sống): nhận vai ngay");
  fs.writeFileSync(lock, "999 blue\n");
  ok(!R.canPromote({ color: "green", liveFile: live, lockFile: lock }, 1234, () => true), "khóa của tiến trình khác còn sống: chờ");
  ok(R.canPromote({ color: "green", liveFile: live, lockFile: lock }, 1234, () => false), "khóa của tiến trình đã chết (bị SIGKILL): nhận vai");
  ok(!R.canPromote({ color: "blue", liveFile: live, lockFile: lock }, 1234, () => false), "màu không sống thì không bao giờ nhận vai");
  ok(!R.canPromote({ color: "", liveFile: live, lockFile: lock }, 1234, () => false), "thiếu SYNCHRO_COLOR: không nhận vai");
}
{
  // Mọi việc chỉ được chạy ở một tiến trình phải nằm trong primaryDuties (instrumentation.ts), không ở phần chạy ở mọi tiến trình.
  const src = fs.readFileSync(path.join(process.cwd(), "instrumentation.ts"), "utf8");
  const at = src.indexOf("function primaryDuties");
  const head = src.slice(0, at), body = src.slice(at);
  const duties = ["startOnBoot", "sweepOrphanClis", "resumeInterrupted", "startScheduler", "./app/brain", "recheckConnectors", "scheduleDiscovery", "startCliUpdates", "keepLinksAlive", "startPrWatch", "sweepEngineTemp", "ensurePluginTags", "ensureDefaultPlugins", "resumeJob", "retryVoicePurges", "noteBoot("];
  const wrong = duties.filter((d) => head.includes(d) || !body.includes(d));
  ok(at > 0 && !wrong.length, "litestream, bộ hẹn giờ, chạy lại lượt, cài plugin… chỉ chạy trong primaryDuties", wrong);
  ok(/startRole\(\(\) => primaryDuties/.test(head) && head.includes("installShutdown("), "register(): cài tắt êm ở mọi tiến trình, việc nền qua startRole");
  const runs = fs.readFileSync(path.join(process.cwd(), "app/runs.ts"), "utf8");
  ok(/status = 'running'"\)\.all\(\) as Row\[\]\)\.filter\(\(r\) => !live\.has\(r\.id\)\)/.test(runs), "resumeInterrupted bỏ qua lượt đang chạy trong chính tiến trình (đã phục vụ từ lúc còn là secondary)");
}

// ---------------- Tắt êm ----------------
console.log("Tắt êm khi nhận SIGTERM");
{
  D.resetDrainForTest();
  ok(D.drainingResponse() === null && !D.isDraining(), "bình thường: không chặn lượt mới");
  let busy = 2, hooks = 0, stopped = 0, exitCode = null, during = null;
  D.onDrain(() => { hooks++; });
  const t0 = Date.now();
  const p = D.shutdown({ busy: () => busy, timeoutMs: 2000, pollMs: 10, graceMs: 0, log: () => {}, stop: async () => { stopped++; }, exit: (c) => { exitCode = c; } });
  await sleep(30);
  during = D.drainingResponse();
  const body = during ? await during.clone().json() : null;
  ok(during?.status === 503 && during.headers.get("retry-after") === "5" && body?.draining === true, "đang tắt: lượt mới nhận 503 kèm Retry-After: 5", { status: during?.status, ra: during?.headers.get("retry-after"), body });
  ok(hooks === 1, "dừng bộ hẹn giờ / việc nền ngay khi bắt đầu tắt", hooks);
  ok(exitCode === null, "chưa thoát khi còn lượt đang chạy", exitCode);
  busy = 1; await sleep(30); busy = 0;
  const r = await p;
  ok(r.left === 0 && exitCode === 0 && stopped === 1, "lượt xong: dừng litestream rồi thoát mã 0", { r, exitCode, stopped });
  ok(Date.now() - t0 < 1000, "thoát ngay khi bản đồ lượt sống trống, không chờ hết giờ", Date.now() - t0);
  ok(D.isStopping(), "sau khi chờ: lỗi 5xx còn lại coi như do tắt máy (lượt giữ 'đang chạy' để bản mới chạy lại)");
}
{
  D.resetDrainForTest();
  let exitCode = null;
  const t0 = Date.now();
  const r = await D.shutdown({ busy: () => 1, timeoutMs: 150, pollMs: 10, log: () => {}, stop: () => new Promise(() => {}), stopMs: 50, exit: (c) => { exitCode = c; } });
  const ms = Date.now() - t0;
  ok(r.left === 1 && exitCode === 0 && ms >= 150 && ms < 1000, "lượt quá dài: chờ đúng hạn (25 giây ở production) rồi vẫn thoát, litestream treo cũng không giữ lại", { r, ms, exitCode });
}
{
  D.resetDrainForTest();
  ok(D.installShutdown({ busy: () => 0 }, {}) === false, "không có NEXT_MANUAL_SIG_HANDLE (staging, npm start): để Next tự xử lý tín hiệu như trước");
  ok(D.DRAIN_MS === 25_000 && D.RETRY_AFTER_S === 5, "mặc định: chờ 25 giây, Retry-After 5 (pm2 kill_timeout 30 giây)");
  const eco = fs.readFileSync(path.join(process.cwd(), "ecosystem.config.cjs"), "utf8");
  ok(/kill_timeout: 30000/.test(eco) && /treekill: false/.test(eco) && /NEXT_MANUAL_SIG_HANDLE: "1"/.test(eco) && /node_modules\/next\/dist\/bin\/next/.test(eco) && !/script:\s*["']npm/.test(eco), "ecosystem: chạy thẳng next, kill_timeout 30000, không giết CLI con, tắt êm bật");
  D.resetDrainForTest();
}

// ---------------- Shell: nginx, màu sống, node_modules ----------------
console.log("scripts/bluegreen-lib.sh với nginx / pm2 / curl giả");
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
const log = path.join(tmp, "calls.log");
const fake = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
fake("nginx", `[ "$1" = "-t" ] && [ -n "\${FAKE_NGINX_FAIL:-}" ] && grep -q "\${FAKE_NGINX_FAIL}" "$BG_UPSTREAM" && exit 1; exit 0`);
fake("pm2", "exit 0");
fake("curl", `case "$*" in *api/health*) printf '%s' "\${FAKE_HEALTH:-}" ;; esac; exit 0`);
const lib = path.join(process.cwd(), "scripts", "bluegreen-lib.sh");
const sh = (script, env = {}) => {
  const r = spawnSync("bash", ["-c", `set -u; . "${lib}"; ${script}`], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BG_WEB_USER: "", BG_STATE_DIR: tmp, BG_UPSTREAM: path.join(tmp, "nginx", "synchro-upstream.conf"), BG_TRIES: "2", BG_SLEEP: "0", ...env } });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
};
const up = path.join(tmp, "nginx", "synchro-upstream.conf");
const calls = () => { const s = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""; fs.rmSync(log, { force: true }); return s; };
{
  let r = sh("bg_switch_upstream 3000");
  ok(r.code === 0 && /proxy_pass http:\/\/127\.0\.0\.1:3000;/.test(fs.readFileSync(up, "utf8")), "tạo tệp upstream trỏ 3000", r);
  let c = calls();
  ok(c.includes("nginx -t") && c.includes("nginx -s reload") && c.indexOf("nginx -t") < c.indexOf("nginx -s reload"), "nginx -t trước, rồi mới reload", c);
  r = sh("bg_switch_upstream 3002");
  ok(r.code === 0 && sh("bg_upstream_port").out === "3002", "chuyển sang 3002", r);
  calls();
  r = sh("bg_switch_upstream 3000", { FAKE_NGINX_FAIL: "3000" });
  c = calls();
  ok(r.code !== 0 && sh("bg_upstream_port").out === "3002", "nginx -t lỗi: trả tệp cũ (vẫn 3002), báo lỗi để deploy dừng", { r, port: sh("bg_upstream_port").out });
  ok(!c.match(/nginx -s reload[\s\S]*nginx -t[\s\S]*$/) || c.split("\n").filter((l) => l === "nginx -s reload").length <= 1, "không reload cấu hình lỗi", c);
  ok(!fs.existsSync(`${up}.bak`) && !fs.readdirSync(path.dirname(up)).some((f) => f.includes(".tmp.")), "không để lại tệp tạm hay .bak");
  fs.rmSync(up);
  r = sh("bg_switch_upstream 3002", { FAKE_NGINX_FAIL: "3002" });
  ok(r.code !== 0 && !fs.existsSync(up), "chưa có tệp mà cấu hình mới lỗi: xóa tệp mới, nginx giữ cấu hình cũ", r);
  calls();
}
{
  const live = path.join(tmp, "live-color");
  fs.rmSync(live, { force: true });
  ok(sh('bg_enabled /var/www/synchro && echo y || echo n').out === "n", "chưa chạy bluegreen-migrate.sh: deploy theo cách một tiến trình");
  ok(sh("bg_write_live green 3002 /var/www/synchro; bg_live_color; bg_live_app").out === "green\n/var/www/synchro", "ghi / đọc màu sống");
  ok(fs.readFileSync(live, "utf8") === "green 3002 /var/www/synchro\n" && (fs.statSync(live).mode & 0o777) === 0o644, "tệp màu sống: một dòng, ai cũng đọc được (tiến trình web đọc)");
  ok(sh('bg_enabled /var/www/synchro && echo y || echo n').out === "y", "production đã chuyển: deploy mặc định dùng xanh/lam");
  ok(sh('bg_enabled /var/www/synchro-staging && echo y || echo n').out === "n", "staging (thư mục app khác) vẫn một tiến trình, cổng 3001 không đụng tới");
  ok(sh('bg_enabled /var/www/synchro && echo y || echo n', { BLUEGREEN: "0" }).out === "n" && sh('bg_enabled /x && echo y || echo n', { BLUEGREEN: "1" }).out === "y", "BLUEGREEN=0/1 ép cách deploy");
  ok(sh("bg_other green; bg_other blue; bg_port_of blue; bg_port_of green").out === "blue\ngreen\n3000\n3002", "đổi màu luân phiên 3000 ⇄ 3002 (không bao giờ 3001)");
}
{
  let r = sh('bg_healthy 3002 B2 && echo ok || echo no', { FAKE_HEALTH: '{"ok":true,"build":"B2","db":true}' });
  ok(r.out === "ok", "kiểm tra sức khỏe đạt khi đúng mã bản mới và ghi được cơ sở dữ liệu", r);
  ok(calls().includes("127.0.0.1:3002/api/health"), "gọi đúng cổng của bản mới");
  r = sh('bg_healthy 3002 B2 && echo ok || echo no', { FAKE_HEALTH: '{"ok":true,"build":"B1","db":true}' });
  ok(r.out === "no", "tiến trình cũ còn sót trả mã bản cũ: không đạt", r);
  r = sh('bg_healthy 3002 B2 && echo ok || echo no', { FAKE_HEALTH: '{"ok":false,"build":"B2","db":false}' });
  ok(r.out === "no", "không ghi được cơ sở dữ liệu: không đạt", r);
  calls();
  r = sh('bg_via_nginx B2 && echo ok || echo no', { FAKE_HEALTH: '{"build":"B2","db":true}' });
  ok(r.out === "ok" && /-ksS --max-time 5 --resolve synchro\.net\.nz:443:127\.0\.0\.1 https:\/\/synchro\.net\.nz\/api\/health/.test(calls()), "kiểm tra qua nginx của máy (tên miền thật, --resolve 127.0.0.1)");
  sh("bg_start /var/www/synchro green; bg_stop blue");
  const c = calls();
  ok(c.includes("pm2 startOrRestart /var/www/synchro/ecosystem.config.cjs --only synchro-green --update-env") && c.includes("pm2 stop synchro-blue"), "bật màu mới từ ecosystem, dừng màu cũ bằng pm2 stop (SIGTERM, chờ kill_timeout)", c);
}
{
  const side = path.join(tmp, "www"), app = path.join(side, "synchro");
  fs.mkdirSync(path.join(app, "node_modules", "next"), { recursive: true });
  fs.writeFileSync(path.join(app, "node_modules", ".synchro-lock"), "aaa\n");
  let r = sh(`bg_adopt_modules "${app}" "${side}"`);
  const target = fs.readlinkSync(path.join(app, "node_modules"));
  ok(r.code === 0 && fs.lstatSync(path.join(app, "node_modules")).isSymbolicLink() && target === path.join(side, ".synchro-mods", "aaa", "node_modules") && fs.existsSync(path.join(target, "next")), "node_modules thật chuyển vào kho theo băm, app dùng liên kết", { r, target });
  ok(sh(`bg_adopt_modules "${app}" "${side}"`).code === 0 && fs.readlinkSync(path.join(app, "node_modules")) === target, "chạy lại: không làm gì");
  const b = path.join(side, ".synchro-mods", "bbb", "node_modules"), c = path.join(side, ".synchro-mods", "ccc", "node_modules");
  fs.mkdirSync(b, { recursive: true }); fs.mkdirSync(c, { recursive: true });
  r = sh(`bg_link_modules "${app}" "${b}"; bg_mods_current "${app}"`);
  ok(r.out === b && !fs.readdirSync(app).some((f) => f.startsWith(".node_modules.new")), "đổi liên kết nguyên tử sang bản mới", r);
  sh(`bg_prune_modules "${side}" "${b}" "${target}"`);
  ok(fs.existsSync(b) && fs.existsSync(target) && !fs.existsSync(path.dirname(c)), "dọn: giữ bản mới và bản trước (trả lại được), xóa phần còn lại", fs.readdirSync(path.join(side, ".synchro-mods")));
}
{
  // Mọi script shell đều đúng cú pháp.
  const bad = ["server-build.sh", "bluegreen-lib.sh", "bluegreen-migrate.sh", "watchdog.sh", "backup.sh"].filter((f) => {
    try { execFileSync("bash", ["-n", path.join(process.cwd(), "scripts", f)], { stdio: "pipe" }); return false; } catch { return true; }
  });
  ok(!bad.length, "bash -n: server-build, bluegreen-lib, bluegreen-migrate, watchdog, backup", bad);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
