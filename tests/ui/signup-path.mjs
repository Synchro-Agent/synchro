// Người mới gõ email: bước kế tiếp nói rõ cả đăng nhập lẫn tạo tài khoản, sai mật khẩu vẫn có đường tạo tài khoản, chữ lạ trên ?auth_error= không hiện ra.
// Chạy tay: BASE=http://localhost:3277 node tests/ui/signup-path.mjs
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const B = process.env.BASE ?? "http://localhost:3200", CDP = process.env.CDP_PORT ?? "9362";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-signup-" + CDP;
rmSync(PROF, { recursive: true, force: true });
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable");
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(200); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const key = async (k, code, vk) => { for (const type of ["keyDown", "keyUp"]) await P("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk }); };
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}signup-${n}.png`, Buffer.from(data, "base64")); };
const btn = (re) => `[...document.querySelectorAll("button")].find((b) => ${re}.test(b.textContent.trim()))`;
const text = `document.body.innerText`;
try {
  await P("Page.navigate", { url: B + "/?auth_error=" + encodeURIComponent("Tài khoản bị khóa, hãy gọi 1900 0000") });
  await until(`!!${btn(/^(Try Again|Thử lại)$/i)}`, 40000, "error stage");
  ok(!(await ev(`${text}.includes("1900 0000")`)), "chữ lạ trên URL không hiện trên trang đăng nhập", await ev(text));
  await click(btn(/^(Try Again|Thử lại)$/i), "try again");
  await until(`!!document.querySelector("input[type=email]")`, 15000, "email");
  await sleep(1500);
  await click(`document.querySelector("input[type=email]")`, "email");
  await P("Input.insertText", { text: "nguoi-moi-" + Date.now() + "@example.com" });
  await sleep(200);
  await key("Enter", "Enter", 13);
  await until(`!!document.querySelector("input[type=password]")`, 8000, "password step");
  await sleep(1500);
  const t = await ev(text);
  ok(/Sign in or create an account|Đăng nhập hoặc đăng ký/.test(t), "tiêu đề nói rõ cả hai đường", t);
  ok(await ev(`(() => { const b = ${btn(/^(Create an account|Tạo tài khoản)$/)}; if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 200 && r.height >= 32; })()`), "nút Tạo tài khoản là nút to, không phải chữ nhỏ");
  await shot("password");
  await click(`document.querySelector("input[type=password]")`, "pass");
  await P("Input.insertText", { text: "mat-khau-moi-12345" });
  await sleep(300);
  await key("Enter", "Enter", 13);
  await until(`!!${btn(/^(Try Again|Thử lại)$/i)}`, 15000, "wrong password");
  await sleep(500);
  ok(await ev(`!!${btn(/^(Create an account|Tạo tài khoản)$/)}`), "sai mật khẩu: có nút Tạo tài khoản", await ev(text));
  await shot("wrong");
  await click(btn(/^(Create an account|Tạo tài khoản)$/), "create");
  await until(`/Create your password|Tạo mật khẩu/.test(${text})`, 8000, "create step");
  ok(true, "bấm vào thì sang bước tạo mật khẩu");
  await shot("create");
} catch (e) { fail++; console.log("  ✗", e.message); await shot("fail").catch(() => {}); }
chrome.kill();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
