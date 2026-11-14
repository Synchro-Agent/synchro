// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock.
// B5: so computed style trước / sau một lần đổi CSS chỉ-tái-cấu-trúc (bọc @layer, gỡ html body, gỡ !important): mọi phần tử (kèm ::before,
// ::after) của các màn chính × 390 / 768 / 1440px × sáng / tối, và trạng thái :hover / :focus-visible của nút, mục menu, ô nhập (ép bằng
// CSS.forcePseudoState). Ảnh chụp không thấy được z-index, hover, focus; bản này thấy.
// Dùng: node tests/ui/cascade.mjs dump <tệp.json>      (chụp bản đang chạy ở :3200)
//       node tests/ui/cascade.mjs diff <trước.json> <sau.json>   (mã thoát 1 khi có thuộc tính khác)
// Bản tĩnh không cần trình duyệt: scripts/css-cascade.mjs.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [mode, A, Bf] = process.argv.slice(2);
// Thuộc tính bỏ qua: chuyển động (ảnh chụp tắt chuyển động), và giá trị phụ thuộc thời điểm.
const IGNORE = /^(transition|animation)/;

if (mode === "diff") {
  const a = JSON.parse(readFileSync(A, "utf8")), b = JSON.parse(readFileSync(Bf, "utf8"));
  let n = 0; const byProp = {};
  for (const [screen, els] of Object.entries(a)) {
    const other = b[screen]; if (!other) { console.log(`✗ thiếu màn ${screen} ở bản sau`); n++; continue; }
    for (const [id, st] of Object.entries(els)) {
      const o = other[id]; if (!o) { console.log(`  ✗ ${screen}: phần tử ${id} không còn`); n++; continue; }
      for (const [p, v] of Object.entries(st)) if (!IGNORE.test(p) && o[p] !== v) { n++; byProp[p] = (byProp[p] ?? 0) + 1; if (n <= 300) console.log(`  ✗ ${screen} ${id} ${p}: ${v} → ${o[p]}`); }
    }
  }
  console.log(n ? `\n${n} khác biệt; theo thuộc tính: ${JSON.stringify(byProp)}` : "\n✓ 0 khác biệt computed style");
  process.exit(n ? 1 : 0);
}
if (mode !== "dump" || !A) { console.log("Dùng: node tests/ui/cascade.mjs dump <tệp.json> | diff <trước.json> <sau.json>"); process.exit(2); }

const B = process.env.BASE ?? "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-cascade";
rmSync(PROF, { recursive: true, force: true });

const email = "dl-member@synchro.test", password = "Member-pass-123";
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

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), ["--headless=new", "--remote-debugging-port=9336", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9336/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable"); await P("DOM.enable"); await P("CSS.enable");
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(300); } throw new Error("timeout: " + expr); };
const click = async (expr) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) return false;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  await P("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  return true;
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;

// Tắt chuyển động: !important ở lớp khai báo ĐẦU TIÊN thắng mọi !important ở lớp sau và mọi !important không lớp (khi CSS của app đã nằm
// trong @layer, một thẻ <style> không lớp không còn thắng được transition:…!important của synchro-ds.css).
const FREEZE = `(() => { let first = null;
  for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules) { if (r instanceof CSSLayerStatementRule) { first = r.nameList[0]; break; } if (r instanceof CSSLayerBlockRule) { first = r.name; break; } if (!(r instanceof CSSImportRule)) break; }
    if (first) break; }
  const css = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  const s = document.createElement("style"); s.textContent = first ? "@layer " + first + "{" + css + "}" : css; document.head.appendChild(s); return first; })()`;

// Computed style của mọi phần tử nhìn thấy được trong trang (và ::before / ::after có content), khóa theo đường DOM.
const DUMP = `(() => { const out = {}; const path = (e) => { const p = []; for (; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) { let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++; p.unshift(e.tagName.toLowerCase() + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\\s+/).join(".") : "") + ":" + i); } return p.join(">"); };
  const take = (cs) => { const o = {}; for (let i = 0; i < cs.length; i++) { const k = cs[i]; o[k] = cs.getPropertyValue(k); } return o; };
  for (const e of [document.documentElement, ...document.querySelectorAll("body, body *")]) { if (e.closest("svg") && e.tagName.toLowerCase() !== "svg") continue; const k = path(e) || "html"; out[k] = take(getComputedStyle(e));
    for (const pe of ["::before", "::after"]) { const cs = getComputedStyle(e, pe); if (cs.content && cs.content !== "none" && cs.content !== "normal") out[k + pe] = take(cs); } }
  return out; })()`;

// Chuyển động còn chạy (transition: … !important trong một lớp thắng FREEZE không lớp, như ở main trước B5 bước 4) thì giá trị đọc ngay
// sau khi ép :hover / :focus-visible là giá trị đầu của transition, không phải giá trị cuối: hai phiên bản khác nhau giả. Đẩy mọi chuyển
// động tới cuối trước khi đọc.
const SETTLE = `(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch {} } return 1; })()`;
const VIEWS = [{ w: 1440, h: 900, mobile: false }, { w: 768, h: 1024, mobile: false }, { w: 390, h: 844, mobile: true }];
const result = {};
// Ép :hover rồi :focus-visible lên tối đa 40 phần tử tương tác của màn, chụp computed style của chính phần tử đó.
async function pseudo(name) {
  const { root } = await P("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await P("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "button, a, .menu-item, .nav-item, .chat-item, input, textarea, [role=tab], [role=menuitem]" });
  const ids = nodeIds.slice(0, 40);
  for (const state of ["hover", "focus-visible"]) {
    for (const nodeId of ids) {
      await P("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [state] }).catch(() => {});
      await ev(SETTLE);
      const { object } = await P("DOM.resolveNode", { nodeId }).catch(() => ({}));
      if (!object) continue;
      const r = await P("Runtime.callFunctionOn", { objectId: object.objectId, returnByValue: true, functionDeclaration: `function () { const cs = getComputedStyle(this); const o = {}; for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]); let p = []; for (let e = this; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) { let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++; p.unshift(e.tagName.toLowerCase() + ":" + i); } return [p.join(">"), o]; }` });
      await P("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] }).catch(() => {});
      const [k, o] = r.result.value ?? [];
      if (k) (result[`${name} :${state}`] ??= {})[k] = o;
    }
  }
}
async function capture(name) {
  for (const theme of ["light", "dark"]) {
    await ev(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)}); 1`);
    await sleep(400);
    await ev(SETTLE);
    result[`${name} ${theme}`] = await ev(DUMP);
    await pseudo(`${name} ${theme}`);
  }
}

let sent = false;
for (const v of VIEWS) {
  await P("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.mobile });
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`);
  await sleep(1500);
  console.log(`${v.w}px: tắt chuyển động ở lớp`, await ev(FREEZE));
  await capture(`${v.w} home`);
  if (!sent) {
    // Một câu hỏi (model giả lập trả lời cố định) để có tin nhắn và thẻ artifact; các khung nhìn sau mở lại đoạn chat đó.
    await click(`document.querySelector("textarea")`); await P("Input.insertText", { text: "Làm trang web cho quán cà phê" });
    await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await until(`document.querySelectorAll(".art-card:not(.busy)").length > 0 && !document.querySelector(".thinking")`, 60000);
    await sleep(2500); sent = true;
  } else {
    if (v.mobile) await click(`document.querySelector(".side-toggle")`), await sleep(600);
    await click(`document.querySelector(".chat-item")`); await sleep(2000);
  }
  await capture(`${v.w} chat`);
  if (v.mobile) { await click(`document.querySelector(".side-toggle")`); await sleep(600); await capture(`${v.w} drawer`); }
  for (const [nav, n] of [["Artifacts", "artifacts"], ["Skill", "hub"], ["Dự án", "projects"]]) {
    if (v.mobile && !(await ev(`!!document.querySelector(".shell-side.open, .sidebar.open")`).catch(() => false))) { await click(`document.querySelector(".side-toggle")`); await sleep(600); }
    if (await click(byText(".nav-item", nav))) { await sleep(2000); await capture(`${v.w} ${n}`); }
  }
  if (await click(`[...document.querySelectorAll("aside button")].find((e) => e.textContent.includes("Download Tester"))`)) {
    await sleep(500); await capture(`${v.w} usermenu`);
    if (await click(byText(".menu-item", "Cài đặt"))) { await sleep(1500); await capture(`${v.w} settings`); }
  }
}
writeFileSync(A, JSON.stringify(result));
console.log(`đã ghi ${Object.keys(result).length} màn vào ${A}`);
ws.close(); chrome.kill(); process.exit(0);
