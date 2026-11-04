// Dịch vụ workspace của Synchro Code (chạy bằng root trên VPS, chỉ nghe ở 127.0.0.1).
// - Mỗi người dùng một container Docker (image synchro-ws) với thư mục /home/user/work lưu trên máy chủ.
// - API HTTP cho máy chủ Next (khóa WS_AGENT_SECRET): bật container, chạy lệnh, điều khiển trình duyệt.
// - WebSocket cho trình duyệt của người dùng (vé ký HMAC do Next cấp): terminal (PTY) và màn hình trình duyệt.
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { BrowserError, createBrowser, devJson } from "./browser-core.mjs";
import { createRelay } from "./ext-relay.mjs";
import { clipSink, collectOutputs, createRunQueue, QueueFull, safeWrite } from "./safefs.mjs";

const env = (k, d) => process.env[k] ?? d;
const PORT = Number(env("WS_AGENT_PORT", 3555));
const HOST = env("WS_AGENT_HOST", "127.0.0.1");
const SECRET = env("WS_AGENT_SECRET", "");
const IMAGE = env("WS_IMAGE", "synchro-ws:1");
const ROOT = env("WS_ROOT", "/srv/synchro-ws");
const NET = env("WS_NETWORK", "synchro-ws");
const BRIDGE = "br-synchro";
const SUBNET = env("WS_SUBNET", "172.30.0.0/16");
// Chạy code cho chat (mỗi lần một container mới, xóa ngay sau khi chạy): mạng riêng không ra được internet,
// chỉ tới được proxy của dịch vụ này ở cổng RUN_PROXY_PORT. Proxy cho đi tới các kho thư viện (PKG_HOSTS); lần chạy được phép ra
// mọi trang web công khai (Cài đặt → Khả năng) được nhận ra theo IP cố định của container (Chromium không gửi được mật khẩu proxy
// ghi trong URL, nên không dùng mã trong Proxy-Authorization). Địa chỉ nội bộ luôn bị chặn.
const RUN_NET = env("WS_RUN_NETWORK", "synchro-run");
const RUN_BRIDGE = "br-synchro-run";
const RUN_SUBNET = env("WS_RUN_SUBNET", "172.29.0.0/24");
const RUN_GW = env("WS_RUN_GATEWAY", "172.29.0.1");
const RUN_PROXY_PORT = Number(env("WS_RUN_PROXY_PORT", 3556));
const RUN_MAX = Number(env("WS_RUN_MAX", 3));
// Dựng video / chuyển tài liệu bằng LibreOffice / Chromium cần nhiều bộ nhớ hơn một script phân tích dữ liệu.
const RUN_MEMORY = env("WS_RUN_MEMORY", "2g");
// Tệp code ghi vào outputs/ được gửi về: tối đa 20 tệp, mỗi tệp 100 MB, tổng 150 MB (đủ cho video MP4 vài phút).
// RUN_PREVIEWS: giữ bằng PREVIEW_MAX trong app/runpreview.ts (quy tắc hứa với model tối đa bằng đó ảnh tự xem).
const RUN_FILES = 20, RUN_PREVIEWS = 12, RUN_FILE_MB = 100, RUN_TOTAL_MB = 150;
// Hết chỗ chạy thì xếp hàng (có giới hạn) thay vì báo lỗi ngay: một chỗ luôn dành cho lần chạy ngắn, người đang chạy ít nhất được chọn trước.
const RUN_QUEUE = Number(env("WS_RUN_QUEUE", 20)), RUN_QUEUE_USER = Number(env("WS_RUN_QUEUE_USER", 4)), RUN_WAIT_SEC = Number(env("WS_RUN_WAIT_SEC", 240));
// Bảo vệ đĩa: một lần chạy không dùng quá RUN_DISK_MB (cả thư mục làm việc lẫn lớp ghi của container); dưới MIN_FREE_MB trống thì không
// nhận việc mới và dừng việc tốn đĩa nhất, để SQLite và nhật ký của mọi người không chết vì đầy đĩa.
const RUN_DISK_MB = Number(env("WS_RUN_DISK_MB", 6000)), MIN_FREE_MB = Number(env("WS_MIN_FREE_MB", 3000));
// Tắt dịch vụ (cập nhật code): chờ các lần chạy đang dở xong tối đa bao lâu.
const DRAIN_SEC = Number(env("WS_DRAIN_SEC", 300));
// Thư mục làm việc giữ nguyên giữa các lần chạy trong cùng một đoạn chat (tệp tải về, khung hình, dự án dựng dở…): xóa sau 24 giờ
// không dùng, mỗi tài khoản tối đa 3 GB (vượt thì xóa thư mục cũ nhất).
const KEEP_MS = 24 * 3_600_000, KEEP_MB = 3000;
// Giữ giống PKG_DOMAINS trong app/catalog.ts.
const PKG_HOSTS = ["pypi.org", "files.pythonhosted.org", "pythonhosted.org", "registry.npmjs.org", "npmjs.org", "npmjs.com", "registry.yarnpkg.com", "yarnpkg.com",
  "crates.io", "index.crates.io", "static.crates.io", "proxy.golang.org", "sum.golang.org", "conda.anaconda.org", "repo.anaconda.com",
  "github.com", "codeload.github.com", "objects.githubusercontent.com", "deb.debian.org", "security.debian.org", "archive.ubuntu.com", "security.ubuntu.com",
  "speech.platform.bing.com", "translate.google.com"];
const MAX_RUNNING = Number(env("WS_MAX_RUNNING", 4));
const IDLE_MS = Number(env("WS_IDLE_MIN", 20)) * 60_000;
const MEMORY = env("WS_MEMORY", "1536m");
// Mọi CPU của máy (đọc lúc dịch vụ khởi động, nâng VPS xong là tự dùng thêm): trình duyệt của Synchro vẽ / chụp khung 2x tốn ~90 ms CPU
// mỗi khung nên càng nhiều CPU càng cuộn mượt (đo trên VPS 2 CPU: 1 CPU 10, 2 CPU 18–21 khung / giây). Ưu tiên thấp (cpu-shares 256):
// khi tranh CPU, máy chủ web, ffmpeg nén hình và các dịch vụ khác chạy trước, container chỉ dùng phần còn rảnh.
const CPUS = env("WS_CPUS", String(Math.max(1, os.availableParallelism?.() ?? os.cpus().length)));
const CPU_SHARES = env("WS_CPU_SHARES", "256");
const DISK_MB = Number(env("WS_DISK_MB", 5000));
const SOCK = "/var/run/docker.sock";
const HOME = "/home/user", WORK = HOME + "/work", UID = "1500";
if (SECRET.length < 32) { console.error("Thiếu WS_AGENT_SECRET (tối thiểu 32 ký tự)"); process.exit(1); }

const okUser = (u) => typeof u === "string" && /^[A-Za-z0-9-]{8,64}$/.test(u);
const okDir = (d) => typeof d === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(d);
const cname = (u) => "sws-" + u;
class E extends Error { constructor(status, m) { super(m); this.status = status; } }
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ------------------------------------------------------------------ tiện ích tiến trình / Docker
// clip: lần chạy của người dùng giữ đầu và cuối log thay vì dừng gom ở max: lỗi thật của một lần dựng dài nằm ở cuối.
function run(cmd, args, { input, timeout = 60_000, max = 2_000_000, clip = false } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [], err = [], so = clipSink(), se = clipSink();
    let n = 0, truncated = false, killed = false;
    const take = (arr, sink) => (c) => { if (clip) return sink.push(c); if (n >= max) { truncated = true; return; } arr.push(c); n += c.length; };
    p.stdout.on("data", take(out, so));
    p.stderr.on("data", take(err, se));
    const t = setTimeout(() => { killed = true; p.kill("SIGKILL"); }, timeout);
    p.on("error", (e) => { clearTimeout(t); resolve({ code: 127, out: "", err: String(e), truncated }); });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: killed ? 124 : code ?? 1, out: clip ? so.text() : Buffer.concat(out).toString("utf8"), err: clip ? se.text() : Buffer.concat(err).toString("utf8"), truncated });
    });
    p.stdin.on("error", () => {});
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ socketPath: SOCK, method, path, headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {} }, (res) => {
      const ch = [];
      res.on("data", (c) => ch.push(c));
      res.on("end", () => {
        const t = Buffer.concat(ch).toString();
        let j = null;
        try { j = t ? JSON.parse(t) : null; } catch {}
        if (res.statusCode >= 300) reject(new E(res.statusCode, j?.message || t || `docker ${res.statusCode}`));
        else resolve(j);
      });
    });
    req.on("error", reject);
    req.end(data ?? undefined);
  });
}

// Gắn trực tiếp vào luồng vào/ra của một exec (PTY) qua kết nối "hijack" của Docker API.
function hijack(path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ socketPath: SOCK, method: "POST", path, headers: { "Content-Type": "application/json", "Content-Length": data.length, Connection: "Upgrade", Upgrade: "tcp" } });
    req.on("upgrade", (_res, sock, head) => { if (head?.length) sock.unshift(head); resolve(sock); });
    req.on("response", (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => reject(new Error(t || "Không mở được terminal"))); });
    req.on("error", reject);
    req.end(data);
  });
}

async function inspect(name) {
  try { return await api("GET", `/containers/${name}/json`); } catch (e) { if (e.status === 404) return null; throw e; }
}

// ------------------------------------------------------------------ mạng cô lập cho container
async function ipt(args) { return (await run("iptables", args, { timeout: 10_000 })).code === 0; }
async function rule(chain, spec, pos = 1) { if (!(await ipt(["-C", chain, ...spec]))) await ipt(["-I", chain, String(pos), ...spec]); }
async function setupHost() {
  if (!(await run("docker", ["network", "inspect", NET])).code) { /* đã có */ }
  else {
    const r = await run("docker", ["network", "create", "--driver", "bridge", "--subnet", SUBNET,
      "-o", `com.docker.network.bridge.name=${BRIDGE}`, "-o", "com.docker.network.bridge.enable_icc=false", NET]);
    if (r.code) log("Không tạo được mạng", r.err);
  }
  // Container ra được internet (npm, pip, git…) nhưng không vào được máy chủ, mạng nội bộ hay container khác.
  for (const net of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10"]) await rule("DOCKER-USER", ["-i", BRIDGE, "-d", net, "-j", "DROP"]);
  await rule("DOCKER-USER", ["-i", BRIDGE, "-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "RETURN"]);
  await rule("INPUT", ["-i", BRIDGE, "-j", "DROP"]);
  await rule("INPUT", ["-i", BRIDGE, "-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "ACCEPT"]);
  // Mạng chạy code: không chuyển tiếp gói nào ra ngoài; vào máy chủ chỉ được tới cổng proxy.
  if ((await run("docker", ["network", "inspect", RUN_NET])).code) {
    const r = await run("docker", ["network", "create", "--driver", "bridge", "--subnet", RUN_SUBNET, "--gateway", RUN_GW,
      "-o", `com.docker.network.bridge.name=${RUN_BRIDGE}`, "-o", "com.docker.network.bridge.enable_icc=false", RUN_NET]);
    if (r.code) log("Không tạo được mạng chạy code", r.err);
  }
  await rule("DOCKER-USER", ["-i", RUN_BRIDGE, "-j", "DROP"]);
  await rule("INPUT", ["-i", RUN_BRIDGE, "-j", "DROP"]);
  await rule("INPUT", ["-i", RUN_BRIDGE, "-p", "tcp", "--dport", String(RUN_PROXY_PORT), "-j", "ACCEPT"]);
  if ((await run("docker", ["image", "inspect", IMAGE])).code) log(`Chưa có image ${IMAGE}: chạy workspace/setup.sh để build.`);
}

// ------------------------------------------------------------------ vòng đời container
const live = new Map(); // uid -> { last, socks, ip, dirs:Set, cdp }
const st = (u) => { let s = live.get(u); if (!s) { s = { last: Date.now(), socks: 0, ip: "", dirs: new Set(), cdp: null }; live.set(u, s); } return s; };
const touch = (u) => { st(u).last = Date.now(); };

async function runningIds() {
  const list = await api("GET", `/containers/json?filters=${encodeURIComponent(JSON.stringify({ label: ["synchro.ws"], status: ["running"] }))}`);
  return list.map((c) => c.Labels["synchro.ws"]).filter(okUser);
}

// Giới hạn số container chạy cùng lúc: dừng container rảnh lâu nhất để nhường chỗ.
async function makeRoom(u) {
  const ids = (await runningIds()).filter((x) => x !== u);
  if (ids.length < MAX_RUNNING) return;
  const free = ids.filter((x) => !(live.get(x)?.socks > 0)).sort((a, b) => (live.get(a)?.last ?? 0) - (live.get(b)?.last ?? 0));
  if (!free.length) throw new E(503, "Máy chủ đang bận (đã đủ số workspace chạy cùng lúc). Hãy thử lại sau ít phút.");
  await stop(free[0]);
}

async function duMB(p) {
  const r = await run("du", ["-sm", p], { timeout: 15_000 });
  return Number(r.out.split(/\s/)[0]) || 0;
}
const usageMB = (u) => duMB(`${ROOT}/${u}`);
// Phần code ghi vào chính container (ngoài thư mục gắn từ máy chủ: pip install, /tmp…) cũng nằm trên đĩa của máy chủ.
const layerMB = (name) => api("GET", `/containers/${name}/json?size=1`).then((c) => Math.round((c?.SizeRw ?? 0) / 1048576), () => 0);
const freeMB = () => { try { const v = fs.statfsSync(ROOT); return Math.round((v.bavail * v.bsize) / 1048576); } catch { return Infinity; } };
const diskGuard = () => { if (freeMB() < MIN_FREE_MB) throw new E(507, "Máy chủ sắp hết dung lượng đĩa nên tạm không nhận việc mới. Hãy thử lại sau."); };
// Hạn mức cứng: quá DISK_MB vẫn bật được để người dùng dọn (nếu không thì không có cách nào xóa bớt); quá HARD_MB thì dịch vụ tự dừng container.
const HARD_MB = Math.round(DISK_MB * 1.2);
const QUOTA_GRACE_MS = 5 * 60_000;
const quotaNote = (u) => (live.get(u)?.over ? `\n[Workspace đang vượt hạn mức ${DISK_MB} MB và sẽ bị dừng. Hãy xóa bớt tệp (node_modules, build…).]` : "");

const starting = new Map();
async function ensure(u) {
  if (!okUser(u)) throw new E(400, "Tài khoản không hợp lệ");
  if (starting.has(u)) return starting.get(u);
  const p = (async () => {
    const name = cname(u);
    let c = await inspect(name);
    if (!c || !c.State.Running) {
      await makeRoom(u);
      const dir = `${ROOT}/${u}`;
      fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
      fs.chownSync(dir, Number(UID), Number(UID));
      diskGuard();
      // Vượt xa hạn mức cứng (cố tình lấp đĩa): không bật lại, quản trị viên xử lý.
      if ((await usageMB(u)) > HARD_MB * 1.25) throw new E(507, `Workspace đã vượt xa hạn mức ${DISK_MB} MB nên không bật được. Hãy liên hệ quản trị viên để dọn bớt.`);
      st(u).started = Date.now();
      // Image đã được build lại (cập nhật công cụ): tạo lại container, thư mục work vẫn giữ nguyên.
      if (c) {
        const img = await api("GET", `/images/${encodeURIComponent(IMAGE)}/json`).catch(() => null);
        if (img && img.Id !== c.Image) { await run("docker", ["rm", "-f", name], { timeout: 30_000 }); c = null; }
      }
      if (!c) {
        const r = await run("docker", ["run", "-d", "--name", name, "--hostname", "workspace", "--init",
          "--network", NET, "--memory", MEMORY, "--memory-swap", MEMORY, "--cpus", CPUS, "--cpu-shares", CPU_SHARES, "--pids-limit", "512",
          "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--shm-size", "256m",
          "--label", `synchro.ws=${u}`, "-v", `${dir}:${WORK}`, IMAGE]);
        if (r.code) throw new E(500, "Không tạo được workspace: " + r.err.trim().slice(0, 300));
        log("tạo workspace", u);
      } else {
        await api("POST", `/containers/${name}/start`);
        log("bật workspace", u);
      }
      c = await inspect(name);
      B.reset(u);
    }
    // Container tạo từ bản trước (giới hạn CPU cũ): cập nhật tại chỗ, không cần tạo lại.
    const nano = Math.round(Number(CPUS) * 1e9);
    if (c.HostConfig && (c.HostConfig.NanoCpus !== nano || c.HostConfig.CpuShares !== Number(CPU_SHARES))) {
      const r = await run("docker", ["update", "--cpus", CPUS, "--cpu-shares", CPU_SHARES, name], { timeout: 30_000 });
      if (r.code) log("không cập nhật được giới hạn CPU", u, r.err.trim().slice(0, 200)); else { log("cập nhật giới hạn CPU", u); c = await inspect(name); }
    }
    const s = st(u);
    s.ip = c.NetworkSettings.Networks[NET]?.IPAddress ?? "";
    touch(u);
    return s;
  })();
  starting.set(u, p);
  try { return await p; } finally { starting.delete(u); }
}

async function stop(u) {
  const s = live.get(u);
  B.reset(u);
  if (s) s.dirs.clear();
  await run("docker", ["stop", "-t", "3", cname(u)], { timeout: 30_000 });
  log("dừng workspace", u);
}

async function destroy(u) {
  await stop(u).catch(() => {});
  await run("docker", ["rm", "-f", cname(u)], { timeout: 30_000 });
  // Lần chạy code đang dở của người này và thư mục giữ lại giữa các lần chạy (xóa tài khoản phải xóa cả chúng).
  const runs = await run("docker", ["ps", "-aq", "--filter", `label=synchro.run=${u}`], { timeout: 15_000 });
  for (const id of runs.out.split("\n").filter(Boolean)) await run("docker", ["rm", "-f", id], { timeout: 20_000 });
  fs.rmSync(`${ROOT}/${u}`, { recursive: true, force: true });
  fs.rmSync(keepRoot(u), { recursive: true, force: true });
  live.delete(u);
  log("xóa workspace", u);
}

// Container rảnh quá lâu (không terminal, không lệnh) thì dừng; file vẫn còn trên máy chủ.
setInterval(async () => {
  try {
    for (const u of await runningIds()) {
      const s = live.get(u);
      if (!s) { st(u); continue; }
      if (s.socks <= 0 && Date.now() - s.last > IDLE_MS) await stop(u);
    }
    await quotaSweep();
  } catch (e) { log("sweep", e.message); }
}, 60_000);

// Hạn mức đĩa theo từng phút: lệnh dd trong workspace chạy suốt, kiểm tra lúc bật container là không đủ.
let keepSwept = 0;
async function quotaSweep() {
  const sizes = [];
  for (const u of await runningIds()) {
    const mb = (await usageMB(u)) + (await layerMB(cname(u))), s = st(u);
    sizes.push({ u, mb });
    s.over = mb > DISK_MB;
    if (mb > HARD_MB * 1.25 || (mb > HARD_MB && Date.now() - (s.started ?? 0) > QUOTA_GRACE_MS)) { log("workspace vượt hạn mức đĩa, dừng", u, `${mb} MB`); await stop(u); }
  }
  const free = freeMB();
  if (free < MIN_FREE_MB) {
    log(`đĩa còn ${free} MB trống`);
    const big = sizes.filter((x) => x.mb > 500).sort((a, b) => b.mb - a.mb)[0];
    if (big) { log("đĩa sắp đầy, dừng workspace tốn đĩa nhất", big.u, `${big.mb} MB`); await stop(big.u); }
  }
  // Thư mục giữ lại của người không chạy gì nữa: sweepKeep chỉ gọi khi chính họ chạy tiếp nên có thể nằm mãi.
  if (Date.now() - keepSwept > 3600_000) {
    keepSwept = Date.now();
    for (const u of fs.existsSync(`${ROOT}/_keep`) ? fs.readdirSync(`${ROOT}/_keep`) : []) {
      if (!okUser(u)) continue;
      try { sweepKeep(u); if (!fs.readdirSync(keepRoot(u)).length) fs.rmdirSync(keepRoot(u)); } catch {}
    }
  }
}

async function dirOf(u, d) {
  if (!okDir(d)) throw new E(400, "Thư mục phiên không hợp lệ");
  const s = await ensure(u);
  if (!s.dirs.has(d)) {
    const r = await run("docker", ["exec", "-u", UID, cname(u), "mkdir", "-p", `${WORK}/${d}`, `${HOME}/.synchro`]);
    if (r.code) throw new E(500, r.err.trim() || "Không tạo được thư mục phiên");
    s.dirs.add(d);
  }
  return `${WORK}/${d}`;
}

// Chạy lệnh (không tương tác) trong thư mục của phiên. Lệnh bị dừng khi quá `timeout` giây.
async function exec(u, { d, cmd, argv, timeout = 120, stdin, env: ev = {} }) {
  const cwd = await dirOf(u, d);
  const sec = Math.max(1, Math.min(Number(timeout) || 120, 900));
  const envArgs = Object.entries(ev).filter(([k]) => /^[A-Z_][A-Z0-9_]*$/.test(k)).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  // Lệnh rất dài (model ghi cả tệp lớn bằng heredoc): một tham số dòng lệnh không được quá 128 KB (spawn E2BIG), nên đưa lệnh vào
  // bash qua stdin (bash -ls) khi lệnh đó không cần stdin riêng.
  const viaStdin = !Array.isArray(argv) && stdin == null && Buffer.byteLength(String(cmd ?? ""), "utf8") > 100_000;
  const tail = Array.isArray(argv) ? argv.map(String) : viaStdin ? ["bash", "-ls"] : ["bash", "-lc", String(cmd ?? "")];
  const input = viaStdin ? String(cmd) : stdin;
  const args = ["exec", ...(input != null ? ["-i"] : []), "-u", UID, "-w", cwd, "-e", `HOME=${HOME}`, ...envArgs, cname(u), "timeout", "-k", "5", String(sec), ...tail];
  touch(u);
  const r = await run("docker", args, { input, timeout: (sec + 15) * 1000 });
  touch(u);
  return { ...r, err: r.err + quotaNote(u) };
}

// ------------------------------------------------------------------ chạy code một lần (chat)
const runDir = (id) => `${ROOT}/_runs/${id}`;
const runQ = createRunQueue({ max: RUN_MAX, queue: RUN_QUEUE, perUser: RUN_QUEUE_USER, waitMs: RUN_WAIT_SEC * 1000 });
const safeRel = (p) => typeof p === "string" && p.length > 0 && p.length < 300 && !p.startsWith("/") && !p.split(/[\\/]/).some((x) => x === ".." || x === "");

const keepRoot = (u) => `${ROOT}/_keep/${u}`;
const okKeep = (k) => typeof k === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(k);
// Lần chạy đang dùng thư mục giữ lại: chạy lần lượt trong cùng một đoạn chat để hai lần chạy không ghi đè tệp của nhau.
const keepBusy = new Map();
// IP cố định cho container có mạng (trong RUN_SUBNET), và các IP đang được ra mọi trang web công khai (chỉ trong lúc chạy).
const usedIps = new Set(), webIps = new Set();
const pickIp = () => { const pre = RUN_GW.replace(/\.\d+$/, "."); for (let i = 10; i < 250; i++) { const ip = pre + i; if (!usedIps.has(ip)) { usedIps.add(ip); return ip; } } return null; };
function sweepKeep(u) {
  const root = keepRoot(u);
  if (!fs.existsSync(root)) return;
  const dirs = fs.readdirSync(root).map((n) => { const p = `${root}/${n}`; try { return { p, at: fs.statSync(p).mtimeMs }; } catch { return null; } }).filter(Boolean).sort((a, b) => a.at - b.at);
  for (const d of dirs) if (Date.now() - d.at > KEEP_MS && !keepBusy.has(d.p)) fs.rmSync(d.p, { recursive: true, force: true });
  return dirs.filter((d) => fs.existsSync(d.p));
}
// Hết lần chạy, tệp trong outputs/ chuyển sang .last_outputs/ để lần sau đọc, kiểm tra được (ffprobe, soffice…) mà không phải dựng lại, và tệp dở của
// lần chạy lỗi / quá giờ / bị dừng không mất. Lần chạy không ghi gì thì giữ nguyên bản trước; lần chỉ có _preview/ (chỉ để kiểm tra) thì giữ nguyên sản phẩm,
// chỉ thay ảnh xem. Container đã bị xóa khi gọi hàm này; lstat trước khi ghi vào: .last_outputs do code trong sandbox tạo, có thể là liên kết tượng trưng.
function rotateOutputs(dir) {
  const out = `${dir}/outputs`, last = `${dir}/.last_outputs`;
  try {
    // Code trong sandbox có thể thay outputs bằng liên kết tượng trưng trỏ ra ngoài: dịch vụ chạy bằng root, không đi theo (khối finally xóa liên kết).
    const isDir = fs.lstatSync(out, { throwIfNoEntry: false })?.isDirectory() === true;
    const names = isDir ? fs.readdirSync(out) : [];
    if (names.some((n) => n !== "_preview")) { fs.rmSync(last, { recursive: true, force: true }); fs.renameSync(out, last); return; }
    if (names.length) {
      if (fs.lstatSync(last, { throwIfNoEntry: false })?.isDirectory() !== true) { fs.rmSync(last, { recursive: true, force: true }); fs.mkdirSync(last); }
      fs.rmSync(`${last}/_preview`, { recursive: true, force: true });
      fs.renameSync(`${out}/_preview`, `${last}/_preview`);
    }
  } catch (e) { log("không chuyển được outputs", e.message); } finally { fs.rmSync(out, { recursive: true, force: true }); }
}
// Có sổ tính trong outputs/ không (bước tính lại công thức chỉ chạy khi có), bỏ thư mục _preview/.
const hasBook = (d, depth = 0) => depth <= 3 && fs.lstatSync(d, { throwIfNoEntry: false })?.isDirectory() === true && fs.readdirSync(d, { withFileTypes: true }).some((e) =>
  e.isDirectory() ? e.name !== "_preview" && hasBook(`${d}/${e.name}`, depth + 1) : e.isFile() && /\.xls[xm]$/i.test(e.name));
async function runOnce(u, { files = [], argv, stdin = null, net: wantNet = false, web = false, timeout = 120, keep = null, recalc = false }, signal) {
  if (!okUser(u)) throw new E(400, "Tài khoản không hợp lệ");
  if (!Array.isArray(argv) || !argv.length || argv.length > 60 || argv.some((a) => typeof a !== "string" || a.length > 4000)) throw new E(400, "Lệnh không hợp lệ");
  if (!Array.isArray(files) || files.length > 6000 || files.some((f) => !safeRel(f?.path) || typeof f.b64 !== "string")) throw new E(400, "Tệp không hợp lệ");
  if (keep != null && !okKeep(keep)) throw new E(400, "Thư mục giữ lại không hợp lệ");
  if (wantNet && !proxyUp) throw new E(503, "Máy chủ chưa bật được mạng cho code (proxy).");
  diskGuard();
  const sec = Math.max(5, Math.min(Number(timeout) || 120, 900));
  const id = crypto.randomBytes(8).toString("hex");
  const dir = keep ? `${keepRoot(u)}/${keep}` : runDir(id), name = "srun-" + id;
  // Chờ lần chạy trước trong cùng thư mục giữ lại xong; người dùng bấm Dừng lúc đang chờ thì thôi, không chạy nữa.
  const stopped = new Promise((ok) => signal?.addEventListener("abort", ok, { once: true }));
  while (keep && keepBusy.has(dir) && !signal?.aborted) await Promise.race([keepBusy.get(dir).catch(() => {}), stopped]);
  if (signal?.aborted) throw new E(499, "Đã dừng");
  let release = () => {};
  if (keep) keepBusy.set(dir, new Promise((ok) => { release = () => { keepBusy.delete(dir); ok(); }; }));
  const queuedAt = Date.now();
  let freeSlot;
  try { freeSlot = await runQ.acquire(u, sec, signal); }
  catch (e) { release(); throw e instanceof QueueFull ? new E(503, e.message) : e; }
  const waited = Math.round((Date.now() - queuedAt) / 1000);
  if (waited >= 2) log("lần chạy chờ", u, `${waited} giây`, `đang chạy ${runQ.running}, đang chờ ${runQ.queued}`);
  const ip = wantNet ? pickIp() : null;
  if (wantNet && !ip) { freeSlot(); release(); throw new E(503, "Máy chủ đang chạy nhiều code cùng lúc. Hãy thử lại sau ít giây."); }
  if (ip && web) webIps.add(ip);
  let watcher = null, overDisk = "";
  try {
    if (keep) {
      // Dọn thư mục lâu không dùng; vượt hạn mức thì xóa thư mục cũ nhất (trừ thư mục của lần chạy này).
      const dirs = sweepKeep(u) ?? [];
      const du = await run("du", ["-sm", keepRoot(u)], { timeout: 15_000 }).catch(() => null);
      let mb = Number(du?.out?.split(/\s/)[0]) || 0;
      for (const d of dirs) { if (mb <= KEEP_MB) break; if (d.p === dir || keepBusy.has(d.p)) continue; const m = await run("du", ["-sm", d.p], { timeout: 15_000 }).catch(() => null); fs.rmSync(d.p, { recursive: true, force: true }); mb -= Number(m?.out?.split(/\s/)[0]) || 0; }
      // outputs/ chỉ chứa tệp của lần chạy này: tệp lần trước đã ở .last_outputs/ (dịch vụ khởi động lại giữa chừng thì chuyển nốt ở đây).
      rotateOutputs(dir);
    }
    fs.mkdirSync(`${dir}/outputs`, { recursive: true, mode: 0o700 });
    // Thư mục giữ lại do code của người dùng ghi: không tin bất kỳ đường dẫn nào trong đó (workspace/safefs.mjs). Không có lần chạy nào
    // đang gắn thư mục này: keepBusy giữ từng đoạn chat một lượt, container cũ của dịch vụ trước bị dọn lúc khởi động.
    for (const f of files) safeWrite(dir, f.path, Buffer.from(f.b64, "base64"));
    await run("chown", ["-hR", `${UID}:${UID}`, dir]);
    fs.utimesSync(dir, new Date(), new Date());
    const proxy = `http://${RUN_GW}:${RUN_PROXY_PORT}`;
    const envs = { HOME: HOME, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", MPLBACKEND: "Agg", PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1",
      PIP_BREAK_SYSTEM_PACKAGES: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1", NPM_CONFIG_PREFIX: `${HOME}/.npm-global`, npm_config_update_notifier: "false",
      PATH: `${HOME}/.local/bin:${HOME}/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
      // SYNCHRO_CHROME_PROXY: Chromium không đọc HTTPS_PROXY; /etc/chromium.d/synchro trong image thêm --proxy-server khi có biến này.
      ...(wantNet ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, NO_PROXY: "localhost,127.0.0.1", no_proxy: "localhost,127.0.0.1", SYNCHRO_CHROME_PROXY: proxy } : {}) };
    // Dùng mọi CPU của máy nhưng ưu tiên thấp (cpu-shares 256): khi tranh CPU, máy chủ web chạy trước. Chromium mở nhiều tiến trình,
    // ffmpeg nhiều luồng: pids 1024, /dev/shm 512 MB.
    const boxArgs = (nm, netArgs, cmdSec, cmd) => ["run", "--rm", "-i", "--name", nm, "--hostname", "sandbox", "--init", ...netArgs,
      "--memory", RUN_MEMORY, "--memory-swap", RUN_MEMORY, "--cpus", CPUS, "--cpu-shares", "256", "--pids-limit", "1024", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--shm-size", "512m", "--label", `synchro.run=${u}`, "-u", UID, "-w", `${HOME}/run`, "-v", `${dir}:${HOME}/run`,
      ...Object.entries(envs).flatMap(([k, v]) => ["-e", `${k}=${v}`]), IMAGE, "timeout", "-k", "5", String(cmdSec), ...cmd];
    // Người dùng bấm Dừng (Next ngắt kết nối): xóa container ngay để nhường chỗ và nhả thư mục giữ lại. Lặp tới khi lệnh docker run kết thúc:
    // lúc container đang khởi động, docker rm chưa tìm thấy tên.
    const inBox = async (nm, a, o) => {
      let over = false;
      const kill = async () => { while (!over) { await run("docker", ["rm", "-f", nm], { timeout: 20_000 }); await new Promise((ok) => setTimeout(ok, 1000)); } };
      if (signal?.aborted) kill(); else signal?.addEventListener("abort", kill, { once: true });
      try { return await run("docker", a, o); } finally { over = true; signal?.removeEventListener("abort", kill); }
    };
    // Canh đĩa trong lúc chạy: dd trong container không bị giới hạn bởi --memory.
    watcher = setInterval(async () => {
      const mb = (await duMB(dir)) + (await layerMB(name)), free = freeMB();
      if (mb <= RUN_DISK_MB && free >= MIN_FREE_MB) return;
      overDisk = `\n[Đã dừng: lần chạy này dùng ${mb} MB đĩa, vượt giới hạn ${RUN_DISK_MB} MB hoặc máy chủ sắp hết đĩa]`;
      log("dừng lần chạy tốn đĩa", u, `${mb} MB`, `còn trống ${free} MB`);
      run("docker", ["rm", "-f", name], { timeout: 20_000 });
    }, 20_000);
    const r = await inBox(name, boxArgs(name, ["--network", wantNet ? RUN_NET : "none", ...(ip ? ["--ip", ip] : [])], sec, argv), { input: stdin ?? "", timeout: (sec + 30) * 1000, clip: true });
    clearInterval(watcher); watcher = null;
    // Đã dừng: không ai chờ kết quả; tệp dở nằm lại ở .last_outputs/ (khối finally).
    if (signal?.aborted) return { code: 130, out: r.out, err: r.err, timedOut: false, files: [] };
    // Chỉ đọc outputs/ khi chắc chắn không còn tiến trình nào của container (client docker có thể đã bị kill trong khi container còn chạy):
    // nếu còn, nó đổi được đường dẫn giữa lúc kiểm tra và lúc đọc.
    const gone = await run("docker", ["rm", "-f", name], { timeout: 20_000 });
    let clean = gone.code === 0 || /No such container/i.test(gone.err);
    // Sổ tính: openpyxl không ghi sẵn giá trị công thức, xlsxwriter ghi 0, nên bản xem trước và Excel ở Protected View thấy ô trống / số 0. Tính lại bằng
    // LibreOffice rồi ghi giá trị vào chính tệp, trong container mới (không mạng, 120 giây); lỗi thì giữ nguyên tệp và báo cho model.
    let book = null;
    if (clean && recalc && r.code === 0 && hasBook(`${dir}/outputs`)) {
      const rc = await inBox(name + "-x", boxArgs(name + "-x", ["--network", "none"], 120, ["python3", "/opt/synchro/xlsx_recalc.py", "outputs"]), { input: "", timeout: 150_000, max: 400_000 });
      if (signal?.aborted) return { code: 130, out: r.out, err: r.err, timedOut: false, files: [] };
      try { book = JSON.parse(rc.out); } catch { book = { error: (rc.err || rc.out || `exit ${rc.code}`).trim().slice(-300) }; }
      // Container tính lại cũng gắn thư mục này: phải dừng hẳn trước khi đọc outputs/.
      const gone2 = await run("docker", ["rm", "-f", name + "-x"], { timeout: 20_000 });
      clean = gone2.code === 0 || /No such container/i.test(gone2.err);
    }
    const got = clean ? collectOutputs(`${dir}/outputs`, { files: RUN_FILES, previews: RUN_PREVIEWS, fileBytes: RUN_FILE_MB * 1048576, totalBytes: RUN_TOTAL_MB * 1048576 }) : { files: [], skipped: ["outputs: không dừng được container"] };
    const timedOut = r.code === 124;
    const note = (waited >= 2 ? `\n[Đã chờ ${waited} giây vì máy chủ đang bận]` : "") + (timedOut ? `\n[Đã dừng: chạy quá ${sec} giây]` : "") + overDisk + (got.skipped.length ? `\n[Không gửi được: ${got.skipped.join("; ")}]` : "");
    return { code: r.code, out: r.out, err: r.err + note, timedOut, files: got.files, ...(book ? { recalc: book } : {}), ...(got.skipped.length ? { skipped: got.skipped } : {}) };
  } finally {
    if (watcher) clearInterval(watcher);
    freeSlot();
    if (ip) { usedIps.delete(ip); webIps.delete(ip); }
    await run("docker", ["rm", "-f", name], { timeout: 20_000 });
    if (keep) { rotateOutputs(dir); release(); }
    else fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Proxy cho code (chỉ nghe trên cổng của mạng chạy code): chỉ CONNECT/HTTP tới kho thư viện, không tới địa chỉ nội bộ.
let proxyUp = false;
const v4Private = (ip) => { const [a, b] = ip.split(".").map(Number); return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224; };
const ipPrivate = (ip) => (net.isIP(ip) === 4 ? v4Private(ip) : /^(::|::1|f[cd]|fe[89ab]|::ffff:)/i.test(ip));
// Lần chạy được ra mọi trang web công khai: nhận ra theo IP nguồn (IP cố định của container, gán bằng --ip).
const webRun = (req) => webIps.has(String(req.socket?.remoteAddress ?? "").replace(/^::ffff:/, ""));
// Dịch vụ nhận tệp / dữ liệu ẩn danh: chặn cả khi được ra mọi trang web, để code không lén đưa dữ liệu của người dùng ra ngoài
// (một model từng tự đưa ảnh chụp sản phẩm lên tmpfiles.org để tự xem).
const DROP_HOSTS = ["tmpfiles.org", "file.io", "transfer.sh", "0x0.st", "catbox.moe", "gofile.io", "pixeldrain.com", "filebin.net", "termbin.com", "paste.rs", "ix.io",
  "sprunge.us", "bashupload.com", "temp.sh", "uguu.se", "tempfile.org", "webhook.site", "requestbin.net", "pipedream.net", "hookbin.com", "beeceptor.com", "oast.fun", "interact.sh"];
async function pkgTarget(host, port, web = false) {
  const h = String(host).toLowerCase().replace(/\.$/, "");
  if (DROP_HOSTS.some((d) => h === d || h.endsWith("." + d))) throw new Error(`blocked: ${h} is a file / data drop service`);
  if (!web && !PKG_HOSTS.some((d) => h === d || h.endsWith("." + d))) throw new Error(`blocked: ${h} is not an allowed package registry or voice service (bật "Mọi trang web công khai" trong Cài đặt → Khả năng để code ra được trang này)`);
  if (port !== 443 && port !== 80) throw new Error(`blocked: port ${port}`);
  const ips = (await lookup(h, { all: true })).map((x) => x.address);
  if (!ips.length || ips.some(ipPrivate)) throw new Error(`blocked: ${h} resolves to a private address`);
  return ips.find((x) => net.isIP(x) === 4) ?? ips[0];
}
function startProxy() {
  const px = http.createServer(async (req, res) => {
    try {
      const t = new URL(req.url);
      const ip = await pkgTarget(t.hostname, Number(t.port || 80), webRun(req));
      const { "proxy-authorization": _, ...headers } = req.headers;
      const up = http.request({ host: ip, port: Number(t.port || 80), path: t.pathname + t.search, method: req.method, headers: { ...headers, host: t.host } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
      up.on("error", () => { res.writeHead(502); res.end(); });
      req.pipe(up);
    } catch (e) { res.writeHead(403, { "content-type": "text/plain" }); res.end(String(e.message ?? e)); }
  });
  px.on("connect", async (req, sock, head) => {
    sock.on("error", () => {});
    const [h, p] = String(req.url ?? "").split(":");
    try {
      const ip = await pkgTarget(h, Number(p || 443), webRun(req));
      const up = net.connect(Number(p || 443), ip, () => { sock.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head?.length) up.write(head); up.pipe(sock); sock.pipe(up); });
      up.on("error", () => sock.destroy());
      sock.on("close", () => up.destroy());
    } catch (e) { sock.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${String(e.message ?? e)}`); }
  });
  px.on("error", (e) => { proxyUp = false; log("proxy", e.message); });
  px.listen(RUN_PROXY_PORT, RUN_GW, () => { proxyUp = true; log(`proxy kho thư viện nghe tại ${RUN_GW}:${RUN_PROXY_PORT}`); });
}
// Dịch vụ khởi động lại giữa chừng: container của lần chạy cũ không còn ai đọc kết quả và vẫn gắn thư mục làm việc: dừng hẳn chúng trước
// (nếu không, chúng đổi được đường dẫn trong thư mục giữ lại đúng lúc dịch vụ mới ghi / đọc), rồi mới xóa thư mục chạy dở.
async function cleanRuns() {
  const r = await run("docker", ["ps", "-aq", "--filter", "label=synchro.run"], { timeout: 20_000 });
  for (const id of r.out.split("\n").filter(Boolean)) await run("docker", ["rm", "-f", id], { timeout: 20_000 });
  fs.rmSync(`${ROOT}/_runs`, { recursive: true, force: true });
}

// ------------------------------------------------------------------ trình duyệt (Chromium trong container, điều khiển qua CDP)
// Phần điều khiển dùng chung với workspace giả lập (workspace/browser-core.mjs); ở đây chỉ lo bật Chromium trong container.
// Cookie và đăng nhập đến khi trình duyệt tắt (Cài đặt → Synchro Code → Trình duyệt): xóa trước mỗi lần bật lại Chromium.
const cookieMode = new Map();
const WIPE_SH = `cd "$HOME/work/.browser/profile/Default" 2>/dev/null && rm -rf Cookies Cookies-journal Network "Local Storage" "Session Storage" IndexedDB "Service Worker" "Login Data" "Login Data-journal" "Web Data" "Web Data-journal"; true`;
const B = createBrowser({
  async up(u) {
    const s = await ensure(u);
    const base = `http://${s.ip}:9223`;
    const alive = await devJson(`${base}/json/version`, "GET", 3000).then(() => true, () => false);
    if (!alive) {
      if (cookieMode.get(u) === "until-stop") await run("docker", ["exec", "-u", UID, "-e", `HOME=${HOME}`, cname(u), "sh", "-c", WIPE_SH], { timeout: 20_000 });
      const r = await run("docker", ["exec", "-u", UID, "-e", `HOME=${HOME}`, cname(u), "/opt/synchro/browser.sh"], { timeout: 30_000 });
      if (r.code) throw new E(500, "Không bật được trình duyệt: " + (r.err || r.out).trim().slice(0, 300));
      B.reset(u);
    }
    return base;
  },
  touch: (u) => touch(u),
  sock: (u, d) => { st(u).socks += d; },
  // Tệp trình duyệt tải về nằm trong thư mục làm việc (giữ lại khi container được tạo lại).
  downloads: () => `${WORK}/Downloads`,
  // Đọc bên trong container: Downloads/ do code của người dùng ghi, dịch vụ này là root trên máy chủ nên không được tự mở tệp trong đó
  // (liên kết Downloads/x -> /etc/shadow). Trong container, liên kết chỉ trỏ được tới tệp của chính container.
  readDownload: async (u, name) => {
    const r = await run("docker", ["exec", "-u", UID, cname(u), "base64", "-w0", `${WORK}/Downloads/${path.basename(String(name))}`], { timeout: 60_000, max: 200_000_000 });
    if (r.code || r.truncated) throw new BrowserError(404, "Không đọc được tệp đã tải.");
    return Buffer.from(r.out, "base64");
  },
  // Server đang nghe trong workspace (đọc /proc/net/tcp*), trừ cổng nội bộ của trình duyệt và DNS của Docker (127.0.0.11).
  ports: async (u) => {
    const r = await run("docker", ["exec", cname(u), "cat", "/proc/net/tcp", "/proc/net/tcp6"], { timeout: 10_000 });
    return [...new Set(r.out.split("\n").map((l) => l.trim().split(/\s+/)).filter((f) => f[3] === "0A" && !f[1].startsWith("0B00007F:")).map((f) => parseInt(f[1].split(":").pop(), 16)))]
      .filter((p) => p && p !== 9222 && p !== 9223).sort((a, b) => a - b);
  },
});
const browserTool = (u, a) => { if (a.cookies) cookieMode.set(u, a.cookies); return B.tool(u, a); };
// Chrome / Edge / Brave của chính người dùng: tiện ích Synchro nối WebSocket /ws-agent/ext, lệnh browser_* chuyển qua đây (workspace/ext-relay.mjs).
const X = createRelay({ log });

// ------------------------------------------------------------------ vé truy cập WebSocket (do Next ký)
const b64 = (b) => Buffer.from(b).toString("base64url");
function ticket(t) {
  const [body, sig] = String(t ?? "").split(".");
  if (!body || !sig) return null;
  const want = b64(crypto.createHmac("sha256", SECRET).update(body).digest());
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const o = JSON.parse(Buffer.from(body, "base64url").toString());
    return o.exp > Date.now() && okUser(o.u) && okDir(o.d) ? o : null;
  } catch { return null; }
}

// ------------------------------------------------------------------ terminal (PTY)
async function terminal(ws, t, q) {
  const cwd = await dirOf(t.u, t.d);
  const s = st(t.u);
  const cmd = t.k === "log"
    ? ["bash", "-lc", `f=$HOME/.synchro/agent-${t.d}.log; touch "$f"; printf '\\033[2mNhật ký lệnh của agent trong phiên này\\033[0m\\r\\n'; tail -n 400 -f "$f"`]
    : ["bash", "-l"];
  const ex = await api("POST", `/containers/${cname(t.u)}/exec`, {
    AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true, User: UID, WorkingDir: cwd,
    Env: ["TERM=xterm-256color", "COLORTERM=truecolor", `HOME=${HOME}`, "LANG=C.UTF-8"], Cmd: cmd,
  });
  const sock = await hijack(`/exec/${ex.Id}/start`, { Detach: false, Tty: true });
  s.socks++;
  const resize = (c, r) => api("POST", `/exec/${ex.Id}/resize?h=${Math.max(2, Math.min(r | 0, 300))}&w=${Math.max(2, Math.min(c | 0, 500))}`).catch(() => {});
  resize(Number(q.get("cols")) || 100, Number(q.get("rows")) || 30);
  let lastTouch = 0;
  const bump = () => { const n = Date.now(); if (n - lastTouch > 10_000) { lastTouch = n; touch(t.u); } };
  sock.on("data", (b) => { bump(); if (ws.readyState === WebSocket.OPEN) ws.send(b, { binary: true }); });
  sock.on("close", () => ws.close(1000, "exit"));
  sock.on("error", () => ws.close(1011, "error"));
  ws.on("message", (m) => {
    bump();
    let j; try { j = JSON.parse(m.toString()); } catch { return; }
    if (typeof j.i === "string") sock.write(j.i);
    else if (Array.isArray(j.r)) resize(j.r[0], j.r[1]);
  });
  ws.on("close", async () => {
    s.socks--;
    sock.destroy();
    // Đóng terminal thì dừng luôn shell trong container (Docker không tự dừng exec khi ngắt kết nối).
    try { const i = await api("GET", `/exec/${ex.Id}/json`); if (i?.Running && i.Pid) process.kill(i.Pid, "SIGHUP"); } catch {}
  });
}

// ------------------------------------------------------------------ máy chủ HTTP + WebSocket
const authed = (req) => {
  const h = String(req.headers.authorization ?? "");
  const want = `Bearer ${SECRET}`;
  return h.length === want.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(want));
};
const body = (req, max = 30_000_000) => new Promise((res, rej) => {
  const ch = []; let n = 0;
  req.on("data", (c) => { n += c.length; if (n > max) { rej(new E(413, "Dữ liệu quá lớn")); req.destroy(); } else ch.push(c); });
  req.on("end", () => { try { res(JSON.parse(Buffer.concat(ch).toString() || "{}")); } catch { rej(new E(400, "JSON không hợp lệ")); } });
});
const reply = (res, status, o) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return reply(res, 200, { ok: true, draining, runs: runQ.running, queued: runQ.queued, diskLow: freeMB() < MIN_FREE_MB });
  if (!authed(req)) return reply(res, 401, { error: "unauthorized" });
  try {
    // /run: chạy script của skill gửi kèm mọi tệp của skill (tới 100 MB, base64) — nhận lớn hơn các lệnh khác.
    const b = req.method === "POST" ? await body(req, url.pathname === "/run" ? 160_000_000 : 30_000_000) : Object.fromEntries(url.searchParams);
    if (!okUser(b.u)) throw new E(400, "Thiếu tài khoản");
    switch (url.pathname) {
      case "/ensure": { const s = await ensure(b.u); return reply(res, 200, { ok: true, running: true, socks: s.socks }); }
      case "/status": {
        const c = await inspect(cname(b.u));
        return reply(res, 200, { exists: !!c, running: !!c?.State?.Running, last: live.get(b.u)?.last ?? null, idleMin: IDLE_MS / 60_000 });
      }
      case "/exec": return reply(res, 200, await exec(b.u, b));
      case "/run": {
        const ac = new AbortController();
        res.once("close", () => { if (!res.writableEnded) ac.abort(); });
        // Chỗ chạy được nhả trước khi dọn container: đếm cả lần gọi đang trả lời để dịch vụ không thoát giữa chừng.
        replying++;
        try { return reply(res, 200, await runOnce(b.u, b, ac.signal)); } finally { replying--; }
      }
      case "/browser": return reply(res, 200, await browserTool(b.u, b));
      case "/ext": return reply(res, 200, await X.http(b));
      case "/stop": await stop(b.u); return reply(res, 200, { ok: true });
      case "/destroy": await destroy(b.u); return reply(res, 200, { ok: true });
      default: return reply(res, 404, { error: "not found" });
    }
  } catch (e) {
    const known = e instanceof E || e instanceof BrowserError;
    if (!known) log("lỗi", url.pathname, e);
    reply(res, known ? e.status : 500, { error: e.message || String(e) });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
// Tiện ích gửi về ảnh chụp màn hình, nội dung trang dài: cho phép tin lớn hơn.
const wssExt = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
server.on("upgrade", (req, sock, head) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^\/ws-agent/, "");
  const t = ticket(url.searchParams.get("t"));
  const kind = path === "/term" ? (t?.k === "term" || t?.k === "log" ? t.k : null) : path === "/screen" && t?.k === "screen" ? "screen" : path === "/ext" && t?.k === "ext" ? "ext" : null;
  if (!t || !kind) { sock.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return sock.destroy(); }
  if (kind === "ext") return wssExt.handleUpgrade(req, sock, head, (ws) => X.attach(ws, t.u, t.d));
  wss.handleUpgrade(req, sock, head, (ws) => {
    const fail = (e) => { try { ws.send(JSON.stringify({ t: "error", error: e.message || String(e) })); } catch {} ws.close(1011, "error"); };
    (kind === "screen" ? B.screen(ws, t.u) : terminal(ws, t, url.searchParams)).catch(fail);
  });
});

// systemd (KillMode=mixed) chỉ gửi SIGTERM cho dịch vụ này: ngừng nhận lần chạy mới, chờ lần đang dở xong tối đa DRAIN_SEC giây rồi mới thoát.
let draining = false, replying = 0;
process.on("SIGTERM", async () => {
  if (draining) return;
  draining = true;
  runQ.close("Máy chủ đang cập nhật workspace. Hãy thử lại sau ít phút.");
  log(`đang tắt: chờ ${runQ.running} lần chạy`);
  const end = Date.now() + DRAIN_SEC * 1000;
  while ((runQ.running > 0 || replying > 0) && Date.now() < end) await new Promise((r) => setTimeout(r, 500));
  setTimeout(() => process.exit(0), 300); // kịp gửi nốt câu trả lời vừa ghi xuống socket
});

setupHost().catch((e) => log("setup", e)).then(() => cleanRuns()).catch((e) => log("dọn lần chạy cũ", e)).finally(() => {
  server.listen(PORT, HOST, () => log(`workspace agent nghe tại ${HOST}:${PORT}`));
  startProxy();
});
