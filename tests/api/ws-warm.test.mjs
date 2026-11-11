// Kho container khởi động sẵn của dịch vụ workspace (workspace/agent.mjs + warmpool.mjs) với lệnh docker giả, không cần Docker thật:
// docker giả mô phỏng thời gian bật container (FAKE_BOOT_MS) để đo lần chạy lạnh và lần chạy dùng container trong kho. Kiểm tra: mỗi container
// chỉ dùng một lần rồi xóa và được bù; lần chạy không mạng thì ngắt mạng trước; tệp giữ lại vẫn đúng chỗ; nút Dừng; image đổi thì bỏ kho;
// thiếu bộ nhớ thì không bù; tắt dịch vụ thì xóa kho; dịch vụ chết giữa lần chạy thì lần khởi động sau trả tệp về thư mục giữ lại.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-ws-warm-")));
const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.on("error", no); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
if (process.getuid?.() === 0) { console.log("  (bỏ qua: không chạy bằng root)"); process.exit(0); }
const BOOT = 900;

// docker giả: run -d (container rảnh chạy sleep), run -i (lần chạy lạnh), exec (lần chạy trong container rảnh), network disconnect, rm -f, image inspect, ps.
const bin = path.join(tmp, "bin"), state = path.join(tmp, "state");
fs.mkdirSync(bin); fs.mkdirSync(state);
fs.writeFileSync(path.join(state, "image"), "sha256:aaa");
fs.writeFileSync(path.join(bin, "docker"), `#!/usr/bin/env node
const { spawn } = require("node:child_process"), fs = require("node:fs");
const a = process.argv.slice(2), st = process.env.FAKE_STATE || ${JSON.stringify(state)}, boot = Number(process.env.FAKE_BOOT_MS || 0);
const log = (f, o) => fs.appendFileSync(st + "/" + f, JSON.stringify(o) + "\\n");
const cfile = (n) => st + "/c-" + n + ".json";
const killPid = (f) => { if (fs.existsSync(f)) { try { process.kill(-Number(fs.readFileSync(f, "utf8")), "SIGKILL"); } catch {} try { fs.rmSync(f); } catch {} } };
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
if (a[0] === "image") { process.stdout.write(fs.readFileSync(st + "/image", "utf8") + "\\n"); process.exit(0); }
if (a[0] === "ps") { process.stdout.write(fs.readdirSync(st).filter((f) => f.startsWith("c-")).map((f) => f.slice(2, -5)).join("\\n")); process.exit(0); }
if (a[0] === "network" && a[1] === "disconnect") { const nm = a[a.length - 1]; log("disconnects", nm); if (!fs.existsSync(cfile(nm))) process.exit(1); const c = JSON.parse(fs.readFileSync(cfile(nm), "utf8")); c.net = false; fs.writeFileSync(cfile(nm), JSON.stringify(c)); process.exit(0); }
if (a[0] === "rm") {
  const nm = a[a.length - 1];
  if (fs.existsSync(cfile(nm)) || fs.existsSync(st + "/" + nm) || fs.existsSync(st + "/x-" + nm)) log("killed", nm);
  killPid(st + "/" + nm); killPid(st + "/x-" + nm); try { fs.rmSync(cfile(nm)); } catch {}
  process.exit(0);
}
const runCmd = (name, cmd, cwd, pidf) => {
  const p = spawn(cmd[0], cmd.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { PATH: process.env.PATH } });
  fs.writeFileSync(pidf, String(p.pid));
  p.stdout.pipe(process.stdout); p.stderr.pipe(process.stderr);
  p.on("close", (c, sig) => { try { fs.rmSync(pidf); } catch {} process.exit(sig ? 137 : c ?? 1); });
};
if (a[0] === "exec") {
  const t = a.indexOf("timeout"), name = a[t - 1], cmd = a.slice(t + 4);
  if (!fs.existsSync(cfile(name))) { process.stderr.write("Error response from daemon: No such container: " + name + "\\n"); process.exit(1); }
  const c = JSON.parse(fs.readFileSync(cfile(name), "utf8"));
  const envs = []; for (let i = 0; i < t; i++) if (a[i] === "-e") envs.push(a[i + 1].split("=")[0]);
  log("runs", { name, cmd, mode: "exec", net: c.net, image: c.image, proxy: envs.includes("HTTPS_PROXY") });
  runCmd(name, cmd, c.dir, st + "/x-" + name);
} else if (a[0] === "run") {
  const v = a[a.indexOf("-v") + 1].split(":")[0], name = a[a.indexOf("--name") + 1];
  wait(boot);
  if (a.includes("-d")) {
    const p = spawn("sleep", ["100000"], { detached: true, stdio: "ignore" }); p.unref();
    fs.writeFileSync(st + "/" + name, String(p.pid));
    fs.writeFileSync(cfile(name), JSON.stringify({ dir: v, net: a.includes("--network"), image: fs.readFileSync(st + "/image", "utf8") }));
    log("created", name);
    process.stdout.write("id-" + name + "\\n"); process.exit(0);
  }
  const t = a.indexOf("timeout"), cmd = a.slice(t + 4);
  log("runs", { name, cmd, mode: "cold" });
  runCmd(name, cmd, v, st + "/" + name);
} else process.exit(0);
`, { mode: 0o755 });

const SECRET = "x".repeat(40);
const agents = [];
process.on("exit", () => {
  for (const g of agents) g.kill("SIGKILL");
  for (const st of [state, path.join(tmp, "state-cold"), path.join(tmp, "state-low")]) for (const f of fs.existsSync(st) ? fs.readdirSync(st) : []) if (/^(srun-|swarm-|x-)/.test(f)) { try { process.kill(-Number(fs.readFileSync(path.join(st, f), "utf8")), "SIGKILL"); } catch {} }
  fs.rmSync(tmp, { recursive: true, force: true });
});
// Mỗi dịch vụ một "máy Docker" riêng (thư mục trạng thái riêng): dịch vụ khởi động dọn mọi container chạy code của máy đó.
async function startAgent(extra = {}, root = path.join(tmp, "root")) {
  if (extra.FAKE_STATE) { fs.mkdirSync(extra.FAKE_STATE, { recursive: true }); fs.writeFileSync(path.join(extra.FAKE_STATE, "image"), "sha256:aaa"); }
  const port = await freePort(), proxyPort = await freePort();
  const g = spawn(process.execPath, ["workspace/agent.mjs"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_BOOT_MS: String(BOOT), WS_AGENT_PORT: String(port), WS_AGENT_SECRET: SECRET, WS_ROOT: root, WS_RUN_GATEWAY: "127.0.0.1", WS_RUN_PROXY_PORT: String(proxyPort), WS_WARM_MIN_MB: "1", ...extra } });
  agents.push(g);
  const o = { g, port, log: "" };
  g.stdout.on("data", (c) => { o.log += c; }); g.stderr.on("data", (c) => { o.log += c; });
  for (let i = 0; i < 80; i++) { await sleep(100); if (/nghe tại/.test(o.log)) break; }
  return /nghe tại/.test(o.log) ? o : null;
}
const req = (o, p, body, signal) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : "";
  const r = http.request({ host: "127.0.0.1", port: o.port, path: p, method: body || p === "/warm/refresh" ? "POST" : "GET", agent: false, signal, headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (x) => {
    const ch = []; x.on("data", (c) => ch.push(c)); x.on("end", () => res({ status: x.statusCode, j: JSON.parse(Buffer.concat(ch).toString() || "{}") }));
  });
  r.on("error", rej); r.end(data);
});
const health = async (o) => (await req(o, "/health")).j;
const waitIdle = async (o, n, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await health(o)).warm?.idle === n) return true; await sleep(100); } return false; };
const lines = (f, st = state) => (fs.existsSync(path.join(st, f)) ? fs.readFileSync(path.join(st, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const U = "user-12345678", KEEP = "conv1";
const bash = (s, o = {}) => ({ u: U, argv: ["bash", "-c", s], keep: KEEP, timeout: 60, net: false, ...o });

const A = await startAgent();
if (!A) { console.log("  (bỏ qua: dịch vụ workspace không khởi động được trên máy này)"); process.exit(0); }
const dir = path.join(tmp, "root", "_keep", U, KEEP);

console.log("1. Kho đầy sẵn, mỗi container dùng một lần");
ok(await waitIdle(A, 2), "khởi động xong: 2 container rảnh (mặc định)", JSON.stringify(await health(A)));
let r = await req(A, "/run", bash("echo mot > outputs/a.txt; echo giu > ghi-nho.txt; pwd"));
const run1 = lines("runs").at(-1);
ok(r.j.code === 0 && run1.mode === "exec" && run1.name.startsWith("swarm-"), "lần chạy dùng container trong kho (docker exec)", JSON.stringify({ r: r.j, run1 }));
ok(lines("disconnects").includes(run1.name) && run1.net === false && !run1.proxy, "lần chạy không mạng: ngắt mạng của container trước khi chạy", JSON.stringify(run1));
ok((r.j.files ?? []).map((f) => f.path).join() === "a.txt" && fs.readFileSync(path.join(dir, ".last_outputs/a.txt"), "utf8") === "mot\n", "tệp gửi về và chuyển sang .last_outputs/ của thư mục giữ lại như trước");
ok(fs.readFileSync(path.join(dir, "ghi-nho.txt"), "utf8") === "giu\n", "tệp khác trong thư mục làm việc trở về đúng chỗ");
ok(lines("killed").includes(run1.name), "chạy xong: container bị xóa (không trả lại kho)");
ok(await waitIdle(A, 2), "kho tự bù lại 2 container");
r = await req(A, "/run", bash("cat ghi-nho.txt; cat .last_outputs/a.txt", { net: true }));
const run2 = lines("runs").at(-1);
ok(r.j.code === 0 && /giu\nmot/.test(r.j.out), "lần sau đọc được tệp của lần trước", JSON.stringify(r.j));
ok(run2.mode === "exec" && run2.name !== run1.name && run2.net === true && run2.proxy && !lines("disconnects").includes(run2.name), "lần chạy có mạng: giữ mạng và IP của container, thêm proxy", JSON.stringify(run2));
const names = new Set(lines("runs").map((x) => x.name));
ok(names.size === lines("runs").length, "không container nào chạy hai lần");

console.log("2. Thời gian bắt đầu chạy (docker giả mô phỏng " + BOOT + " ms bật container)");
const timeRuns = async (o, n) => { const ts = []; for (let i = 0; i < n; i++) { await waitIdle(o, o.cold ? 0 : 2, 8000); const t0 = Date.now(); await req(o, "/run", bash("true")); ts.push(Date.now() - t0); } return ts.sort((a, b) => a - b)[Math.floor(n / 2)]; };
const warmMs = await timeRuns(A, 3);
const coldState = path.join(tmp, "state-cold");
const C = await startAgent({ SYNCHRO_WARM_POOL: "0", FAKE_STATE: coldState }, path.join(tmp, "root-cold"));
C.cold = true;
ok((await health(C)).warm?.size === 0, "SYNCHRO_WARM_POOL=0: tắt kho");
const coldMs = await timeRuns(C, 3);
console.log(`     lạnh: ${coldMs} ms · kho: ${warmMs} ms (trung vị 3 lần, gồm cả HTTP và chuyển thư mục)`);
ok(warmMs + BOOT * 0.7 < coldMs, `dùng kho nhanh hơn khoảng thời gian bật container (${coldMs - warmMs} ms)`, `${coldMs} ${warmMs}`);
ok(lines("runs", coldState).filter((x) => x.mode === "cold").length >= 3 && !lines("created", coldState).length, "kho tắt: chạy theo cách thường, không bật container rảnh nào");

console.log("3. Nút Dừng khi chạy trong container của kho");
await waitIdle(A, 2);
const ac = new AbortController(), t0 = Date.now();
const p = req(A, "/run", bash("echo do-dang > outputs/v.mp4; sleep 60"), ac.signal).catch((e) => e);
const nRuns = lines("runs").length;
for (let i = 0; i < 50 && lines("runs").length === nRuns; i++) await sleep(100);
await sleep(300);
const running = lines("runs").at(-1);
ok(running.mode === "exec" && fs.existsSync(path.join(state, "x-" + running.name)), "đang chạy bằng exec", JSON.stringify(running) + A.log.slice(-1500));
ac.abort(); await p;
for (let i = 0; i < 60 && fs.existsSync(path.join(state, "x-" + running.name)); i++) await sleep(100);
ok(!fs.existsSync(path.join(state, "x-" + running.name)) && lines("killed").includes(running.name) && Date.now() - t0 < 10_000, "dừng ngay: container bị xóa");
await sleep(300);
ok(fs.readFileSync(path.join(dir, ".last_outputs/v.mp4"), "utf8") === "do-dang\n" && fs.existsSync(path.join(dir, "ghi-nho.txt")), "tệp dở và tệp cũ về lại thư mục giữ lại");

console.log("4. Image đổi, thiếu bộ nhớ, container mất");
await waitIdle(A, 2);
const before = fs.readdirSync(state).filter((f) => f.startsWith("c-swarm-"));
fs.writeFileSync(path.join(state, "image"), "sha256:bbb");
await req(A, "/warm/refresh");
await waitIdle(A, 2);
const after = fs.readdirSync(state).filter((f) => f.startsWith("c-swarm-"));
ok(before.every((f) => !after.includes(f)) && after.every((f) => JSON.parse(fs.readFileSync(path.join(state, f), "utf8")).image === "sha256:bbb"), "image build lại: bỏ cả kho, dựng lại bằng image mới", JSON.stringify({ before, after }));
// Container trong kho bị xóa từ bên ngoài (Docker khởi động lại): lần chạy vẫn chạy được theo cách thường.
for (const f of after) fs.rmSync(path.join(state, f));
r = await req(A, "/run", bash("echo van-chay"));
ok(r.j.code === 0 && /van-chay/.test(r.j.out) && lines("runs").at(-1).mode === "cold", "container trong kho đã mất: chạy theo cách thường, không lỗi", JSON.stringify(r.j));
ok(fs.existsSync(path.join(dir, "ghi-nho.txt")), "tệp giữ lại vẫn còn sau khi chuyển sang cách thường");
const L = await startAgent({ WS_WARM_MIN_MB: "99999999", FAKE_STATE: path.join(tmp, "state-low") }, path.join(tmp, "root-low"));
await sleep(1500);
const hl = await health(L);
ok(hl.warm.idle === 0 && hl.warm.lowMem >= 1, "bộ nhớ khả dụng dưới ngưỡng: không bù kho", JSON.stringify(hl.warm));
r = await req(L, "/run", bash("echo ok"));
ok(r.j.code === 0 && /ok/.test(r.j.out), "thiếu bộ nhớ: vẫn chạy theo cách thường");

console.log("5. Tắt dịch vụ và khởi động lại");
await waitIdle(A, 2);
const idleNow = fs.readdirSync(state).filter((f) => f.startsWith("c-swarm-")).map((f) => f.slice(2, -5));
A.g.kill("SIGTERM");
for (let i = 0; i < 100 && A.g.exitCode === null; i++) await sleep(100);
const killed = lines("killed");
ok(idleNow.length === 2 && idleNow.every((n) => killed.includes(n)), "tắt dịch vụ: xóa mọi container rảnh trong kho", JSON.stringify({ idleNow, exit: A.g.exitCode }));
// Dịch vụ chết giữa lần chạy (tệp đang nằm trong thư mục của container kho): lần khởi động sau trả về thư mục giữ lại.
const lost = path.join(tmp, "root", "_runs", "warm-dead1");
fs.mkdirSync(path.join(lost, "outputs"), { recursive: true });
fs.writeFileSync(path.join(lost, "du-an.txt"), "quan-trong");
const keep2 = path.join(tmp, "root", "_keep", U, "conv2");
fs.writeFileSync(lost + ".origin", keep2);
fs.writeFileSync(path.join(tmp, "root", "_runs", "warm-evil.origin"), "/etc");
fs.mkdirSync(path.join(tmp, "root", "_runs", "warm-evil"), { recursive: true });
const B = await startAgent();
ok(!!B && fs.readFileSync(path.join(keep2, "du-an.txt"), "utf8") === "quan-trong", "khởi động lại: tệp của lần chạy dở trở về thư mục giữ lại", B?.log.slice(-300));
ok(!fs.existsSync(path.join(tmp, "root", "_runs", "warm-dead1")), "thư mục tạm của kho được dọn");
ok(B && /trả thư mục giữ lại về chỗ cũ/.test(B.log) && !/\/etc/.test(B.log.split("\n").filter((l) => /trả thư mục/.test(l)).join("")), "chỉ trả về trong _keep (không ghi ra chỗ khác)");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
