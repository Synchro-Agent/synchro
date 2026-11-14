// Số lần vẽ lại và tác vụ dài khi một câu trả lời dài (khoảng 2.000 từ) đang chảy về, máy giảm tốc CPU 4 lần (blueprint B2.8).
// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/render-perf.mjs
// Đếm bằng app/perfmark.ts (countRender trong Thanh bên, Ô soạn tin, Home): chỉ tính lúc chữ đang chảy, bỏ các lần vẽ lúc bắt đầu / kết thúc lượt.
// Chạy hai khổ: 1440×900 (thanh bên mở) và điện thoại 375×812 (ngăn kéo đóng).
// Biến môi trường: GATE=0 chỉ in số đo, không chặn (mặc định chặn: Sidebar = 0, Composer = 0, tác vụ dài nhất ≤ LT_MAX ms, mặc định 50);
// OUT=<tệp.json> ghi số đo ra tệp để so trước / sau. Ngưỡng 50 ms chỉ đáng tin trên bản production (dev:mock:fast); dev React chậm hơn nhiều.
// Đang nằm trong SKIP của scripts/qa.mjs cho tới khi B2 tách xong Thanh bên (bước 5–7): trước đó Sidebar còn vẽ lại theo từng mẩu chữ.
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
(await import("node:fs")).mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-rperf";
rmSync(PROF, { recursive: true, force: true });
const GATE = process.env.GATE !== "0", LT_MAX = Number(process.env.LT_MAX ?? 50);

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

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), ["--headless=new", "--remote-debugging-port=9371", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9371/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); }
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const out = {};

async function run(name, metrics) {
  console.log(`\n── ${name} (${metrics.width}×${metrics.height})`);
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 30000, what = expr, step = 300) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(step); } throw new Error("timeout: " + what); };
  await P("Runtime.enable"); await P("Page.enable");
  await P("Emulation.setDeviceMetricsOverride", metrics);
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  // Tác vụ dài (≥ 50 ms trên luồng chính) gom từ lúc mở trang; bài đo xóa trước khi bắt đầu đo.
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch {}` });
  try {
    await P("Page.navigate", { url: B + "/" });
    await until(`!!document.querySelector("textarea")`, 60000, "app loaded");
    await sleep(2000);
    await P("Emulation.setCPUThrottlingRate", { rate: 4 });
    const box = await ev(`(() => { const el = document.querySelector("#main textarea") ?? document.querySelector("textarea"); el.focus(); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: box[0], y: box[1], button: "left", clickCount: 1 });
    await P("Input.insertText", { text: "Viết bản tổng hợp dài #longmd" });
    await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    const len = `(document.querySelector(".ai-msg.ai-streaming")?.textContent.length ?? -1)`;
    // Đã có chữ chảy về: bỏ qua các lần vẽ lúc bắt đầu lượt (đoạn chat mới, nút Dừng hiện ra…).
    await until(`${len} > 300`, 90000, "first words", 100);
    await sleep(300);
    await ev(`window.__renders = {}; window.__lt = []; 1`);
    const t0 = Date.now();
    let snap = null;
    for (;;) {
      const s = await ev(`(() => { const m = document.querySelector(".ai-msg.ai-streaming"); return m ? { r: { ...window.__renders }, lt: [...window.__lt], n: m.textContent.length } : null; })()`);
      if (!s) break;
      snap = s;
      if (Date.now() - t0 > 180000) throw new Error("câu trả lời không xong sau 3 phút");
      await sleep(100);
    }
    await P("Emulation.setCPUThrottlingRate", { rate: 1 });
    const total = await ev(`[...document.querySelectorAll(".ai-msg")].at(-1)?.textContent.length ?? 0`);
    const r = snap?.r ?? {}, lt = snap?.lt ?? [];
    const res = { renders: r, longTasks: lt.length, ltMax: lt.length ? Math.max(...lt) : 0, ltSum: lt.reduce((a, b) => a + b, 0), streamedMs: Date.now() - t0, chars: snap?.n ?? 0, total };
    out[name] = res;
    console.log("   ", JSON.stringify(res));
    ok(total > 10000, `câu trả lời dài về đủ (${total} ký tự)`, await ev(`[...document.querySelectorAll(".ai-msg")].at(-1)?.textContent.slice(0, 300) ?? ""`));
    if (GATE) {
      ok(!r.Sidebar, `thanh bên không vẽ lại lúc chữ chảy (Sidebar = ${r.Sidebar ?? 0})`);
      ok(!r.Composer, `ô soạn tin không vẽ lại lúc chữ chảy (Composer = ${r.Composer ?? 0})`);
      ok(res.ltMax <= LT_MAX, `không có tác vụ dài hơn ${LT_MAX} ms (dài nhất ${res.ltMax} ms, ${lt.length} tác vụ ≥ 50 ms)`);
    }
  } catch (e) { ok(false, `${name}: lỗi khi chạy`, `${e.message} · ${await ev(`(document.querySelector("#main")?.innerText ?? "").slice(-400)`).catch(() => "")}`); }
  await send("Target.closeTarget", { targetId }).catch(() => {});
}

await run("desktop", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await run("phone", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
console.log(`${pass}/${pass + fail} đạt`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
