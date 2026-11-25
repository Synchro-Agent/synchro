// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/apps.mjs
// Autopilot: giao việc từ mẫu, kết quả vào Autopilot (có số đếm trên thanh bên), mở đoạn chat kết quả, địa chỉ cũ
// #v=inbox.
import { waitFor } from "../lib/wait.mjs";
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
// Ô chọn của app (ui/listbox.tsx): bấm nút, chờ danh sách, bấm mục có data-value cần chọn.
const pickDd = async (btn, v) => { await ev(`(${btn}).click(), 1`); await until(`!!document.querySelector('.dd-pop [role=option][data-value=${JSON.stringify(String(v))}]')`, 5000, "mục " + v); await ev(`document.querySelector('.dd-pop [role=option][data-value=${JSON.stringify(String(v))}]').click(), 1`); };
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





const results = [];
const ok = (c, n, x = "") => { results.push([c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}inbox-${n}.png`, Buffer.from(data, "base64")); };
try {
  await sleep(800);
  await click(byText(".nav-item", "Autopilot"), "inbox");
  ok(await waitFor(() => ev(`!!document.querySelector(".tk-top")`), 8000), "trang Autopilot mở từ thanh bên");
  // Autopilot thành trung tâm tự động hóa (5917e17): nút "Tác vụ nền mới" và chip mẫu .tk-tpl được thay bằng ô giao việc (.tk-comp):
  // chip ví dụ điền sẵn câu, "Lên kế hoạch" mở thẻ kế hoạch (.tk-modal) đã điền tên, yêu cầu, lịch.
  await click(byText(".tk-comp .tk-ex .chip", "Bản tin AI buổi sáng"), "example"); await sleep(200);
  await click(byText(".tk-comp .btn.dark", "Lên kế hoạch"), "plan");
  await until(`!!document.querySelector(".tk-modal")`, 30000, "plan modal");
  ok(await ev(`document.querySelector(".tk-modal textarea").value.length > 20`), "lên kế hoạch từ ví dụ: điền sẵn tên, yêu cầu, lịch");
  // Tên cố định để các bước sau tìm đúng kết quả "Bản tin buổi sáng" (model lên kế hoạch tự đặt tên khác).
  await ev(`(() => { const i = document.querySelector(".tk-modal input.field"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Bản tin buổi sáng"); i.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
  await shot("1-form");
  await pickDd(`document.querySelector(".tk-modal .tk-kind")`, "once");
  await sleep(200);
  await click(`document.querySelector(".tk-modal .modal-foot .btn.dark")`, "save");
  await until(`!document.querySelector(".tk-modal")`, 10000, "form closed");
  await click(byText(".pl-seg button", "Kết quả"), "results tab");
  // Chỉ tính kết quả mới (chưa đọc): tài khoản test có thể còn kết quả cũ từ lần chạy trước.
  await until(`[...document.querySelectorAll(".tk-item.unread")].some((e) => e.textContent.includes("Bản tin buổi sáng") && !e.querySelector(".tk-dot.running"))`, 60000, "result in inbox");
  ok(true, "tác vụ chạy ở nền, kết quả hiện trong Autopilot");
  await P("Page.reload", {});
  // Chờ app tải lại xong (thanh bên có số chưa đọc) thay vì 3 giây cố định (H2.3).
  await waitFor(() => ev(`Number(document.querySelector(".nav-badge")?.textContent) >= 1`), 20000);
  const badge = await ev(`document.querySelector(".nav-badge")?.textContent ?? ""`);
  ok(Number(badge) >= 1, "thanh bên hiện số kết quả chưa đọc: " + badge);
  await click(byText(".nav-item", "Autopilot"), "inbox");
  // Danh sách kết quả tải sau khung chờ (máy chậm: hơn 1,5 giây): chờ đúng mục thay vì chờ cố định (H2.3).
  const item = `[...document.querySelectorAll(".tk-item.unread .tk-row")].find((e) => e.textContent.includes("Bản tin buổi sáng"))`;
  await until(`!!${item}`, 15000, "result row");
  await click(item, "open item");
  ok(await waitFor(() => ev(`!!document.querySelector(".tk-body .mdx")`), 6000), "mở kết quả: hiện nội dung đầy đủ");
  await shot("2-result");
  // Kết quả đã là một đoạn chat thường máy chủ tạo sẵn (thẻ Autopilot, đồng bộ về mọi thiết bị): nút mở đúng đoạn
  // chat đó.
  await click(byText(".tk-acts .btn", "Mở đoạn chat để hỏi tiếp"), "as chat");
  ok(await waitFor(() => ev(`document.querySelectorAll(".ai-msg").length >= 1 && /Bản tin buổi sáng/.test(document.body.innerText)`), 10000),
    "mở đoạn chat kết quả để hỏi tiếp");
  const listed = `/#c=\\d+/.test(location.hash) && [...document.querySelectorAll(".chat-item")]
    .some((e) => /Bản tin buổi sáng/.test(e.textContent))`;
  ok(await waitFor(() => ev(listed), 10000), "đoạn chat kết quả có trong danh sách đoạn chat ở thanh bên");
  await shot("3-chat");
  // Địa chỉ cũ #v=inbox (dấu trang, email cũ) mở đúng trang Autopilot và tự đổi sang #v=autopilot.
  await ev(`(location.hash = "#v=inbox", 1)`);
  ok(await waitFor(() => ev(`!!document.querySelector(".tk-top") && location.hash === "#v=autopilot"`), 8000),
    "#v=inbox → trang Autopilot, địa chỉ #v=autopilot");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
