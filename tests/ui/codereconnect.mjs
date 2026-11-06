// Synchro Code trên giao diện thật: mất mạng giữa lượt không xóa phần đã hiện và thẻ đang chờ duyệt; gửi khi phiên đang có lượt thì nối vào lượt đó và giữ tin chờ gửi;
// lỗi của lượt hiện đúng tiếng Anh. Chạy tay: BASE=http://localhost:3277 node tests/ui/codereconnect.mjs
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = process.env.BASE ?? "http://localhost:3200", CDP = process.env.CDP_PORT ?? "9362";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-codereconnect-" + CDP;
rmSync(PROF, { recursive: true, force: true });
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
if (!cookie) throw new Error("login failed");
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(200); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}codereconnect-${n}.png`, Buffer.from(data, "base64")); };
const codeBox = `document.querySelector(".cv-dock textarea")`;
const openCode = async () => {
  await until(`!![...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Code"))`, 30000, "app");
  await click(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Code"))`, "Code nav");
  await until(`!!${codeBox}`, 30000, "code box");
};
const sendMsg = async (text) => {
  await click(codeBox, "box");
  await P("Input.insertText", { text });
  await sleep(150);
  await click(`document.querySelector(".cv-dock .send")`, "send");
};
const steps = (a) => `Làm theo các bước #seq=${JSON.stringify(a)}`;
const offlineFor = async (ms) => {
  await P("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(ms);
  await P("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
};
const lastTurn = `[...document.querySelectorAll(".cv-turn")].at(-1)`;
try {
  await api("PATCH", "/api/code/prefs", { allowBypass: true, permMode: "auto" });
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const f = window.fetch; window.fetch = (u, o) => { if (u === "/api/agent" && o?.method === "POST") { const b = JSON.parse(o.body); b.model = "anthropic/claude-haiku-5-5"; if (localStorage.getItem("__ask")) b.perm = { mode: "ask", allow: [] }; window.__sid = b.sid; o = { ...o, body: JSON.stringify(b) }; } if (localStorage.getItem("__gone") && String(u).includes("json=1")) return Promise.resolve(new Response(null, { status: 204 })); return f(u, o); }; })()` });
  await P("Page.navigate", { url: B + "/" });
  await openCode();
  await until(`fetch("/api/ws").then((r) => r.json()).then((j) => j.available)`, 15000, "workspace mock");
  await sleep(1000);

  console.log("1. Mất mạng khi đang theo dõi lượt đã nối lại, có thẻ chờ duyệt");
  await ev(`localStorage.setItem("__ask", "1"), 1`);
  await sendMsg(steps([{ tool: "read_file", args: { path: "phan-da-hien.txt" } }, { tool: "bash", args: { command: "echo xong > a.txt", description: "Ghi tệp" } }]));
  await until(`!!document.querySelector(".ag-ask")`, 30000, "ask card");
  const sid = await ev(`window.__sid`); // tải lại trang thì mất
  await sleep(1500);
  await P("Page.reload");
  await sleep(1000);
  await until(`!!document.querySelector(".code-item")`, 30000, "session list");
  await click(`document.querySelector(".code-item")`, "session");
  await until(`!!document.querySelector(".ag-ask")`, 20000, "ask card after reattach");
  ok(await ev(`${lastTurn}.innerText.includes("phan-da-hien.txt")`), "nối lại: thấy phần đã viết và thẻ chờ duyệt");
  await offlineFor(1500);
  await sleep(5000); // follow chờ 3 giây rồi nối lại
  ok(await ev(`${lastTurn}.innerText.includes("phan-da-hien.txt")`), "sau khi có mạng lại: phần đã hiện vẫn còn", await ev(`${lastTurn}.innerText`));
  ok(await ev(`!!document.querySelector(".ag-ask .ag-ask-a .btn.dark")`), "thẻ chờ duyệt vẫn còn nút bấm", await ev(`${lastTurn}.innerHTML.slice(0, 400)`));
  await shot("after-offline");
  await click(`document.querySelector(".ag-ask .ag-ask-a .btn.dark")`, "allow");
  await until(`!document.querySelector(".ai-streaming")`, 30000, "turn end");
  ok(await ev(`!document.querySelector(".cv-stopped") && ${lastTurn}.innerText.includes("phan-da-hien.txt")`), "bấm cho phép được, lượt chạy hết, không mất chữ", await ev(`${lastTurn}.innerText`));
  await ev(`localStorage.removeItem("__ask"), 1`);

  console.log("2. Gửi khi phiên đang có lượt ở nơi khác");
  const before = await ev(`document.querySelectorAll(".cv-turn").length`);
  // Lượt do tab khác khởi động: tab này chưa biết gì.
  const other = fetch(B + "/api/agent", { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify({ sid, model: "anthropic/claude-haiku-5-5", system: "", messages: [{ role: "user", content: steps([{ tool: "bash", args: { command: "sleep 6", description: "Chờ ở tab khác" } }]) }], perm: { mode: "auto", allow: [] }, node: { id: 777001, parent: 0, user: "tab khác", atts: [], mode: "auto", time: Date.now() } }) });
  const otherRes = await other; ok(otherRes.ok, "tab khác đã khởi động lượt", otherRes.status); void otherRes.text().catch(() => {});
  await sleep(600);
  await sendMsg("tin gửi khi đang bận");
  await until(`!!document.querySelector(".wl-q")`, 10000, "queued chip");
  ok(await ev(`document.querySelector(".wl-q").innerText.includes("tin gửi khi đang bận")`), "tin của người dùng nằm trong hàng chờ");
  ok(await ev(`!document.body.innerText.includes("Phiên này đang có một lượt chạy")`), "không báo lỗi lượt đang chạy");
  await until(`document.body.innerText.includes("Chờ ở tab khác")`, 10000, "attached text");
  ok(await ev(`!!document.querySelector(".ai-streaming")`), "thấy lượt đang chạy ở tab khác");
  ok((await api("GET", `/api/agent?sid=${sid}&json=1`)).j?.running === true, "lượt ở máy chủ vẫn chạy");
  ok(await ev(`/Dừng|Stop/.test(document.querySelector(".cv-dock .send")?.getAttribute("aria-label") ?? "")`), "bấm được Dừng", await ev(`document.querySelector(".cv-dock .send")?.outerHTML.slice(0, 200)`));
  await shot("queued");
  await until(`[...document.querySelectorAll(".cv-turn")].some((t) => t.innerText.includes("tin gửi khi đang bận"))`, 30000, "queued message sent");
  ok(await ev(`!document.querySelector(".wl-q")`), "lượt kia xong thì tin tự gửi");
  await until(`!document.querySelector(".ai-streaming")`, 30000, "queued turn end");
  ok(await ev(`document.querySelectorAll(".cv-turn").length`) > before, "lượt mới nằm trong phiên");
  ok(await ev(`!document.body.innerText.includes("Phiên này đang có một lượt chạy")`), "vẫn không có lời báo lỗi");

  console.log("3. Lỗi của lượt theo ngôn ngữ giao diện");
  await sendMsg(steps([{ tool: "bash", args: { command: "sleep 4", description: "Chờ để khởi động lại" } }]));
  await sleep(1500);
  // Máy chủ trả lời không còn lượt nào: giống hệt lúc máy chủ khởi động lại giữa chừng.
  await ev(`localStorage.setItem("p:uilang", '"en"'), localStorage.setItem("__gone", "1"), 1`);
  await P("Page.navigate", { url: B + "/" }); await sleep(1500);
  await until(`!!document.querySelector(".code-item")`, 30000, "session list en");
  await click(`document.querySelector(".code-item")`, "session en");
  await until(`!!document.querySelector(".cv-stopped")`, 20000, "stopped label");
  const t = await ev(`${lastTurn}.innerText`);
  ok(/The server restarted/.test(t) && !/Máy chủ vừa khởi động lại/.test(t), "giao diện tiếng Anh: lý do bằng tiếng Anh", t);
  await shot("gone-en");
  await ev(`localStorage.setItem("p:uilang", '"vi"'), localStorage.removeItem("__gone"), 1`);
} catch (e) { fail++; console.log("  ✗", e.message); await shot("fail").catch(() => {}); }
chrome.kill();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
