// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/skill-hub.mjs
// Ảnh chụp so sánh giao diện (visual regression): chụp các màn hình chính vào thư mục OUT, rồi so với lần chụp trước bằng tests/ui/diff.py.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
(await import("node:fs")).mkdirSync(SCR, { recursive: true });
const DL = SCR + "dl", PROF = SCR + "chrome-prof";
rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
rmSync(PROF, { recursive: true, force: true });
const ONLY = process.argv[2] ?? "";

// Tài khoản test của bản local, xóa mức dùng cũ.
const email = process.env.ADMIN ? "admin@synchro.test" : "dl-member@synchro.test", password = process.env.ADMIN ? "synchro-mock-123" : "Member-pass-123";
let cookie = "";
const api = async (p, body) => {
  const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return r.status;
};
await api("/api/auth/signup", { email, password, profile: { fullName: "Download Tester", birthDate: "2000-01-01" } });
await api("/api/auth/login", { email, password });
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email); db.close(); }
if (!cookie) throw new Error("login failed");

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9334/json/version").then((r) => r.json()).catch(() => null); }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(); const handlers = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); }
  else if (m.method) for (const h of handlers) h(m);
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const downloads = [];
handlers.push((m) => {
  if (m.method === "Browser.downloadWillBegin") downloads.push({ guid: m.params.guid, name: m.params.suggestedFilename, state: "start" });
  if (m.method === "Browser.downloadProgress") { const d = downloads.find((x) => x.guid === m.params.guid); if (d && m.params.state !== "inProgress") d.state = m.params.state; }
});
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
const logs = [];
handlers.push((m) => { if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")); });
// Khung artifact (sandbox, nguồn gốc ẩn danh) chạy ở tiến trình riêng: gắn vào từng khung con để chặn in và đọc log.
handlers.push(async (m) => {
  if (m.method !== "Target.attachedToTarget") return;
  const s = m.params.sessionId;
  await send("Runtime.enable", {}, s).catch(() => {});
  await send("Page.enable", {}, s).catch(() => {});
  await send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK, runImmediately: true }, s).catch(() => {});
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s).catch(() => {});
  await send("Runtime.runIfWaitingForDebugger", {}, s).catch(() => {});
});
await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
await P("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
// Chặn hộp thoại in ở mọi khung (kể cả khung artifact và khung ẩn cùng nguồn gốc), ghi lại nội dung sẽ in.
var HOOK; await P("Page.addScriptToEvaluateOnNewDocument", { runImmediately: true, source: HOOK = `(() => {
  const hook = (w) => { try { w.print = () => { const d = w.document; console.log("PRINT", JSON.stringify({ title: d.title, slides: d.querySelectorAll("section.slide,[data-slide]").length, html: d.documentElement.outerHTML })); }; } catch {} };
  hook(window);
  if (window === top) new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.tagName === "IFRAME" && !n.src && !n.srcdoc) hook(n.contentWindow); }).observe(document, { childList: true, subtree: true });
})();` });

const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(300); } throw new Error("timeout: " + what); };
// Bấm chuột thật vào giữa phần tử.
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  const hit = await ev(`(() => { const e = document.elementFromPoint(${r[0]}, ${r[1]}); return e ? e.tagName + "." + e.className : "none"; })()`);
  if (process.env.DBG) { await sleep(250); console.log("    click", what, r.map(Math.round), "→", hit, await ev("JSON.stringify(window.__ev)")); }
  if (process.env.DBG) await ev(`window.__ev = []; for (const t of ["pointerdown","mousedown","mouseup","click"]) addEventListener(t, (e) => __ev.push(t + ":" + e.target.tagName), { capture: true, once: true }); 1`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;

await P("Page.navigate", { url: B + "/" });
await until(`!!document.querySelector("textarea")`, 30000, "app loaded");
await sleep(1500);




const OUT = process.argv[2] ?? SCR + "shots";
mkdirSync(OUT, { recursive: true });
const shot = async (n) => { await sleep(700); const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(data, "base64")); };
// Tắt mọi hiệu ứng chuyển động để ảnh chụp ổn định giữa hai lần. CSS của app nằm trong @layer (B5): !important không lớp thua !important
// trong lớp, nên luật tắt đặt vào lớp được khai báo ĐẦU TIÊN (đọc từ trang) — !important ở lớp đầu thắng !important ở mọi lớp sau.
const FREEZE = `(() => { let first = null;
  for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules) { if (r instanceof CSSLayerStatementRule) { first = r.nameList[0]; break; } if (r instanceof CSSLayerBlockRule) { first = r.name; break; } if (!(r instanceof CSSImportRule)) break; }
    if (first) break; }
  const css = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  const s = document.createElement("style"); s.textContent = first ? "@layer " + first + "{" + css + "}" : css; document.head.appendChild(s); return 1; })()`;
await ev(FREEZE);
await sleep(800);
// SNAP_ALL=1: mọi màn chính × 1440 / 768 / 390px × sáng / tối (B5: thay đổi CSS phải giữ ảnh <0.1% ở cả điện thoại và giao diện tối).
// Tên ảnh: <rộng>-<màn>-<chủ đề>.png. Không đặt thì chụp 6 màn 1440px sáng như cũ.
if (process.env.SNAP_ALL) {
  const VIEWS = [{ w: 1440, h: 900, mobile: false }, { w: 768, h: 1024, mobile: false }, { w: 390, h: 844, mobile: true }];
  const both = async (n) => { for (const t of ["light", "dark"]) { await ev(`document.documentElement.setAttribute("data-theme", "${t}"); 1`); await sleep(300); await shot(`${n}-${t}`); } await ev(`document.documentElement.setAttribute("data-theme", "light"); 1`); };
  const openSide = async (v) => { if (v.mobile && !(await ev(`!!document.querySelector(".shell-side:not(.closed)")`).catch(() => false))) { await click(`document.querySelector(".side-toggle")`, "drawer"); await sleep(600); } };
  process.on("exit", () => { try { chrome.kill(); } catch {} });
  let sent = false;
  for (const v of VIEWS) {
    await P("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.mobile });
    await P("Page.navigate", { url: B + "/" });
    await until(`!!document.querySelector("textarea")`, 30000, "app loaded");
    await sleep(1500); await ev(FREEZE); await sleep(500);
    await both(`${v.w}-home`);
    if (!sent) {
      await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: "Làm trang web cho quán cà phê" });
      await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
      await until(`document.querySelectorAll(".art-card:not(.busy)").length > 0 && !document.querySelector(".thinking")`, 60000, "reply");
      await sleep(3500); sent = true;
    } else { await openSide(v); await click(`document.querySelector(".chat-item")`, "chat"); await sleep(2500); }
    await both(`${v.w}-chat`);
    if (v.mobile) { await openSide(v); await both(`${v.w}-drawer`); }
    for (const [nav, n] of [["Artifacts", "artifacts"], ["Kỹ năng", "hub"], ["Dự án", "projects"]]) { await openSide(v); await click(byText(".nav-item", nav), n); await sleep(2500); await both(`${v.w}-${n}`); }
    await openSide(v);
    // Nút tài khoản: tên đầy đủ ở thanh bên rộng, chữ viết tắt "DT" ở thanh rail.
    try {
      await click(`[...document.querySelectorAll("aside button, nav button, button")].find((e) => [e.textContent, e.getAttribute("aria-label"), e.title].join(" ").includes("Download Tester") || e.textContent.trim() === "DT")`, "user"); await sleep(600);
      await both(`${v.w}-usermenu`);
      await click(byText(".menu-item", "Cài đặt"), "settings"); await sleep(2000); await both(`${v.w}-settings`);
    } catch (e) { console.log(`  ✗ ${v.w}px: ${e.message}`); }
  }
  console.log("đã chụp vào", OUT);
  ws.close(); chrome.kill(); process.exit(0);
}
await shot("home");
// Hồ sơ Chrome mới nên chưa có đoạn chat: gửi một yêu cầu (model giả lập trả lời cố định) rồi chụp.
await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: "Làm trang web cho quán cà phê" });
await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
await until(`document.querySelectorAll(".art-card:not(.busy)").length > 0 && !document.querySelector(".thinking")`, 60000, "reply");
await sleep(3500);
await shot("chat");
await click(byText(".nav-item", "Artifacts"), "artifacts"); await sleep(2500); await shot("artifacts");
await click(byText(".nav-item", "Kỹ năng"), "hub"); await sleep(2000); await shot("hub");
await click(`[...document.querySelectorAll("aside button")].find((e) => e.textContent.includes("Download Tester"))`, "user"); await sleep(500);
await shot("usermenu");
await click(byText(".menu-item", "Cài đặt"), "settings"); await sleep(1500); await shot("settings");
console.log("đã chụp vào", OUT);
ws.close(); chrome.kill(); process.exit(0);
