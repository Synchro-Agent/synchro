// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/skill-hub.mjs
// Kho kỹ năng (gộp Skills + Plugins): thanh bên, trang gộp, menu Thêm, thả tệp, Cài đặt. Chạy bằng Chrome ẩn trên dev:mock.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
(await import("node:fs")).mkdirSync(SCR, { recursive: true });
// Skill mẫu để thử kéo thả tệp vào Kho kỹ năng.
mkdirSync(SCR + "hubfix", { recursive: true });
writeFileSync(SCR + "hubfix/SKILL.md", "---\nname: meeting-notes\ndescription: Turn rough meeting notes into a clean summary with decisions, owners and deadlines.\n---\n# Meeting notes\nWrite a short summary, then a table of decisions with owner and deadline.\n");
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



const results = [];
const ok = (c, n, x = "") => { results.push([c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}hub-${n}.png`, Buffer.from(data, "base64")); };
const text = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.innerText.trim()).join(" | ")`);
const api2 = (m, p, b) => fetch(B + p, { method: m, headers: { "content-type": "application/json", origin: B, cookie }, body: b && JSON.stringify(b) }).then((r) => r.json().catch(() => ({})));
await api2("DELETE", "/api/skills/meeting-notes");
try {
  const nav = await text(".sidebar .nav-item, aside .nav-item");
  ok(/Kho kỹ năng/.test(nav) && !/Kỹ năng\b(?! )/.test(nav.replace("Kho kỹ năng", "")), "thanh bên có mục Kho kỹ năng: " + nav, nav);
  ok(await ev(`!!${byText(".nav-item", "Kho kỹ năng")}?.querySelector("svg")`), "mục có icon");
  await click(byText(".nav-item", "Kho kỹ năng"), "nav"); await sleep(1500);
  await until(`!!document.querySelector(".hub-yours")`, 15000, "hub page");
  const cz = await text(".cz-nav button");
  ok(/^Kho kỹ năng( \| Connectors)?$/.test(cz), "trang Tùy chỉnh không còn Skills / Plugins riêng: " + cz, cz);
  const title = await text(".pl-title"), secs = await text(".pl-sec");
  ok(title === "Kho kỹ năng", "tiêu đề: " + title);
  ok(/Thư viện cho mọi người/.test(secs) && /Skill của bạn/.test(secs), "các phần: " + secs, secs);
  ok(await ev(`!!document.querySelector(".hub-yours .gh-add input")`), "ô Thêm từ GitHub nằm ngay đầu trang");
  await shot("1-page");

  await click(`document.querySelector(".pl-add")`, "Thêm"); await sleep(600);
  const menu = await text(".pl-menu .pl-mi b");
  ok(/Thêm từ GitHub/.test(menu) && /Tải lên skill/.test(menu) && /Duyệt danh mục/.test(menu), "menu Thêm: " + menu, menu);
  await shot("2-menu");
  await click(byText(".pl-menu .menu-item", "Thêm từ GitHub"), "menu GitHub"); await sleep(700);
  ok(await ev(`document.activeElement === document.querySelector(".hub-yours .gh-add input")`), "chọn Thêm từ GitHub → con trỏ vào ô link");

  // Kéo thả tệp SKILL.md vào giữa trang
  const at = await ev(`(() => { const b = document.querySelector(".pl-tip").getBoundingClientRect(); return [b.x + 60, b.y + 5]; })()`);
  const data = { items: [], files: [SCR + "hubfix/SKILL.md"], dragOperationsMask: 1 };
  await P("Input.dispatchDragEvent", { type: "dragEnter", x: at[0], y: at[1], data });
  await P("Input.dispatchDragEvent", { type: "dragOver", x: at[0], y: at[1], data });
  await sleep(300);
  ok(await ev(`!!document.querySelector(".hub-drop")`), "kéo tệp vào → hiện vùng thả");
  await shot("3-drag");
  await P("Input.dispatchDragEvent", { type: "dragLeave", x: 5, y: 5, data }).catch(() => {});
  // Thả tệp thật (DataTransfer chứa File) lên trang
  const md = JSON.stringify(readFileSync(SCR + "hubfix/SKILL.md", "utf8"));
  await ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${md}], "SKILL.md", { type: "text/markdown" })); const el = document.querySelector(".pl-tip"); for (const t of ["dragover", "drop"]) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })); return 1; })()`);
  await until(`!!document.querySelector(".sk-modal")`, 20000, "skill preview after drop");
  ok(/meeting-notes/.test(await text(".sk-modal .sk-mh")), "thả tệp → mở bản xem trước skill");
  await click(`document.querySelector(".sk-modal .sk-actions .btn.dark")`, "add"); 
  await until(`[...document.querySelectorAll(".hub-yours .pl-row2 b")].some((b) => b.textContent === "meeting-notes")`, 15000, "listed");
  ok(true, "skill lẻ hiện trong phần Skill của bạn, cùng kiểu hàng với thư viện");
  await shot("4-added");
  // Bật tắt ngay trên hàng
  await click(`[...document.querySelectorAll(".hub-yours .pl-row2")].find((r) => r.querySelector("b")?.textContent === "meeting-notes").querySelector(".toggle")`, "toggle");
  await sleep(800);
  ok((await api2("GET", "/api/skills")).skills.find((s) => s.name === "meeting-notes")?.enabled === false && !(await ev(`!!document.querySelector(".sk-modal")`)), "nút bật/tắt trên hàng hoạt động, không mở chi tiết");
  await click(`[...document.querySelectorAll(".hub-yours .pl-row2")].find((r) => r.querySelector("b")?.textContent === "meeting-notes")`, "row");
  await until(`!!document.querySelector(".sk-modal")`, 10000, "detail");
  ok(true, "bấm vào hàng → mở chi tiết skill");
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await ev(`document.querySelector(".sk-mask")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })) ?? 0`); await sleep(400);

  // Tìm kiếm lọc cả thư viện lẫn skill
  await click(`document.querySelector(".pl-search input")`, "search"); await P("Input.insertText", { text: "meeting" }); await sleep(500);
  ok(await ev(`document.querySelectorAll(".hub-yours .pl-row2").length === 1`), "tìm kiếm lọc chung thư viện và skill");
  await ev(`(() => { const i = document.querySelector(".pl-search input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);

  // Cài đặt: một mục Kho kỹ năng thay cho Skills + Plugins
  await click(`[...document.querySelectorAll("aside button")].find((e) => e.textContent.includes("Download Tester"))`, "user menu"); await sleep(500);
  const st = await ev(`!!${byText(".menu-item", "Cài đặt")}`);
  if (st) { await click(byText(".menu-item", "Cài đặt"), "settings"); await sleep(1200);
    const tabs = await text(".s-nav button");
    ok(/Kho kỹ năng/.test(tabs) && !/Plugins/.test(tabs), "Cài đặt có mục Kho kỹ năng, không còn Plugins riêng", tabs);
    await click(byText(".s-nav button", "Kho kỹ năng"), "settings hub"); await sleep(1500);
    ok(await ev(`!!document.querySelector(".modal.settings .hub-yours")`), "mở Kho kỹ năng trong Cài đặt");
    await shot("5-settings");
  } else ok(false, "không mở được Cài đặt", await text(".menu-item"));
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
await api2("DELETE", "/api/skills/meeting-notes");
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
