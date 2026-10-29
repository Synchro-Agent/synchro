// Workspace giả lập cho npm run dev:mock (thay workspace/agent.mjs chạy container Docker trên VPS): cùng đường dẫn và hợp đồng
// (/health, /ensure, /status, /exec, /browser, /stop, /destroy, khóa Bearer), mỗi người dùng một thư mục, mỗi phiên Synchro Code
// một thư mục con trong data-mock/ws. Lệnh chạy thật bằng bash trên máy này (chỉ dùng khi thử ở máy cá nhân / CI);
// thao tác tệp dùng đúng workspace/fsop.js của container. Trình duyệt: Chrome / Chromium thật trên máy này (mỗi người dùng một hồ sơ
// riêng trong data-mock/ws/<id>/.browser), điều khiển bằng đúng lõi workspace/browser-core.mjs như trên VPS, kèm màn hình trực tiếp
// qua WebSocket /ws-agent/screen. Máy không có Chrome thì trình duyệt trả trang giả lập như trước.
// Chrome của chính người dùng: cầu nối tới tiện ích Synchro (/ext và WebSocket /ws-agent/ext) giống hệt dịch vụ thật (workspace/ext-relay.mjs);
// tiện ích giả lập là scripts/mock-extension.mjs.
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { WebSocketServer } from "ws";
import { BrowserError, CDP, createBrowser, devJson, verifyTicket } from "../workspace/browser-core.mjs";
import { createRelay } from "../workspace/ext-relay.mjs";

// Chrome thật: CHROME_PATH, bản cài trên macOS, hoặc lệnh trong PATH (máy Linux / CI).
export function findChrome() {
  const fixed = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
  const inPath = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].flatMap((n) => (process.env.PATH ?? "").split(":").map((d) => path.join(d, n)));
  return [...fixed, ...inPath].find((p) => p && fs.existsSync(p)) ?? null;
}
const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.unref(); s.on("error", no); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });

const FSOP = path.resolve("workspace/fsop.js");
const W = "/home/user/work";
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
// Ảnh JPEG 1×1 (trắng) cho browser_screenshot.
const JPG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

export function startMockWs(port, root, secret) {
  fs.mkdirSync(root, { recursive: true });
  const dirOf = (u, d) => {
    if (!/^[\w-]{1,80}$/.test(String(u)) || (d !== undefined && !/^s\d{1,16}$/.test(String(d)))) throw Object.assign(new Error("Tham số không hợp lệ"), { code: 400 });
    const p = path.join(root, String(u), String(d ?? ""));
    fs.mkdirSync(p, { recursive: true });
    return p;
  };
  const pages = new Map();
  const cookieMode = new Map();
  const CHROME = process.env.MOCK_BROWSER === "fake" ? null : findChrome();
  const procs = new Map(); // u -> { proc, base }
  const alive = (base) => devJson(`${base}/json/version`, "GET", 1500).then(() => true, () => false);
  // Bật Chrome headless cho người dùng (nếu chưa chạy), cùng các cờ như trong container (workspace/browser.sh).
  const up = async (u) => {
    const cur = procs.get(u);
    if (cur && await alive(cur.base)) return cur.base;
    const home = dirOf(u);
    const prof = path.join(home, ".browser", "profile");
    fs.mkdirSync(prof, { recursive: true });
    fs.mkdirSync(path.join(home, "Downloads"), { recursive: true });
    // Chrome cũ còn giữ hồ sơ (dev:mock bị tắt đột ngột): dừng nó trước.
    spawnSync("pkill", ["-f", `--user-data-dir=${prof}`]);
    // Cookie đến khi trình duyệt tắt: xóa dữ liệu đăng nhập trước khi bật lại (như workspace/agent.mjs).
    if (cookieMode.get(u) === "until-stop") for (const f of ["Cookies", "Cookies-journal", "Network", "Local Storage", "Session Storage", "IndexedDB", "Service Worker", "Login Data", "Web Data"]) fs.rmSync(path.join(prof, "Default", f), { recursive: true, force: true });
    for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) fs.rmSync(path.join(prof, f), { force: true });
    const port = await freePort();
    const proc = spawn(CHROME, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-blink-features=AutomationControlled",
      "--lang=vi-VN", "--accept-lang=vi-VN,vi,en-US,en", "--use-mock-keychain", "--password-store=basic", "--disable-features=Translate,MediaRouter", "--mute-audio",
      `--remote-debugging-port=${port}`, "--remote-allow-origins=*", `--user-data-dir=${prof}`, "--window-size=1280,800", "about:blank"], { stdio: "ignore", env: { ...process.env, TZ: "Asia/Ho_Chi_Minh" } });
    const base = `http://127.0.0.1:${port}`;
    procs.set(u, { proc, base });
    proc.on("exit", () => { if (procs.get(u)?.proc === proc) { procs.delete(u); core.reset(u); } });
    for (let i = 0; i < 60; i++) { if (await alive(base)) { core.reset(u); return base; } await new Promise((r) => setTimeout(r, 150)); }
    proc.kill("SIGKILL");
    throw new BrowserError(500, "Không bật được Chrome trên máy này.");
  };
  const core = createBrowser({ up, downloads: (u) => path.join(dirOf(u), "Downloads"), readDownload: (u, name) => fs.promises.readFile(path.join(dirOf(u), "Downloads", path.basename(String(name)))), allowFile: true });
  const relay = createRelay();
  const killAll = () => { for (const { proc } of procs.values()) proc.kill("SIGKILL"); };
  process.on("exit", killAll);
  const exec = (u, b) => new Promise((ok) => {
    const cwd = dirOf(u, b.d);
    const sec = Math.max(1, Math.min(Number(b.timeout) || 120, 900));
    // Lệnh nhắc tới /home/user/work của container → thư mục phiên trên máy này; fsop.js của container → bản trong mã nguồn.
    const fix = (s) => String(s).replaceAll(`${W}/${b.d}`, cwd).replace("/opt/synchro/fsop.js", FSOP);
    const argv = Array.isArray(b.argv) ? b.argv.map(fix) : ["bash", "-lc", fix(b.cmd ?? "")];
    const env = { PATH: process.env.PATH, LANG: "C.UTF-8", HOME: path.join(root, String(u)), ...Object.fromEntries(Object.entries(b.env ?? {}).filter(([k]) => /^[A-Z_][A-Z0-9_]*$/.test(k)).map(([k, v]) => [k, fix(v)])) };
    fs.mkdirSync(path.join(env.HOME, ".synchro"), { recursive: true });
    const p = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const t = setTimeout(() => { p.kill("SIGKILL"); }, sec * 1000);
    p.stdout.on("data", (x) => { if (out.length < 2_000_000) out += x; });
    p.stderr.on("data", (x) => { if (err.length < 200_000) err += x; });
    p.on("error", (e) => { if (done) return; done = true; clearTimeout(t); ok({ code: 127, out, err: e.message }); });
    p.on("close", (code, sig) => { if (done) return; done = true; clearTimeout(t); ok({ code: sig ? 124 : code ?? 0, out, err }); });
    if (b.stdin != null) p.stdin.end(String(b.stdin)); else p.stdin.end();
  });
  const fake = (u, b) => {
    const cur = pages.get(u) ?? { url: "about:blank", title: "" };
    if (b.action === "navigate") { const url = String(b.url ?? ""); pages.set(u, { url, title: `Trang giả lập: ${url}` }); return { url, title: `Trang giả lập: ${url}` }; }
    if (b.action === "read") return { ...cur, text: `Nội dung giả lập của ${cur.url}`, elements: ["[1] button \"Bấm thử\""] };
    if (b.action === "screenshot") return { ...cur, image: JPG };
    if (b.action === "console") return { logs: [] };
    return cur;
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (req.headers.authorization !== `Bearer ${secret}`) return json(res, 401, { error: "Sai khóa workspace" });
    let raw = ""; for await (const c of req) raw += c;
    let b = {}; try { b = JSON.parse(raw || "{}"); } catch {}
    try {
      switch (url.pathname) {
        case "/ensure": dirOf(b.u); return json(res, 200, { ok: true, running: true, socks: {} });
        case "/status": return json(res, 200, { running: true, idleMin: 0 });
        case "/exec": return json(res, 200, await exec(b.u, b));
        case "/browser": if (b.cookies) cookieMode.set(String(b.u), b.cookies); return json(res, 200, CHROME ? await core.tool(String(b.u), b) : fake(b.u, b));
        case "/ext": dirOf(b.u); return json(res, 200, await relay.http(b));
        // Dừng workspace như container bị tắt: trình duyệt của người dùng tắt theo.
        case "/stop": case "/destroy": {
          const p = procs.get(String(b.u));
          if (p) {
            procs.delete(String(b.u));
            // Đóng êm (Chrome ghi cookie xuống đĩa như khi container dừng), quá 3 giây thì buộc tắt.
            try { const v = await devJson(`${p.base}/json/version`, "GET", 1500); const c = await CDP.open(v.webSocketDebuggerUrl); await c.send("Browser.close").catch(() => {}); } catch {}
            await new Promise((r) => { const t = setTimeout(r, 3000); p.proc.once("exit", () => { clearTimeout(t); r(); }); });
            p.proc.kill("SIGKILL"); core.reset(String(b.u));
          }
          return json(res, 200, { ok: true });
        }
      }
      return json(res, 404, { error: "Không có đường dẫn này" });
    } catch (e) { return json(res, e.code === 400 ? 400 : e instanceof BrowserError ? e.status : 500, { error: e.message }); }
  });
  // Màn hình trình duyệt trực tiếp và tiện ích Chrome (vé ký HMAC như dịch vụ workspace thật); terminal chưa có ở bản giả lập.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const wssExt = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  server.on("upgrade", (req, sock, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    const t = verifyTicket(secret, url.searchParams.get("t"), (u) => /^[\w-]{1,80}$/.test(String(u)), (d) => /^[\w-]{1,64}$/.test(String(d)));
    if (t?.k === "ext" && url.pathname.replace(/^\/ws-agent/, "") === "/ext") return wssExt.handleUpgrade(req, sock, head, (ws) => relay.attach(ws, String(t.u), String(t.d)));
    if (!CHROME || !t || t.k !== "screen" || url.pathname.replace(/^\/ws-agent/, "") !== "/screen") { sock.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return sock.destroy(); }
    wss.handleUpgrade(req, sock, head, (ws) => core.screen(ws, String(t.u)).catch((e) => { try { ws.send(JSON.stringify({ t: "error", error: e.message })); } catch {} ws.close(1011, "error"); }));
  });
  if (CHROME) console.log(`Trình duyệt của workspace giả lập: ${CHROME}`);
  return new Promise((ok, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", () => ok(server)); });
}
