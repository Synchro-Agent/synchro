// Workspace giả lập cho npm run dev:mock (thay workspace/agent.mjs chạy container Docker trên VPS): cùng đường dẫn và hợp đồng
// (/health, /ensure, /status, /exec, /browser, /stop, /destroy, khóa Bearer), mỗi người dùng một thư mục, mỗi phiên Synchro Code
// một thư mục con trong data-mock/ws. Lệnh chạy thật bằng bash trên máy này (chỉ dùng khi thử ở máy cá nhân / CI);
// thao tác tệp dùng đúng workspace/fsop.js của container. Trình duyệt của workspace trả trang giả lập.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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
  const browser = (u, b) => {
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
        case "/browser": return json(res, 200, browser(b.u, b));
        case "/stop": case "/destroy": return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "Không có đường dẫn này" });
    } catch (e) { return json(res, e.code === 400 ? 400 : 500, { error: e.message }); }
  });
  return new Promise((ok, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", () => ok(server)); });
}
