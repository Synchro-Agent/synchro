// Deploy xanh/lam (A5): vai trò primary/secondary (server/role.ts), tắt êm khi nhận SIGTERM (server/drain.ts), và các hàm shell đổi upstream nginx,
// màu sống, node_modules (scripts/bluegreen-lib.sh) với nginx / pm2 / curl giả trên PATH. Tự chạy được, không cần máy chủ.
import { execFileSync, spawn, spawnSync } from "node:child_process";
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
  const env = { SYNCHRO_PRIMARY_LOCK: path.join(tmp, "single.pid") };
  R.startRole(() => { n++; }, { env });
  R.startRole(() => { n++; }, { env });
  ok(n === 1 && R.isPrimary(), "một tiến trình (SYNCHRO_ROLE trống): primary ngay, việc nền chạy đúng một lần", { n, role: R.role() });
  ok(fs.readFileSync(env.SYNCHRO_PRIMARY_LOCK, "utf8").startsWith(`${process.pid} single`), "DEPLOY-2: một tiến trình cũng giữ khóa primary");
  R.releasePrimary();
}
{
  // DEPLOY-2: "npm start" lỡ bật cạnh production xanh/lam (cùng thư mục dữ liệu): không thành primary thứ hai.
  R.resetRoleForTest();
  const lock = path.join(tmp, "single2.pid");
  fs.writeFileSync(lock, "424243 green\n");
  let holderAlive = true, n = 0;
  const env = { SYNCHRO_PRIMARY_LOCK: lock, SYNCHRO_ROLE_POLL_MS: "20" };
  const err = console.error; console.error = () => {};
  R.startRole(() => { n++; }, { env, alive: (pid) => (pid === 424243 ? holderAlive : pid === process.pid) });
  console.error = err;
  await sleep(100);
  ok(n === 0 && R.role() === "secondary", "DEPLOY-2: khóa primary đang do tiến trình khác giữ: tiến trình một-màu chỉ phục vụ, không chạy việc nền", { n, role: R.role() });
  holderAlive = false;
  await sleep(100);
  ok(n === 1 && R.isPrimary(), "DEPLOY-2: tiến trình giữ khóa thoát: nhận vai một lần", { n, role: R.role() });
  R.releasePrimary(); R.resetRoleForTest();
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
  ok(R.canPromote({ bluegreen: true, color: "green", liveFile: live, lockFile: lock }, 1234, () => true), "không có khóa (watchdog khởi động lại màu sống): nhận vai ngay");
  fs.writeFileSync(lock, "999 blue\n");
  ok(!R.canPromote({ bluegreen: true, color: "green", liveFile: live, lockFile: lock }, 1234, () => true), "khóa của tiến trình khác còn sống: chờ");
  ok(R.canPromote({ bluegreen: true, color: "green", liveFile: live, lockFile: lock }, 1234, () => false), "khóa của tiến trình đã chết (bị SIGKILL): nhận vai");
  ok(!R.canPromote({ bluegreen: true, color: "blue", liveFile: live, lockFile: lock }, 1234, () => false), "màu không sống thì không bao giờ nhận vai");
  ok(!R.canPromote({ bluegreen: true, color: "", liveFile: live, lockFile: lock }, 1234, () => false), "thiếu SYNCHRO_COLOR: không nhận vai");
}
{
  // NODE-2: khóa cũ còn sót sau khi máy tắt đột ngột, pid đã thuộc tiến trình khác.
  const lock = path.join(tmp, "lock-ident"), live = path.join(tmp, "live-ident");
  fs.writeFileSync(live, "green 3002 /x\n");
  fs.writeFileSync(lock, "424250 green bootA 100\n");
  const id = (boot, start) => ({ boot: () => boot, start: () => start });
  ok(R.primaryHolder(lock, () => true, id("bootB", "100")) === null, "NODE-2: khóa của lần khởi động máy trước (boot_id khác): coi như trống");
  ok(R.primaryHolder(lock, () => true, id("bootA", "999")) === null, "NODE-2: pid còn sống nhưng thời điểm bắt đầu khác (pid bị dùng lại): coi như trống");
  ok(R.primaryHolder(lock, () => true, id("bootA", "100")) === 424250, "NODE-2: đúng tiến trình giữ khóa: vẫn chờ");
  const rootPid = execFileSync("ps", ["-U", "0", "-o", "pid="], { encoding: "utf8" }).split("\n").map(Number).find((p) => p > 1);
  fs.writeFileSync(lock, `${rootPid} green\n`);
  ok(!!rootPid && R.primaryHolder(lock) === null && R.canPromote({ bluegreen: true, color: "green", liveFile: live, lockFile: lock }, process.pid), "NODE-2: pid của user khác (EPERM, ví dụ tiến trình của root) không thể là khóa của Synchro", rootPid);
  fs.writeFileSync(lock, "424252 single bootA 100\n");
  ok(R.primaryHolder(lock, () => "eperm", id("bootA", "100")) === 424252 && !R.canPromote({ bluegreen: false, liveFile: live, lockFile: lock }, process.pid, () => "eperm", id("bootA", "100")),
    "NODE-2: tiến trình user khác (EPERM) mà danh tính khớp khóa vẫn là chủ khóa (không có primary thứ hai)");
  ok(R.primaryHolder(lock, () => "eperm", id("bootA", null)) === null, "NODE-2: EPERM mà không đọc được danh tính: không tin");
  R.resetRoleForTest();
  fs.writeFileSync(lock, "424251 blue bootA 100\n");
  const errs = []; const err = console.error; console.error = (...a) => errs.push(a.join(" "));
  R.startRole(() => {}, { env: { SYNCHRO_ROLE: "secondary", SYNCHRO_COLOR: "green", SYNCHRO_LIVE_FILE: live, SYNCHRO_PRIMARY_LOCK: lock, SYNCHRO_ROLE_POLL_MS: "20" }, alive: (p) => p === 424251, ident: id("bootA", "100"), warnMs: 60 });
  await sleep(200);
  console.error = err;
  ok(errs.filter((e) => e.includes("chờ nhận vai primary")).length === 1, "NODE-2: chờ nhận vai quá lâu thì báo lỗi một lần (hiện ở Sức khỏe hệ thống)", errs);
  R.resetRoleForTest();
}
{
  // Mọi việc chỉ được chạy ở một tiến trình phải nằm trong primaryDuties (instrumentation-node.ts), không ở phần chạy ở mọi tiến trình.
  const src = fs.readFileSync(path.join(process.cwd(), "instrumentation-node.ts"), "utf8");
  { const entry = fs.readFileSync("instrumentation.ts", "utf8"); ok(/NEXT_RUNTIME === "nodejs"[\s\S]*import\("\.\/instrumentation-node"\)\)\.registerNode\(\)/.test(entry), "instrumentation.ts (điểm vào thật của Next) gọi registerNode() ở runtime Node"); }
  const at = src.indexOf("function primaryDuties");
  const head = src.slice(0, at), body = src.slice(at);
  const duties = ["startOnBoot", "sweepOrphanClis", "resumeInterrupted", "startScheduler", "./server/brain", "recheckConnectors", "scheduleDiscovery", "startCliUpdates", "keepLinksAlive", "startPrWatch", "sweepEngineTemp", "ensurePluginTags", "ensureDefaultPlugins", "resumeJob", "retryVoicePurges", "noteBoot("];
  const wrong = duties.filter((d) => head.includes(d) || !body.includes(d));
  ok(at > 0 && !wrong.length, "litestream, bộ hẹn giờ, chạy lại lượt, cài plugin… chỉ chạy trong primaryDuties", wrong);
  ok(/startRole\(\(\) => primaryDuties/.test(head) && head.includes("installShutdown("), "registerNode(): cài tắt êm ở mọi tiến trình, việc nền qua startRole");
  const runs = fs.readFileSync(path.join(process.cwd(), "server/runs.ts"), "utf8");
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
  const errs = []; const err = console.error; console.error = (...a) => errs.push(a.join(" "));
  const r = await D.shutdown({ busy: () => 1, describe: () => "0 lượt chat, 1 lượt Code", timeoutMs: 150, pollMs: 10, log: () => {}, stop: () => new Promise(() => {}), stopMs: 50, exit: (c) => { exitCode = c; } });
  console.error = err;
  const ms = Date.now() - t0;
  ok(errs.some((e) => e.includes("1 lượt Code") && e.includes("lượt Code dừng hẳn")), "NODE-3: hết giờ chờ: nhật ký nói rõ lượt Code dừng hẳn (không chạy lại), tách khỏi lượt chat", errs);
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

// ---------------- NODE-1: Dừng / nhắn thêm cho lượt do tiến trình khác chạy ----------------
console.log("Dừng / nhắn thêm qua cơ sở dữ liệu (tiến trình cũ đang chạy nốt)");
{
  process.env.DATA_DIR = path.join(tmp, "data"); fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  process.env.DATA_KEY ??= "k";
  const { authstore: AS, runs: RN } = await loadTs(["authstore", "runs"]);
  const u = AS.createUser({ email: `bg-${Date.now()}@x.test`, name: "BG", verified: true });
  let reran = 0, got = [];
  RN.registerExec("bgprobe", async () => {
    const sig = RN.runSignal();
    const inbox = new Promise((r) => { RN.onInbox(() => r("msg")); });
    const why = await Promise.race([inbox, new Promise((r) => sig.addEventListener("abort", () => r("abort")))]);
    if (why === "msg") { got = RN.takeInbox(); return { http: 200, json: { text: "steered" } }; }
    return { http: 200, json: { text: "", cancelled: true } };
  });
  RN.registerExec("bgrerun", async () => { reran++; return { http: 200, json: { text: "re-ran" } }; });
  RN.registerExec("bgpartial", async () => { RN.delta("phần đã viết"); await new Promise(() => {}); return { http: 200, json: {} }; });
  const db = AS.db();
  const status = (id) => db.prepare("SELECT status, result FROM runs WHERE id = ?").get(id);
  // Lượt chạy ở tiến trình này; lệnh Dừng do tiến trình khác ghi vào cơ sở dữ liệu.
  const a = RN.startRun(u, "bgprobe", {}, "c-a");
  await sleep(50);
  db.prepare("UPDATE runs SET cancel_req = 1 WHERE id = ?").run(a);
  RN.applyRemote(); await sleep(50);
  ok(status(a).status === "done" && JSON.parse(status(a).result).cancelled === true, "NODE-1: tiến trình đang chạy lượt nhận lệnh Dừng ghi từ tiến trình khác", status(a));
  // Nhắn thêm qua cơ sở dữ liệu.
  const b = RN.startRun(u, "bgprobe", {}, "c-b");
  await sleep(50);
  db.prepare("UPDATE runs SET steer_req = json_insert(COALESCE(steer_req, '[]'), '$[#]', ?) WHERE id = ?").run("thêm ý này", b);
  RN.applyRemote(); await sleep(50);
  ok(got.join() === "thêm ý này" && status(b).status === "done", "NODE-1: tin nhắn thêm gửi qua tiến trình khác tới đúng lượt đang chạy", { got, st: status(b) });
  // Lượt của tiến trình khác (không có ở đây): Dừng ghi cờ; tiến trình đó thoát rồi thì resumeInterrupted kết thúc lượt là đã dừng, không chạy lại.
  const c = "run_otherproc";
  db.prepare("INSERT INTO runs (id,user_id,conv,kind,status,req,events,created_at,updated_at) VALUES (?,?,?,?, 'running', ?, '[]', ?, ?)").run(c, u.id, "c-c", "bgrerun", "{}", Date.now(), Date.now());
  ok(RN.cancelRun(c, u.id) === true && RN.pushInbox(c, u.id, "x") === false, "NODE-1: Dừng cho lượt ở tiến trình khác được nhận (không còn trả false); sau khi đã dừng thì không nhận nhắn thêm");
  RN.resumeInterrupted(); await sleep(50);
  ok(reran === 0 && JSON.parse(status(c).result).cancelled === true, "NODE-1: lượt đã bấm Dừng không bị chạy lại khi bản mới nhận vai primary", { reran, st: status(c) });
  // Bản cũ hết giờ chờ: lưu chữ đã viết; lượt được bấm Dừng lúc đó được đóng kèm phần chữ này.
  const p = RN.startRun(u, "bgpartial", {}, "c-p");
  await sleep(50);
  ok(RN.persistPartials() >= 1 && db.prepare("SELECT partial FROM runs WHERE id = ?").get(p).partial === "phần đã viết", "NODE-1: tắt êm hết giờ: lưu chữ đã viết của lượt còn dở");
  const p2 = "run_otherproc2";
  db.prepare("INSERT INTO runs (id,user_id,conv,kind,status,req,events,created_at,updated_at,cancel_req,partial) VALUES (?,?,?,?, 'running', ?, '[]', ?, ?, 1, ?)").run(p2, u.id, "c-p2", "bgrerun", "{}", Date.now(), Date.now(), "chữ dở");
  RN.resumeInterrupted(); await sleep(50);
  ok(JSON.parse(status(p2).result).text === "chữ dở" && JSON.parse(status(p2).result).cancelled === true && reran === 0, "NODE-1: lượt đã bấm Dừng mà bản cũ chưa kịp thấy: đóng kèm phần chữ đã viết, không trống", status(p2));
  const fin = fs.readFileSync(path.join(process.cwd(), "server/runs.ts"), "utf8");
  const fstart = fin.indexOf("function finish(");
  ok(/d\.transaction\(\(\) => \{\n\s+const remote = /.test(fin.slice(fstart, fstart + 1500)) && /\}\)\.immediate\(\);/.test(fin.slice(fstart, fstart + 1500)), "NODE-1: finish đọc hàng chờ nhắn thêm và đóng lượt trong một giao dịch IMMEDIATE");

  // NODE-3: lượt Code đang chạy nốt ở tiến trình cũ.
  const { agentruns: AR } = await loadTs(["agentruns"]);
  const other = spawn("sleep", ["10"]);
  AR.agentElsewhere(u.id, "warm"); // tạo bảng agent_owner
  db.prepare("INSERT OR REPLACE INTO agent_owner (uid, sid, pid, started, ended, stop, node) VALUES (?, ?, ?, ?, 0, 0, 7)").run(u.id, "s-old", other.pid, Date.now());
  ok(AR.latestRun(u.id, "s-old") === null && AR.agentElsewhere(u.id, "s-old")?.node === 7, "NODE-3: bản mới biết lượt Code đang chạy nốt ở tiến trình cũ (trả 202 cho trình duyệt chờ, không báo mất lượt)");
  ok(AR.stopAgentElsewhere(u.id, "s-old") === true && db.prepare("SELECT stop FROM agent_owner WHERE uid = ? AND sid = ?").get(u.id, "s-old").stop === 1, "NODE-3: nút Dừng ở bản mới ghi cờ cho tiến trình cũ");
  other.kill();
  await sleep(50);
  ok(AR.agentElsewhere(u.id, "s-old") === null && !db.prepare("SELECT 1 FROM agent_owner WHERE uid = ? AND sid = ?").get(u.id, "s-old"), "NODE-3: tiến trình cũ đã thoát: không còn chờ (204 như trước) và dòng của chủ đã chết bị xóa");
  db.prepare("INSERT OR REPLACE INTO agent_owner (uid, sid, pid, started, ended, stop) VALUES (?, ?, ?, ?, 0, 0)").run(u.id, "s-dead", 999999, Date.now());
  const run = AR.startAgentRun({ uid: u.id, sid: "s-new" }, (emit, signal) => new Promise((res) => signal.addEventListener("abort", () => res())));
  const row = db.prepare("SELECT pid, ended, boot, start FROM agent_owner WHERE uid = ? AND sid = ?").get(u.id, "s-new");
  ok(row.pid === process.pid && row.boot && row.start && AR.agentElsewhere(u.id, "s-new") === null, "NODE-3: lượt Code ghi tiến trình đang chạy nó kèm danh tính", row);
  ok(!db.prepare("SELECT 1 FROM agent_owner WHERE sid = 's-dead'").get(), "NODE-3: bắt đầu lượt mới thì dọn dòng của các chủ đã chết (ended = 0 mãi)");
  ok(R.sameProcess(4321, "bootA", "100", () => true, { boot: () => "bootA", start: () => "555" }) === false && R.sameProcess(4321, "bootA", "100", () => true, { boot: () => "bootA", start: () => "100" }) === true,
    "NODE-3: pid bị dùng lại (starttime khác) không còn được coi là bản cũ đang chạy lượt");
  db.prepare("UPDATE agent_owner SET stop = 1 WHERE uid = ? AND sid = ?").run(u.id, "s-new");
  ok(AR.applyAgentStops() === 1 && run.ac.signal.aborted, "NODE-3: tiến trình đang chạy lượt Code nhận lệnh Dừng ghi từ tiến trình khác");
  await sleep(50);
  ok(db.prepare("SELECT ended FROM agent_owner WHERE uid = ? AND sid = ?").get(u.id, "s-new").ended > 0, "NODE-3: lượt xong thì đánh dấu đã kết thúc");
  const wc = fs.readFileSync(path.join(process.cwd(), "app/wsclient.ts"), "utf8"), ar = fs.readFileSync(path.join(process.cwd(), "app/api/agent/route.ts"), "utf8");
  ok(/if \(r\.status === 202\) \{ const j = /.test(wc) && /return \{ running: true, node: j\.node \?\? null, elsewhere: true \}/.test(wc), "NODE-3: agentRunInfo hiểu 202 (đang chạy ở bản cũ): resumeAgent hiện bận + nút Dừng, watchAgentEnd hỏi tiếp");
  ok(/r\.status === 202\) \{ if \(\+\+elsewhere > 45\) return false; await sleep\(2000, signal\); continue; \}/.test(wc) && /status: 202/.test(ar) && /stopAgentElsewhere\(c\.user\.id, sid\)/.test(ar), "NODE-3: trình duyệt chờ khi nhận 202; route trả 202 và chuyển Dừng sang tiến trình cũ");
}

// ---------------- Shell: nginx, màu sống, node_modules ----------------
console.log("scripts/bluegreen-lib.sh với nginx / pm2 / curl giả");
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
const log = path.join(tmp, "calls.log");
const fake = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
// nginx giả nhớ cấu hình đang chạy (chỉ đổi khi reload); FAKE_SIG_IN_T: gửi tín hiệu cho script đang chạy nginx -t.
fake("nginx", `if [ "$1" = "-t" ]; then [ -n "\${FAKE_SIG_IN_T:-}" ] && kill -s "$FAKE_SIG_IN_T" $PPID; [ -n "\${FAKE_NGINX_FAIL:-}" ] && grep -q "\${FAKE_NGINX_FAIL}" "$BG_UPSTREAM" && exit 1; exit 0; fi
[ "$1 $2" = "-s reload" ] && sed -n 's/.*127\\.0\\.0\\.1:\\([0-9]*\\).*/\\1/p' "$BG_UPSTREAM" > "$BG_STATE_DIR/running"; exit 0`);
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
  // DEPLOY-1: deploy trước chết sau khi đổi nginx, trước khi ghi màu sống. Upstream là nguồn sự thật; không bao giờ dừng màu nginx đang trỏ.
  fs.mkdirSync(path.dirname(up), { recursive: true });
  fs.writeFileSync(up, "proxy_pass http://127.0.0.1:3000;\n");
  fs.writeFileSync(path.join(tmp, "live-color"), "green 3002 /var/www/synchro\n");
  calls();
  let r = sh("bg_stop blue; echo rc=$?");
  ok(/rc=1/.test(r.out) && !calls().includes("pm2 stop synchro-blue"), "DEPLOY-1: không dừng màu nginx đang trỏ (blue 3000)", r);
  r = sh("bg_sync_live /var/www/synchro; bg_live_color");
  ok(r.out === "blue" && fs.readFileSync(path.join(tmp, "live-color"), "utf8") === "blue 3000 /var/www/synchro\n", "DEPLOY-1: tệp màu sống được sửa theo cổng nginx", r);
  r = sh("bg_stop green; echo rc=$?");
  ok(/rc=0/.test(r.out) && calls().includes("pm2 stop synchro-green"), "DEPLOY-1: màu nghỉ thì dừng được", r);
  // Tín hiệu tới giữa nginx -t: việc đổi vẫn làm trọn (tệp = cấu hình đang chạy), tín hiệu được xử lý sau.
  const running = () => fs.readFileSync(path.join(tmp, "running"), "utf8").trim();
  r = sh('trap "exit 143" TERM; bg_switch_upstream 3002; echo after', { FAKE_SIG_IN_T: "TERM" });
  ok(r.code === 143 && !/after/.test(r.out) && running() === "3002" && sh("bg_upstream_port").out === "3002", "DEPLOY-1: SIGTERM giữa nginx -t được hoãn tới khi reload xong (tệp upstream luôn khớp nginx đang chạy)", { r, running: running() });
  // Tệp đã đổi nhưng nginx chưa reload (SIGKILL giữa chừng): nạp lại theo tệp trước khi tin nó.
  fs.writeFileSync(path.join(tmp, "running"), "3000\n");
  fs.writeFileSync(path.join(tmp, "live-color"), "blue 3000 /var/www/synchro\n");
  r = sh("bg_sync_live /var/www/synchro; bg_live_color");
  ok(r.out.endsWith("green") && running() === "3002", "DEPLOY-1: tệp upstream khác màu sống: reload nginx theo tệp rồi mới sửa màu sống", { r, running: running() });
  fs.writeFileSync(path.join(tmp, "running"), "3000\n");
  fs.writeFileSync(path.join(tmp, "live-color"), "blue 3000 /var/www/synchro\n");
  calls();
  r = sh("bg_stop green; echo rc=$?");
  ok(/rc=1/.test(r.out) && running() === "3002" && !calls().includes("pm2 stop synchro-green"), "DEPLOY-1: trước khi dừng màu nào cũng nạp lại nginx nếu tệp khác màu sống; không dừng màu nginx đang chạy", { r, running: running() });
  const sb = fs.readFileSync(path.join(process.cwd(), "scripts", "server-build.sh"), "utf8");
  ok(sb.indexOf('BG=0; bg_enabled "$APP" && BG=1') > sb.indexOf("flock -w 900 9") && !/\[ "\$PM2" = "synchro" \] && PORT=3001/.test(sb) && /bg_pm2_has "\$PM2"/.test(sb), "DEPLOY-2: chọn cách deploy sau khi giữ khóa; production đã chuyển không đi đường một tiến trình nếu thiếu app pm2; không bao giờ đoán cổng 3001");
  {
    // DEPLOY-3: chỉ bỏ qua lỗi "tệp vừa bị xóa" của chown -R; lỗi khác (EPERM, ổ chỉ đọc…) làm dừng.
    const fn = sb.slice(sb.indexOf("harden() {"), sb.indexOf("\n}\n", sb.indexOf("harden() {")) + 3);
    const cb = path.join(tmp, "chownbin"); fs.mkdirSync(cb, { recursive: true });
    fs.writeFileSync(path.join(cb, "chown"), `#!/bin/bash\n[ "$1" = -R ] && [ "$2" = synchro:synchro ] && [ -n "$CHOWN_ERR" ] && { echo "$CHOWN_ERR" >&2; exit 1; }\nexit 0\n`); fs.chmodSync(path.join(cb, "chown"), 0o755);
    const app = path.join(tmp, "happ"); for (const d of ["scripts", "workspace"]) fs.mkdirSync(path.join(app, d), { recursive: true });
    const h = (e) => spawnSync("bash", ["-c", `set -e; APP="${app}"; ${fn}\nharden; echo done`], { encoding: "utf8", env: { ...process.env, PATH: `${cb}:${process.env.PATH}`, CHOWN_ERR: e } });
    const gone = h("chown: cannot access 'x/data/tmp1': No such file or directory"), perm = h("chown: changing ownership of 'x/app/a': Operation not permitted");
    ok(gone.status === 0 && /done/.test(gone.stdout) && perm.status !== 0 && /Operation not permitted/.test(perm.stderr) && !/done/.test(perm.stdout), "DEPLOY-3: chown -R chỉ bỏ qua tệp vừa bị xóa; lỗi quyền làm dừng deploy và in ra lỗi thật", { gone: gone.status, perm: perm.status, err: perm.stderr });
  }
  ok(/if \[ "\$PM2" = synchro-staging \]; then \[ -n "\$PORT_ARG" \] \|\| PORT_ARG=3001/.test(sb) && /bg_color_of_port "\$\(bg_upstream_port\)" >\/dev\/null; then/.test(sb) && /KHÔNG CÓ APP PM2/.test(sb) && /không biết cổng nên KHÔNG kiểm tra được web/.test(sb),
    "DEPLOY-2: staging tạo lại synchro-staging ở 3001 (chỉ staging); production đã chuyển + nginx trỏ màu xanh/lam thì từ chối cả khi còn app 'synchro'; không báo 'web đang chạy bình thường' khi không có app / không biết cổng");
  const bgPart = sb.slice(sb.indexOf("# ---------------- Xanh/lam"));
  ok(bgPart.indexOf("SHARED=1") < bgPart.indexOf('mv "$B/.next" "$NEWDIST"') && bgPart.indexOf("sync_code") < bgPart.indexOf('bg_link_modules "$APP" "$MODS"') && /rollback "thoát giữa chừng/.test(sb) && /grep -v 'No such file or directory'/.test(sb),
    "DEPLOY-3: mọi bước đụng trạng thái dùng chung nằm sau khi có rollback (cleanup khi thoát lỗi); chép mã trước khi đổi liên kết thư viện; chown -R data/ không làm hỏng deploy");
  const eco = fs.readFileSync(path.join(process.cwd(), "ecosystem.config.cjs"), "utf8");
  ok(/script: path\.join\(APP, `\.next-\$\{color\}`, "node_modules\/next\/dist\/bin\/next"\)/.test(eco) && bgPart.includes('ln -sfn "$MODS" "$NEWDIST/node_modules"')
    && bgPart.indexOf('bg_link_modules "$APP" "$MODS"') > bgPart.indexOf('bg_stop "$LIVE"'),
    "DEPLOY-4: mỗi màu có node_modules riêng (.next-<màu>/node_modules), pm2 chạy next của màu đó; liên kết chung chỉ đổi khi bản cũ đã thoát");
  {
    // DEPLOY-5: next build trong $B có .env.production của máy chủ (cả xanh/lam lẫn staging); đồng bộ mã vẫn không bao giờ chép .env*.
    const app = path.join(tmp, "envapp"), b = path.join(tmp, "envb");
    fs.mkdirSync(app, { recursive: true }); fs.mkdirSync(b, { recursive: true });
    fs.writeFileSync(path.join(app, ".env.production"), "SYNCHRO_FIXED_LANG=en\n"); fs.writeFileSync(path.join(app, "package.json"), "{}");
    const line = sb.split("\n").find((l) => l.startsWith('for f in "$APP"/.env*'));
    spawnSync("bash", ["-c", `APP="${app}"; B="${b}"; ${line}`]);
    ok(!!line && sb.indexOf(line) > sb.indexOf('rsync -a "${EXCL[@]}" "$SRC/" "$B/"') && fs.existsSync(path.join(b, ".env.production")) && /--exclude '\/\.env\*'/.test(sb),
      "DEPLOY-5: .env* của máy chủ được chép vào thư mục build trước next build; đồng bộ mã vẫn loại .env*");
  }
  ok(sb.indexOf('bg_sync_live "$APP"') > sb.indexOf("flock -w 900 9") && /trap cleanup EXIT/.test(sb) && /trap 'exit 129' HUP/.test(sb), "DEPLOY-1: server-build sửa màu sống sau khi giữ khóa, trap khi thoát / mất ssh");
  fs.rmSync(up);
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
// ---------------- bluegreen-migrate.sh với pm2 / nginx / curl giả ----------------
console.log("scripts/bluegreen-migrate.sh với công cụ giả");
const mig = (name, o = {}) => {
  const H = path.join(tmp, `mig-${name}`), A = path.join(H, "www", "synchro"), mb = path.join(H, "bin"), P = path.join(H, "pm2");
  for (const d of [path.join(A, ".next", "static"), path.join(A, "node_modules"), path.join(A, "data"), path.join(A, "scripts"), path.join(H, "nginx", "snippets"), path.join(H, "state"), mb, P]) fs.mkdirSync(d, { recursive: true });
  for (const f of ["bluegreen-lib.sh", "bluegreen-migrate.sh"]) fs.copyFileSync(path.join(process.cwd(), "scripts", f), path.join(A, "scripts", f));
  fs.copyFileSync(path.join(process.cwd(), "ecosystem.config.cjs"), path.join(A, "ecosystem.config.cjs"));
  fs.writeFileSync(path.join(A, ".next", "BUILD_ID"), "BID1");
  if (o.newCode !== false) { fs.mkdirSync(path.join(A, ".next", "server", "chunks"), { recursive: true }); fs.writeFileSync(path.join(A, ".next", "server", "chunks", "r.js"), "process.env.SYNCHRO_PRIMARY_LOCK;process.env.NEXT_MANUAL_SIG_HANDLE"); }
  fs.writeFileSync(path.join(A, "node_modules", ".synchro-lock"), "lockhash\n");
  fs.writeFileSync(path.join(H, "site"), "server {\n    location / {\n        proxy_pass http://127.0.0.1:3000;\n    }\n    location /ws { proxy_pass http://127.0.0.1:3555; }\n}\n");
  fs.writeFileSync(path.join(H, "ops.env"), "APP=/var/www/synchro\nPM2=synchro\nPORT=3000\nWATCHDOG_ALERT_CMD=keep\n");
  fs.writeFileSync(path.join(P, o.oldName ?? "synchro"), o.oldDown ? "stopped" : "online");
  fs.writeFileSync(path.join(H, "active"), "3000");
  if (o.live) fs.writeFileSync(path.join(H, "state", "live-color"), `${o.live} ${A}\n`);
  if (o.primary) fs.writeFileSync(path.join(A, "data", ".primary.pid"), `4242 ${o.primary}\n`);
  if (o.resume) {
    // Lần trước dừng sau khi nginx đã sang green: site include tệp upstream 3002, green chạy, app cũ đã xóa tay.
    fs.writeFileSync(path.join(H, "nginx", "snippets", "synchro-upstream.conf"), "proxy_pass http://127.0.0.1:3002;\n");
    fs.writeFileSync(path.join(H, "site"), `server {\n    location / {\n        include ${path.join(H, "nginx", "snippets", "synchro-upstream.conf")};\n    }\n}\n`);
    fs.cpSync(path.join(A, ".next"), path.join(A, ".next-green"), { recursive: true });
    fs.writeFileSync(path.join(P, "synchro-green"), "online"); fs.writeFileSync(path.join(H, "active"), "3002");
    fs.rmSync(path.join(P, o.oldName ?? "synchro"));
  }
  const sh = (n, body) => { fs.writeFileSync(path.join(mb, n), `#!/bin/bash\n${body}\n`); fs.chmodSync(path.join(mb, n), 0o755); };
  sh("id", `[ "$1" = -u ] && { echo 0; exit 0; }; exec /usr/bin/id "$@"`);
  sh("chown", "exit 0");
  sh("sqlite3", "echo 0");
  sh("sed", `if [ "$1" = -i ]; then shift; exec /usr/bin/sed -i '' "$@"; fi; exec /usr/bin/sed "$@"`);
  sh("nginx", `[ "$1" = -t ] && { [ -n "\${FAKE_NGINX_FAIL:-}" ] && exit 1; exit 0; }
up=$(/usr/bin/sed -n 's/.*127\\.0\\.0\\.1:\\([0-9]*\\);.*/\\1/p' "$BG_UPSTREAM" 2>/dev/null | head -1)
grep -q synchro-upstream.conf "${H}/site" && echo "$up" > "${H}/active"; exit 0`);
  sh("pm2", `echo "pm2 $*" >> "${H}/calls.log"; P="${P}"
case "$1" in
  startOrRestart) echo online > "$P/$4" ;;
  stop) [ "$2" = "\${KEEP_UP:-x}" ] && exit 0; [ -f "$P/$2" ] && echo stopped > "$P/$2" || exit 1 ;;
  delete) [ -n "\${FAIL_DELETE:-}" ] && exit 1; [ -f "$P/$2" ] && rm -f "$P/$2" || exit 1 ;;
  restart) [ -f "$P/$2" ] && echo online > "$P/$2" || exit 1 ;;
  save) [ -n "\${FAIL_SAVE:-}" ] && exit 1; ls "$P" | tr '\\n' ' ' > "${H}/dump" ;;
  jlist) printf '['; for f in "$P"/*; do printf '{"name":"%s"},' "$(basename "$f")"; done; printf '{}]' ;;
esac; exit 0`);
  sh("curl", `url="\${@: -1}"
case "$*" in *--resolve*|*"Host: "*) p=$(cat "${H}/active") ;; *) p=$(echo "$url" | /usr/bin/sed -n 's|.*127\\.0\\.0\\.1:\\([0-9]*\\).*|\\1|p') ;; esac
case "$p" in 3000) n=${o.oldName ?? "synchro"}; d=.next ;; 3002) n=synchro-green; d=.next-green ;; *) exit 7 ;; esac
[ "$(cat "${P}/$n" 2>/dev/null)" = online ] || exit 7
case "$*" in *"-o /dev/null"*) exit 0 ;; esac; case "$url" in *api/health*) printf '{"ok":true,"build":"%s","db":true}' "$(cat "${A}/$d/BUILD_ID")" ;; *) echo html ;; esac`);
  // green nhận vai khi màu sống = green và bản cũ đã dừng (như server/role.ts).
  sh("sleep", `[ -n "\${NO_PROMOTE:-}" ] && exit 0
[ "$(awk '{print $1}' "${H}/state/live-color" 2>/dev/null)" = green ] && [ "$(cat "${P}/${o.oldName ?? "synchro"}" 2>/dev/null)" != online ] && echo "4242 green" > "${A}/data/.primary.pid"; exit 0`);
  const run = (env = {}) => spawnSync("bash", [path.join(A, "scripts", "bluegreen-migrate.sh"), A, "synchro", path.join(H, "site")], { encoding: "utf8",
    env: { ...process.env, PATH: `${mb}:${process.env.PATH}`, BG_STATE_DIR: path.join(H, "state"), BG_UPSTREAM: path.join(H, "nginx", "snippets", "synchro-upstream.conf"), BG_TRIES: "2", BG_SLEEP: "0", BG_WEB_USER: "", DATA_DIR: path.join(A, "data"), SYNCHRO_OPS_ENV: path.join(H, "ops.env"), ...o.env, ...env } });
  const r = run();
  const st = () => ({ live: fs.existsSync(path.join(H, "state", "live-color")) ? fs.readFileSync(path.join(H, "state", "live-color"), "utf8").split(" ")[0] : "", active: fs.readFileSync(path.join(H, "active"), "utf8").trim(),
    pm2: Object.fromEntries(fs.readdirSync(P).map((f) => [f, fs.readFileSync(path.join(P, f), "utf8").trim()])), dump: fs.existsSync(path.join(H, "dump")) ? fs.readFileSync(path.join(H, "dump"), "utf8").trim() : "", env: fs.readFileSync(path.join(H, "ops.env"), "utf8") });
  return { code: r.status, out: (r.stdout + r.stderr).trim(), st: st(), run, stNow: st, H, A };
};
{
  let m = mig("ok"); if (process.env.DEBUG_MIG) console.log(m.out);
  ok(m.code === 0 && m.st.live === "green" && m.st.active === "3002" && m.st.pm2["synchro-green"] === "online" && !m.st.pm2.synchro && /synchro-green/.test(m.st.dump) && /PM2=synchro-green/.test(m.st.env), "chuyển đổi đủ bước: green 3002 sống, app cũ xóa, pm2 save, synchro-ops.env", { code: m.code, st: m.st, out: m.out.slice(-1500) });
  ok(fs.readlinkSync(path.join(m.A, ".next-green", "node_modules")).endsWith("lockhash/node_modules"), "DEPLOY-4: green có liên kết thư viện riêng");
  m = mig("noanswer", { oldDown: true });
  ok(m.code === 1 && /không trả lời/.test(m.out) && !m.st.live, "MIGRATE-1: cổng cũ không trả lời: báo rõ lý do (không thoát im lặng vì set -e)", { code: m.code, out: m.out.slice(-300) });
  m = mig("oldcode", { newCode: false });
  ok(m.code !== 0 && /chưa có mã xanh\/lam/.test(m.out) && m.st.active === "3000" && m.st.pm2.synchro === "online" && !m.st.pm2["synchro-green"] && !m.st.live, "MIGRATE-1: bản đang chạy chưa có mã xanh/lam: từ chối trước khi bật green, không đổi gì", { code: m.code, st: m.st, out: m.out.slice(-400) });
}
{
  let m = mig("wrongname", { oldName: "synchro-web" });
  ok(m.code !== 0 && !m.st.live && m.st.pm2["synchro-web"] === "online", "MIGRATE-2: pm2 stop app cũ lỗi (sai tên): không ghi màu sống, báo lỗi (không có hai primary)", { code: m.code, st: m.st });
  m = mig("stillup", { env: { KEEP_UP: "synchro" } });
  ok(m.code !== 0 && !m.st.live && /vẫn trả lời/.test(m.out), "MIGRATE-2: cổng cũ vẫn trả lời sau pm2 stop: không ghi màu sống", { code: m.code, st: m.st });
  m = mig("nopromote", { env: { NO_PROMOTE: "1" } });
  ok(m.code !== 0 && !m.st.live && m.st.active === "3000" && m.st.pm2.synchro === "online" && m.st.pm2["synchro-green"] === "stopped", "MIGRATE-2: green không nhận vai primary: bật lại bản cũ, nginx về 3000, bỏ màu sống, dừng green", { code: m.code, st: m.st });
}
{
  {
    const g = mig("gone", { resume: true });
    ok(g.code === 0 && g.st.live === "green" && /không còn trong pm2/.test(g.out), "MIGRATE-2: app cũ đã không còn trong pm2 và cổng cũ trống: coi như đã dừng, chuyển xong", { code: g.code, st: g.st, out: g.out.slice(-400) });
    const w = mig("wrongname2", { oldName: "synchro-web" });
    ok(w.code !== 0 && !w.st.live && /chạy dưới tên khác/.test(w.out), "MIGRATE-2: không có app tên đó nhưng cổng cũ còn trả lời: nói rõ bản cũ có thể chạy dưới tên khác", { code: w.code, out: w.out.slice(-300) });
    const n = mig("stillup2", { env: { KEEP_UP: "synchro" } });
    ok(/KHÔNG có tiến trình nào là primary/.test(n.out), "MIGRATE-2: bản cũ đã dừng mà green chưa là primary: nói rõ không có primary và cách xử lý", n.out.slice(-300));
  }
  const m = mig("savefail", { env: { FAIL_SAVE: "1" } });
  ok(m.code !== 0 && m.st.live === "green" && !m.st.dump, "MIGRATE-3: pm2 save lỗi không bị giấu (mã lỗi)", { code: m.code, st: m.st });
  const r = m.run({ FAIL_SAVE: "" }), st = m.stNow();
  ok(r.status === 0 && /synchro-green/.test(st.dump) && /PM2=synchro-green/.test(st.env), "MIGRATE-3: chạy lại sau khi bị cắt ngang: làm nốt pm2 save và synchro-ops.env", { code: r.status, st, out: (r.stdout + r.stderr).slice(-300) });
  // Lần trước bị cắt ngang lúc chờ green nhận vai, và green không bao giờ nhận: chạy lại thì trả lại bản cũ, không xóa nó.
  const d = mig("rerun-noprim", { live: "green 3002", env: { NO_PROMOTE: "1" } });
  ok(d.code !== 0 && d.st.pm2.synchro === "online" && !d.st.live && !/synchro-green/.test(d.st.dump), "MIGRATE-3: chạy lại khi green chưa là primary: không làm nốt (không xóa app cũ, không pm2 save) mà trả lại bản cũ", { code: d.code, st: d.st });
  const e = mig("delfail", { live: "green 3002", primary: "green", env: { FAIL_DELETE: "1" } });
  ok(e.code !== 0 && !e.st.dump && /chưa pm2 save/.test(e.out), "MIGRATE-3: pm2 delete app cũ lỗi thì không pm2 save", { code: e.code, st: e.st });
  const m2 = mig("rerun-old", { live: "green 3002", primary: "green" });
  ok(m2.code === 0 && !m2.st.pm2.synchro && /synchro/.test(m2.out) && /PM2=synchro-green/.test(m2.st.env), "MIGRATE-3: chạy lại khi app pm2 cũ còn sót: dừng và xóa nó, lưu pm2", { code: m2.code, st: m2.st });
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
