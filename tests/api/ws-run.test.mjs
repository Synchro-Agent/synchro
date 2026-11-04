// Dịch vụ workspace thật (workspace/agent.mjs) với lệnh docker giả (chạy lệnh ngay trên máy này), không cần máy chủ Next:
// nút Dừng dừng hẳn container và nhả thư mục giữ lại, tệp của lần chạy trước đọc lại được ở .last_outputs/, tính lại công thức chỉ chạy sau lần thành công.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-ws-run-")));
const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.on("error", no); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });

// docker giả: "run" chạy lệnh sau "timeout -k 5 N" trong thư mục gắn -v, ghi pid theo tên để "rm -f" giết được; "rm -f" ghi lại đã xóa container nào.
const bin = path.join(tmp, "bin"), state = path.join(tmp, "state");
fs.mkdirSync(bin); fs.mkdirSync(state);
fs.writeFileSync(path.join(bin, "docker"), `#!/usr/bin/env node
const { spawn } = require("node:child_process"), fs = require("node:fs");
const a = process.argv.slice(2), st = ${JSON.stringify(state)};
if (a[0] === "rm") {
  const nm = a[a.length - 1], f = st + "/" + nm;
  if (fs.existsSync(f)) { fs.appendFileSync(st + "/killed", nm + "\\n"); try { process.kill(-Number(fs.readFileSync(f, "utf8")), "SIGKILL"); } catch {} }
  process.exit(0);
}
if (a[0] !== "run") process.exit(0);
const v = a[a.indexOf("-v") + 1].split(":")[0], name = a[a.indexOf("--name") + 1], t = a.indexOf("timeout");
const cmd = a.slice(t + 4);
fs.appendFileSync(st + "/runs", JSON.stringify({ name, cmd }) + "\\n");
const p = spawn(cmd[0], cmd.slice(1), { cwd: v, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { PATH: process.env.PATH } });
fs.writeFileSync(st + "/" + name, String(p.pid));
p.stdout.pipe(process.stdout); p.stderr.pipe(process.stderr);
p.on("close", (c, sig) => { try { fs.rmSync(st + "/" + name); } catch {} process.exit(sig ? 137 : c ?? 1); });
`, { mode: 0o755 });

// Dịch vụ thật thêm luật iptables khi chạy bằng root: không chạy bộ này với root (máy CI, VPS).
if (process.getuid?.() === 0) { console.log("  (bỏ qua: không chạy bằng root)"); process.exit(0); }
const port = await freePort(), proxyPort = await freePort();
const SECRET = "x".repeat(40);
const agent = spawn(process.execPath, ["workspace/agent.mjs"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WS_AGENT_PORT: String(port), WS_AGENT_SECRET: SECRET, WS_ROOT: path.join(tmp, "root"), WS_RUN_GATEWAY: "127.0.0.1", WS_RUN_PROXY_PORT: String(proxyPort) } });
let log = ""; agent.stdout.on("data", (c) => { log += c; }); agent.stderr.on("data", (c) => { log += c; });
process.on("exit", () => { agent.kill("SIGKILL"); fs.rmSync(tmp, { recursive: true, force: true }); });
for (let i = 0; i < 50; i++) { await sleep(100); if (/nghe tại/.test(log)) break; }
if (!/nghe tại/.test(log)) { console.log("  (bỏ qua: dịch vụ workspace không khởi động được trên máy này)", log.slice(-300)); process.exit(0); }

// Giống app/workspace.ts: mỗi yêu cầu một kết nối, ngắt kết nối nghĩa là người dùng đã bấm Dừng.
const call = (body, signal) => new Promise((res, rej) => {
  const data = JSON.stringify(body);
  const req = http.request({ host: "127.0.0.1", port, path: "/run", method: "POST", agent: false, signal, headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (r) => {
    const ch = []; r.on("data", (c) => ch.push(c)); r.on("end", () => res({ status: r.statusCode, j: JSON.parse(Buffer.concat(ch).toString() || "{}") }));
  });
  req.on("error", rej); req.end(data);
});
const U = "user-12345678", KEEP = "conv1", dir = path.join(tmp, "root", "_keep", U, KEEP);
const bash = (s, o = {}) => ({ u: U, argv: ["bash", "-c", s], keep: KEEP, timeout: 60, ...o });
const names = (r) => (r.j.files ?? []).map((f) => f.path).sort();

console.log("1. Tệp của lần chạy trước đọc lại được");
let r = await call(bash("echo mot > outputs/a.txt; mkdir -p outputs/sub; echo hai > outputs/sub/b.txt"));
ok(r.j.code === 0 && names(r).join() === "a.txt,sub/b.txt", "lần 1 gửi tệp", JSON.stringify(r.j).slice(0, 300));
ok(!fs.existsSync(path.join(dir, "outputs")) && fs.readFileSync(path.join(dir, ".last_outputs/a.txt"), "utf8") === "mot\n", "hết lần chạy: outputs/ được dọn, tệp nằm ở .last_outputs/");
r = await call(bash("cat .last_outputs/a.txt; ls outputs | wc -l; mkdir -p outputs/_preview; echo khung > outputs/_preview/f.png"));
ok(/^mot\n\s*0\n/.test(r.j.out) && names(r).join() === "_preview/f.png", "lần 2 đọc được tệp lần 1, outputs/ không gửi lại tệp cũ", JSON.stringify(r.j).slice(0, 300));
ok(fs.existsSync(path.join(dir, ".last_outputs/a.txt")) && fs.existsSync(path.join(dir, ".last_outputs/_preview/f.png")), "lần chỉ có ảnh xem: giữ nguyên sản phẩm, kiểm tra được nhiều lần");
r = await call(bash("true"));
ok(fs.existsSync(path.join(dir, ".last_outputs/a.txt")), "lần không ghi gì: giữ nguyên bản trước");
r = await call(bash("echo moi > outputs/c.txt"));
ok(fs.existsSync(path.join(dir, ".last_outputs/c.txt")) && !fs.existsSync(path.join(dir, ".last_outputs/a.txt")), "lần có sản phẩm mới: thay toàn bộ");
r = await call(bash("echo do-dang > outputs/video.mp4; exit 3"));
ok(r.j.code === 3 && fs.readFileSync(path.join(dir, ".last_outputs/video.mp4"), "utf8") === "do-dang\n", "lần chạy lỗi: tệp dở vẫn ở .last_outputs/", JSON.stringify(r.j).slice(0, 200));
// outputs là liên kết tượng trưng trỏ ra ngoài (code trong sandbox có thể tạo): dịch vụ chạy bằng root, không được đi theo.
const outside = path.join(tmp, "ngoai"); fs.mkdirSync(path.join(outside, "_preview"), { recursive: true }); fs.writeFileSync(path.join(outside, "_preview", "bi-mat"), "x");
r = await call(bash(`rm -rf outputs; ln -s ${outside} outputs`));
ok(fs.existsSync(path.join(outside, "_preview", "bi-mat")) && fs.lstatSync(path.join(dir, "outputs"), { throwIfNoEntry: false }) === undefined, "outputs là liên kết tượng trưng: không đụng tới thư mục ngoài", JSON.stringify(r.j).slice(0, 200));

console.log("2. Nút Dừng");
const ac = new AbortController();
const t0 = Date.now();
const p = call(bash(`echo do-dang > outputs/video.mp4; sleep 60; echo xong > ${path.join(tmp, "khong-duoc-chay")}`), ac.signal).catch((e) => e);
await sleep(1500);
const pid = fs.readdirSync(state).find((f) => f.startsWith("srun-"));
ok(!!pid, "đang chạy trong container");
ac.abort();
await p;
for (let i = 0; i < 60 && fs.readdirSync(state).some((f) => f.startsWith("srun-")); i++) await sleep(100);
ok(!fs.readdirSync(state).some((f) => f.startsWith("srun-")), "ngắt kết nối thì lệnh trong container dừng ngay", fs.readdirSync(state).join());
ok(fs.readFileSync(path.join(state, "killed"), "utf8").includes(pid), "container bị xóa bằng docker rm -f");
ok(Date.now() - t0 < 15000, "không phải chờ hết giờ", Date.now() - t0);
const t1 = Date.now();
r = await call(bash("cat .last_outputs/video.mp4"));
ok(r.j.code === 0 && /do-dang/.test(r.j.out) && Date.now() - t1 < 8000, "lần chạy sau trong cùng đoạn chat không bị kẹt, tệp dở còn đọc được", JSON.stringify(r.j).slice(0, 200));
// Bấm Dừng lúc còn đang chờ lần chạy trước trong cùng thư mục: không chạy nữa.
const first = call(bash("sleep 3"));
await sleep(300);
const ac2 = new AbortController(), marker = path.join(tmp, "lan-doi");
const waiting = call(bash(`touch ${marker}`), ac2.signal).catch((e) => e);
await sleep(300); ac2.abort(); await waiting; await first; await sleep(300);
ok(!fs.existsSync(marker), "dừng lúc đang chờ lượt: lệnh không chạy");

console.log("3. Tính lại công thức Excel");
const runs = () => fs.readFileSync(path.join(state, "runs"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const recalcRuns = () => runs().filter((x) => x.cmd.some((c) => c.includes("xlsx_recalc")));
r = await call(bash("echo x > outputs/a.xlsx; exit 1", { recalc: true }));
ok(recalcRuns().length === 0 && !r.j.recalc, "lần chạy lỗi: không tính lại");
r = await call(bash("echo x > outputs/a.txt", { recalc: true }));
ok(recalcRuns().length === 0, "không có sổ tính: không bật LibreOffice");
r = await call(bash("echo x > outputs/a.xlsx"));
ok(recalcRuns().length === 0, "không yêu cầu (skill, artifact): không tính lại");
r = await call(bash("mkdir -p outputs/s; echo x > outputs/s/a.xlsx", { recalc: true }));
ok(recalcRuns().length === 1 && recalcRuns()[0].cmd.join(" ") === "python3 /opt/synchro/xlsx_recalc.py outputs", "sổ tính sau lần thành công: tính lại trong container riêng", JSON.stringify(recalcRuns()));
ok(typeof r.j.recalc?.error === "string", "bước tính lại lỗi (image cũ chưa có công cụ): báo về, không làm hỏng lần chạy", JSON.stringify(r.j).slice(0, 300));
ok(r.j.code === 0 && names(r).join() === "s/a.xlsx", "tệp vẫn được gửi về", JSON.stringify(names(r)));

console.log("4. Log dài và tệp không gửi được");
r = await call(bash(`for i in $(seq 1 6000); do echo "status line $i ------------------------------------------------------------------"; done; echo "RuntimeError: moov atom not found" >&2; for i in $(seq 1 6000); do echo "frame $i ------------------------------------------------------------------" >&2; done; echo "loi that o cuoi" >&2`));
ok(r.j.out.startsWith("status line 1 ") && /status line 6000 /.test(r.j.out) && /Đã bỏ \d+ KB ở giữa/.test(r.j.out), "stdout dài: giữ đầu và cuối", r.j.out.length);
ok(r.j.err.includes("loi that o cuoi") && r.j.err.length < 45_000, "stderr dài: lỗi cuối còn nguyên", r.j.err.length);
r = await call(bash("for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22; do echo x > outputs/t$i.txt; done"));
ok(r.j.files.length === 20 && r.j.skipped?.length === 2 && r.j.skipped.every((s) => /quá 20 tệp/.test(s)), "quá số tệp: báo riêng từng tệp bị bỏ", JSON.stringify(r.j.skipped));
r = await call(bash("mkdir -p outputs/_preview; for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo x > outputs/_preview/f$i.png; done"));
ok(names(r).length === 12 && !r.j.skipped, "đủ 12 ảnh tự xem như quy tắc nói với model", JSON.stringify(r.j.skipped));

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
