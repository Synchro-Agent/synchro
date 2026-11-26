// Bàn phím trong Chrome ẩn: đóng bảng lệnh trả tiêu điểm về ô soạn, Tab trong bảng lệnh không mất chữ, ảnh thu nhỏ không có điểm dừng Tab, tiêu đề thẻ theo màn hình. Chạy tay: BASE=http://localhost:3200 node tests/ui/a11y-focus.mjs
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
const B = process.env.BASE ?? "http://localhost:3200", H = { "content-type": "application/json", origin: B };
const PROF = tmpdir() + "/synchro-ui/chrome-prof-a11yf", PORT = 9348;
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch(B + "/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
const cookie = (login.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0];
if (!cookie) throw new Error("login failed");
rmSync(PROF, { recursive: true, force: true });
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [y, n] = waits.get(m.id); waits.delete(m.id); m.error ? n(new Error(JSON.stringify(m.error))) : y(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((y, n) => { const id = ++seq; waits.set(id, [y, n]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (m, p) => send(m, p, S);
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; };
const key = async (k, code, vk, mods = 0) => { await P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); };
const typeIn = (text) => P("Input.insertText", { text });
// Bộ não không còn trên thanh điều hướng (mở từ menu tài khoản, ⌘K hoặc địa chỉ #v=brain).
const nav = (v) => ev(v === "brain"
  ? `(location.hash = "#v=brain"), 1`
  : `document.querySelector('[data-nav="${v}"]')?.click(), 1`);
try {
  await P("Page.enable"); await P("Runtime.enable"); await P("Network.enable");
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await P("Page.navigate", { url: B + "/" });
  ok(await until(`!!document.querySelector("textarea") && !!document.querySelector("[data-nav=artifacts]")`), "trang chính mở");
  await sleep(800);
  console.log("1. Bảng lệnh");
  await ev(`document.querySelector("textarea").focus(), 1`);
  await key("k", "KeyK", 75, 4);
  ok(await until(`!!document.querySelector(".overlay input")`, 8000), "Cmd+K mở bảng lệnh");
  await sleep(300);
  await typeIn("ab");
  await key("Tab", "Tab", 9);
  ok(await ev(`document.activeElement?.tagName === "INPUT"`), "Tab trong bảng lệnh: tiêu điểm vẫn ở ô nhập", await ev(`document.activeElement?.tagName`));
  await typeIn("c");
  ok((await ev(`document.querySelector(".overlay input")?.value`)) === "abc", "chữ gõ sau Tab không mất", await ev(`document.querySelector(".overlay input")?.value`));
  await key("Escape", "Escape", 27);
  ok(await until(`!document.querySelector(".overlay input")`, 5000), "Esc đóng bảng lệnh");
  ok(await until(`document.activeElement?.tagName === "TEXTAREA"`, 3000), "tiêu điểm về lại ô soạn", await ev(`document.activeElement?.tagName`));
  await typeIn("X");
  ok((await ev(`document.querySelector("textarea").value`)).includes("X"), "gõ tiếp vào được ô soạn");
  await ev(`(() => { const t = document.querySelector("textarea"); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; s.call(t, ""); t.dispatchEvent(new Event("input", { bubbles: true })); })(), 1`);
  console.log("2. Tiêu đề thẻ");
  for (const [v, want] of [["artifacts", /Artifacts · Synchro$/], ["projects", /(Dự án|Projects) · Synchro$/],
    ["autopilot", /Autopilot · Synchro$/], ["brain", /(Bộ não|Brain) · Synchro$/]]) {
    await nav(v); await until(`/ · Synchro$/.test(document.title)`, 3000); await sleep(300);
    const t = await ev(`document.title`);
    ok(want.test(t), `tiêu đề ở ${v}`, t);
  }
  console.log("3. Ảnh thu nhỏ của Artifacts");
  await nav("artifacts"); await sleep(1500);
  const r = JSON.parse(await ev(`JSON.stringify({ thumbs: document.querySelectorAll(".art-thumb").length, live: [...document.querySelectorAll(".art-thumb")].filter((t) => !t.inert).length, nested: document.querySelectorAll(".art-tile[role=button] button").length })`));
  ok(r.live === 0 && r.nested === 0, "ảnh thu nhỏ đều inert, không còn nút lồng", r);
  console.log("4. Nhóm thẻ báo trạng thái");
  await nav("autopilot"); await until(`!!document.querySelector(".tk-tabs [role=tab]")`, 8000);
  ok(await ev(`document.querySelectorAll(".tk-tabs [role=tab][aria-selected=true]").length === 1`),
    "Autopilot có đúng một thẻ đang chọn");
  console.log("5. Tiếng Anh");
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("p:uilang", '"en"'); } catch {}` });
  await P("Page.navigate", { url: B + "/terms" });
  ok(await until(`document.title.includes("Terms")`, 15000), "tiêu đề /terms theo tiếng Anh", await ev(`document.title`));
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("[data-nav=artifacts]")`); await sleep(800);
  await nav("artifacts");
  ok(await until(`!!document.querySelector(".st-tag") && [...document.querySelectorAll(".st-tag")].filter((e) => e.textContent.trim()).every((e) => /^\\d[\\d.,]* skills?$/.test(e.textContent.trim()) && !/^(\\d*[02-9]|\\d+\\d) skill$/.test(e.textContent.trim()))`, 15000), "số nhiều trên thẻ Artifacts", await ev(`[...document.querySelectorAll(".st-tag")].map((e) => e.textContent)`));
} finally { chrome.kill(); }
console.log(`\n${pass} đúng, ${fail} sai`);
process.exit(fail ? 1 : 0);
