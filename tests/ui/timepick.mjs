// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/timepick.mjs
// Ô chọn giờ của việc tự động (ui/timepick.tsx, thay <input type="time"> mặc định của Chrome): bảng chọn nổi trên hộp thoại, chọn giờ
// rồi phút thì điền HH:MM và đóng, gõ tay nhiều kiểu (1915, 7h30, 8 tối), gõ sai thì giữ giờ cũ, mốc nhanh, Esc đóng. Không lưu việc nào.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-timepick";
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
// Việc tự động của riêng bộ này để mở hộp Sửa (trước đây dựa vào việc do inbox.mjs bỏ lại; luồng tạo việc ở Autopilot
// đã đổi, 5917e17), đặt tên riêng để tìm đúng thẻ; xóa khi xong. Không chạy lần nào (lịch hằng ngày).
const TITLE = "Kiểm thử ô chọn giờ";
const made = await api("POST", "/api/tasks", { title: TITLE, prompt: "Tóm tắt tin công nghệ buổi sáng", schedule: { kind: "daily", time: "08:00", tz: "Asia/Ho_Chi_Minh" }, browser: "auto", engine: "chat" });
if (!made.j?.task?.id) throw new Error("không tạo được việc tự động: " + JSON.stringify(made.j));
const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", "--remote-debugging-port=9343", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9343/json/version").then((r) => r.json()).catch(() => null); }
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
// Ô chọn của app (ui/listbox.tsx): bấm nút, chờ danh sách, bấm mục có data-value cần chọn.
const pickDd = async (btn, v) => { await ev(`(${btn}).click(), 1`); await until(`!!document.querySelector('.dd-pop [role=option][data-value=${JSON.stringify(String(v))}]')`, 5000, "mục " + v); await ev(`document.querySelector('.dd-pop [role=option][data-value=${JSON.stringify(String(v))}]').click(), 1`); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const results = [];
const ok = (c, n, x = "") => { results.push([c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}timepick-${n}.png`, Buffer.from(data, "base64")); };
const val = () => ev(`document.querySelector(".field.tpk input").value`);
const popOpen = () => ev(`!!document.querySelector(".tpk-pop")`);
const type = async (text) => {
  await ev(`(() => { const i = document.querySelector(".field.tpk input"); i.focus(); i.select(); return 1; })()`);
  await P("Input.insertText", { text });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(250);
};

try {
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`, 30000, "app");
  await sleep(800);
  await ev(`[...document.querySelectorAll(".nav-item")].find((e) => ` +
    `e.textContent.trim().startsWith("Autopilot"))?.click(), 1`);
  await until(`!![...document.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("Việc tự động"))`, 15000, "jobs tab");
  await ev(`[...document.querySelectorAll("button")].find((e) => e.textContent.trim().startsWith("Việc tự động")).click(), 1`);
  const edit = `[...document.querySelectorAll(".tk-job")].find((e) => e.querySelector(".tk-t b")?.textContent === ${JSON.stringify(TITLE)})?.querySelector(".tk-acts .btn.ghost")`;
  await until(`!!${edit}`, 15000, "edit");
  await ev(`${edit}.click(), 1`);
  await until(`!!document.querySelector(".modal.tk-modal")`, 10000, "modal");
  await sleep(400);
  await pickDd(`document.querySelector(".tk-modal .tk-kind")`, "daily");
  await until(`!!document.querySelector(".field.tpk input")`, 5000, "time picker");
  ok(!(await ev(`!!document.querySelector('.tk-modal input[type=time]')`)), "không còn ô chọn giờ mặc định của Chrome");

  await click(`document.querySelector(".field.tpk input")`, "open");
  await until(`!!document.querySelector(".tpk-pop")`, 5000, "popover");
  await sleep(400);
  ok(await ev(`(() => { const r = document.querySelector(".tpk-pop").getBoundingClientRect(); return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest(".tpk-pop"); })()`), "bảng chọn giờ nổi trên hộp thoại");
  ok(await ev(`[...document.querySelectorAll(".tpk-col")].every((c) => { const s = c.querySelector("[aria-selected=true]").getBoundingClientRect(), b = c.getBoundingClientRect(); return Math.abs(s.y + s.height / 2 - (b.y + b.height / 2)) < 3; })`), "giờ và phút đang chọn nằm giữa cột");
  await shot("1-open");
  await click(`[...document.querySelectorAll(".tpk-col")][0].querySelectorAll("button")[8]`, "hour 8");
  await sleep(200);
  ok((await val()).startsWith("08:") && await popOpen(), "chọn giờ: điền giờ, bảng vẫn mở để chọn phút", await val());
  await click(`[...document.querySelectorAll(".tpk-col")][1].querySelectorAll("button")[6]`, "minute 30");
  await sleep(250);
  ok((await val()) === "08:30" && !(await popOpen()), "chọn phút: 08:30 và đóng bảng", await val());

  const typed = [];
  for (const [t, want] of [["1915", "19:15"], ["7h30", "07:30"], ["8 tối", "20:00"], ["99", "20:00"], ["6:05 am", "06:05"]]) { await type(t); typed.push(`${t}→${await val()}`); ok((await val()) === want, `gõ "${t}" → ${want}`, typed.at(-1)); }

  await click(`document.querySelector(".field.tpk input")`, "reopen");
  await until(`!!document.querySelector(".tpk-pop")`, 5000, "popover again");
  await click(`[...document.querySelectorAll(".tpk-quick button")].find((b) => b.textContent === "12:00")`, "quick 12:00");
  await sleep(250);
  ok((await val()) === "12:00" && !(await popOpen()), "mốc nhanh 12:00", await val());
  await click(`document.querySelector(".field.tpk input")`, "reopen 2");
  await until(`!!document.querySelector(".tpk-pop")`, 5000, "popover 3");
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(250);
  ok(!(await popOpen()) && !!(await ev(`!!document.querySelector(".modal.tk-modal")`)), "Esc đóng bảng chọn, hộp thoại vẫn mở");
  await shot("2-done");
  await ev(`[...document.querySelectorAll(".tk-modal .modal-foot .btn")].find((b) => /Hủy|Cancel/.test(b.textContent))?.click(), 1`);
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
await api("DELETE", `/api/tasks/${made.j.task.id}`);
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
