// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/mixer.mjs
// Bàn trộn ngữ cảnh: thanh đo token cạnh ô soạn tin, bảng ba tầng, tắt khối tầng động, nén lịch sử thành tóm tắt.
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

// Tài khoản chủ sở hữu của bản local (web dùng cá nhân), xóa mức dùng cũ.
const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
const api = async (p, body) => {
  const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return r.status;
};
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







let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}mx-${n}.png`, Buffer.from(data, "base64")); };
const sendMsg = async (t) => { await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: t }); await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }); };
const idle = () => until(`!document.querySelector(".ai-msg .thinking") && !document.querySelector("button.send svg rect")`, 60000, "reply done");
try {
  await sleep(800);
  await click(byText(".nav-item", "Mới"), "new"); await sleep(800);
  await sendMsg("tạo trang web giới thiệu quán cà phê");
  await until(`document.querySelectorAll(".art-card:not(.busy)").length >= 1`, 60000, "artifact"); await sleep(2500);
  for (const t of ["#rev 1", "#rev 2", "#rev 3"]) { await sendMsg(t); await sleep(1500); await until(`document.querySelectorAll(".art-card").length >= 2 && !document.querySelector(".art-card.busy")`, 60000, t); await sleep(1500); }
  await until(`/[0-9]/.test(document.querySelector(".cx-pill")?.textContent ?? "")`, 15000, "meter");
  const pill = await ev(`document.querySelector(".cx-pill").textContent`);
  ok(/^[0-9]/.test(pill.trim()), "thanh đo token hiện cạnh ô soạn tin: " + pill);
  await click(`document.querySelector(".cx-pill")`, "open mixer"); await sleep(600);
  await until(`!!document.querySelector(".cx-pop .cx-row")`, 15000, "mixer panel");
  const tiers = await ev(`[...document.querySelectorAll(".cx-tier-h b")].map((b) => b.textContent).join("|")`);
  ok(/Cố định/.test(tiers) && /Lịch sử/.test(tiers) && /Thay đổi mỗi lượt/.test(tiers), "bảng chia ba tầng: " + tiers);
  const artRow = `[...document.querySelectorAll(".cx-row")].find((r) => /Artifact hiện tại/.test(r.textContent))`;
  ok(await ev(`!!${artRow}?.querySelector(".toggle.on")`), "khối Artifact hiện tại có nút bật/tắt, đang bật");
  await shot("1-panel");
  const before = await ev(`Number((document.querySelector(".cx-h span b")?.textContent ?? "0").replace(/[^0-9]/g, ""))`);
  await click(`${artRow}.querySelector(".toggle")`, "toggle artifact");
  await until(`/Đang tắt/.test(${artRow}?.textContent ?? "")`, 10000, "off");
  await waitFor(async () => (await ev(`Number((document.querySelector(".cx-h span b")?.textContent ?? "0").replace(/[^0-9]/g, ""))`)) < before, 5000);
  const after = await ev(`Number((document.querySelector(".cx-h span b")?.textContent ?? "0").replace(/[^0-9]/g, ""))`);
  ok(after < before, `tắt artifact: tổng giảm ${before} → ${after}`);
  await click(`${artRow}.querySelector(".toggle")`, "toggle back"); await sleep(1200);
  // Ô chọn "Gửi": danh sách của Dropdown gắn vào <body> (ngoài khung bàn trộn). Bấm chuột thật vào "12 tin gần nhất" phải đổi giá trị
  // và giữ bàn trộn mở (trước đây cú mousedown vào danh sách bị coi là bấm ra ngoài, đóng cả bàn trộn, giá trị vẫn "Toàn bộ").
  const sendDd = `document.querySelector(".cx-hist .dd")`;
  await click(sendDd, "open Gửi"); await until(`!!document.querySelector(".dd-pop .dd-opt")`, 5000, "Gửi list");
  await click(byText(".dd-pop .dd-opt", "12 tin gần nhất"), "pick 12");
  await sleep(500);
  ok(await ev(`!!document.querySelector(".cx-pop") && !document.querySelector(".dd-pop")`), "chọn trong danh sách Gửi: danh sách đóng, bàn trộn vẫn mở");
  ok(await ev(`${sendDd}?.dataset.value === "12"`), "Gửi đổi sang 12 tin gần nhất bằng chuột", await ev(`${sendDd}?.textContent`));
  await click(`document.querySelector(".cx-pill")`, "close mixer"); await sleep(400);
  await click(`document.querySelector(".cx-pill")`, "reopen mixer"); await until(`!!document.querySelector(".cx-hist .dd")`, 15000, "mixer reopened");
  ok(await ev(`${sendDd}.dataset.value === "12" && /12 tin gần nhất/.test(${sendDd}.textContent)`), "mở lại bàn trộn: Gửi vẫn là 12 tin gần nhất", await ev(`${sendDd}?.textContent`));
  // Bấm ra ngoài cả bàn trộn lẫn danh sách thì vẫn đóng như cũ.
  await click(sendDd, "open Gửi again"); await until(`!!document.querySelector(".dd-pop")`, 5000, "Gửi list again");
  await click(byText(".dd-pop .dd-opt", "Toàn bộ"), "pick all"); await sleep(400);
  ok(await ev(`${sendDd}?.dataset.value === "0"`), "đổi lại Toàn bộ");
  await click(`document.querySelector("h1, .thread, main")`, "click outside"); await sleep(400);
  ok(await ev(`!document.querySelector(".cx-pop")`), "bấm ra ngoài: bàn trộn đóng");
  await click(`document.querySelector(".cx-pill")`, "reopen for compact"); await until(`!!document.querySelector(".cx-hist .btn")`, 15000, "mixer for compact");
  await click(byText(".cx-hist .btn", "Nén lịch sử"), "compact");
  await until(`!!document.querySelector(".cx-mark")`, 30000, "compact mark");
  ok(true, "nén lịch sử: luồng tin hiện vạch đã nén");
  ok(await ev(`!!${byText(".cx-hist .lnk", "Bỏ nén")}`), "có nút bỏ nén");
  await shot("2-compacted");
  await click(`document.querySelector(".cx-pill")`, "close"); await sleep(400);
  await sendMsg("#rev 4"); await sleep(1500); await idle();
  // Số phiên bản lên 5 ngay khi bản sửa bắt đầu chảy (thẻ còn "Đang sửa…"): chờ tới khi sửa xong ("Đã sửa 1 chỗ"), không chỉ chờ số phiên bản.
  const tIdle = Date.now();
  await waitFor(async () => { const t = await ev(`[...document.querySelectorAll(".art-card")].at(-1)?.textContent ?? ""`); return /Phiên bản 5/.test(t) && /Đã sửa 1 chỗ/.test(t); }, 15000);
  const lag = Date.now() - tIdle;
  // Lượt đã xong mà thẻ còn "Đang sửa…" lâu là lỗi người dùng thấy: giữ gần ngưỡng cũ (1,5 giây sau khi xong lượt), cho dư tới 3 giây.
  ok(lag <= 3000, `thẻ artifact báo "Đã sửa 1 chỗ" ngay sau khi lượt xong (${lag} ms)`);
  const card = await ev(`[...document.querySelectorAll(".art-card")].at(-1)?.textContent ?? ""`);
  ok(/Phiên bản 5/.test(card) && /Đã sửa 1 chỗ/.test(card), "sau khi nén vẫn sửa đúng artifact (bản hiện tại vẫn gửi kèm): " + card);
  await shot("3-after");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
console.log(`${pass}/${pass + fail} đạt`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
