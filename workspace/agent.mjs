// Dịch vụ workspace của Synchro Code (chạy bằng root trên VPS, chỉ nghe ở 127.0.0.1).
// - Mỗi người dùng một container Docker (image synchro-ws) với thư mục /home/user/work lưu trên máy chủ.
// - API HTTP cho máy chủ Next (khóa WS_AGENT_SECRET): bật container, chạy lệnh, điều khiển trình duyệt.
// - WebSocket cho trình duyệt của người dùng (vé ký HMAC do Next cấp): terminal (PTY) và màn hình trình duyệt.
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { BrowserError, createBrowser, devJson } from "./browser-core.mjs";
import { createRelay } from "./ext-relay.mjs";

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
// chỉ tới được proxy của dịch vụ này ở cổng RUN_PROXY_PORT; proxy chỉ cho đi tới các kho thư viện (PKG_HOSTS).
const RUN_NET = env("WS_RUN_NETWORK", "synchro-run");
const RUN_BRIDGE = "br-synchro-run";
const RUN_SUBNET = env("WS_RUN_SUBNET", "172.29.0.0/24");
const RUN_GW = env("WS_RUN_GATEWAY", "172.29.0.1");
const RUN_PROXY_PORT = Number(env("WS_RUN_PROXY_PORT", 3556));
const RUN_MAX = Number(env("WS_RUN_MAX", 4));
const RUN_MEMORY = env("WS_RUN_MEMORY", "1g");
// Giữ giống PKG_DOMAINS trong app/catalog.ts.
const PKG_HOSTS = ["pypi.org", "files.pythonhosted.org", "pythonhosted.org", "registry.npmjs.org", "npmjs.org", "npmjs.com", "registry.yarnpkg.com", "yarnpkg.com",
  "crates.io", "index.crates.io", "static.crates.io", "proxy.golang.org", "sum.golang.org", "conda.anaconda.org", "repo.anaconda.com",
  "github.com", "codeload.github.com", "objects.githubusercontent.com", "deb.debian.org", "security.debian.org", "archive.ubuntu.com", "security.ubuntu.com"];
const MAX_RUNNING = Number(env("WS_MAX_RUNNING", 4));
const IDLE_MS = Number(env("WS_IDLE_MIN", 20)) * 60_000;
const MEMORY = env("WS_MEMORY", "1536m");
const CPUS = env("WS_CPUS", "1");
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
function run(cmd, args, { input, timeout = 60_000, max = 2_000_000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [], err = [];
    let n = 0, truncated = false, killed = false;
    const take = (arr) => (c) => { if (n >= max) { truncated = true; return; } arr.push(c); n += c.length; };
    p.stdout.on("data", take(out));
    p.stderr.on("data", take(err));
    const t = setTimeout(() => { killed = true; p.kill("SIGKILL"); }, timeout);
    p.on("error", (e) => { clearTimeout(t); resolve({ code: 127, out: "", err: String(e), truncated }); });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: killed ? 124 : code ?? 1, out: Buffer.concat(out).toString("utf8"), err: Buffer.concat(err).toString("utf8"), truncated });
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

async function usageMB(u) {
  const r = await run("du", ["-sm", `${ROOT}/${u}`], { timeout: 15_000 });
  return Number(r.out.split(/\s/)[0]) || 0;
}

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
      if ((await usageMB(u)) > DISK_MB) throw new E(507, `Workspace đã vượt ${DISK_MB} MB. Hãy xóa bớt file (node_modules, build…) rồi thử lại.`);
      // Image đã được build lại (cập nhật công cụ): tạo lại container, thư mục work vẫn giữ nguyên.
      if (c) {
        const img = await api("GET", `/images/${encodeURIComponent(IMAGE)}/json`).catch(() => null);
        if (img && img.Id !== c.Image) { await run("docker", ["rm", "-f", name], { timeout: 30_000 }); c = null; }
      }
      if (!c) {
        const r = await run("docker", ["run", "-d", "--name", name, "--hostname", "workspace", "--init",
          "--network", NET, "--memory", MEMORY, "--memory-swap", MEMORY, "--cpus", CPUS, "--pids-limit", "512",
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
  fs.rmSync(`${ROOT}/${u}`, { recursive: true, force: true });
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
  } catch (e) { log("sweep", e.message); }
}, 60_000);

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
  const tail = Array.isArray(argv) ? argv.map(String) : ["bash", "-lc", String(cmd ?? "")];
  const args = ["exec", ...(stdin != null ? ["-i"] : []), "-u", UID, "-w", cwd, "-e", `HOME=${HOME}`, ...envArgs, cname(u), "timeout", "-k", "5", String(sec), ...tail];
  touch(u);
  const r = await run("docker", args, { input: stdin, timeout: (sec + 15) * 1000 });
  touch(u);
  return r;
}

// ------------------------------------------------------------------ chạy code một lần (chat)
const runDir = (id) => `${ROOT}/_runs/${id}`;
let running = 0;
const safeRel = (p) => typeof p === "string" && p.length > 0 && p.length < 300 && !p.startsWith("/") && !p.split(/[\\/]/).some((x) => x === ".." || x === "");

async function runOnce(u, { files = [], argv, stdin = null, net: wantNet = false, timeout = 120 }) {
  if (!Array.isArray(argv) || !argv.length || argv.length > 60 || argv.some((a) => typeof a !== "string" || a.length > 4000)) throw new E(400, "Lệnh không hợp lệ");
  if (!Array.isArray(files) || files.length > 120 || files.some((f) => !safeRel(f?.path) || typeof f.b64 !== "string")) throw new E(400, "Tệp không hợp lệ");
  if (wantNet && !proxyUp) throw new E(503, "Máy chủ chưa bật được mạng cho code (proxy kho thư viện).");
  if (running >= RUN_MAX) throw new E(503, "Máy chủ đang chạy nhiều code cùng lúc. Hãy thử lại sau ít giây.");
  const sec = Math.max(5, Math.min(Number(timeout) || 120, 300));
  const id = crypto.randomBytes(8).toString("hex");
  const dir = runDir(id), name = "srun-" + id;
  running++;
  try {
    fs.mkdirSync(`${dir}/outputs`, { recursive: true, mode: 0o700 });
    for (const f of files) {
      const p = `${dir}/${f.path}`;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from(f.b64, "base64"));
    }
    await run("chown", ["-R", `${UID}:${UID}`, dir]);
    const proxy = `http://${RUN_GW}:${RUN_PROXY_PORT}`;
    const envs = { HOME: HOME, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", MPLBACKEND: "Agg", PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1",
      PIP_BREAK_SYSTEM_PACKAGES: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1", NPM_CONFIG_PREFIX: `${HOME}/.npm-global`, npm_config_update_notifier: "false",
      PATH: `${HOME}/.local/bin:${HOME}/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
      ...(wantNet ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy } : {}) };
    const args = ["run", "--rm", "-i", "--name", name, "--hostname", "sandbox", "--init", "--network", wantNet ? RUN_NET : "none",
      "--memory", RUN_MEMORY, "--memory-swap", RUN_MEMORY, "--cpus", "1", "--pids-limit", "256", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--shm-size", "128m", "--label", `synchro.run=${u}`, "-u", UID, "-w", `${HOME}/run`, "-v", `${dir}:${HOME}/run`,
      ...Object.entries(envs).flatMap(([k, v]) => ["-e", `${k}=${v}`]), IMAGE, "timeout", "-k", "5", String(sec), ...argv];
    const r = await run("docker", args, { input: stdin ?? "", timeout: (sec + 30) * 1000, max: 400_000 });
    const out = [];
    let total = 0;
    const walk = (d, depth) => {
      if (depth > 3 || !fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.isFile() && out.length < 10) {
          const size = fs.statSync(p).size;
          if (size > 20 * 1024 * 1024 || total + size > 40 * 1024 * 1024) continue;
          total += size;
          out.push({ path: path.relative(`${dir}/outputs`, p), b64: fs.readFileSync(p).toString("base64") });
        }
      }
    };
    walk(`${dir}/outputs`, 0);
    const timedOut = r.code === 124;
    return { code: r.code, out: r.out, err: r.err + (timedOut ? `\n[Đã dừng: chạy quá ${sec} giây]` : ""), timedOut, files: out };
  } finally {
    running--;
    await run("docker", ["rm", "-f", name], { timeout: 20_000 });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Proxy cho code (chỉ nghe trên cổng của mạng chạy code): chỉ CONNECT/HTTP tới kho thư viện, không tới địa chỉ nội bộ.
let proxyUp = false;
const v4Private = (ip) => { const [a, b] = ip.split(".").map(Number); return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224; };
const ipPrivate = (ip) => (net.isIP(ip) === 4 ? v4Private(ip) : /^(::|::1|f[cd]|fe[89ab]|::ffff:)/i.test(ip));
async function pkgTarget(host, port) {
  const h = String(host).toLowerCase().replace(/\.$/, "");
  if (!PKG_HOSTS.some((d) => h === d || h.endsWith("." + d))) throw new Error(`blocked: ${h} is not a package registry`);
  if (port !== 443 && port !== 80) throw new Error(`blocked: port ${port}`);
  const ips = (await lookup(h, { all: true })).map((x) => x.address);
  if (!ips.length || ips.some(ipPrivate)) throw new Error(`blocked: ${h} resolves to a private address`);
  return ips.find((x) => net.isIP(x) === 4) ?? ips[0];
}
function startProxy() {
  const px = http.createServer(async (req, res) => {
    try {
      const t = new URL(req.url);
      const ip = await pkgTarget(t.hostname, Number(t.port || 80));
      const up = http.request({ host: ip, port: Number(t.port || 80), path: t.pathname + t.search, method: req.method, headers: { ...req.headers, host: t.host } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
      up.on("error", () => { res.writeHead(502); res.end(); });
      req.pipe(up);
    } catch (e) { res.writeHead(403, { "content-type": "text/plain" }); res.end(String(e.message ?? e)); }
  });
  px.on("connect", async (req, sock, head) => {
    sock.on("error", () => {});
    const [h, p] = String(req.url ?? "").split(":");
    try {
      const ip = await pkgTarget(h, Number(p || 443));
      const up = net.connect(Number(p || 443), ip, () => { sock.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head?.length) up.write(head); up.pipe(sock); sock.pipe(up); });
      up.on("error", () => sock.destroy());
      sock.on("close", () => up.destroy());
    } catch (e) { sock.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${String(e.message ?? e)}`); }
  });
  px.on("error", (e) => { proxyUp = false; log("proxy", e.message); });
  px.listen(RUN_PROXY_PORT, RUN_GW, () => { proxyUp = true; log(`proxy kho thư viện nghe tại ${RUN_GW}:${RUN_PROXY_PORT}`); });
}
// Dọn thư mục chạy dở còn sót (dịch vụ khởi động lại giữa chừng).
fs.rmSync(`${ROOT}/_runs`, { recursive: true, force: true });

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
  readDownload: (u, name) => fs.promises.readFile(path.join(ROOT, u, "Downloads", path.basename(String(name)))),
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
const body = (req) => new Promise((res, rej) => {
  const ch = []; let n = 0;
  req.on("data", (c) => { n += c.length; if (n > 30_000_000) { rej(new E(413, "Dữ liệu quá lớn")); req.destroy(); } else ch.push(c); });
  req.on("end", () => { try { res(JSON.parse(Buffer.concat(ch).toString() || "{}")); } catch { rej(new E(400, "JSON không hợp lệ")); } });
});
const reply = (res, status, o) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return reply(res, 200, { ok: true });
  if (!authed(req)) return reply(res, 401, { error: "unauthorized" });
  try {
    const b = req.method === "POST" ? await body(req) : Object.fromEntries(url.searchParams);
    if (!okUser(b.u)) throw new E(400, "Thiếu tài khoản");
    switch (url.pathname) {
      case "/ensure": { const s = await ensure(b.u); return reply(res, 200, { ok: true, running: true, socks: s.socks }); }
      case "/status": {
        const c = await inspect(cname(b.u));
        return reply(res, 200, { exists: !!c, running: !!c?.State?.Running, last: live.get(b.u)?.last ?? null, idleMin: IDLE_MS / 60_000 });
      }
      case "/exec": return reply(res, 200, await exec(b.u, b));
      case "/run": return reply(res, 200, await runOnce(b.u, b));
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

setupHost().catch((e) => log("setup", e)).finally(() => {
  server.listen(PORT, HOST, () => log(`workspace agent nghe tại ${HOST}:${PORT}`));
  startProxy();
});
