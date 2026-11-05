// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/layers.mjs
// Khung phủ toàn màn hình mở từ trong một trang (xem artifact, sửa việc tự động) phải nằm trên thanh bên: trước đây animation hiện dần của
// .page biến trang thành một lớp xếp chồng riêng nằm dưới thanh bên (z-index 20), thanh bên che mất nửa trái khung xem artifact.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-layers";
rmSync(PROF, { recursive: true, force: true });

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", "--remote-debugging-port=9340", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9340/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); }
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable");
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });

const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const results = [];
const ok = (c, n, x = "") => { results.push([c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}layers-${n}.png`, Buffer.from(data, "base64")); };
// Điểm cách góc trên bên trái của khung 24px (nằm ngang chỗ thanh bên) phải thuộc khung, không thuộc thanh bên.
const onTop = (overlay, box) => ev(`(() => { const b = document.querySelector(${JSON.stringify(box)})?.getBoundingClientRect(); if (!b) return "no box"; const side = document.querySelector("aside.sidebar").getBoundingClientRect(); const x = Math.min(b.x + 24, side.right - 12), y = b.y + 24; if (x < b.x) return "box right of sidebar"; const el = document.elementFromPoint(x, y); return el?.closest(${JSON.stringify(overlay)}) ? "overlay" : el?.closest(".sidebar") ? "sidebar" : String(el?.className); })()`);

try {
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`, 30000, "app");
  await sleep(800);
  await click(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim() === "Artifacts")`, "artifacts");
  await until(`!!document.querySelector(".art-tile")`, 15000, "artifact tiles");
  await sleep(1200);
  ok(await ev(`getComputedStyle(document.querySelector(".page")).opacity === "1" && document.querySelector(".page").getAnimations().length === 0`), "trang hiện dần xong thì không còn hiệu ứng nào gắn trên .page");
  await ev(`document.querySelector(".art-tile").click(), 1`);
  await until(`!!document.querySelector(".art-modal .art-panel")`, 20000, "artifact modal");
  await sleep(500);
  const a = await onTop(".art-modal", ".art-modal .art-panel");
  ok(a === "overlay", "khung xem artifact nằm trên thanh bên (không bị che nửa trái)", a);
  await shot("1-artifact");
  ok(await ev(`document.querySelector(".art-modal [role=dialog]")?.getAttribute("aria-modal") === "true" && document.querySelector("aside.sidebar").closest("[inert]") !== null`), "khung xem là hộp thoại thật: nền không nhận Tab, trình đọc màn hình biết");
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await sleep(100);
  ok(await ev(`!!document.activeElement?.closest(".art-modal")`), "Tab ở trong khung xem, không rơi xuống các thẻ phía sau");
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(400);
  ok(await ev(`!document.querySelector(".art-modal")`), "Esc đóng khung xem");
  // Xóa một artifact: hỏi lại trước, Enter trên nút xóa không mở khung xem.
  const tiles0 = await ev(`document.querySelectorAll(".art-tile").length`);
  // Đóng khung xem trả tiêu điểm về chỗ cũ sau hiệu ứng đóng; máy bận thì việc đó tới muộn và cướp lại tiêu điểm, Enter rơi vào nút khác. Đặt lại tới khi đứng yên.
  { const t = Date.now(); let still = 0; while (Date.now() - t < 5000 && still < 4) { const on = await ev(`document.activeElement === document.querySelector(".art-tile .icon-btn")`); if (on) still++; else { still = 0; await ev(`document.querySelector(".art-tile .icon-btn").focus(), 1`); } await sleep(100); } }
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await P("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  // Khung hỏi lại tải dần trên máy bận: chờ tới khi hiện, rồi xét không có khung xem artifact.
  { const t = Date.now(); while (Date.now() - t < 4000 && !(await ev(`!!document.querySelector(".overlay.cf-top")`))) await sleep(150); }
  ok(await ev(`!!document.querySelector(".overlay.cf-top") && !document.querySelector(".art-modal")`), "nút xóa hỏi lại, không mở artifact đằng sau",
    await ev(`JSON.stringify({ confirm: !!document.querySelector(".overlay.cf-top"), modal: !!document.querySelector(".art-modal"), active: document.activeElement?.tagName + "." + document.activeElement?.className, label: document.activeElement?.getAttribute("aria-label"), tiles: document.querySelectorAll(".art-tile").length })`));
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(400);
  ok(await ev(`!document.querySelector(".overlay.cf-top") && document.querySelectorAll(".art-tile").length === ${tiles0}`), "hủy thì artifact còn nguyên");
  await click(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Hộp thư"))`, "inbox");
  // Thẻ "Việc tự động" của Hộp thư: nút Sửa của việc đầu tiên.
  await until(`!![...document.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("Việc tự động"))`, 15000, "jobs tab");
  await ev(`[...document.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("Việc tự động")).click(), 1`);
  await until(`!!document.querySelector(".tk-acts .btn.ghost")`, 15000, "task edit button");
  await sleep(1200);
  await ev(`document.querySelector(".tk-acts .btn.ghost").click(), 1`);
  await until(`!!document.querySelector(".modal.tk-modal")`, 10000, "task modal");
  await sleep(500);
  const t = await onTop(".overlay", ".modal.tk-modal");
  ok(t === "overlay" || t === "box right of sidebar", "khung sửa việc tự động nằm trên thanh bên", t);
  await shot("2-task");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
