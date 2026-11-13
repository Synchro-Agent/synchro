// Hàng chờ chạy code có vị trí (Blueprint G3.2 / G5.3, W23-4): dịch vụ workspace thật (workspace/agent.mjs) với lệnh docker giả, chỉ 1 chỗ chạy.
// Lần chạy phải xếp hàng nhận lại vị trí trong kết quả (queue.pos, ghi chú cuối err); chờ quá giờ thì lời báo bận nói rõ vị trí. Không cần Docker hay Next.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-ws-queue-")));
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
const agent = spawn(process.execPath, ["workspace/agent.mjs"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WS_AGENT_PORT: String(port), WS_AGENT_SECRET: SECRET, WS_ROOT: path.join(tmp, "root"), WS_RUN_GATEWAY: "127.0.0.1", WS_RUN_PROXY_PORT: String(proxyPort), WS_RUN_MAX: "1", WS_RUN_WAIT_SEC: "2", SYNCHRO_WARM_POOL: "0" } });
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
const U = "user-12345678", V = "user-87654321";
const bash = (u, s) => ({ u, argv: ["bash", "-c", s], timeout: 60 });

console.log("1. Phải xếp hàng: kết quả trả vị trí lúc vào hàng, ghi chú nói vị trí");
{
  const a = call(bash(U, "sleep 1; echo a"));
  await sleep(300);
  const b = await call(bash(V, "echo b"));
  const ra = await a;
  ok(ra.status === 200 && ra.j.code === 0 && !ra.j.queue, "lần đầu chạy ngay, không có queue", JSON.stringify(ra.j).slice(0, 300));
  ok(b.status === 200 && b.j.code === 0 && b.j.queue?.pos === 1 && b.j.queue.waitedSec >= 0, "lần sau: queue.pos = 1", JSON.stringify(b.j).slice(0, 300));
  ok(/vị trí 1/.test(b.j.err ?? ""), "ghi chú cuối kết quả nói vị trí 1", b.j.err);
}

console.log("2. Chờ quá giờ (WS_RUN_WAIT_SEC=2): báo bận kèm vị trí, không phải 503 trơn");
{
  const a = call(bash(U, "sleep 4; echo a"));
  await sleep(300);
  const b = await call(bash(V, "echo b"));
  ok(b.status === 503 && /vị trí 1 trong hàng chờ/.test(b.j.error ?? ""), "503 sau khi chờ, lời báo có vị trí 1", JSON.stringify(b.j));
  await a;
}

console.log("3. W23-1: lần dựng video không giữ chỗ chạy chung (WS_RUN_MAX=1 vẫn chạy được code khác ngay)");
{
  const m = call(bash(U, "echo synchro-video render x >/dev/null; sleep 1.5; echo m"));
  await sleep(300);
  const t0 = Date.now();
  const b = await call(bash(V, "echo b"));
  ok(b.status === 200 && b.j.code === 0 && !b.j.queue && Date.now() - t0 < 1200, "run_code của người khác chạy ngay trong lúc đang dựng video", JSON.stringify(b.j).slice(0, 300));
  const rm = await m;
  ok(rm.status === 200 && rm.j.code === 0 && /m/.test(rm.j.out ?? ""), "lần dựng video vẫn xong", JSON.stringify(rm.j).slice(0, 300));
}

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
