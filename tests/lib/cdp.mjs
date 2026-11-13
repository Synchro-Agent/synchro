// Chrome ẩn điều khiển qua CDP cho các bài kiểm thử giao diện mới: đăng nhập tài khoản thử nghiệm của npm run dev:mock, mở một tab, tiện ích chờ / chụp.
// Dùng: const t = await openChrome({ base, port }); await t.P("Page.navigate", { url }); … await t.close();
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

export { sleep, waitFor, settle } from "./wait.mjs";
import { sleep } from "./wait.mjs";

export async function login(base, email = "admin@synchro.test", password = "synchro-mock-123") {
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ email, password }) });
  const cookie = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0];
  if (!cookie) throw new Error("login failed");
  const uid = (await (await fetch(base + "/api/auth/me", { headers: { cookie } })).json()).user.id;
  return { cookie, uid };
}

export async function openChrome({ base, port = 9360, name = "r9", shots }) {
  const PROF = `${tmpdir()}/synchro-ui/chrome-prof-${name}`;
  rmSync(PROF, { recursive: true, force: true });
  if (shots) mkdirSync(shots, { recursive: true });
  const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
    ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars"], { stdio: "ignore" });
  let ver; for (let i = 0; i < 60 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null); }
  if (!ver) { chrome.kill(); throw new Error("Chrome không mở được"); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map(), reqs = [], logs = [], hooks = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [y, n] = waits.get(m.id); waits.delete(m.id); m.error ? n(new Error(JSON.stringify(m.error))) : y(m.result); return; }
    if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown") logs.push(m.params.exceptionDetails?.exception?.description ?? "exception");
    for (const f of hooks.get(m.method) ?? []) f(m.params);
  });
  const send = (method, params = {}, sessionId) => new Promise((y, n) => { const id = ++seq; waits.set(id, [y, n]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (m, p) => send(m, p, S);
  await P("Page.enable"); await P("Runtime.enable"); await P("Network.enable");
  const ev = async (expr) => {
    const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; };
  const size = async (width, height, mobile = false) => P("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  const theme = async (t) => { await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: t }] }); await ev(`try { localStorage.setItem("theme", ${JSON.stringify(t)}) } catch {}; document.documentElement.dataset.theme = ${JSON.stringify(t)}`).catch(() => {}); };
  const shot = async (file) => { if (!shots) return; const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${shots}/${file}.png`, Buffer.from(data, "base64")); };
  const click = async (x, y) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
  const hover = (x, y) => P("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const key = async (k, code = k, kc = 0, mods = 0) => { await P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: kc, modifiers: mods }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: kc, modifiers: mods }); };
  const type = (text) => P("Input.insertText", { text });
  const close = () => { try { ws.close(); } catch {} chrome.kill(); };
  // Sự kiện CDP của tab (Fetch.requestPaused…): on("Fetch.requestPaused", (p) => …).
  const on = (method, f) => { if (!hooks.has(method)) hooks.set(method, []); hooks.get(method).push(f); };
  return { P, ev, until, size, theme, shot, click, hover, key, type, close, on, reqs, logs };
}
