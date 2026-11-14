// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/critic.mjs
// Skill tự sửa lỗi trong Kho kỹ năng: chi tiết skill có mục "Bản tự sửa" (đang dùng / chờ duyệt), xem khác biệt, duyệt, hoàn tác.
import { waitFor } from "../lib/wait.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-skillheal";
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
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email); db.close(); }
const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", "--remote-debugging-port=9338", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9338/json/version").then((r) => r.json()).catch(() => null); }
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
await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
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
const ok = (c, n, x = "") => { results.push([c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}skillheal-${n}.png`, Buffer.from(data, "base64")); };
const ask = async (text) => {
  await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
};
const R = createRequire(process.cwd() + "/package.json");
const JSZip = R("jszip");
const NAME = "heal-ui-demo";
await api("DELETE", `/api/skills/${NAME}`);
const z = new JSZip();
z.file(`${NAME}/SKILL.md`, `---\nname: ${NAME}\ndescription: "Kiểm thử giao diện bản tự sửa"\n---\n\n# Demo\n`);
z.file(`${NAME}/scripts/count.py`, `import sys\nprint("So tu:", totl)  # BUG FIX: print("So tu:", len(sys.argv) - 1)\n`);
z.file(`${NAME}/scripts/post.py`, `# requests.post(URL, json=data)\nprint("Da gui", cnt)  # BUG FIX: print("Da gui", 0)\n`);
const fd = new FormData();
fd.append("file", new Blob([await z.generateAsync({ type: "nodebuffer" })]), `${NAME}.zip`);
await fetch(B + "/api/skills", { method: "POST", headers: { origin: B, cookie }, body: fd });
const run = async (cmd) => {
  let r = await api("POST", "/api/llm", { system: "", max_tokens: 1500, skills: true, model: "anthropic/claude-sonnet-5-5", messages: [{ role: "user", content: cmd }] });
  for (let i = 0; i < 120 && r.j?.run && !r.j.done; i++) { await sleep(500); r = await api("GET", `/api/runs/${r.j.run ?? r.j.id}?json=1`); }
};
await run(`#skillrun ${NAME} scripts/count.py a b`);
await run(`#skillrun ${NAME} scripts/post.py`);

try {
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`, 30000, "app");
  await sleep(1000);
  await click(byText(".nav-item", "Skill"), "hub");
  await until(`!!${byText(".pl-row2", NAME)}`, 15000, "skill row");
  await click(byText(".pl-row2", NAME), "open skill");
  await until(`!!document.querySelector(".sk-fix")`, 8000, "self-fixes");
  const rows = await ev(`[...document.querySelectorAll(".sk-fix")].map((e) => e.querySelector(".sk-tag").textContent + " | " + e.querySelector("b").textContent)`);
  ok(rows.length === 2 && rows.some((x) => /Chờ duyệt \| scripts\/post.py/.test(x)) && rows.some((x) => /Đang dùng \| scripts\/count.py/.test(x)), "mục Bản tự sửa: count.py đang dùng, post.py chờ duyệt", JSON.stringify(rows));
  ok(await ev(`!!document.querySelector(".sk-fix.pending .sk-diff .add") && !!document.querySelector(".sk-fix.pending .sk-diff .del")`), "bản chờ duyệt mở sẵn phần khác biệt (dòng thêm / bớt)");
  ok(/NameError/.test(await ev(`document.querySelector(".sk-fix.active .sk-fix-e").textContent`)) && /Tự sửa sau 1 lần thử/.test(await ev(`document.querySelector(".sk-fix.active .sk-fix-m").textContent`)), "ghi rõ lỗi gốc và số lần thử");
  await (async () => { await ev(`document.querySelector(".sk-fix.pending").scrollIntoView({ block: "center" }); 1`); })();
  await shot("1-fixes");
  await click(byText(".sk-fix.pending .btn", "Duyệt bản sửa"), "approve");
  ok(await waitFor(() => ev(`[...document.querySelectorAll(".sk-fix .sk-tag")].filter((e) => e.textContent === "Đang dùng").length === 2`), 5000), "duyệt: bản sửa post.py chuyển sang Đang dùng");
  await click(`[...document.querySelectorAll(".sk-fix")].find((e) => /count.py/.test(e.textContent)).querySelector(".btn")`, "undo");
  ok(await waitFor(() => ev(`/Đã hoàn tác/.test([...document.querySelectorAll(".sk-fix")].find((e) => /count.py/.test(e.textContent)).textContent)`), 5000), "hoàn tác bản sửa count.py");
  await shot("2-after");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
await api("DELETE", `/api/skills/${NAME}`);
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
