// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/apps.mjs
// Bảng lệnh ⌘K (tìm bỏ dấu, mở đúng mục), gợi ý "Lưu thành skill" khi dặn lâu dài / dặn lặp lại, điểm skill trong Kho kỹ năng.
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
const email = process.env.ADMIN ? "admin@synchro.test" : "pal-member@synchro.test", password = process.env.ADMIN ? "synchro-mock-123" : "Member-pass-123";
let cookie = "";
const api = async (p, body) => {
  const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return r.status;
};
await api("/api/auth/signup", { email, password, profile: { fullName: "Palette Tester", birthDate: "2000-01-01" } });
await api("/api/auth/login", { email, password });
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email); db.close(); }
if (!cookie) throw new Error("login failed");
// Đoạn chat đi theo tài khoản: lời dặn "dùng bảng khi so sánh…" của lần chạy trước còn trên máy chủ thì lời dặn "lần đầu" ở mục 2
// đã thành lặp lại và có gợi ý ngay. Tài khoản thử riêng của bộ này bắt đầu sạch (không xóa đoạn chat khi chạy bằng tài khoản quản trị).
if (!process.env.ADMIN) {
  await fetch(B + "/api/chats", { method: "PUT", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify({ wipe: Date.now() }) });
  await new Promise((r) => setTimeout(r, 20));
}
// Quyền mặc định của thành viên do quản trị viên đặt (có thể tắt Skills): cấp đủ quyền cho tài khoản test.
{ let ac = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
  if (!ac) { const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) }); ac = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0] ?? ""; }
  const u = (await (await fetch(B + "/api/admin", { headers: { cookie: ac } })).json()).users.find((x) => x.email === email);
  if (u) await fetch(B + `/api/admin/users/${u.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: B, cookie: ac }, body: JSON.stringify({ action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } }) }); }

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), ["--headless=new", "--remote-debugging-port=9336", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9336/json/version").then((r) => r.json()).catch(() => null); }

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
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}pal-${n}.png`, Buffer.from(data, "base64")); };
const setVal = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const proto = e.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
const key = (k, code, vk, modifiers = 0) => (async () => { await P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); })();
const palette = async (q) => {
  await key("k", "KeyK", 75, 2); await until(`!!document.querySelector(".pal input")`, 5000, "palette open");
  await until(`!document.querySelector(".pal .art-spin")`, 10000, "palette data");
  await setVal(".pal input", q); await sleep(300);
  return ev(`[...document.querySelectorAll(".pal .s-row")].map((r) => r.textContent.trim())`);
};
const ask = async (text) => {
  await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await sleep(600);
  await until(`!!document.querySelector(".actions.in") && !document.querySelector(".thinking")`, 60000, "answer done");
  await sleep(500);
};
const SK = "pal-test-ban-tin", SAVED = "ss-test-ngan-gon";
try {
  // Dữ liệu mẫu: một skill.
  await ev(`(async () => {
    for (const n of [${JSON.stringify(SK)}, ${JSON.stringify(SAVED)}]) await fetch("/api/skills/" + n, { method: "DELETE" });
    const fd = new FormData(); fd.append("file", new File([${JSON.stringify(`---\nname: ${"pal-test-ban-tin"}\ndescription: "Viết bản tin nội bộ hằng tuần theo mẫu của công ty"\n---\n\n# Bản tin\n\nViết bản tin ngắn.\n`)}], "SKILL.md")); await fetch("/api/skills", { method: "POST", body: fd });
    try { localStorage.removeItem("synchro:skill-suggest"); } catch {}
    return 1; })()`);
  await P("Page.reload"); await until(`!!document.querySelector("textarea")`, 30000, "reload"); await sleep(1200);

  console.log("1. Bảng lệnh ⌘K");
  let rows = await palette("");
  ok(rows.some((r) => r.startsWith("Đoạn chat mới")) && rows.some((r) => r.startsWith("Autopilot")), "mở bằng ⌘K, chưa gõ gì thì hiện lệnh nhanh", rows.join(" | "));
  await shot("1-open");
  ok(!rows.some((r) => /^(Tri thức|Cuộc họp)/.test(r)), "không có lệnh Tri thức, Cuộc họp", rows.join(" | "));
  rows = await palette("hop thu");
  ok(rows[0]?.startsWith("Autopilot"), "gõ không dấu \"hop thu\" → lệnh Autopilot đứng đầu", rows.join(" | "));
  await key("Escape", "Escape", 27); await sleep(400);
  // Mục đổi nhãn thành "Connectors": người gõ tiếng Việt (có dấu hay không dấu) vẫn tìm được lệnh.
  for (const q of ["kết nối", "ket noi"]) {
    rows = await palette(q);
    ok(rows.some((r) => r.startsWith("Connectors")), `gõ "${q}" → có lệnh Connectors`, rows.join(" | "));
    await key("Escape", "Escape", 27); await sleep(400);
  }
  rows = await palette("hop thu");
  await key("Enter", "Enter", 13);
  await until(`!!document.querySelector(".tk-top")`, 8000, "inbox page");
  await sleep(600);
  ok(!(await ev(`!!document.querySelector(".pal") && !document.querySelector(".pal").closest(".closing")`)), "Enter mở trang Autopilot, bảng lệnh đóng");
  await shot("2-search");
  rows = await palette("ban tin noi bo");
  ok(rows.some((r) => r.startsWith(SK)), "tìm skill theo mô tả", rows.join(" | "));
  ok(await ev(`[...document.querySelectorAll(".pal-g")].some((g) => g.textContent === "Skill và thư viện")`), "kết quả xếp theo nhóm");
  await key("ArrowDown", "ArrowDown", 40); await sleep(150);
  const sel = await ev(`[...document.querySelectorAll(".pal .s-row")].findIndex((r) => r.classList.contains("on"))`);
  ok(sel === 1 || rows.length === 1, "mũi tên xuống chuyển dòng chọn", sel);
  await key("ArrowUp", "ArrowUp", 40); await sleep(150);
  await click(`[...document.querySelectorAll(".pal .s-row")].find((r) => r.textContent.trim().startsWith(${JSON.stringify(SK)}))`, "skill row");
  await until(`[...document.querySelectorAll(".pl-sec")].some((s) => /Your skills|Skill của bạn/.test(s.textContent))`, 8000, "skill hub");
  ok(true, "bấm skill → mở Kho kỹ năng");
  rows = await palette("zzqqxx không có");
  ok(rows.length === 0 && await ev(`/Không tìm thấy|No results/.test(document.querySelector(".pal .s-list").textContent)`), "không khớp gì → báo không tìm thấy");
  await key("Escape", "Escape", 27); await sleep(400);

  console.log("2. Gợi ý lưu cách làm thành skill");
  await click(byText(".nav-item", "Mới"), "new"); await sleep(800);
  await ask("Kể tên ba loại cà phê phổ biến");
  ok(!(await ev(`!!document.querySelector(".ss-chip")`)), "câu hỏi thường → không gợi ý");
  await click(byText(".nav-item", "Mới"), "new"); await sleep(800);
  await ask("Từ giờ luôn trả lời ngắn gọn bằng gạch đầu dòng nhé");
  await until(`!!document.querySelector(".ss-chip")`, 8000, "chip");
  ok(/lời dặn lâu dài|standing instruction/.test(await ev(`document.querySelector(".ss-chip").textContent`)), "lời dặn \"từ giờ luôn…\" → hiện gợi ý dưới câu trả lời");
  await shot("3-chip");
  await click(`document.querySelector(".ss-chip .lnk")`, "save chip"); await sleep(500);
  const name = await ev(`document.querySelector(".ss-modal input.field").value`);
  ok(/^[a-z0-9-]+$/.test(name) && /ngan-gon/.test(name), "tên skill tự đặt từ lời dặn (bỏ dấu): " + name);
  ok(/Từ giờ luôn trả lời ngắn gọn/.test(await ev(`document.querySelector(".ss-modal textarea.mono").value`)), "nội dung SKILL.md có đúng lời dặn");
  await setVal(".ss-modal input.field", SAVED); await sleep(200);
  await shot("4-modal");
  await click(`document.querySelector(".ss-modal .btn.dark")`, "save"); 
  await until(`!document.querySelector(".ss-modal")`, 8000, "modal closed");
  const list = await ev(`fetch("/api/skills").then((r) => r.json()).then((j) => j.skills.map((s) => s.name))`);
  ok(list.includes(SAVED), "đã lưu thành skill trong Kho kỹ năng", list.join(","));
  ok(!(await ev(`!!document.querySelector(".ss-chip")`)), "lưu xong thì gợi ý biến mất");
  await P("Page.reload"); await until(`!!document.querySelector("textarea")`, 30000, "reload"); await sleep(1500);
  ok(!(await ev(`!!document.querySelector(".ss-chip")`)), "tải lại trang, gợi ý đã xử lý không hiện lại");
  // Dặn cùng một điều ở hai đoạn chat (không có chữ "từ giờ / luôn") → gợi ý vì lặp lại.
  await click(byText(".nav-item", "Mới"), "new"); await sleep(800);
  await ask("Hãy dùng bảng khi so sánh các gói sản phẩm");
  ok(!(await ev(`!!document.querySelector(".ss-chip")`)), "dặn lần đầu (không có từ chỉ lâu dài) → chưa gợi ý");
  await click(byText(".nav-item", "Mới"), "new"); await sleep(800);
  await ask("Khi so sánh các gói sản phẩm hãy dùng bảng");
  await until(`!!document.querySelector(".ss-chip")`, 8000, "repeat chip");
  ok(/2 lần|2 times/.test(await ev(`document.querySelector(".ss-chip").textContent`)), "dặn lại ở đoạn chat khác → gợi ý \"đã dặn 2 lần\"");
  await click(`document.querySelector(".ss-chip .lnk")`, "save chip 2"); await sleep(500);
  ok(await ev(`document.querySelectorAll(".ss-rule").length`) === 2, "hộp lưu liệt kê cả hai lời dặn để chọn");
  await click(`document.querySelector(".ss-modal .btn:not(.dark)")`, "cancel"); await sleep(300);
  await click(`document.querySelector(".ss-chip .icon-btn")`, "dismiss"); await sleep(300);
  ok(!(await ev(`!!document.querySelector(".ss-chip")`)), "bấm × bỏ qua gợi ý");

  console.log("3. Điểm skill trong Kho kỹ năng");
  await ev(`(async () => { for (const m of ["p1", "p2", "p3"]) await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msg: "pal:" + m, skills: [${JSON.stringify(SK)}], value: -1 }) }); await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msg: "pal:p4", skills: [${JSON.stringify(SAVED)}], value: 1 }) }); return 1; })()`);
  rows = await palette("kho ky nang"); await key("Enter", "Enter", 13);
  // Kho kỹ năng tải chậm (mã trang và danh sách skill hỏi máy chủ): chờ dòng của skill có điểm thay vì 1,5 giây cố định (H2.3).
  await until(`!![...document.querySelectorAll(".pl-row2")].find((x) => x.querySelector("b")?.textContent === ${JSON.stringify(SK)})?.querySelector(".sk-score")`, 20000, "điểm skill").catch(() => {});
  const badge = (n) => ev(`(() => { const r = [...document.querySelectorAll(".pl-row2")].find((x) => x.querySelector("b")?.textContent === ${JSON.stringify(n)}); const b = r?.querySelector(".sk-score"); return b ? { t: b.textContent, low: b.classList.contains("high") } : null; })()`);
  let bd = await badge(SK);
  ok(bd?.low && /Hay bị chê|Often unhelpful/.test(bd.t) && /0.*3/.test(bd.t), "skill bị chê 3 lần → điểm đỏ \"Hay bị chê\"", JSON.stringify(bd));
  bd = await badge(SAVED);
  ok(bd && !bd.low && /1.*0/.test(bd.t), "skill được khen → điểm thường", JSON.stringify(bd));
  await click(`[...document.querySelectorAll(".pl-row2")].find((x) => x.querySelector("b")?.textContent === ${JSON.stringify(SK)})`, "open skill"); await sleep(700);
  ok(await ev(`!!document.querySelector(".sk-modal .sk-note.bad")`), "mở skill: có lời khuyên cập nhật hoặc tắt");
  await shot("5-hub");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
// Dọn dữ liệu test.
await ev(`(async () => { for (const m of ["p1", "p2", "p3", "p4"]) await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msg: "pal:" + m, skills: ["x"], value: 0 }) }); for (const n of [${JSON.stringify(SK)}, ${JSON.stringify(SAVED)}]) await fetch("/api/skills/" + n, { method: "DELETE" }); return 1; })()`).catch(() => {});
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
