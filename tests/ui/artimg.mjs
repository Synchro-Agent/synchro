// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/artimg.mjs
// Ảnh từ URL ngoài trong artifact hiện được trong khung xem trước. Từng sót (synchro.net.nz): slide dùng ảnh Wikimedia, khung artifact chỉ
// cho ảnh nhúng (CSP img-src data: blob:) nên mọi ảnh "biến mất". Giờ khung tải ảnh qua /api/artimg rồi nhúng thành data: trước khi dựng.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/artimg/";
rmSync(SCR, { recursive: true, force: true }); mkdirSync(SCR, { recursive: true });
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-artimg";
rmSync(PROF, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = "";
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  cookie = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0] ?? "";
  if (!cookie) throw new Error("login failed");
}
await fetch(B + "/api/caps", { method: "PATCH", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify({ art: true }) });

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9353", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
try {
  let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9353/json/version").then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map(), frames = new Set();
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  ws.addEventListener("message", async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
    // Khung artifact (sandbox, nguồn gốc ẩn danh) chạy ở tiến trình riêng: gắn vào để đo bên trong.
    if (m.method === "Target.attachedToTarget") {
      const s = m.params.sessionId; frames.add(s);
      await send("Runtime.enable", {}, s).catch(() => {});
      await send("Runtime.runIfWaitingForDebugger", {}, s).catch(() => {});
    }
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable");
  await P("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  const ev = async (expr, s = S) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(300); } return false; };
  // Đo trong khung artifact: tìm khung con có ảnh #logo.
  const inFrame = async (expr) => { for (const s of frames) { const v = await ev(`document.getElementById("logo") ? (${expr}) : undefined`, s).catch(() => undefined); if (v !== undefined) return v; } return undefined; };

  console.log("━━ ảnh từ URL ngoài trong artifact");
  await P("Page.navigate", { url: B + "/" });
  if (!(await until(`!!document.querySelector("textarea")`))) throw new Error("trang chủ không tải được");
  // Người mới bắt đầu ở Tự động (chạy qua CLI giả lập): ca này cần model của nhà cung cấp giả lập, nơi có câu trả lời "#artimg".
  await ev(`(async () => { const me = await (await fetch("/api/auth/me")).json(), m = await (await fetch("/api/models")).json(), k = m.providers.flatMap((p) => p.models).find((x) => !x.key.startsWith("sub-"))?.key; if (k) localStorage.setItem("u:" + me.user.id + ":model", k); })()`);
  await P("Page.reload");
  if (!(await until(`!!document.querySelector("textarea")`))) throw new Error("trang chủ không tải được");
  await sleep(1200);
  const r = await ev(`(() => { const el = document.querySelector("textarea"); el.focus(); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  await P("Input.insertText", { text: "Làm trang có ảnh #artimg" });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await P("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  let got;
  for (let t = Date.now(); Date.now() - t < 30000 && !(got = await inFrame(`({ w: document.getElementById("logo").naturalWidth, src: document.getElementById("logo").getAttribute("src").slice(0, 22), bg: getComputedStyle(document.getElementById("nen")).backgroundImage.slice(0, 26) })`))?.w;) await sleep(400);
  ok(got?.w > 0 && got.src.startsWith("data:image/png"), "ảnh <img> từ URL ngoài hiện trong khung (đã nhúng thành data:)", JSON.stringify(got));
  ok(/^url\("data:image\/png/.test(got?.bg ?? ""), "ảnh nền CSS url(...) cũng được nhúng", JSON.stringify(got));
  const { data } = await P("Page.captureScreenshot", { format: "png" });
  writeFileSync(SCR + "artimg.png", Buffer.from(data, "base64"));
} finally {
  chrome.kill();
}
console.log(fail ? `\n${fail} lỗi` : "\nTất cả đạt");
process.exitCode = fail ? 1 : 0;
