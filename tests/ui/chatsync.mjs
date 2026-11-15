// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/apps.mjs
// Đoạn chat theo tài khoản: chuyển dần từ trình duyệt lên máy chủ, thiết bị mới thấy đủ, trình duyệt hết chỗ thì báo; xóa có xác nhận và lan lên máy chủ; chia sẻ thật.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { idbRows, idbWipe } from "../lib/idbchats.mjs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
(await import("node:fs")).mkdirSync(SCR, { recursive: true });
const DL = SCR + "dl", PROF = SCR + "chrome-prof-sync";
rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
rmSync(PROF, { recursive: true, force: true });
const ONLY = process.argv[2] ?? "";

// Tài khoản test của bản local, xóa mức dùng cũ.
const email = process.env.ADMIN ? "admin@synchro.test" : "chatsync-ui@synchro.test", password = process.env.ADMIN ? "synchro-mock-123" : "Member-pass-123";
let cookie = "";
const api = async (p, body) => {
  const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return r.status;
};
await api("/api/auth/signup", { email, password, profile: { fullName: "Sync UI Tester", birthDate: "2000-01-01" } });
await api("/api/auth/login", { email, password });
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email); db.close(); }
if (!cookie) throw new Error("login failed");
// Quyền mặc định của thành viên do quản trị viên đặt (có thể tắt Skills): cấp đủ quyền cho tài khoản test.
{ let ac = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
  if (!ac) { const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) }); ac = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0] ?? ""; }
  const u = (await (await fetch(B + "/api/admin", { headers: { cookie: ac } })).json()).users.find((x) => x.email === email);
  if (u) await fetch(B + `/api/admin/users/${u.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: B, cookie: ac }, body: JSON.stringify({ action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } }) }); }

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), ["--headless=new", "--remote-debugging-port=9341", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9341/json/version").then((r) => r.json()).catch(() => null); }

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
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}sync-${n}.png`, Buffer.from(data, "base64")); };
const server = async (p) => (await fetch(B + p, { headers: { cookie } })).json();
const onServer = async () => (await server("/api/chats?since=0")).items;
const reload = async () => { await P("Page.reload"); await until(`!!document.querySelector("textarea")`, 30000, "app loaded"); };
try {
  const uid = (await server("/api/auth/me")).user.id;
  // Dữ liệu cũ của tài khoản thử: bắt đầu sạch cả hai phía.
  await fetch(B + "/api/chats", { method: "PUT", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify({ wipe: Date.now() }) });
  await sleep(20);
  const id = Date.now(), inc = id + 1, chat = { id, title: "Báo cáo cũ trong trình duyệt", msgs: [{ role: "user", text: "Câu hỏi cũ OLD123", time: id, done: true }, { role: "ai", text: "Trả lời cũ", time: id + 1, done: true }] };

  console.log("1. Chuyển dần: đoạn chat cũ trong trình duyệt lên máy chủ, bản trong trình duyệt vẫn còn");
  await ev(`localStorage.removeItem("u:${uid}:chatSync"); localStorage.setItem("u:${uid}:chats", ${JSON.stringify(JSON.stringify([chat, { ...chat, id: inc, title: "Ẩn danh", inc: true }]))}); 1`);
  await reload();
  await until(`[...document.querySelectorAll(".chat-item")].some((e) => e.textContent.includes("Báo cáo cũ"))`, 15000, "chat hiện ở thanh bên");
  const t0 = Date.now(); let items = [];
  while (Date.now() - t0 < 15000) { items = await onServer(); if (items.some((x) => x.id === String(id) && !x.deleted)) break; await sleep(500); }
  ok(items.some((x) => x.id === String(id) && !x.deleted && x.data.includes("OLD123")), "đoạn chat cũ đã lên máy chủ", JSON.stringify(items).slice(0, 300));
  ok(!items.some((x) => x.id === String(inc)), "đoạn chat ẩn danh không lên máy chủ");
  ok(await ev(`(localStorage.getItem("u:${uid}:chats") ?? "").includes("OLD123")`), "khóa cũ trong trình duyệt vẫn còn sau khi máy chủ đã nhận (giữ 7 ngày)");
  // Khóa localStorage cũ đã được nhập vào kho IndexedDB của thiết bị (ui/chatidb.ts); đoạn ẩn danh thì không.
  const rows1 = await ev(idbRows(uid));
  ok(rows1.some((r) => r.id === id && (r.body ?? "").includes("OLD123")) && !rows1.some((r) => r.id === inc), "kho IndexedDB có thân đoạn chat cũ, không có đoạn ẩn danh", rows1.map((r) => r.id));

  console.log("2. Thiết bị mới (trình duyệt trống) thấy đủ");
  // Thiết bị mới: rời app (để app đóng kho), xóa kho IndexedDB và các khóa u:<uid>:chat* rồi mở lại.
  await P("Page.navigate", { url: B + "/api/auth/me" }); await until(`location.pathname === "/api/auth/me" && document.readyState === "complete"`, 10000, "trang JSON");
  await ev(idbWipe(uid));
  await ev(`for (const k of Object.keys(localStorage)) if (k.startsWith("u:${uid}:chat")) localStorage.removeItem(k); 1`);
  await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("textarea")`, 30000, "app loaded");
  await until(`[...document.querySelectorAll(".chat-item")].some((e) => e.textContent.includes("Báo cáo cũ"))`, 15000, "chat về từ máy chủ");
  await click(byText(".chat-item", "Báo cáo cũ"), "mở chat");
  await until(`document.querySelector(".thread")?.textContent.includes("OLD123")`, 5000, "nội dung về từ máy chủ");
  ok(true, "đoạn chat và nội dung về đủ từ máy chủ");

  console.log("3. Trình duyệt hết chỗ và máy chủ chưa nhận: báo ngay, nhận xong thì thôi báo");
  // Kho đoạn chat (IndexedDB) báo hết chỗ khi ghi thân.
  await ev(`window.__put = IDBObjectStore.prototype.put; window.__fetch = window.fetch;
    IDBObjectStore.prototype.put = function (v, k) { if (this.name === "body") throw new DOMException("full", "QuotaExceededError"); return window.__put.call(this, v, k); };
    window.fetch = (u, o) => (String(u).startsWith("/api/chats") ? Promise.reject(new TypeError("offline")) : window.__fetch(u, o)); 1`);
  await click(`[...document.querySelectorAll(".chat-item")].find((e) => e.textContent.includes("Báo cáo cũ")).parentElement.querySelector(".dots")`, "menu");
  await click(byText(".menu-item", "Ghim"), "ghim");
  await until(`!!document.querySelector(".sync-warn")`, 8000, "dải cảnh báo");
  ok(await ev(`document.querySelector(".sync-warn button") !== null`), "có dải cảnh báo kèm nút xuất dữ liệu");
  await shot("1-warn");
  await ev(`window.fetch = window.__fetch; window.dispatchEvent(new Event("online")); 1`);
  await until(`!document.querySelector(".sync-warn")`, 70000, "hết cảnh báo khi máy chủ đã nhận");
  ok(true, "máy chủ nhận xong thì thôi cảnh báo");
  ok((await onServer()).some((x) => x.id === String(id) && JSON.parse(x.data).pinned === true), "thay đổi đã lên máy chủ");
  await ev(`IDBObjectStore.prototype.put = window.__put; 1`);

  console.log("4. Chia sẻ thật");
  await click(byText("button.btn", "Chia sẻ"), "nút chia sẻ");
  await until(`[...document.querySelectorAll(".sy-modal button")].some((b) => b.textContent.includes("Tạo liên kết"))`, 5000, "hộp chia sẻ");
  await click(byText(".sy-modal button", "Tạo liên kết"), "tạo liên kết");
  await until(`!!document.querySelector(".sh-link input")`, 8000, "có liên kết");
  const link = await ev(`document.querySelector(".sh-link input").value`);
  ok(/\/share\/[\w-]{30,}$/.test(link), "liên kết có mã ngẫu nhiên", link);
  const pub = await fetch(link);
  ok(pub.status === 200 && (await pub.text()).includes("OLD123"), "người chưa đăng nhập mở được liên kết");
  await shot("2-share");
  await click(byText(".sy-modal button", "Dừng chia sẻ"), "dừng chia sẻ");
  await until(`!document.querySelector(".sh-link input")`, 5000, "đã dừng");
  ok((await fetch(link)).status === 404, "dừng chia sẻ thì liên kết 404");
  await click(`document.querySelector(".sy-modal .sy-x")`, "đóng");
  await sleep(300);

  console.log("5. Xóa có xác nhận và lan lên máy chủ");
  await click(`[...document.querySelectorAll(".chat-item")].find((e) => e.textContent.includes("Báo cáo cũ")).parentElement.querySelector(".dots")`, "menu");
  await click(byText(".menu-item", "Xóa"), "xóa");
  await until(`!!document.querySelector(".cf-top .btn.danger")`, 3000, "hộp xác nhận");
  ok(await ev(`document.querySelector(".cf-top").textContent.includes("Bộ não")`), "hộp xác nhận nói rõ phần Bộ não");
  await click(`document.querySelector(".cf-top .btn.danger")`, "xác nhận");
  const t1 = Date.now(); let gone = false;
  while (Date.now() - t1 < 10000 && !gone) { gone = (await onServer()).some((x) => x.id === String(id) && x.deleted); await sleep(400); }
  ok(gone, "máy chủ đã xóa đoạn chat");
  await reload(); await sleep(2500);
  ok(!(await ev(`[...document.querySelectorAll(".chat-item")].some((e) => e.textContent.includes("Báo cáo cũ"))`)), "tải lại không sống lại");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
