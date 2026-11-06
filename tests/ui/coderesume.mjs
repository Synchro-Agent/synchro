// Synchro Code trên giao diện thật: rời mục Code và tải lại trang giữa lượt không mất lượt, nút Dừng dừng ở máy chủ,
// workspace không dùng được thì nói rõ và để người dùng chọn. Chạy tay: BASE=http://localhost:3277 node tests/ui/coderesume.mjs
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = process.env.BASE ?? "http://localhost:3200", CDP = process.env.CDP_PORT ?? "9361";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-coderesume-" + CDP;
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
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}coderesume-${n}.png`, Buffer.from(data, "base64")); };
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
try {
  // Không phụ thuộc cài đặt còn sót của bài kiểm thử khác: chế độ Tự động, không hỏi duyệt.
  await api("PATCH", "/api/code/prefs", { allowBypass: true, permMode: "auto" });
  // Model giả lập có công cụ, không phụ thuộc model đang chọn của tài khoản thử; nhớ mã phiên để hỏi máy chủ.
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const f = window.fetch; window.fetch = (u, o) => { if (u === "/api/agent" && o?.method === "POST") { const b = JSON.parse(o.body); b.model = "anthropic/claude-haiku-5-5"; window.__sid = b.sid; o = { ...o, body: JSON.stringify(b) }; } return f(u, o); }; })()` });
  await P("Page.navigate", { url: B + "/" });
  await openCode();
  await until(`fetch("/api/ws").then((r) => r.json()).then((j) => j.available)`, 15000, "workspace mock");
  await sleep(1000);

  console.log("1. Rời mục Code giữa lượt");
  await sendMsg(steps([{ tool: "bash", args: { command: "sleep 6 && echo xong > a.txt", description: "Chờ rồi ghi" } }]));
  await until(`!!document.querySelector(".cv-turn") && !!location`, 8000, "turn");
  await sleep(1500);
  await click(`[...document.querySelectorAll(".nav-item")].find((e) => /^(Dự án|Projects)/.test(e.textContent.trim()))`, "Projects");
  await sleep(1000);
  await click(`document.querySelector(".code-item")`, "session");
  await until(`!!document.querySelector(".cv-turn")`, 15000, "session back");
  await sleep(1500);
  ok(await ev(`!!document.querySelector(".cv-dock .send[aria-label*='Dừng'], .cv-dock .send[aria-label*='Stop']") || !!document.querySelector(".ai-streaming")`), "quay lại: vẫn thấy lượt đang chạy, có nút Dừng", await ev(`document.querySelector(".cv-turn")?.innerText`));
  await shot("back");
  await until(`!document.querySelector(".ai-streaming") && !!document.querySelector(".cv-ai .actions")`, 40000, "turn end");
  ok(await ev(`!document.querySelector(".cv-stopped")`), "lượt chạy hết, không bị coi là đã dừng");
  const id = await ev(`window.__sid`);

  ok(!!id, "biết mã phiên");

  console.log("2. Tải lại trang giữa lượt");
  await sendMsg(steps([{ tool: "bash", args: { command: "sleep 6 && echo xong > b.txt", description: "Chờ lần hai" } }]));
  await sleep(2000);
  await P("Page.reload");
  await sleep(1000);
  await until(`!!document.querySelector(".code-item")`, 30000, "session list");
  await click(`document.querySelector(".code-item")`, "session");
  // Vừa mở lại có một nhịp hỏi máy chủ: chờ tới khi lượt được nối lại.
  await until(`!!document.querySelector(".ai-streaming")`, 15000, "reattach");
  ok(await ev(`document.querySelectorAll(".cv-turn").length >= 2`), "tải lại: lượt vẫn ở trong phiên, đang chạy tiếp");
  await until(`!document.querySelector(".ai-streaming")`, 40000, "reload end");
  ok(await ev(`!document.querySelectorAll(".cv-turn")[document.querySelectorAll(".cv-turn").length - 1].querySelector(".cv-stopped")`), "tải lại: lượt chạy hết, có kết quả", await ev(`document.querySelector(".cv-turn:last-child")?.innerText`));

  console.log("3. Nút Dừng dừng ở máy chủ");
  await sendMsg(steps([{ tool: "bash", args: { command: "sleep 8", description: "Chờ lâu" } }]));
  await until(`[...document.querySelectorAll(".cv-turn")].at(-1)?.querySelector(".cv-ai")?.innerText.includes("Chờ lâu")`, 15000, "tool step");
  await click(`document.querySelector(".cv-dock .send")`, "stop");
  await sleep(800);
  const st = (await api("GET", `/api/agent?sid=${id}&json=1`)).j;
  ok(await ev(`!!document.querySelector(".cv-stopped")`), "giao diện báo đã dừng", await ev(`document.querySelector(".cv-dock .send")?.getAttribute("aria-label") + " | " + [...document.querySelectorAll(".cv-turn")].at(-1)?.innerText.slice(0, 200)`));
  const t0 = Date.now();
  for (;;) { const j = (await api("GET", `/api/agent?sid=${id}&json=1`)).j; if (!j?.running || Date.now() - t0 > 15000) { ok(!j?.running, "máy chủ đã dừng lượt", JSON.stringify(st)); break; } await sleep(300); }

  console.log("4. Workspace không dùng được");
  // Giống lúc workspace đang khởi động lại: mở mục Code khi /api/ws báo không dùng được.
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const f = window.fetch; window.__llm = 0; window.fetch = (u, o) => { const s = String(u); if (!localStorage.getItem("__wsOn") && s === "/api/ws" && !o?.method) return Promise.resolve(new Response(JSON.stringify({ available: false, reason: "Workspace đang khởi động lại." }), { status: 200, headers: { "content-type": "application/json" } })); if (s.startsWith("/api/llm") || s.startsWith("/api/runs")) window.__llm++; return f(u, o); }; })()` });
  await P("Page.reload"); await sleep(800);
  await openCode();
  await sleep(500);
  await sendMsg("sửa bug trong repo của tôi");
  await until(`!!document.querySelector(".cv-wswait")`, 8000, "notice");
  ok(await ev(`document.querySelector(".cv-wswait").innerText.includes("Workspace đang khởi động lại.")`), "nói rõ lý do ngay trong luồng");
  ok(await ev(`window.__llm === 0`), "không tự gửi sang trả lời suông");
  await shot("wswait");
  await click(`[...document.querySelectorAll(".cv-wswait button")].find((b) => /Trả lời không/.test(b.textContent))`, "skip");
  await until(`!!document.querySelector(".cv-nows")`, 8000, "label");
  await until(`!document.querySelector(".ai-streaming")`, 30000, "chat reply");
  ok(await ev(`window.__llm >= 1 && !document.querySelector(".cv-wswait")`), "chọn trả lời không cần workspace: có nhãn rõ ràng", await ev(`window.__llm`));
  await shot("nows");
  await sendMsg("sửa tiếp đi");
  await until(`document.querySelectorAll(".cv-nows").length >= 2`, 8000, "second label");
  ok(true, "cùng phiên không hỏi lại, vẫn có nhãn");
  await until(`!document.querySelector(".ai-streaming")`, 30000, "reply 2");

  console.log("5. Tìm phiên Code ở bảng lệnh");
  await P("Page.reload"); await sleep(1000);
  await openCode();
  await until(`!!document.querySelector(".code-item")`, 15000, "code list");
  await click(`document.querySelector(".side-search")`, "search");
  await until(`!!document.querySelector(".overlay input, [role=dialog] input")`, 8000, "palette");
  await sleep(300);
  await P("Input.insertText", { text: "sửa bug trong repo" });
  await sleep(800);
  ok(await ev(`document.body.innerText.includes("Phiên Code")`), "gõ tên phiên: có nhóm Phiên Code", await ev(`document.querySelector(".overlay")?.innerText.slice(0, 300)`));
  await shot("palette");
  await click(`[...document.querySelectorAll(".overlay [data-i]")].find((e) => /sửa bug trong repo/.test(e.textContent))`, "code row");
  await until(`/sửa bug trong repo/.test(document.querySelector(".cv-title")?.textContent ?? "")`, 8000, "open session");
  ok(true, "chọn kết quả thì mở đúng phiên");

  console.log("6. Tiếng Anh");
  await ev(`localStorage.setItem("p:uilang", '"en"'), localStorage.setItem("__wsOn", "1"), 1`);
  await P("Page.navigate", { url: B + "/" }); await sleep(1500);
  await openCode();
  await until(`fetch("/api/ws").then((r) => r.json()).then((j) => j.available)`, 15000, "workspace on");
  await sleep(1200);
  await sendMsg("write the greet helper");
  await until(`!!document.querySelector(".codeblock")`, 20000, "code block");
  await until(`!document.querySelector(".ai-streaming")`, 20000, "reply end");
  const cb = await ev(`document.querySelector(".codeblock").innerText`);
  ok(!/Mở|Sao chép/.test(cb), "nút khối mã không còn tiếng Việt", cb);
  await shot("english");
} catch (e) { fail++; console.log("  ✗", e.message); await shot("fail").catch(() => {}); }
chrome.kill();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
