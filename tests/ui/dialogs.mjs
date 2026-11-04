// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/apps.mjs
// Hộp thoại giữ tiêu điểm (Tab không thoát ra, Esc trả về đúng chỗ); ⌘K xem tất cả kết quả, tìm tên tệp; đọc to bỏ mã nguồn và ký hiệu; xóa ngữ cảnh dự án có xác nhận.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
(await import("node:fs")).mkdirSync(SCR, { recursive: true });
const DL = SCR + "dl", PROF = SCR + "chrome-prof-dlg";
rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
rmSync(PROF, { recursive: true, force: true });
const ONLY = process.argv[2] ?? "";

// Tài khoản test của bản local, xóa mức dùng cũ.
const email = process.env.ADMIN ? "admin@synchro.test" : "dialogs-ui@synchro.test", password = process.env.ADMIN ? "synchro-mock-123" : "Member-pass-123";
let cookie = "";
const api = async (p, body) => {
  const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return r.status;
};
await api("/api/auth/signup", { email, password, profile: { fullName: "Dialog UI Tester", birthDate: "2000-01-01" } });
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

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), ["--headless=new", "--remote-debugging-port=9342", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9342/json/version").then((r) => r.json()).catch(() => null); }

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
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}dlg-${n}.png`, Buffer.from(data, "base64")); };
const key = (k, code, vk, modifiers = 0) => (async () => { await P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); })();
const inTop = `(() => { const a = document.activeElement, ovs = [...document.querySelectorAll(".overlay")].filter((o) => !o.closest(".closing")); const t = ovs[ovs.length - 1]; return !!t && !!a && t.contains(a); })()`;
try {
  const uid = (await (await fetch(B + "/api/auth/me", { headers: { cookie } })).json()).user.id;
  // Dữ liệu của lần chạy trước (đoạn chat nay đi theo tài khoản): bắt đầu sạch.
  await fetch(B + "/api/chats", { method: "PUT", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify({ wipe: Date.now() }) });
  await sleep(20);
  const base = Date.now();
  const chats = Array.from({ length: 25 }, (_, i) => ({ id: base + i, title: `Báo cáo tháng ${i + 1}`, msgs: [{ role: "user", text: "Tóm tắt giúp", time: base + i, done: true, files: i === 0 ? ["hop-dong-mau.pdf"] : undefined }, { role: "ai", done: true, time: base + i + 1, text: "# Tiêu đề\n\nĐây là **đậm**.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<artifact identifier=\"a\" type=\"text/html\" title=\"Trang\">\n<h1>MA_NGUON_BI_MAT</h1>\n</artifact>" }] }));
  const projId = base + 100;
  await ev(`localStorage.setItem("u:${uid}:chats", ${JSON.stringify(JSON.stringify(chats))}); localStorage.setItem("u:${uid}:projects", ${JSON.stringify(JSON.stringify([{ id: projId, name: "Dự án thử", desc: "", upd: projId, pinned: true, ctx: [{ id: 1, name: "tai-lieu.txt", kind: "text", text: "Nội dung", chars: 8 }] }]))}); 1`);
  await P("Page.reload"); await until(`!!document.querySelector("textarea")`, 30000, "app loaded"); await sleep(1500);

  console.log("1. Hộp thoại giữ tiêu điểm");
  await ev(`document.querySelector("textarea").focus(); 1`);
  await key("/", "Slash", 191, 2);
  await until(`!!document.querySelector(".sy-keys")`, 3000, "hộp phím tắt");
  await sleep(200);
  ok(await ev(inTop), "mở ra thì tiêu điểm vào trong hộp, gõ phím không rơi xuống ô soạn tin");
  ok(await ev(`document.querySelector(".sy-keys").getAttribute("role") === "dialog" && document.querySelector(".sy-keys").getAttribute("aria-modal") === "true" && !!document.getElementById(document.querySelector(".sy-keys").getAttribute("aria-labelledby"))`), "có role=dialog, aria-modal và tên lấy từ tiêu đề");
  let out = 0; for (let i = 0; i < 12; i++) { await key("Tab", "Tab", 9); if (!(await ev(inTop))) out++; }
  ok(out === 0, "Tab đi vòng trong hộp, không thoát ra", out);
  ok(await ev(`document.querySelector("main")?.closest("[inert]") !== null`), "phần còn lại bị chặn (inert)");
  await key("Escape", "Escape", 27);
  await until(`!document.querySelector(".sy-keys")`, 3000, "đóng hộp");
  await sleep(250);
  ok(await ev(`document.activeElement?.tagName === "TEXTAREA"`), "đóng thì tiêu điểm về đúng ô soạn tin", await ev(`document.activeElement?.tagName`));
  ok(await ev(`!document.querySelector("main")?.closest("[inert]")`), "đóng thì bỏ chặn");

  console.log("2. ⌘K: xem tất cả kết quả, tìm tên tệp");
  await key("k", "KeyK", 75, 2);
  await until(`!!document.querySelector(".pal input")`, 5000, "palette");
  await until(`!document.querySelector(".pal .art-spin")`, 10000, "palette data");
  const setQ = (v) => ev(`(() => { const e = document.querySelector(".pal input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
  await setQ("bao cao thang"); await sleep(200);
  const rowsOf = () => ev(`[...document.querySelectorAll(".pal .s-row")].filter((r) => r.textContent.includes("Báo cáo tháng")).length`);
  ok((await rowsOf()) === 6, "trước tiên hiện 6 kết quả", await rowsOf());
  await click(byText(".pal .s-row", "Xem tất cả 25"), "xem tất cả");
  await sleep(150);
  ok(await ev(`!!document.querySelector(".pal input")`), "bấm xem tất cả không đóng bảng");
  ok((await rowsOf()) === 25, "hiện đủ 25 kết quả", await rowsOf());
  await setQ("hop-dong"); await sleep(200);
  ok(await ev(`[...document.querySelectorAll(".pal .s-row")].some((r) => r.textContent.includes("hop-dong-mau.pdf"))`), "tìm được theo tên tệp đính kèm");
  await key("Escape", "Escape", 27); await sleep(250);

  console.log("3. Đọc to bỏ mã nguồn artifact và ký hiệu Markdown (giọng của trình duyệt)");
  await ev(`(() => { const f = window.fetch; window.fetch = (u, i) => (String(u).includes("/api/speech/speak") ? Promise.resolve(new Response("{}", { status: 503 })) : f(u, i)); })(); 1`);
  await ev(`window.__spoken = []; window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 5); }; window.speechSynthesis.cancel = () => {}; 1`);
  await click(byText(".chat-item", "Báo cáo tháng 1"), "mở chat");
  await until(`!!document.querySelector('[aria-label="Đọc to"],[aria-label="Read aloud"]')`, 5000, "nút đọc to");
  await click(`document.querySelector('[aria-label="Đọc to"],[aria-label="Read aloud"]')`, "đọc to");
  await until(`window.__spoken.length > 0`, 5000, "đã đọc");
  const said = await ev(`window.__spoken.join(" ")`);
  ok(!/MA_NGUON|<h1>|\*\*|\||#/.test(said) && /Tiêu đề/.test(said) && /đậm/.test(said), `chỉ đọc chữ: “${said}”`, said);

  console.log("4. Xóa ngữ cảnh dự án có xác nhận");
  await click(`[...document.querySelectorAll(".chat-item.pj-row")].find((e) => e.textContent.includes("Dự án thử"))`, "mở dự án");
  await until(`[...document.querySelectorAll(".pj-in button")].some((b) => /^Tệp|^Ngữ cảnh|^Context|^Files/.test(b.textContent.trim()))`, 5000, "trang dự án");
  await click(`[...document.querySelectorAll(".pj-in button")].find((b) => /^Tệp|^Ngữ cảnh|^Context|^Files/.test(b.textContent.trim()))`, "tab ngữ cảnh");
  await until(`!!document.querySelector(".pj-file-x")`, 5000, "có tệp");
  await ev(`document.querySelector(".pj-file-x").click(); 1`);
  await until(`!!document.querySelector(".cf-top .btn.danger")`, 3000, "hộp xác nhận");
  ok(await ev(`!!document.querySelector(".pj-file")`), "chưa xóa khi chưa xác nhận");
  await click(`document.querySelector(".cf-top .btn:not(.danger)")`, "hủy");
  await sleep(300);
  ok(await ev(`!!document.querySelector(".pj-file")`), "bấm Hủy thì tệp còn nguyên");
  ok(await ev(`(() => { const t = document.querySelector(".pj-usage-t"); return !t || /1%/.test(t.textContent); })()`), "thanh dung lượng tính theo giới hạn thật");
  await shot("project");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
