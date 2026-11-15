// Diễn tập khôi phục đầu cuối theo đúng các bước ở docs/van-hanh.md: tạo dữ liệu bằng mã thật, sao lưu bằng ops/backup.sh, chép ra thư mục mới như máy mới,
// rồi mở bằng mã thật trong một tiến trình mới: tài khoản đăng nhập được, đoạn chat còn, token mã hóa giải được, tệp tải lên còn nguyên. Tự chạy được, không cần dev:mock.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const root = process.cwd();
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-restore-")));
const app = path.join(tmp, "app"), data = path.join(app, "data"), dest = path.join(tmp, "backups"), ops = path.join(tmp, "ops");
fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(path.join(app, ".cache", "files"), { recursive: true });
process.env.DATA_DIR = data; delete process.env.DATA_KEY;
const { authstore: AS, chatstore: CS, providers: PR } = await loadTs(["authstore", "chatstore", "providers"]);
const u = AS.createUser({ email: "restore@synchro.test", name: "R", verified: true, passwordHash: "hash-giu-nguyen" });
CS.pushItems(u.id, [{ kind: "chat", id: "1", upd: Date.now(), data: JSON.stringify({ id: 1, title: "Đoạn chat cần giữ", msgs: [] }) }]);
const sealed = PR.sealSecret("token-bi-mat");
AS.db().exec("CREATE TABLE IF NOT EXISTS connectors_drill (b TEXT)");
AS.db().prepare("INSERT INTO connectors_drill VALUES (?)").run(sealed);
AS.db().pragma("wal_checkpoint(TRUNCATE)");
const body = Buffer.from("noi dung tep tai len"), id = crypto.createHash("sha1").update(body).digest("hex");
fs.writeFileSync(path.join(app, ".cache", "files", `${id}.bin`), body);

const r = spawnSync("bash", [path.join(root, "ops/backup.sh"), app, dest], { env: { ...process.env, OPS_DIR: ops, MIN_FREE_MB: "1", NODE_PATH: path.join(root, "node_modules") }, encoding: "utf8", timeout: 120_000 });
ok(r.status === 0, "sao lưu chạy xong", r.stderr + r.stdout);
const st = JSON.parse(fs.readFileSync(path.join(ops, "backup-status.json"), "utf8"));
const B = path.join(dest, "daily", st.snapshot);

// Các bước trong "Khôi phục" của docs/van-hanh.md, trên một thư mục mới hoàn toàn.
const fresh = path.join(tmp, "may-moi"), fdata = path.join(fresh, "data");
fs.mkdirSync(fresh, { recursive: true });
fs.cpSync(path.join(B, "data"), fdata, { recursive: true });
fs.copyFileSync(path.join(B, "synchro.db"), path.join(fdata, "synchro.db"));
for (const f of ["synchro.db-wal", "synchro.db-shm"]) fs.rmSync(path.join(fdata, f), { force: true });
fs.mkdirSync(path.join(fresh, ".cache"), { recursive: true });
fs.cpSync(path.join(B, "uploads"), path.join(fresh, ".cache", "files"), { recursive: true });
ok(fs.readFileSync(path.join(fresh, ".cache", "files", `${id}.bin`)).equals(body), "tệp tải lên còn nguyên");

// Tiến trình mới, không có gì trong bộ nhớ: như máy chủ vừa khởi động trên bản đã khôi phục.
const check = path.join(tmp, "check.mjs");
fs.writeFileSync(check, `
import { loadTs } from ${JSON.stringify(path.join(root, "tests/lib/ts.mjs"))};
const { authstore: AS, chatstore: CS, providers: PR } = await loadTs(["authstore", "chatstore", "providers"]);
const u = AS.db().prepare("SELECT id, email, password_hash AS h FROM users WHERE email = ?").get("restore@synchro.test");
const page = await CS.changesSince(u.id, 0);
const b = AS.db().prepare("SELECT b FROM connectors_drill").get().b;
console.log(JSON.stringify({ email: u.email, h: u.h, chat: JSON.parse(page.items[0].data).title, secret: PR.openSecret(b) }));
`);
const out = execFileSync(process.execPath, [check], { cwd: root, env: { ...process.env, DATA_DIR: fdata }, encoding: "utf8" }).trim().split("\n").at(-1);
const j = JSON.parse(out);
ok(j.email === "restore@synchro.test" && j.h === "hash-giu-nguyen", "tài khoản và mật khẩu băm còn nguyên", j);
ok(j.chat === "Đoạn chat cần giữ", "đoạn chat còn nguyên", j);
ok(j.secret === "token-bi-mat", "khóa trong bản sao mở được dữ liệu đã mã hóa", j);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
