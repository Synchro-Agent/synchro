// scripts/cli-contract.mjs chạy trọn trên CLI giả lập: bảng đủ dòng, CLI chưa đăng nhập thì skip, không lộ mã cầu nối hay token, không để lại tệp tạm, thoát sạch. Chỉ kiểm phần
// khung của script (chấm ở phía máy chủ, cách ly dữ liệu): hành vi của CLI thật chỉ biết khi chạy script này trên máy chủ. Tự chạy được, không cần dev:mock.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 1500)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-contract-test-"));
const HOME = path.join(tmp, "engine"), BIN = path.join(HOME, ".local", "bin"), SCOPE = "user_contract";
fs.mkdirSync(BIN, { recursive: true });
for (const f of fs.readdirSync("scripts/mock-cli")) { fs.copyFileSync(path.join("scripts/mock-cli", f), path.join(BIN, f)); fs.chmodSync(path.join(BIN, f), 0o755); }
fs.writeFileSync(path.join(BIN, "mock-cli.json"), JSON.stringify({ base: "http://127.0.0.1:9" }));
const login = (cli, rel) => { const f = path.join(HOME, "logins", cli, SCOPE, rel); fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); fs.writeFileSync(f, "{}"); };
login("claude", ".mock-login"); login("grok", ".grok/auth.json"); login("codex", "auth.json");
// agy không đăng nhập: phải là skip.

const run = (...args) => spawnSync(process.execPath, ["scripts/cli-contract.mjs", ...args], { encoding: "utf8", timeout: 240_000, env: { ...process.env, CONTRACT_MOCK: "1", DATA_DIR: path.join(tmp, "data"), SYNCHRO_ENGINE_HOME: HOME, DATA_KEY: "contract-test", SYNCHRO_ENGINE_USER: "" } });
try {
  console.log("1. Cách dùng");
  const u = run();
  ok(u.status === 2 && /Usage/.test(u.stderr), "thiếu tài khoản: báo cách dùng, mã 2", u.stderr);

  console.log("2. Chạy trọn trên CLI giả lập");
  const cacheBefore = fs.readdirSync("node_modules/.cache").filter((d) => d.startsWith("synchro-ts-")).length;
  const r = run(SCOPE, "--slow-min=0.02", "--hold-min=0.02");
  const all = r.stdout + r.stderr;
  ok(!r.signal, "không treo", r.signal);

  for (const c of ["tools listed", "nested args", "$ref args", "resume keeps context", "tools after resume", "names over 50 chars", "long hold", "approval hold"]) {
    const v = c === "$ref args" ? (r.stdout.split("\n").find((l) => l.startsWith("$ref args")) ?? "").replace("$ref args", "").trim().split(/\s+/) : (r.stdout.split("\n").find((l) => l.startsWith(c)) ?? "").slice(c.length).trim().split(/\s+/);
    // Thứ tự cột: claude codex agy grok.
    ok(v[0] === "pass" && v[1] === "pass" && v[2] === "skip" && v[3] === "pass", `${c}: chạy được trên 3 CLI đã đăng nhập, agy chưa đăng nhập thì skip`, `${v.join(" ")}\n${r.stdout}`);
  }

  ok(/^warm process\s+pass/.test(r.stdout.split("\n").find((l) => l.startsWith("warm process")) ?? ""), "Claude dùng trúng tiến trình khởi động sẵn", r.stdout);
  ok(r.status === 0, "không có fail: mã thoát 0", `${r.status}\n${r.stdout}\n${r.stderr}`);
  ok(!/\/api\/mcp\/bridge\/[\w-]{10,}/.test(all) && !/sk-ant/.test(all) && !all.includes("contract-test"), "không lộ mã cầu nối, token, khóa dữ liệu", all);
  ok(fs.readdirSync("node_modules/.cache").filter((d) => d.startsWith("synchro-ts-")).length === cacheBefore, "không để lại bản dịch tạm");
  ok(!fs.existsSync(path.join(tmp, "data", "synchro.db")), "không mở cơ sở dữ liệu thật");

  ok(/^real image\s+skip\s+skip\s+skip\s+skip/m.test(r.stdout), "mặc định không tạo ảnh thật (tốn hạn mức)", r.stdout);

  console.log("3. Bỏ bài chờ lâu, chọn CLI");
  const q = run(SCOPE, "--quick", "--only=grok");
  ok(q.status === 0 && /^long hold\s+skip/m.test(q.stdout) && /--quick/.test(q.stdout) && !/claude\s/.test(q.stdout.split("\n")[2] ?? ""), "--quick --only chỉ chạy đúng phần được chọn", q.stdout);

  console.log("4. --image: mỗi CLI đã đăng nhập tạo một ảnh thật");
  const im = run(SCOPE, "--quick", "--image", "--only=grok,codex");
  ok(im.status === 0 && /^real image\s+pass\s+pass/m.test(im.stdout) && /image\/png/.test(im.stdout), "ảnh ra đúng tệp, bảng ghi loại ảnh và dung lượng", `${im.stdout}\n${im.stderr}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
