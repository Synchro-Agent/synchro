// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/error-notice.mjs
// Hết hạn mức giữa chừng: chữ đã viết vẫn còn, lời báo hiện riêng kèm mốc dùng lại được và nút đổi model; bấm nút thì gửi tiếp. Chặn /api/llm bằng phản hồi dựng sẵn
// nên không cần đăng nhập gói giả lập.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const B = "http://localhost:3200";
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-error-notice";
rmSync(PROF, { recursive: true, force: true });
let cookie = "";
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("login failed");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9352", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
try {
  let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9352/json/version").then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0, calls = 0; const waits = new Map(), bodies = [];
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const reset = Date.now() + 2 * 3600_000;
  const FAIL = { error: "Gói Claude của bạn đã hết hạn mức.", planLimit: "claude", quota: "plan", resetsAt: reset, apiModel: null, text: "Phần đã viết trước khi hết hạn mức.", switchTo: { model: "sub-codex/default", name: "ChatGPT Mock" } };
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
    if (m.method === "Fetch.requestPaused") {
      calls++;
      try { bodies.push(JSON.parse(m.params.request.postData ?? "{}")); } catch {}
      const first = calls === 1;
      send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: first ? 429 : 200, responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(first ? FAIL : { model: "sub-codex/default", text: "Đã làm tiếp xong." })).toString("base64") }, m.sessionId).catch(() => {});
    }
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable");
  await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await P("Fetch.enable", { patterns: [{ urlPattern: "*/api/llm*", requestStage: "Request" }] });
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval"); return r.result.value; };
  const until = async (expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(250); } return false; };
  const click = async (expr) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("not found: " + expr);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };
  await P("Page.navigate", { url: B + "/" });
  if (!(await until(`!!document.querySelector("textarea")`, 30000))) throw new Error("trang chủ không tải được");
  await click(`document.querySelector("textarea")`);
  await P("Input.insertText", { text: "Viết giúp mình một bài dài" });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await P("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  say(await until(`!!document.querySelector(".msg-notice")`, 15000), "lượt lỗi: có khung thông báo riêng");
  const bubble = await ev(`[...document.querySelectorAll(".ai-msg")].at(-1)?.textContent ?? ""`);
  say(/Phần đã viết trước khi hết hạn mức/.test(bubble), `chữ đã viết vẫn còn: “${bubble.slice(0, 80)}”`);
  const notice = await ev(`document.querySelector(".msg-notice").textContent`);
  say(/hết hạn mức|hit its limit/.test(notice) && /Dùng lại được|Available again/.test(notice), `lời báo kèm mốc dùng lại được: “${notice.slice(0, 140)}”`);
  say(await ev(`!![...document.querySelectorAll(".msg-notice button")].find((b) => /ChatGPT Mock|Tự động|Auto/.test(b.textContent))`), "có nút đổi model");
  await click(`document.querySelector(".msg-notice .btn")`);
  say(await until(`[...document.querySelectorAll(".ai-msg")].at(-1)?.textContent.includes("Đã làm tiếp xong")`, 15000), "bấm nút: gửi tiếp và có câu trả lời");
  const b2 = bodies.at(-1) ?? {};
  say(b2.messages?.at(-1)?.role === "user" && /Tiếp tục|Continue/.test(String(b2.messages.at(-1).content)), `lượt sau là lời làm tiếp, không gửi lại từ đầu: ${JSON.stringify(b2.messages?.at(-1)).slice(0, 100)}`);
  say(b2.messages?.some((m) => m.role === "assistant" && /Phần đã viết/.test(String(m.content)) && m.trace?.some((t) => /ngắt giữa chừng/.test(t.summary))), "lịch sử có phần đã viết, đánh dấu chưa xong");
  say(typeof b2.histTotal === "number" && typeof b2.tz === "string", "gửi kèm số tin thật và múi giờ");
} finally {
  chrome.kill();
}
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exitCode = fails ? 1 : 0;
