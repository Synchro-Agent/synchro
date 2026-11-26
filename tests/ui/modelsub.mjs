// Danh sách model của một hãng (video chủ dự án 5/11): dòng cuối lòi khỏi khung, viền cắt ngang chữ, tiêu đề gói bị cắt khi cuộn. Chạy tay: node tests/ui/modelsub.mjs
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-msub";
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
  ["--headless=new", "--remote-debugging-port=9345", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9345/json/version").then((r) => r.json()).catch(() => null); }
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
const ok = (c, n, x = "") => { results.push(c); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}msub-${n}.png`, Buffer.from(data, "base64")); };
// Bộ chọn model của tài khoản có gói: ghi chú "Từ gói của bạn" cộng thêm chiều cao. Hãng cuối có rất nhiều model để buộc phải cuộn.
await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const f = window.fetch; window.fetch = async (...a) => { const r = await f(...a); if (!String(a[0]).includes("/api/models")) return r;
  const j = await r.clone().json().catch(() => null); if (!j?.providers?.length) return r;
  const mk = (p, n) => Array.from({ length: n }, (_, i) => ({ key: p + "/m" + i, id: "m" + i, name: "Model thử " + (i + 1) }));
  j.providers = j.providers.slice(0, 3).map((p, i) => ({ ...p, plan: { cli: "agy" }, models: mk(p.id, [3, 4, 30][i] ?? 4) }));
  j.allowed = "*"; return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } }); }; })()` });
// Chỉ đếm dòng model trong vùng cuộn: nút "Xem tất cả model" / "Thu gọn" đứng ngoài vùng cuộn, ở đáy khung.
const measure = `(() => {
  const m = [...document.querySelectorAll(".msub-models")].find((e) => !e.classList.contains("out"));
  if (!m) return null;
  const s = m.querySelector(".msub-scroll"), r = m.getBoundingClientRect(), it = [...s.querySelectorAll(".menu-item")];
  const last = it.at(-1).getBoundingClientRect(), sr = s.getBoundingClientRect();
  const n = m.querySelector(".msub-plan")?.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, h: r.height, H: innerHeight, panelScrolls: /(auto|scroll)/.test(getComputedStyle(m).overflowY), panelTop: m.scrollTop, canScroll: s.scrollHeight > s.clientHeight + 1, scrollTop: s.scrollTop, lastBottom: last.bottom, listBottom: sr.bottom, listTop: sr.top, noteTop: n?.top, noteBottom: n?.bottom, items: it.length }; })()`;
try {
  for (const [w, h] of [[1440, 900], [1280, 640], [1280, 480]]) {
    await P("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await P("Page.navigate", { url: B + "/" });
    await until(`!!document.querySelector("textarea") && !!document.querySelector(".model-btn")`, 30000, "app");
    await sleep(1200);
    await click(`document.querySelector(".model-btn")`, "nút model");
    await until(`!!document.querySelector(".model-menu")`, 5000, "menu model");
    await sleep(300);
    const names = await ev(`(async () => (await (await fetch("/api/models")).json()).providers.map((p) => p.name))()`);
    for (let i = 0; i < 3; i++) {
      const pt = await ev(`(() => { const e = [...document.querySelectorAll(".model-menu .menu-item")].filter((x) => !x.closest(".model-sub")).find((x) => x.textContent.trim().startsWith(${JSON.stringify(names[i])})); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
      if (!pt) { ok(false, `${h}px: không thấy dòng ${names[i]}`); continue; }
      await P("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt[0], y: pt[1] });
      await sleep(450);
      // Menu con chỉ hiện đội hình ngắn: mở "Xem tất cả model" để có danh sách dài thật sự phải cuộn.
      const openSub = `[...document.querySelectorAll(".msub-models")].find((e) => !e.classList.contains("out"))`;
      if (await ev(`!!${openSub}?.querySelector(".mall")`)) {
        await click(`${openSub}.querySelector(".mall")`, "Xem tất cả model");
        await sleep(450);
      }
      const a = await ev(measure);
      const tag = `${h}px, ${names[i]} (${a?.items} model)`;
      ok(a && !a.panelScrolls, `${tag}: khung kính không tự cuộn`, JSON.stringify(a));
      ok(a && a.top >= 7 && a.bottom <= a.H - 7, `${tag}: khung nằm trọn trong màn hình`, JSON.stringify(a));
      ok(a && a.noteBottom <= a.listTop + 1 && a.noteTop >= a.top, `${tag}: ghi chú gói ở đầu khung, không bị cắt`, JSON.stringify(a));
      // Danh sách ngắn mà khung đủ chỗ thì không được phải cuộn (đúng lỗi Gemini 4 model ở video của chủ dự án).
      if (a && a.items <= 4 && h >= 480) ok(!a.canScroll, `${tag}: đủ chỗ thì không cuộn`, JSON.stringify(a));
      if (a && a.canScroll) {
        await ev(`(() => { const s = [...document.querySelectorAll(".msub-models")].find((e) => !e.classList.contains("out")).querySelector(".msub-scroll"); s.scrollTop = s.scrollHeight; })()`);
        await sleep(200);
        const b = await ev(measure);
        ok(b.panelTop === 0 && b.scrollTop > 0, `${tag}: cuộn phần danh sách, khung kính đứng yên`, JSON.stringify(b));
        ok(b.lastBottom <= b.listBottom + 1 && b.listBottom <= b.bottom + 1, `${tag}: dòng cuối nằm trong khung sau khi cuộn`, JSON.stringify(b));
        ok(b.noteTop === a.noteTop, `${tag}: ghi chú gói đứng yên khi cuộn`, JSON.stringify(b));
        await shot(`${h}-cuon`);
      } else await shot(`${h}-${i}`);
    }
  }
} catch (e) { ok(false, "lỗi khi chạy " + e.message); await shot("loi").catch(() => {}); }
finally { chrome.kill(); }
const bad = results.filter((c) => !c).length;
console.log(`\n${results.length - bad} đạt, ${bad} lỗi`);
process.exit(bad ? 1 : 0);
