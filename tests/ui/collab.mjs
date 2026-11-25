// Kiểm thử giao diện bằng Chrome ẩn trên npm run dev:mock. Chạy tay: node tests/ui/collab.mjs
// Thẻ hỏi lại (```ask), bảng tương tác (sắp xếp, chép, tải CSV), và hai người cùng mở một ứng dụng nội bộ:
// thấy nhau, dữ liệu chung cập nhật ngay trong khung ứng dụng, bình luận @nhắc tên hiện trực tiếp và vào Autopilot.
import { waitFor } from "../lib/wait.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const DL = SCR + "dl-collab", PROF = SCR + "chrome-prof-collab";
rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
rmSync(PROF, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hai tài khoản test của bản local (đủ quyền), xóa mức dùng cũ.
async function account(email, fullName) {
  let cookie = "";
  const post = async (p, body) => { const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify(body) }); for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0]; return r; };
  await post("/api/auth/signup", { email, password: "Member-pass-123", profile: { fullName, birthDate: "2000-01-01" } });
  await post("/api/auth/login", { email, password: "Member-pass-123" });
  if (!cookie) throw new Error("login failed: " + email);
  const id = (await (await fetch(B + "/api/auth/me", { headers: { cookie } })).json()).user.id;
  return { email, cookie, id, post };
}
const A = await account("cl-ui-a@synchro.test", "Lan Anh"), Bb = await account("cl-ui-b@synchro.test", "Minh Bình");
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  for (const x of [A, Bb]) db.prepare("DELETE FROM usage_events WHERE user_id = ?").run(x.id);
  db.close();
  let ac = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
  if (!ac) { const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) }); ac = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0] ?? ""; }
  const users = (await (await fetch(B + "/api/admin", { headers: { cookie: ac } })).json()).users;
  for (const x of [A, Bb]) { const u = users.find((y) => y.email === x.email); await fetch(B + `/api/admin/users/${u.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: B, cookie: ac }, body: JSON.stringify({ action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } }) }); }
}

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), ["--headless=new", "--remote-debugging-port=9337", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9337/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(); const handlers = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); }
  else if (m.method) for (const h of handlers) h(m);
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });

// Khung ứng dụng (sandbox) chạy ở tiến trình riêng: gắn vào từng khung con, nhớ khung con thuộc trang nào để đọc log đúng người.
const parent = new Map(), logs = [], frames = new Map(), ctxs = new Map();
const root = (s) => { while (parent.has(s)) s = parent.get(s); return s; };
handlers.push(async (m) => {
  if (m.method === "Runtime.consoleAPICalled") logs.push({ page: root(m.sessionId), text: m.params.args.map((a) => a.value ?? a.description ?? "").join(" ") });
  if (m.method === "Runtime.executionContextCreated") ctxs.set(m.sessionId, [...(ctxs.get(m.sessionId) ?? []), m.params.context]);
  if (m.method === "Runtime.executionContextsCleared") ctxs.set(m.sessionId, []);
  if (m.method !== "Target.attachedToTarget") return;
  const s = m.params.sessionId; if (m.sessionId) parent.set(s, m.sessionId);
  if (m.params.targetInfo.type === "iframe") { const r = root(s); frames.set(r, [...(frames.get(r) ?? []), s]); }
  await send("Runtime.enable", {}, s).catch(() => {});
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s).catch(() => {});
  await send("Runtime.runIfWaitingForDebugger", {}, s).catch(() => {});
});
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true });
await send("Browser.grantPermissions", { origin: B, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => {});

// Mỗi người một hồ sơ trình duyệt riêng (cookie riêng).
async function page(acc) {
  const { browserContextId } = await send("Target.createBrowserContext", {});
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
  await P("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await P("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await P("Network.setCookie", { name: "synchro_session", value: acc.cookie.split("=")[1], url: B });
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, browserContextId, eventsEnabled: true });
  await send("Browser.grantPermissions", { origin: B, browserContextId, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch(() => {});
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(300); } throw new Error("timeout: " + what); };
  const click = async (expr, what) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("not found: " + what);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };
  const type = async (text) => P("Input.insertText", { text });
  const key = async (k, code, vk) => { await P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k === "Enter" ? "\r" : undefined }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
  const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}collab-${n}.png`, Buffer.from(data, "base64")); };
  // Chạy mã trong khung ứng dụng của trang này.
  // Khung ở tiến trình riêng (phiên con) hoặc cùng tiến trình (ngữ cảnh chạy khác khung chính).
  const inFrame = async (expr) => {
    for (const s of frames.get(S) ?? []) { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s).catch(() => null); if (r && !r.exceptionDetails && r.result.value !== undefined) return r.result.value; }
    const top = (await P("Page.getFrameTree")).frameTree.frame.id;
    for (const c of (ctxs.get(S) ?? []).filter((c) => c.auxData?.frameId !== top && c.auxData?.isDefault)) { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, contextId: c.id }).catch(() => null); if (r && !r.exceptionDetails && r.result.value !== undefined) return r.result.value; }
    return undefined;
  };
  return { S, P, ev, until, click, type, key, shot, inFrame, go: async (url) => { frames.set(S, []); await P("Page.navigate", { url: B + url }); } };
}
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;

const results = [];
const ok = (c, n, x = "") => { results.push([c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const pa = await page(A), pb = await page(Bb);
const ask = async (p, text) => {
  await p.click(`document.querySelector("textarea")`, "composer"); await p.type(text);
  await p.key("Enter", "Enter", 13); await sleep(700);
  await p.until(`!!document.querySelector(".actions.in") && !document.querySelector(".thinking") && ![...document.querySelectorAll(".ai-msg")].at(-1)?.querySelector(".art-card.busy")`, 60000, "answer: " + text);
  await sleep(400);
};
try {
  await pa.go("/"); await pa.until(`!!document.querySelector("textarea")`, 30000, "app loaded"); await sleep(1200);

  console.log("1. Thẻ hỏi lại");
  await ask(pa, "Làm cho tôi một trang web");
  await pa.until(`!!document.querySelector(".ask-card")`, 5000, "ask card");
  ok(await pa.ev(`document.querySelectorAll(".ask-card .ask-q").length`) === 3, "yêu cầu mơ hồ → thẻ hỏi 3 câu thay vì đoán");
  ok(await pa.ev(`document.querySelector(".ask-f .btn.dark").disabled`), "chưa chọn đủ thì nút Gửi bị khóa");
  for (const o of ["Bán hàng online", "Tối giản, sáng sủa", "Bảng giá", "Form liên hệ"]) { await pa.click(byText(".ask-o", o), o); await sleep(120); }
  ok(await pa.ev(`document.querySelectorAll(".ask-o.on").length`) === 4, "chọn một ở câu 1, 2; chọn nhiều ở câu 3");
  await pa.shot("1-ask");
  await pa.click(`document.querySelector(".ask-f .btn.dark")`, "send answers");
  await pa.until(`[...document.querySelectorAll(".user-msg")].some((u) => u.textContent.includes("Trang web dùng để làm gì? → Bán hàng online") && u.textContent.includes("Bảng giá, Form liên hệ"))`, 8000, "answer msg");
  ok(true, "câu trả lời gửi thành tin nhắn: mỗi câu hỏi → lựa chọn");
  await pa.until(`!!document.querySelector(".actions.in") && document.querySelectorAll(".ai-msg").length >= 2 && !document.querySelector(".thinking")`, 60000, "build after answer");
  ok(await waitFor(() => pa.ev(`document.querySelector(".ask-card").classList.contains("off") && !document.querySelector(".ask-card .ask-other")`), 5000), "thẻ cũ chuyển sang chỉ xem, không bấm lại được");
  ok(await pa.ev(`document.querySelectorAll(".ask-card").length === 1`), "trả lời xong thì làm luôn, không hỏi lại");
  await pa.click(byText(".nav-item", "Mới"), "new"); await sleep(700);
  await ask(pa, "Tạo một bài thuyết trình");
  await pa.until(`!!document.querySelector(".ask-card")`, 5000, "ask card 2");
  await pa.click(`document.querySelector(".ask-f .lnk")`, "skip");
  await pa.until(`[...document.querySelectorAll(".user-msg")].some((u) => /tự chọn phương án/.test(u.textContent))`, 8000, "skip msg");
  ok(true, "\"Bỏ qua, cứ làm đi\" → gửi lời nhờ tự chọn");

  console.log("2. Bảng tương tác");
  await pa.click(byText(".nav-item", "Mới"), "new"); await sleep(700);
  await ask(pa, "So sánh các model");
  const col = (i) => pa.ev(`[...[...document.querySelectorAll(".md-tbl")].at(-1).querySelectorAll("tbody tr")].map((r) => r.cells[${i}].textContent)`);
  const before = await col(0);
  await pa.click(`[...document.querySelectorAll(".md-th")].find((b) => b.textContent.startsWith("Phù hợp cho"))`, "sort");
  await sleep(200);
  let c2 = await col(2);
  ok(c2[0].startsWith("Câu hỏi ngắn") && c2.at(-1).startsWith("Việc thường ngày"), "bấm tiêu đề cột → sắp xếp tăng dần (theo tiếng Việt)", c2.join(" | "));
  await pa.click(`[...document.querySelectorAll(".md-th")].find((b) => b.textContent.startsWith("Phù hợp cho"))`, "sort desc"); await sleep(200);
  c2 = await col(2);
  ok(c2[0].startsWith("Việc thường ngày"), "bấm lần hai → giảm dần", c2.join(" | "));
  await pa.click(`[...document.querySelectorAll(".md-th")].find((b) => b.textContent.startsWith("Phù hợp cho"))`, "sort off"); await sleep(200);
  ok(JSON.stringify(await col(0)) === JSON.stringify(before), "bấm lần ba → trở lại thứ tự gốc");
  await pa.ev(`document.querySelector(".md-tbl").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); 1`);
  await pa.click(`document.querySelector(".md-tbl-bar [aria-label='Tải CSV']")`, "csv");
  let csv = ""; for (let i = 0; i < 20 && !csv; i++) { await sleep(300); if (existsSync(DL + "/bang.csv")) csv = readFileSync(DL + "/bang.csv", "utf8"); }
  ok(csv.startsWith("﻿Model,Tốc độ,Phù hợp cho") && csv.includes("Claude Opus 5.5"), "tải CSV (UTF-8 có BOM, mở bằng Excel không lỗi dấu)", JSON.stringify(csv.slice(0, 80)));
  await pa.click(`document.querySelector(".md-tbl-bar [aria-label='Chép bảng']")`, "copy"); await sleep(500);
  const clip = await pa.ev(`navigator.clipboard.readText().catch((e) => "ERR " + e.message)`);
  ok(clip.startsWith("Model\tTốc độ\tPhù hợp cho"), "chép bảng dạng tab (dán thẳng vào Excel / Sheets)", JSON.stringify(clip.slice(0, 60)));
  await pa.shot("2-table");

  console.log("3. Hai người cùng mở một ứng dụng");
  const HTML = `<!doctype html><html><body><h1>Việc chung</h1><p id="v">…</p><script>
async function load(src) { const r = await window.storage.get("notes", true); document.getElementById("v").textContent = r ? r.value : "trống"; console.log("NOTES", src, r ? r.value : "null"); }
load("init");
window.storage.onChange(({ key }) => { if (key === "notes") load("change"); });
window.add = (v) => window.storage.set("notes", v, true);
</script></body></html>`;
  for (const x of (await (await fetch(B + "/api/apps", { headers: { cookie: A.cookie } })).json()).apps.filter((x) => x.mine)) await fetch(B + `/api/apps/${x.id}`, { method: "DELETE", headers: { origin: B, cookie: A.cookie } });
  const app = (await (await A.post("/api/apps", { conv: "cl-ui", ident: "viec-chung", title: "Việc chung", type: "html", content: HTML, visibility: "org" })).json()).id;
  await pa.go(`/apps/${app}`); await pb.go(`/apps/${app}`);
  await pa.until(`!!document.querySelector(".app-frame")`, 15000, "A app"); await pb.until(`!!document.querySelector(".app-frame")`, 15000, "B app");
  await pa.until(`!!document.querySelector(".cl-pres .cl-av[title='Minh Bình']")`, 10000, "A sees B");
  ok(true, "A thấy B đang xem cùng");
  ok(await pb.ev(`!!document.querySelector(".cl-pres .cl-av[title='Lan Anh']")`), "B thấy A đang xem cùng");
  await sleep(1500);
  const n0 = logs.length;
  await pb.inFrame(`window.add("B vừa thêm việc ${Date.now() % 1000}"), 1`);
  const fromB = () => logs.slice(n0).filter((l) => /NOTES change B vừa thêm việc/.test(l.text));
  for (let i = 0; i < 20 && !fromB().some((l) => l.page === pa.S); i++) await sleep(250);
  ok(fromB().some((l) => l.page === pa.S), "B thêm dữ liệu chung → khung ứng dụng của A cập nhật ngay (storage.onChange)", JSON.stringify(logs.slice(n0)));
  ok(!fromB().some((l) => l.page === pb.S), "tab của B không nhận lại thay đổi do chính mình ghi");
  ok(/B vừa thêm việc/.test(await pa.inFrame(`document.getElementById("v").textContent`) ?? ""), "nội dung trong ứng dụng của A đã đổi");
  await pa.shot("3-presence");

  console.log("4. Bình luận @nhắc tên");
  await pa.click(`document.querySelector(".app-cmt")`, "comments"); await sleep(500);
  ok(await pa.ev(`/Chưa có bình luận/.test(document.querySelector(".cl-list").textContent)`), "bảng bình luận trống có hướng dẫn gõ @");
  await pa.click(`document.querySelector(".cl-box textarea")`, "comment box");
  await pa.type("Nhờ @Min"); await pa.ev(`(() => { const t = document.querySelector(".cl-box textarea"); t.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
  await pa.until(`!!document.querySelector(".cl-sug button")`, 5000, "mention suggestions");
  ok(await pa.ev(`document.querySelector(".cl-sug button.on").textContent.includes("Minh Bình")`), "gõ @Min → gợi ý Minh Bình");
  await pa.key("Enter", "Enter", 13); await sleep(200);
  ok(await pa.ev(`document.querySelector(".cl-box textarea").value === "Nhờ @Minh Bình "`), "Enter chọn người, chèn đúng tên", await pa.ev(`document.querySelector(".cl-box textarea").value`));
  await pa.type("cập nhật hạn chót giúp mình");
  await pa.key("Enter", "Enter", 13);
  await pa.until(`[...document.querySelectorAll(".cl-c-b")].some((b) => b.textContent.includes("cập nhật hạn chót"))`, 8000, "comment shown");
  ok(await pa.ev(`[...document.querySelectorAll(".cl-at")].some((b) => b.textContent === "@Minh Bình")`), "bình luận hiện ngay, tên được nhắc tô nổi bật");
  await pb.until(`document.querySelector(".app-cmt .cl-n")?.textContent === "1"`, 8000, "B badge");
  ok(true, "B (chưa mở bảng bình luận) thấy số bình luận mới ngay, không cần tải lại");
  await pb.click(`document.querySelector(".app-cmt")`, "B comments"); await sleep(600);
  ok(await pb.ev(`[...document.querySelectorAll(".cl-c-b")].some((b) => b.textContent.includes("@Minh Bình cập nhật hạn chót"))`), "B mở bảng thấy bình luận");
  const inbox = await pb.ev(`fetch("/api/autopilot").then((r) => r.json()).then((j) => j.items.filter((x) => x.link === "app:${app}").map((x) => x.title))`);
  ok(inbox.some((t) => /Lan Anh nhắc bạn trong Việc chung/.test(t)), "B nhận thông báo trong Autopilot", JSON.stringify(inbox));
  await pb.shot("4-comments-b");
  await pa.ev(`document.querySelector(".cl-c").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); 1`);
  await pa.click(`document.querySelector(".cl-c-a [aria-label='Đánh dấu đã xử lý']")`, "resolve");
  await pb.until(`!document.querySelector(".app-cmt .cl-n")`, 8000, "B badge cleared");
  ok(true, "A đánh dấu đã xử lý → số trên máy B về 0 ngay");
  await pa.shot("4-comments-a");
  await pb.go("/"); await sleep(1500);
  ok(await pa.until(`!document.querySelector(".cl-pres .cl-av")`, 8000, "B left").then(() => true), "B đóng ứng dụng → A không còn thấy B");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await pa.shot("fail-a"); await pb.shot("fail-b"); }
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
