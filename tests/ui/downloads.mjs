// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/downloads.mjs
// Bấm thật các mục "Tải về" của khung xem trước trên bản local (dev:mock), bằng Chrome ẩn với hồ sơ riêng,
// lưu tệp vào scratchpad/dl để kiểm tra nội dung. In (PDF) được chặn lại để ghi nhận thay vì mở hộp thoại.
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

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9333/json/version").then((r) => r.json()).catch(() => null); }

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

async function ask(text) {
  await click(byText("button", "Mới"), "new chat"); await sleep(800);
  const before = await ev(`document.querySelectorAll(".art-card:not(.busy)").length`);
  await click(`document.querySelector("textarea")`, "composer");
  await P("Input.insertText", { text });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await P("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(`document.querySelectorAll(".art-card:not(.busy)").length > ${before}`, 60000, "artifact for: " + text);
  await click(`[...document.querySelectorAll(".art-card")].at(-1)`, "last card");
  await sleep(2500);
}

async function download(label, { expectFile = true, ms = 40000 } = {}) {
  const n0 = downloads.length, l0 = logs.length;
  await click(`document.querySelector(".art-panel .art-dl > .icon-btn")`, "download button");
  await until(`!!${byText(".art-dl-menu .menu-item", label)}`, 5000, "menu item " + label);
  await sleep(+(process.env.MENU_WAIT ?? 600));
  await click(byText(".art-dl-menu .menu-item", label), label);
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (expectFile && downloads.length > n0 && downloads[n0].state !== "start") return { file: downloads[n0] };
    const pr = logs.slice(l0).find((l) => l.startsWith("PRINT "));
    if (!expectFile && pr) return { print: JSON.parse(pr.slice(6)) };
    await sleep(300);
  }
  const toast = await ev(`[...document.querySelectorAll(".toast,[role=status]")].map((e) => e.textContent).join(" | ")`).catch(() => "");
  return { timeout: true, toast, logs: logs.slice(l0).join("\n").slice(0, 400) };
}

const size = (n) => statSync(`${DL}/${n}`).size;
const prints = {};
async function check(kind, label, opts, test) {
  const r = await download(label, opts);
  if (r.timeout) { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}fail-${kind}-${label.replace(/\W+/g, "")}.png`, Buffer.from(data, "base64")); }
  if (r.timeout) return ok(false, `${kind} · ${label}`, `hết thời gian chờ; toast: ${r.toast}; log: ${r.logs}`);
  if (r.print) { prints[`${kind}-${label}`] = r.print; return ok(test(r.print), `${kind} · ${label}: mở hộp thoại in "${r.print.title}"${r.print.slides ? `, ${r.print.slides} slide` : ""}`); }
  const f = r.file;
  if (f.state !== "completed") return ok(false, `${kind} · ${label}`, `download ${f.state}`);
  ok(test(f.name, size(f.name)), `${kind} · ${label}: ${f.name} (${size(f.name)} B)`, f.name);
}

const run = (k) => !ONLY || ONLY.split(",").includes(k);
try {
  if (run("deck")) {
    console.log("Slide");
    await ask("Làm slide thuyết trình về Synchro");
    await check("Slide", "HTML", {}, (n, s) => n.endsWith(".html") && s > 1000);
    await check("Slide", "PNG", {}, (n, s) => n.endsWith(".png") && s > 5000);
    await check("Slide", "PDF", { expectFile: false }, (p) => p.slides >= 3);
    const png = readFileSync(`${DL}/bao-cao-quy-iii.png`); const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    ok(w >= 1900 && Math.abs(w / h - 16 / 9) < 0.03, `ảnh slide ${w}×${h}`);
    // Mở tệp HTML tải về ở thẻ riêng: phải trình chiếu được và in ra mỗi slide một trang.
    const { targetId: t2 } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId: S2 } = await send("Target.attachToTarget", { targetId: t2, flatten: true });
    await send("Page.enable", {}, S2);
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, S2);
    await send("Page.navigate", { url: `file://${DL}/bao-cao-quy-iii.html` }, S2); await sleep(1200);
    const vis = async () => (await send("Runtime.evaluate", { expression: `[...document.querySelectorAll("section.slide")].map((e) => getComputedStyle(e).display !== "none")`, returnByValue: true }, S2)).result.value;
    const v1 = await vis();
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 }, S2);
    await sleep(200); const v2 = await vis();
    ok(v1.filter(Boolean).length === 1 && v1[0] && v2[1] && v2.filter(Boolean).length === 1, `HTML tải về trình chiếu được: ${v1.length} slide, phím → sang slide 2`, JSON.stringify([v1, v2]));
    const { data } = await send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true }, S2);
    const pdf = Buffer.from(data, "base64"); writeFileSync(`${DL}/bao-cao-quy-iii-print.pdf`, pdf);
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    ok(pages === v1.length, `In tệp HTML ra PDF: ${pages} trang`);
    await send("Target.closeTarget", { targetId: t2 });
  }
  if (run("web")) {
    console.log("Trang web");
    await ask("Làm trang web cho quán cà phê");
    await check("Web", "HTML", {}, (n, s) => n.endsWith(".html") && s > 1000);
    await check("Web", "PNG", {}, (n, s) => n.endsWith(".png") && s > 5000);
    await check("Web", "PDF", { expectFile: false }, (p) => p.html.length > 1000);
  }
  if (run("react")) {
    console.log("React");
    await ask("Tạo ứng dụng todo cho tôi");
    await check("React", "HTML", {}, (n, s) => n.endsWith(".html") && s > 1000);
    await check("React", "JSX", {}, (n, s) => /\.(jsx|tsx)$/.test(n) && s > 200);
    await check("React", "PNG", {}, (n, s) => n.endsWith(".png") && s > 3000);
    await check("React", "PDF", { expectFile: false }, (p) => p.html.length > 500 && p.title === "Danh sách việc cần làm");
  }
  if (run("svg")) {
    console.log("SVG");
    await ask("Vẽ logo dạng svg cho Synchro");
    await check("SVG", "SVG", {}, (n, s) => n.endsWith(".svg") && s > 200);
    await check("SVG", "PNG", {}, (n, s) => n.endsWith(".png") && s > 3000);
  }
  if (run("doc")) {
    console.log("Tài liệu");
    await ask("Soạn kế hoạch ra mắt sản phẩm mới");
    await check("Tài liệu", "Word (.doc)", {}, (n, s) => n.endsWith(".doc") && s > 500);
    await check("Tài liệu", "PDF", { expectFile: false }, (p) => p.html.length > 500);
    await check("Tài liệu", "Markdown (.md)", {}, (n, s) => n.endsWith(".md") && s > 100);
    const doc = readFileSync(`${DL}/de-xuat-trien-khai-plugins.doc`, "utf8");
    ok(/<h1>/.test(doc) && (doc.match(/<h2>/g) ?? []).length >= 3 && !/class="w"/.test(doc), `Word: tiêu đề h1 + ${(doc.match(/<h2>/g) ?? []).length} mục h2, không còn span từng chữ`, doc.slice(0, 600));
    const pr = prints["Tài liệu-PDF"]?.html ?? "";
    ok(/<h1>/.test(pr) && !/class="w"/.test(pr), "PDF tài liệu: tiêu đề đúng cấp", pr.slice(0, 400));
  }
} catch (e) { ok(false, "lỗi khi chạy", e.stack); }

writeFileSync(`${DL}/prints.json`, JSON.stringify(prints));
console.log("\nTệp đã tải:", readdirSync(DL).join(", "));
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill();
process.exit(fails ? 1 : 0);
