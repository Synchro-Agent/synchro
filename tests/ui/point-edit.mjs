// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/apps.mjs
// Chỉ và sửa + so sánh phiên bản: chọn một phần tử trong artifact, yêu cầu sửa riêng phần đó, rồi so bản trước / bản sau.
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
// Các khung con (artifact chạy ở tiến trình riêng): để đọc vị trí phần tử bên trong khung.
const frames = [];
handlers.push((m) => { if (m.method === "Target.attachedToTarget" && m.params.targetInfo?.type === "iframe") frames.push(m.params.sessionId); });
const inFrame = async (expr) => {
  for (const s of [...frames].reverse()) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }, s).catch(() => null); if (r?.result?.value) return r.result.value; }
  return null;
};
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
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}pe-${n}.png`, Buffer.from(data, "base64")); };
const tap = async (x, y) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
try {
  await sleep(800);
  await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: "Làm trang web cho quán cà phê" });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await until(`document.querySelectorAll(".art-card:not(.busy)").length > 0 && !document.querySelector(".thinking")`, 60000, "reply");
  await sleep(3000);
  ok(await ev(`!!document.querySelector('.art-acts [aria-label="Chỉ và sửa"]')`), "khung artifact có nút Chỉ và sửa");
  await click(`document.querySelector('.art-acts [aria-label="Chỉ và sửa"]')`, "pick"); await sleep(600);
  ok(await ev(`!!document.querySelector(".pe-hint")`), "bật chế độ chọn: hiện hướng dẫn bấm vào phần muốn sửa");
  // Tiêu đề lớn của trang mẫu nằm ở phía trên khung xem trước.
  const fr = await ev(`(() => { const b = document.querySelector(".art-frame").getBoundingClientRect(); return [b.x, b.y]; })()`);
  await P("Input.dispatchMouseEvent", { type: "mouseMoved", x: fr[0] + 90, y: fr[1] + 130 }); await sleep(300);
  await shot("1-hover");
  await tap(fr[0] + 90, fr[1] + 130);
  await until(`!!document.querySelector(".pe-bar .pe-what")`, 8000, "picked bar");
  const what = await ev(`document.querySelector(".pe-what").textContent`);
  ok(/<h1>/.test(what) && /Cà phê rang mộc/.test(what), "bấm vào tiêu đề: thanh sửa hiện đúng phần tử " + what, what);
  await shot("2-picked");
  await click(`document.querySelector(".pe-in input")`, "req"); await P("Input.insertText", { text: 'đổi thành "Cà phê ngon mỗi ngày"' });
  await click(`document.querySelector(".pe-in .btn.dark")`, "send");
  await until(`[...document.querySelectorAll(".art-ver span")].some((e) => e.textContent.trim() === "2/2") && !document.querySelector(".thinking") && !document.querySelector(".art-card.busy")`, 60000, "version 2");
  await sleep(2000);
  await click(byText(".art-tabs button", "Mã"), "code tab"); await sleep(600);
  const code = await ev(`document.querySelector(".art-code").textContent`);
  ok(code.includes("Cà phê ngon mỗi ngày") && !code.includes("Cà phê rang mộc, pha chậm mỗi sáng."), "phiên bản mới chỉ đổi đúng tiêu đề");
  await click(byText(".art-tabs button", "Xem trước"), "preview tab"); await sleep(800);
  await click(`document.querySelector('[aria-label="So sánh với bản trước"]')`, "compare"); await sleep(1500);
  ok(await ev(`document.querySelectorAll(".cmp-side .cmp-col").length === 2`), "so sánh song song bản 1 và bản 2");
  await shot("3-side");
  await click(byText(".cmp-bar button", "Mã thay đổi"), "diff"); await sleep(500);
  const n = await ev(`document.querySelector(".cmp-n").textContent`);
  ok(/\+1/.test(n) && /−1/.test(n), "mã thay đổi: đúng 1 dòng thêm, 1 dòng bớt " + n, n);
  await shot("4-diff");

  // Alt+Click: không bật chế độ chọn, giữ Alt rồi bấm vào phần tử → biết đúng dòng mã, chỉ gửi các dòng quanh đó.
  const altPick = async (find, what) => {
    let r = null;
    for (let i = 0; i < 30 && !r; i++) { r = await inFrame(`(() => { if (!document.querySelector("[data-sx-loc]")) return null; const el = ${find}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`); if (!r) await sleep(300); }
    if (!r) throw new Error("not found in frame: " + what);
    await sleep(300);
    const fo = await ev(`(() => { const b = document.querySelector(".art-panel .art-frame").getBoundingClientRect(); return [b.x, b.y]; })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: fo[0] + r[0], y: fo[1] + r[1], button: "left", clickCount: 1, modifiers: 1 });
    await until(`!!document.querySelector(".pe-bar .pe-loc")`, 8000, "alt-picked " + what);
  };
  const sendEdit = async (text, ver) => {
    await click(`document.querySelector(".pe-in input")`, "req"); await P("Input.insertText", { text });
    await click(`document.querySelector(".pe-in .btn.dark")`, "send");
    await until(`[...document.querySelectorAll(".art-ver span")].some((e) => e.textContent.trim() === ${JSON.stringify(ver)}) && !document.querySelector(".thinking") && !document.querySelector(".art-card.busy")`, 60000, "version " + ver);
    await sleep(1500);
  };
  const hlInfo = `(() => { const h = [...document.querySelectorAll(".art-code div.hl")]; return { n: h.length, first: h[0]?.querySelector("span")?.textContent, text: h.map((d) => d.textContent).join("\\n") }; })()`;
  await click(`document.querySelector('[aria-label="So sánh với bản trước"]')`, "compare off"); await sleep(1500);
  ok(await ev(`!document.querySelector(".pe-hint")`), "chưa bật chế độ chọn");
  await altPick(`[...document.querySelectorAll("h3")].find((e) => e.textContent === "Pha thủ công")`, "card h3");
  const chip = await ev(`document.querySelector(".pe-loc").textContent`);
  ok(/<h3>/.test(await ev(`document.querySelector(".pe-what code").textContent`)) && /Dòng \d+/.test(chip), "Alt+Click vào tiêu đề thẻ: thanh sửa hiện đúng phần tử và số dòng (" + chip + ")", chip);
  await shot("5-alt");
  await click(`document.querySelector(".pe-loc")`, "loc chip"); await sleep(700);
  let hi = await ev(hlInfo);
  ok(hi.n === 1 && hi.text.includes("<h3>Pha thủ công</h3>") && chip.endsWith(hi.first), "Xem trong mã: tô đúng dòng chứa phần tử (" + hi.first + ")", JSON.stringify(hi));
  await shot("6-code-hl");
  await sendEdit("đổi màu đỏ", "3/3");
  await click(byText(".art-tabs button", "Mã"), "code tab"); await sleep(600);
  const code3 = await ev(`document.querySelector(".art-code").textContent`);
  ok(code3.includes('<h3 style="color:#dc2626">Pha thủ công</h3>') && code3.includes("<h3>Rang trong ngày</h3>") && code3.includes("<h3>Không gian yên tĩnh</h3>"), "sửa đúng phần tử ở dòng đó, hai thẻ cùng dòng mẫu giữ nguyên");
  const texts = ((await fetch("http://127.0.0.1:4010/_debug/last").then((r) => r.json())).anthropic?.messages ?? []).flatMap((m) => (typeof m.content === "string" ? [m.content] : (m.content ?? []).map((x) => x.text ?? "")));
  const pe = /<point_edit>([\s\S]*?)<\/point_edit>/.exec(texts.findLast((t) => t.includes("<point_edit>")) ?? "")?.[1] ?? "";
  ok(/dòng: \d+-\d+/.test(pe) && /mã nguồn quanh đó/.test(pe) && !/<meta charset/.test(pe) && pe.split("\n").length < 15, "yêu cầu gửi model: số dòng và vài dòng mã quanh phần tử, không kèm cả trang", pe);
  const bubble = await ev(`(() => { const u = [...document.querySelectorAll(".user-msg")].at(-1); return u ? [!!u.querySelector(".pe-msg"), u.textContent] : [false, ""]; })()`);
  ok(bubble[0] && !bubble[1].includes("point_edit") && /<h3>Pha thủ côngDòng \d+đổi màu đỏ/.test(bubble[1]), "tin nhắn trong chat hiện gọn: phần tử, dòng, yêu cầu (" + bubble[1] + ")", bubble[1]);

  // React: dòng mã lấy từ JSX (Babel), phần tử sinh từ danh sách trỏ về đúng dòng mẫu trong .map().
  await click(byText(".nav-item", "Mới"), "new chat"); await sleep(800);
  await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: "Làm ứng dụng todo" });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await until(`document.querySelectorAll(".art-card:not(.busy)").length > 0 && !document.querySelector(".thinking") && /Danh sách việc cần làm/.test(document.querySelector(".art-panel .art-head-t")?.textContent ?? "")`, 60000, "todo reply");
  await sleep(2500);
  await altPick(`[...document.querySelectorAll("span")].find((e) => e.textContent === "Gửi email cho nhóm thiết kế")`, "todo item");
  await click(`document.querySelector(".pe-loc")`, "loc chip"); await sleep(700);
  hi = await ev(hlInfo);
  ok(hi.n === 1 && hi.text.includes("{i.text}</span>"), "React: bấm một việc trong danh sách → đúng dòng mẫu trong .map() (" + hi.first + ")", JSON.stringify(hi));
  await sendEdit("đổi màu xanh lá", "2/2");
  await click(byText(".art-tabs button", "Xem trước"), "preview"); await sleep(2500);
  const col = await inFrame(`(() => { const e = [...document.querySelectorAll("span")].find((x) => x.textContent === "Gửi email cho nhóm thiết kế"); return e ? getComputedStyle(e).color : null; })()`);
  ok(col === "rgb(22, 163, 74)", "bản sửa chạy được: việc trong danh sách đổi sang xanh lá (" + col + ")", col);
  await shot("7-react");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
