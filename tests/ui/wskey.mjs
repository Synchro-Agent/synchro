// Thêm khóa Anthropic không gắn với workspace trên giao diện thật: thông báo, ô chọn, giữ khóa đã dán, cả sáng và tối. Chạy tay: node tests/ui/wskey.mjs
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-wskey";
rmSync(PROF, { recursive: true, force: true });

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", "--remote-debugging-port=9344", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9344/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); }
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable");
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });

const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;

const results = [];
const ok = (c, n, x = "") => { results.push(c); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}wskey-${n}.png`, Buffer.from(data, "base64")); };
const ORIGINAL = "sk-ant-mock-local-0001";
const prov = (await api("GET", "/api/admin/apikeys")).j.providers.find((p) => p.id === "anthropic");
const type = async (expr, text) => { await click(expr, text); await ev(`(() => { const el = ${expr}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`); };
try {
  for (const theme of ["light", "dark"]) {
    await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    // Tải lại thật (cùng địa chỉ chỉ đổi # thì trang không tải lại, form còn giữ workspace của vòng trước) và đổi giao diện như người dùng.
    await P("Page.navigate", { url: B + "/" });
    await until(`!!document.querySelector("textarea")`, 30000, "app");
    await ev(`localStorage.setItem("theme", ${JSON.stringify(theme)}), 1`);
    await P("Page.reload");
    await sleep(500);
    await until(`!!document.querySelector("textarea")`, 30000, "app");
    await sleep(800);
    if (!(await ev(`!!document.querySelector(".modal.settings")`))) {
      await click(`document.querySelector(".user")`, "user");
      await until(`!![...document.querySelectorAll(".menu-item")].find((e) => /Cài đặt|Settings/.test(e.textContent))`, 5000, "menu");
      await click(`[...document.querySelectorAll(".menu-item")].find((e) => /Cài đặt|Settings/.test(e.textContent))`, "settings");
      await until(`!!document.querySelector(".modal.settings")`, 8000, "settings");
    }
    await click(`[...document.querySelectorAll(".modal.settings .s-item")].find((e) => /Providers|Nhà cung cấp/i.test(e.textContent + e.getAttribute("title")))`, "providers");
    await sleep(1200);
    const card = `document.querySelector('input[id="api-key-anthropic"]')`;
    if (!(await ev(`!!${card}`))) {
      // Mở mục Claude, chọn "Link an API key" rồi bấm đổi khóa.
      const v = `document.querySelector('.pv-vendor[data-vendor="anthropic"]')`;
      if (await ev(`${v}.querySelector(".pv-vendor-h").getAttribute("aria-expanded") !== "true"`)) await click(`${v}.querySelector(".pv-vendor-h")`, "mở Claude");
      await sleep(400);
      await click(`[...${v}.querySelectorAll(".pv-opt")].at(-1)`, "chọn khóa API");
      await sleep(400);
      await click(`[...${v}.querySelectorAll(".api-btns button")].find((b) => /Change key|Add key|Đổi khóa|Thêm khóa/.test(b.textContent))`, "đổi khóa");
      await until(`!!${card}`, 5000, "form khóa");
    }
    await type(card, "sk-ant-mock-org-two-0001");
    await click(`[...document.querySelectorAll(".api-form button")].find((b) => /Verify and save|Kiểm tra và lưu/.test(b.textContent))`, "lưu");
    await until(`!!document.querySelector(".api-form select")`, 15000, "ô chọn workspace");
    const r = await ev(`(() => { const f = document.querySelector(".api-form"), sel = f.querySelector("select"), err = f.querySelector(".api-err"), fb = f.getBoundingClientRect(), sb = sel.getBoundingClientRect(), eb = err.getBoundingClientRect(); return { opts: [...sel.options].map((o) => o.textContent), err: err.textContent, inForm: sb.left >= fb.left - 1 && sb.right <= fb.right + 1 && eb.left >= fb.left - 1 && eb.right <= fb.right + 1, h: sb.height, w: sb.width, key: f.querySelector('input[type="password"],input[type="text"]').value.length, gap: eb.top - sb.bottom }; })()`);
    ok(r.opts.join() === "Chọn workspace,Default,Team" || r.opts.join() === "Choose a workspace,Default,Team", `${theme}: ô chọn hiện đúng workspace`, JSON.stringify(r));
    ok(!/anthropic-workspace-id|Error 400|Lỗi 400/.test(r.err), `${theme}: thông báo dễ hiểu, không lộ lỗi kỹ thuật`, r.err);
    ok(r.inForm && r.h >= 32 && r.w > 200 && r.gap >= 0, `${theme}: ô chọn và thông báo nằm gọn trong form`, JSON.stringify(r));
    ok(r.key > 0, `${theme}: khóa vừa dán không bị xóa, chỉ cần chọn rồi lưu`, JSON.stringify(r));
    await sleep(300); await shot(`${theme}-chon`);
    await ev(`(() => { const s = document.querySelector(".api-form select"); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "wrkspc_01Team000000"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await click(`[...document.querySelectorAll(".api-form button")].find((b) => /Verify and save|Kiểm tra và lưu/.test(b.textContent))`, "lưu lần 2");
    await until(`!document.querySelector(".api-form")`, 15000, "form đóng sau khi lưu");
    const p = (await api("GET", "/api/admin/apikeys")).j.providers.find((x) => x.id === "anthropic");
    ok(p.workspaceId === "wrkspc_01Team000000" && p.status === "ok", `${theme}: chọn xong lưu được`, JSON.stringify(p.workspaceId));
    await api("POST", "/api/admin/apikeys", { id: "anthropic", key: ORIGINAL, baseUrl: prov.baseUrl, name: "Claude", workspaceId: "" });
  }
} catch (e) { ok(false, "lỗi khi chạy " + e.message); await shot("loi").catch(() => {}); }
finally { await api("POST", "/api/admin/apikeys", { id: "anthropic", key: ORIGINAL, baseUrl: prov.baseUrl, name: "Claude", workspaceId: "" }); chrome.kill(); }
const bad = results.filter((c) => !c).length;
console.log(`\n${results.length - bad} đạt, ${bad} lỗi`);
process.exit(bad ? 1 : 0);
