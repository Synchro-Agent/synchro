// Dịch vụ workspace của Synchro Code (chạy bằng root trên VPS, chỉ nghe ở 127.0.0.1).
// - Mỗi người dùng một container Docker (image synchro-ws) với thư mục /home/user/work lưu trên máy chủ.
// - API HTTP cho máy chủ Next (khóa WS_AGENT_SECRET): bật container, chạy lệnh, điều khiển trình duyệt.
// - WebSocket cho trình duyệt của người dùng (vé ký HMAC do Next cấp): terminal (PTY) và màn hình trình duyệt.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";

const env = (k, d) => process.env[k] ?? d;
const PORT = Number(env("WS_AGENT_PORT", 3555));
const HOST = env("WS_AGENT_HOST", "127.0.0.1");
const SECRET = env("WS_AGENT_SECRET", "");
const IMAGE = env("WS_IMAGE", "synchro-ws:1");
const ROOT = env("WS_ROOT", "/srv/synchro-ws");
const NET = env("WS_NETWORK", "synchro-ws");
const BRIDGE = "br-synchro";
const SUBNET = env("WS_SUBNET", "172.30.0.0/16");
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
      st(u).cdp?.close(); st(u).cdp = null;
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
  s?.cdp?.close();
  if (s) { s.cdp = null; s.dirs.clear(); }
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

// ------------------------------------------------------------------ trình duyệt (Chromium qua CDP)
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.wait = new Map(); this.subs = new Map(); this.closed = false;
    ws.on("message", (m) => {
      let j; try { j = JSON.parse(m.toString()); } catch { return; }
      if (j.id && this.wait.has(j.id)) { const w = this.wait.get(j.id); this.wait.delete(j.id); j.error ? w.rej(new Error(j.error.message)) : w.res(j.result); }
      else if (j.method) for (const f of this.subs.get(j.method) ?? []) f(j.params);
    });
    ws.on("close", () => { this.closed = true; for (const w of this.wait.values()) w.rej(new Error("Trình duyệt đã ngắt kết nối")); this.wait.clear(); for (const f of this.subs.get("close") ?? []) f(); });
    ws.on("error", () => {});
  }
  static open(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
      const t = setTimeout(() => { ws.terminate(); rej(new Error("Không kết nối được trình duyệt")); }, 8000);
      ws.once("open", () => { clearTimeout(t); res(new CDP(ws)); });
      ws.once("error", (e) => { clearTimeout(t); rej(e); });
    });
  }
  send(method, params = {}, timeout = 20_000) {
    if (this.closed) return Promise.reject(new Error("Trình duyệt đã ngắt kết nối"));
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.wait.delete(id); rej(new Error(`${method}: quá thời gian`)); }, timeout);
      this.wait.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(ev, f) { if (!this.subs.has(ev)) this.subs.set(ev, []); this.subs.get(ev).push(f); return () => this.subs.set(ev, this.subs.get(ev).filter((x) => x !== f)); }
  once(ev, ms) { return new Promise((res) => { const off = this.on(ev, (p) => { off(); clearTimeout(t); res(p); }); const t = setTimeout(() => { off(); res(null); }, ms); }); }
  close() { try { this.ws.close(); } catch {} }
}

async function devtools(u, path, method = "GET") {
  const s = st(u);
  const r = await fetch(`http://${s.ip}:9223${path}`, { method, signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`DevTools ${r.status}`);
  return r.json();
}

// Bật Chromium nếu chưa chạy; trả về địa chỉ WebSocket của tab chính.
async function pageUrl(u) {
  const s = await ensure(u);
  let ok = false;
  try { await devtools(u, "/json/version"); ok = true; } catch {}
  if (!ok) {
    const r = await run("docker", ["exec", "-u", UID, "-e", `HOME=${HOME}`, cname(u), "/opt/synchro/browser.sh"], { timeout: 30_000 });
    if (r.code) throw new E(500, "Không bật được trình duyệt: " + (r.err || r.out).trim().slice(0, 300));
  }
  let list = (await devtools(u, "/json/list")).filter((t) => t.type === "page");
  if (!list.length) { await devtools(u, "/json/new?about:blank", "PUT"); list = (await devtools(u, "/json/list")).filter((t) => t.type === "page"); }
  touch(u);
  return list[0].webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://${s.ip}:9223`);
}

// Kết nối điều khiển dùng chung của agent (giữ log console để agent đọc lại).
async function agentCdp(u) {
  const s = st(u);
  if (s.cdp && !s.cdp.closed) return s.cdp;
  const c = await CDP.open(await pageUrl(u));
  c.logs = [];
  const push = (l) => { c.logs.push(l.slice(0, 2000)); if (c.logs.length > 200) c.logs.shift(); };
  c.on("Runtime.consoleAPICalled", (p) => push(`[${p.type}] ${p.args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`));
  c.on("Runtime.exceptionThrown", (p) => push(`[exception] ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`));
  c.on("Log.entryAdded", (p) => push(`[${p.entry.level}] ${p.entry.text}${p.entry.url ? " (" + p.entry.url + ")" : ""}`));
  await Promise.all([c.send("Page.enable"), c.send("Runtime.enable"), c.send("Log.enable")]);
  s.cdp = c;
  return c;
}

const READ_JS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[contenteditable=""],[contenteditable=true],summary';
  document.querySelectorAll("[data-sref]").forEach((e) => e.removeAttribute("data-sref"));
  let n = 0; const els = [];
  for (const el of document.querySelectorAll(sel)) {
    if (els.length >= 200 || !vis(el)) continue;
    const ref = String(++n); el.setAttribute("data-sref", ref);
    const tag = el.tagName.toLowerCase(), type = el.getAttribute("type"), role = el.getAttribute("role");
    const label = (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || el.title || el.getAttribute("name") || "").trim().replace(/\\s+/g, " ").slice(0, 80);
    els.push("[" + ref + "] " + tag + (type ? "[" + type + "]" : "") + (role ? " role=" + role : "") + ' "' + label + '"' + (tag === "a" ? " -> " + el.getAttribute("href") : ""));
  }
  return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : "").slice(0, 15000), elements: els };
})()`;

const KEYS = { Enter: [13, "\r"], Tab: [9], Escape: [27], Backspace: [8], Delete: [46], ArrowUp: [38], ArrowDown: [40], ArrowLeft: [37], ArrowRight: [39], PageUp: [33], PageDown: [34], Home: [36], End: [35], " ": [32, " "], Space: [32, " "] };
async function pressKey(c, key, modifiers = 0) {
  const [code, text] = KEYS[key] ?? [key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, key.length === 1 ? key : undefined];
  const k = key === "Space" ? " " : key;
  await c.send("Input.dispatchKeyEvent", { type: text && !modifiers ? "keyDown" : "rawKeyDown", key: k, windowsVirtualKeyCode: code, text: modifiers ? undefined : text, modifiers });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, windowsVirtualKeyCode: code, modifiers });
}
async function clickAt(c, x, y) {
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const evaluate = async (c, expression) => {
  const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, 15_000);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const info = (c) => evaluate(c, "({ url: location.href, title: document.title })").catch(() => ({ url: "", title: "" }));
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
async function refPoint(c, ref) {
  const p = await evaluate(c, `(() => { const el = document.querySelector('[data-sref="${String(ref).replace(/\D/g, "")}"]'); if (!el) return null; el.scrollIntoView({ block: "center", inline: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!p) throw new E(400, `Không còn phần tử ref ${ref} trên trang. Hãy gọi browser_read để lấy lại danh sách.`);
  return p;
}

async function browserTool(u, a) {
  const c = await agentCdp(u);
  touch(u);
  switch (a.action) {
    case "navigate": {
      let url = String(a.url ?? "").trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = (/^(localhost|127\.|0\.0\.0\.0)/.test(url) ? "http://" : "https://") + url;
      if (!/^(https?|about):/i.test(url)) throw new E(400, "Chỉ mở được địa chỉ http(s)");
      const load = c.once("Page.loadEventFired", 15_000);
      const r = await c.send("Page.navigate", { url });
      if (r.errorText) return { error: `Không mở được ${url}: ${r.errorText}`, ...(await info(c)) };
      await load; await settle(300);
      return await info(c);
    }
    case "read": return await evaluate(c, READ_JS);
    case "screenshot": {
      const { data } = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
      return { image: data, ...(await info(c)) };
    }
    case "click": {
      const p = a.ref != null ? await refPoint(c, a.ref) : { x: Number(a.x), y: Number(a.y) };
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new E(400, "Thiếu ref hoặc tọa độ x, y");
      await clickAt(c, p.x, p.y);
      await settle(600);
      return await info(c);
    }
    case "type": {
      if (a.ref != null) { const p = await refPoint(c, a.ref); await clickAt(c, p.x, p.y); }
      if (a.clear) await evaluate(c, `(() => { const el = document.activeElement; if (el && "value" in el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); } })()`);
      await c.send("Input.insertText", { text: String(a.text ?? "") });
      if (a.submit) { await pressKey(c, "Enter"); await settle(800); }
      return await info(c);
    }
    case "key": await pressKey(c, String(a.key ?? "Enter")); await settle(300); return await info(c);
    case "scroll": {
      const { w, h } = await evaluate(c, "({ w: innerWidth, h: innerHeight })");
      await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: w / 2, y: h / 2, deltaX: 0, deltaY: Number(a.dy ?? 600) });
      await settle(300);
      return await info(c);
    }
    case "back": case "forward": {
      const h = await c.send("Page.getNavigationHistory");
      const e = h.entries[h.currentIndex + (a.action === "back" ? -1 : 1)];
      if (e) { const load = c.once("Page.loadEventFired", 10_000); await c.send("Page.navigateToHistoryEntry", { entryId: e.id }); await load; }
      return await info(c);
    }
    case "reload": { const load = c.once("Page.loadEventFired", 15_000); await c.send("Page.reload"); await load; return await info(c); }
    case "console": { const logs = c.logs.slice(-Number(a.limit ?? 50)); if (a.clear) c.logs = []; return { logs }; }
    case "eval": {
      const v = await evaluate(c, String(a.expression ?? ""));
      return { value: JSON.stringify(v ?? null).slice(0, 20_000) };
    }
    default: throw new E(400, "Thao tác trình duyệt không hợp lệ");
  }
}

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

// ------------------------------------------------------------------ màn hình trình duyệt (screencast + điều khiển)
async function screen(ws, t) {
  // Tin nhắn đến trong lúc đang bật trình duyệt (vd. kích thước khung) được giữ lại rồi xử lý sau.
  const queue = [];
  let handle = null, gone = false;
  ws.on("message", (m) => (handle ? handle(m) : queue.push(m)));
  ws.on("close", () => { gone = true; });
  const s = st(t.u);
  const c = await CDP.open(await pageUrl(t.u));
  if (gone) { c.close(); return; }
  s.socks++;
  let size = { w: 1280, h: 800 };
  const send = (o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
  const sendInfo = async () => send({ t: "nav", ...(await info(c)) });
  c.on("Page.screencastFrame", (p) => {
    send({ t: "frame", data: p.data, w: p.metadata.deviceWidth, h: p.metadata.deviceHeight });
    c.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  });
  c.on("Page.frameNavigated", (p) => { if (!p.frame.parentId) send({ t: "nav", url: p.frame.url }); });
  c.on("Page.loadEventFired", () => { sendInfo(); });
  c.on("Page.frameStartedLoading", () => send({ t: "loading", on: true }));
  c.on("Page.frameStoppedLoading", () => send({ t: "loading", on: false }));
  c.on("close", () => ws.close(1011, "browser closed"));
  const startCast = () => c.send("Page.startScreencast", { format: "jpeg", quality: 65, maxWidth: size.w, maxHeight: size.h, everyNthFrame: 1 }).catch(() => {});
  await c.send("Page.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false }).catch(() => {});
  await startCast();
  sendInfo();
  let lastTouch = 0;
  handle = async (m) => {
    const n = Date.now(); if (n - lastTouch > 10_000) { lastTouch = n; touch(t.u); }
    let j; try { j = JSON.parse(m.toString()); } catch { return; }
    try {
      if (j.t === "size") {
        size = { w: Math.max(320, Math.min(j.w | 0, 2560)), h: Math.max(240, Math.min(j.h | 0, 1600)) };
        await c.send("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false });
        await c.send("Page.stopScreencast").catch(() => {});
        await startCast();
      } else if (j.t === "mouse") {
        await c.send("Input.dispatchMouseEvent", { type: j.type, x: +j.x, y: +j.y, button: j.button ?? "left", buttons: j.buttons ?? 0, clickCount: j.clickCount ?? 0, modifiers: j.mod ?? 0 });
      } else if (j.t === "wheel") {
        await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: +j.x, y: +j.y, deltaX: +j.dx || 0, deltaY: +j.dy || 0 });
      } else if (j.t === "key") {
        await c.send("Input.dispatchKeyEvent", { type: j.type, key: j.key, code: j.code, text: j.text, unmodifiedText: j.text, windowsVirtualKeyCode: j.kc ?? 0, modifiers: j.mod ?? 0 });
      } else if (j.t === "text") {
        await c.send("Input.insertText", { text: String(j.text ?? "") });
      } else if (j.t === "go") {
        await browserTool(t.u, { action: "navigate", url: j.url }).catch((e) => send({ t: "error", error: e.message }));
      } else if (j.t === "back" || j.t === "forward" || j.t === "reload") {
        await browserTool(t.u, { action: j.t });
      }
    } catch (e) { send({ t: "error", error: e.message }); }
  };
  for (const m of queue.splice(0)) handle(m);
  const bye = () => { s.socks--; c.send("Page.stopScreencast").catch(() => {}).finally(() => c.close()); };
  if (gone) bye(); else ws.on("close", bye);
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
      case "/browser": return reply(res, 200, await browserTool(b.u, b));
      case "/stop": await stop(b.u); return reply(res, 200, { ok: true });
      case "/destroy": await destroy(b.u); return reply(res, 200, { ok: true });
      default: return reply(res, 404, { error: "not found" });
    }
  } catch (e) {
    if (!(e instanceof E)) log("lỗi", url.pathname, e);
    reply(res, e instanceof E ? e.status : 500, { error: e.message || String(e) });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
server.on("upgrade", (req, sock, head) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^\/ws-agent/, "");
  const t = ticket(url.searchParams.get("t"));
  const kind = path === "/term" ? (t?.k === "term" || t?.k === "log" ? t.k : null) : path === "/screen" && t?.k === "screen" ? "screen" : null;
  if (!t || !kind) { sock.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return sock.destroy(); }
  wss.handleUpgrade(req, sock, head, (ws) => {
    const fail = (e) => { try { ws.send(JSON.stringify({ t: "error", error: e.message || String(e) })); } catch {} ws.close(1011, "error"); };
    (kind === "screen" ? screen(ws, t) : terminal(ws, t, url.searchParams)).catch(fail);
  });
});

setupHost().catch((e) => log("setup", e)).finally(() => server.listen(PORT, HOST, () => log(`workspace agent nghe tại ${HOST}:${PORT}`)));
