// Sao lưu và watchdog: chạy thật hai script trên thư mục tạm (không cần root, không cần máy chủ Synchro), kiểm tra báo cáo cho trang Sức khỏe hệ thống.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
const root = process.cwd();
const R = createRequire(path.join(root, "package.json"));
const D = R("better-sqlite3");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-ops-"));
const json = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

console.log("1. Sao lưu và kiểm tra bản mới nhất");
const app = path.join(tmp, "app"), data = path.join(app, "data"), dest = path.join(tmp, "backups"), ops = path.join(tmp, "ops");
fs.mkdirSync(path.join(app, ".cache/files"), { recursive: true }); fs.mkdirSync(data, { recursive: true });
fs.writeFileSync(path.join(data, "secret.key"), "k");
fs.writeFileSync(path.join(app, ".cache/files/aaa.bin"), "x");
// Tên tệp là mã băm nội dung: một tệp đúng, một tệp hỏng.
const sha1 = (s) => createHash("sha1").update(s).digest("hex"), good = sha1("nội dung tốt"), bad = sha1("nội dung gốc");
fs.writeFileSync(path.join(app, `.cache/files/${good}.bin`), "nội dung tốt");
fs.writeFileSync(path.join(app, `.cache/files/${bad}.bin`), "đã bị hỏng");
let db = new D(path.join(data, "synchro.db"));
db.exec(`CREATE TABLE users (id TEXT); INSERT INTO users VALUES ('a'), ('b'); CREATE TABLE file_owners (file_id TEXT, user_id TEXT, size INTEGER); INSERT INTO file_owners VALUES ('aaa', 'a', 1), ('bbb', 'a', 5), ('old', 'b', 0), ('${good}', 'a', 9), ('${bad}', 'a', 9);`);
// Hộp mã hóa đúng định dạng của providers.ts bằng khóa trong secret.key ("k").
const seal = (key, plain) => { const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", createHash("sha256").update(`synchro-api:${key}`).digest(), iv); const e = Buffer.concat([c.update(plain, "utf8"), c.final()]); return [iv, c.getAuthTag(), e].map((b) => b.toString("base64")).join("."); };
db.exec("CREATE TABLE connectors (id TEXT, enc_auth TEXT)");
db.prepare("INSERT INTO connectors VALUES ('c1', ?)").run(seal("k", "{}"));
db.close();
const env = { ...process.env, OPS_DIR: ops, MIN_FREE_MB: "1", NODE_PATH: path.join(root, "node_modules") };
const backup = (extra = {}) => spawnSync("bash", [path.join(root, "scripts/backup.sh"), app, dest], { env: { ...env, ...extra }, encoding: "utf8", timeout: 120_000 });
let r = backup();
ok(r.status === 0, "chạy xong", r.stderr + r.stdout);
let st = json(path.join(ops, "backup-status.json"));
ok(st?.ok === true && st.integrity === "ok", "báo cáo: bản mới nhất qua kiểm tra toàn vẹn", st);
ok(st?.users === 2 && st.tables >= 2 && st.hasKey === true, "báo cáo: số tài khoản, số bảng, có khóa mã hóa", st);
ok(st?.uploads === 4 && st.missingUploads === 1, "báo cáo: đếm đúng tệp tải lên thiếu trong bản sao", st);
ok(st?.checked === 2 && st.corrupt === 1, "báo cáo: đọc lại tệp theo mã băm, phát hiện tệp hỏng", st);
ok(st?.keyOk === true, "báo cáo: khóa trong bản sao mở được dữ liệu đã mã hóa", st);
ok(st?.offsite === false && Date.now() - st?.lastOkAt < 120_000 && !!st?.snapshot, "báo cáo: chưa đẩy ra ngoài, có mốc thời gian và tên bản", st);
ok(fs.existsSync(path.join(dest, "daily", st?.snapshot ?? "x", "synchro.db")), "bản sao nằm đúng chỗ");
ok(!fs.readdirSync(data).some((f) => f.startsWith(".backup-work")), "không để lại thư mục tạm trong dữ liệu", fs.readdirSync(data));
ok(fs.existsSync(path.join(dest, "daily", st?.snapshot ?? "x", "data")) && !fs.readdirSync(path.join(dest, "daily", st?.snapshot ?? "x", "data")).some((f) => f.startsWith(".backup-work")), "thư mục tạm không vào bản sao");
// Web user bị chiếm không được lợi dụng script chạy bằng root.
const envFile = path.join(app, ".env.production"), hadEnv = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : null;
fs.writeFileSync(envFile, `DATA_DIR=${path.join(dest, "daily", st?.snapshot ?? "x")}\n`);
r = backup();
ok(r.status === 1 && /nằm trong/.test(r.stderr), "DATA_DIR trỏ vào nơi sao lưu: từ chối", r.stderr);
if (hadEnv === null) fs.rmSync(envFile); else fs.writeFileSync(envFile, hadEnv);
const keyPath = path.join(data, "secret.key"), keyBak = fs.readFileSync(keyPath), outside = path.join(tmp, "tep-cua-root");
fs.writeFileSync(outside, "khong-duoc-doc"); fs.rmSync(keyPath); fs.symlinkSync(outside, keyPath);
r = backup();
const stLink = json(path.join(ops, "backup-status.json"));
ok(r.status === 0 && stLink?.hasKey === false && stLink?.keyOk === null, "secret.key là liên kết mềm: không đọc tệp nó trỏ tới", stLink);
// openrsync của macOS không chịu --link-dest có liên kết mềm trùng tên: bỏ bản này để các bước sau không vướng (rsync trên máy chủ thì được).
fs.rmSync(path.join(dest, "daily", stLink?.snapshot ?? "x"), { recursive: true, force: true });
fs.rmSync(keyPath); fs.writeFileSync(keyPath, keyBak);
// Web user bị chiếm (node_modules là của nó): bước chụp SQLite để lại liên kết mềm tới tệp của root, rồi một tệp có liên kết cứng.
{
  const fake = path.join(tmp, "fake-node"), daily = path.join(dest, "daily");
  fs.mkdirSync(fake, { recursive: true });
  const before = fs.readdirSync(daily).sort().join();
  fs.writeFileSync(path.join(fake, "node"), `#!/bin/sh\nln -s "${outside}" "$OUT"\n`, { mode: 0o755 });
  r = backup({ PATH: `${fake}:${process.env.PATH}` });
  const stBad = json(path.join(ops, "backup-status.json"));
  ok(r.status === 1 && /không phải tệp thật/.test(r.stderr) && stBad?.ok === false && /không đáng tin/.test(stBad?.error ?? ""), "bản sao là liên kết mềm: dừng, báo lỗi trên trang sức khỏe", { status: r.status, err: r.stderr, stBad });
  ok(fs.readdirSync(daily).sort().join() === before, "không có bản sao mới nào được công bố");
  ok(fs.readFileSync(outside, "utf8") === "khong-duoc-doc" && !fs.readdirSync(data).some((f) => f.startsWith(".backup-work")), "tệp của root nguyên vẹn, không để lại thư mục tạm");
  fs.writeFileSync(path.join(fake, "node"), `#!/bin/sh\nln "${outside}" "$OUT"\n`, { mode: 0o755 });
  r = backup({ PATH: `${fake}:${process.env.PATH}` });
  ok(r.status === 1 && /không phải tệp thật/.test(r.stderr) && fs.readdirSync(daily).sort().join() === before, "bản sao là liên kết cứng: cũng dừng", { status: r.status, err: r.stderr });
}
const src = fs.readFileSync(path.join(root, "scripts/backup.sh"), "utf8");
ok(!/chown "\$WEB_USER"/.test(src) && !/^[^#]*> "\$WORK\//m.test(src.replace(/as_web sh -c .*/g, "")), "root không ghi, không đổi chủ gì trong thư mục của web user");
ok(/\[ "\$\(owner_of "\$DATA"\)" = "\$WEB_USER" \]/.test(src) && !/WEB_USER="\$\(stat/.test(src), "web user không suy ra từ chủ thư mục, thư mục phải thuộc web user");
db = new D(path.join(data, "synchro.db"));
db.prepare("UPDATE connectors SET enc_auth = ?").run(seal("khoa-khac", "{}"));
db.close();
r = backup();
st = json(path.join(ops, "backup-status.json"));
ok(r.status === 0 && st?.keyOk === false, "khóa không khớp dữ liệu: báo ngay, không đợi tới lúc khôi phục", st);
db = new D(path.join(data, "synchro.db"));
db.prepare("DELETE FROM connectors").run();
db.close();
const hook = path.join(tmp, "hook.sh");
fs.writeFileSync(hook, "#!/bin/sh\necho \"$1\" > \"$HOOK_OUT\"\nexit 1\n"); fs.chmodSync(hook, 0o755);
r = backup({ SYNCHRO_BACKUP_HOOK: hook, HOOK_OUT: path.join(tmp, "hook.out") });
st = json(path.join(ops, "backup-status.json"));
ok(r.status === 0 && st?.ok === true && st.offsite === true && st.offsiteOk === false, "lệnh đẩy ra ngoài lỗi: bản cục bộ vẫn tốt, trang sức khỏe biết", st);
ok(fs.readFileSync(path.join(tmp, "hook.out"), "utf8").includes("/daily/"), "lệnh đẩy nhận đường dẫn bản vừa tạo");
const lastOk = st.lastOkAt;
r = backup({ MIN_FREE_MB: "999999999" });
st = json(path.join(ops, "backup-status.json"));
ok(r.status === 2 && st?.ok === false && /trống/.test(st.error) && st.lastOkAt === lastOk, "đĩa đầy: báo lỗi, giữ mốc bản tốt gần nhất", st);
fs.rmSync(path.join(data, "synchro.db"));
r = backup();
st = json(path.join(ops, "backup-status.json"));
ok(r.status === 1 && st?.ok === false && /cơ sở dữ liệu/.test(st.error), "mất cơ sở dữ liệu: báo lỗi", st);

console.log("2. Watchdog");
const wd = path.join(tmp, "wd"); fs.mkdirSync(wd);
let mode = "ok";
const srv = http.createServer((_, res) => {
  if (mode === "ok") { res.writeHead(200); res.end('{"ok":true,"db":true}'); }
  else if (mode === "degraded") { res.writeHead(503); res.end('{"ok":false,"db":true,"disk":false}'); }
  else if (mode === "dbdown") { res.writeHead(503); res.end('{"ok":false,"db":false}'); }
  else { res.writeHead(502); res.end("bad gateway"); }
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${srv.address().port}/api/health`, marker = path.join(tmp, "restarted");
const tick = (extra = {}) => new Promise((done) => {
  const { spawn } = R("node:child_process");
  const c = spawn("bash", [path.join(root, "scripts/watchdog.sh")], { env: { ...process.env, OPS_DIR: wd, WATCHDOG_URL: url, WATCHDOG_RESTART_CMD: `echo x >> ${marker}`, DEPLOY_LOCK: path.join(tmp, "no-lock"), ...extra }, stdio: "ignore" });
  c.on("close", done);
});
const restarts = () => { try { return fs.readFileSync(marker, "utf8").trim().split("\n").length; } catch { return 0; } };
const state = () => json(path.join(wd, "watchdog-state.json"));
const events = () => { try { return fs.readFileSync(path.join(wd, "watchdog.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).event); } catch { return []; } };
await tick();
ok(state()?.status === "ok" && state().fails === 0 && Date.now() - state().at < 60_000, "web khỏe: ghi trạng thái", state());
mode = "degraded"; for (let i = 0; i < 4; i++) await tick();
ok(restarts() === 0 && state().status === "degraded" && events().includes("degraded"), "503 vì đĩa hay workspace: không khởi động lại, có ghi lại", [state(), events()]);
mode = "bad"; await tick(); await tick();
ok(restarts() === 0 && state().fails === 2 && events().includes("down"), "lỗi 2 lần: chưa khởi động lại", [state(), events()]);
await tick();
ok(restarts() === 1 && state().status === "restarted" && events().includes("restart") && state().restarts24 === 1, "lỗi 3 lần liên tiếp: khởi động lại, ghi lại", [state(), events()]);
await tick(); await tick(); await tick();
ok(restarts() === 1, "chưa đủ 10 phút: không khởi động lại liên tục", restarts());
mode = "dbdown"; await tick({ WATCHDOG_GAP_SEC: "0" });
ok(restarts() === 2, "không ghi được cơ sở dữ liệu cũng tính là lỗi", [restarts(), state()]);
const alertFile = path.join(tmp, "alert.out");
for (let i = 0; i < 12; i++) await tick({ WATCHDOG_GAP_SEC: "0", WATCHDOG_ALERT_CMD: `echo a >> ${alertFile}` });
ok(fs.existsSync(alertFile) && fs.readFileSync(alertFile, "utf8").trim().split("\n").length === 1, "bỏ cuộc: chạy lệnh báo động đúng một lần, không phụ thuộc web", fs.existsSync(alertFile) ? fs.readFileSync(alertFile, "utf8") : "không có");
ok(restarts() === 3 && state().status === "gave_up" && events().includes("gave_up"), "tối đa 3 lần mỗi giờ rồi dừng, ghi lại để người xử lý", [restarts(), state()]);
mode = "ok"; await tick();
ok(state()?.status === "ok", "web khỏe lại", state());
srv.close();

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? "✗" : "✓"} ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
