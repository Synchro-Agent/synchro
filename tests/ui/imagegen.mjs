// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/imagegen.mjs (đổi địa chỉ bằng SYNCHRO_URL).
// Chat xin ảnh: chip "Tạo ảnh" ở trang chủ, trạng thái đang tạo với số giây, thẻ ảnh hiện ngay trong tin nhắn, bấm xem trước, nút tải về ra đúng tệp ảnh;
// chưa có gói tạo ảnh thì có nút mở Providers; điện thoại không tràn ngang.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", PORT = Number(process.env.CDP_PORT ?? 9341);
const DATA = path.resolve("data-mock"), HOME = path.join(DATA, "engine");
const SCR = path.join(os.tmpdir(), "synchro-ui-img") + "/", DL = SCR + "dl", PROF = SCR + "prof";
rmSync(SCR, { recursive: true, force: true }); mkdirSync(DL, { recursive: true }); mkdirSync(PROF, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tài khoản riêng của bộ kiểm, đăng nhập sẵn gói Claude (model trả lời) và Antigravity (tạo ảnh) bằng CLI giả lập.
const email = `img-ui-${Date.now().toString(36)}@synchro.test`, password = "Image-ui-123";
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return r.status;
};
await api("POST", "/api/auth/signup", { email, password, profile: { fullName: "Image Tester", birthDate: "2000-01-01" } });
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
const Db = createRequire(path.join(process.cwd(), "package.json"))("better-sqlite3");
const uid = (() => { const d = new Db(path.join(DATA, "synchro.db")); d.pragma("busy_timeout = 5000"); const id = d.prepare("SELECT id FROM users WHERE email = ?").get(email).id; d.close(); return id; })();
const LOGIN = { claude: ".mock-login", agy: ".gemini/antigravity-cli/antigravity-oauth-token" };
const dirOf = (cli) => path.join(HOME, "logins", cli, uid);
async function signIn(clis) {
  for (const cli of clis) {
    const f = path.join(dirOf(cli), LOGIN[cli]);
    mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, "{}");
    mkdirSync(path.join(DATA, "engine-tokens"), { recursive: true }); writeFileSync(path.join(DATA, "engine-tokens", `${cli}-${uid}.login`), "1");
    await api("GET", `/api/engines/${cli}/status?fresh=1`);
  }
}
await signIn(["claude"]);
await api("GET", "/api/models");

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(), handlers = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [y, n] = waits.get(m.id); waits.delete(m.id); m.error ? n(new Error(JSON.stringify(m.error))) : y(m.result); }
  else if (m.method) for (const h of handlers) h(m);
});
const send = (method, params = {}, sessionId) => new Promise((y, n) => { const id = ++seq; waits.set(id, [y, n]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const downloads = [];
handlers.push((m) => {
  if (m.method === "Browser.downloadWillBegin") downloads.push({ guid: m.params.guid, name: m.params.suggestedFilename, state: "start" });
  if (m.method === "Browser.downloadProgress") { const d = downloads.find((x) => x.guid === m.params.guid); if (d && m.params.state !== "inProgress") d.state = m.params.state; }
});
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable");
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("u:${uid}:model", JSON.stringify("sub-claude/sonnet")); localStorage.setItem("seen-intro", "1"); } catch {}
  // Ghi lại mọi dòng trạng thái đã hiện: có dòng chỉ hiện vài giây.
  window.__st = []; addEventListener("DOMContentLoaded", () => new MutationObserver(() => { const t = document.querySelector(".wl-st-t")?.textContent; if (t && window.__st.at(-1) !== t) window.__st.push(t); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true }));` });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}${n}.png`, Buffer.from(data, "base64")); };
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const sendMsg = async (t) => { await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: t }); await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); };
const open = async () => { await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("textarea")`, 30000, "app"); await sleep(1500); };
const skipIntro = async () => { await ev(`document.querySelector(".intro-film button, [data-skip-intro]")?.click(); 1`); await sleep(300); };

try {
  console.log("1. Chưa có gói tạo ảnh");
  await open(); await skipIntro();
  ok(!(await ev(`!!${byText(".hero-chip", "Tạo ảnh")}`)), "chưa đăng nhập gói tạo ảnh: chưa hiện chip Tạo ảnh");
  await sendMsg('Tạo ảnh quả táo #tool=generate_image #args={"prompt":"quả táo"}');
  await until(`!!document.querySelector(".wl-plans") && !document.querySelector(".ai-msg .thinking")`, 40000, "thẻ Providers");
  await sleep(400);
  ok(await ev(`!document.querySelector(".outs-imgs img")`), "không có thẻ ảnh giả");
  ok(/Antigravity/.test(await ev(`[...document.querySelectorAll(".ai-msg")].at(-1).textContent`)), "câu trả lời nói gói nào tạo được ảnh");
  await shot("1-noplan");
  await click(`document.querySelector(".wl-plans button")`, "Mở Providers");
  await until(`!!document.querySelector(".pv-vendor")`, 8000, "Providers");
  const note = await ev(`(() => { document.querySelector('[data-vendor="google"] .pv-vendor-h')?.click(); return 1; })()`);
  await sleep(600);
  ok(note && /Creates images|Tạo ảnh ngay/.test(await ev(`document.querySelector('[data-vendor="google"]').textContent`)), "Providers: Gemini nói rõ tạo được ảnh", await ev(`document.querySelector('[data-vendor="google"]').textContent`));
  await shot("1-providers");

  console.log("2. Có gói: chip ở trang chủ, trạng thái, thẻ ảnh");
  await signIn(["agy"]);
  writeFileSync(path.join(dirOf("agy"), "mock-image.json"), JSON.stringify({ mode: "ok", delayMs: 12000 }));
  await open(); await skipIntro();
  await until(`!!${byText(".hero-chip", "Tạo ảnh")}`, 15000, "chip Tạo ảnh");
  ok(true, "có gói Antigravity: chip Tạo ảnh hiện ở trang chủ");
  await click(byText(".hero-chip", "Tạo ảnh"), "chip");
  await sleep(300);
  ok(/^Tạo ảnh/.test(await ev(`document.querySelector("textarea").value`)), "bấm chip: điền sẵn lời nhờ vào ô chat", await ev(`document.querySelector("textarea").value`));
  await shot("2-chip");
  await P("Input.insertText", { text: 'quả táo đỏ #tool=generate_image #args={"prompt":"quả táo đỏ"}' });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(`!!document.querySelector(".wl-status") && /tạo ảnh/i.test(document.querySelector(".wl-status").textContent)`, 30000, "dòng trạng thái");
  await shot("2-status");
  await until(`!!document.querySelector(".outs-imgs img") && document.querySelector(".outs-imgs img").naturalWidth > 0`, 40000, "thẻ ảnh");
  const seen = await ev(`window.__st ?? []`);
  ok(seen.some((t) => /^Đang tạo ảnh bằng Antigravity/.test(t)), "trạng thái: Đang tạo ảnh bằng Antigravity", JSON.stringify(seen));
  ok(seen.some((t) => /^Đang tạo ảnh bằng Antigravity, đã \d+ giây$/.test(t)), "trạng thái đếm giây", JSON.stringify(seen));
  ok(await ev(`document.querySelector(".outs-imgs img").naturalWidth === 96`), "ảnh hiện ngay trong tin nhắn, đúng ảnh thật");
  await until(`!document.querySelector(".wl-status")`, 15000, "xong");
  await sleep(400);
  ok(await ev(`!!${byText(".out-card b", "qua-tao-do")}`), "thẻ tệp có tên dễ đọc", await ev(`document.querySelector(".outs")?.textContent`));
  ok(!/\.gemini|file:\/\//.test(await ev(`document.querySelector(".msgs, main")?.textContent ?? ""`)), "không lộ đường dẫn máy chủ");
  await shot("2-card");

  console.log("3. Xem trước, tải về");
  await click(`document.querySelector(".outs-imgs button")`, "ảnh");
  await until(`!!document.querySelector(".fp-img img") && document.querySelector(".fp-img img").naturalWidth > 0`, 10000, "xem trước");
  ok(true, "bấm ảnh: mở khung xem trước");
  await shot("3-preview");
  await click(`document.querySelector(".out-dl")`, "tải về");
  for (let i = 0; i < 40 && !downloads.some((d) => d.state === "completed"); i++) await sleep(200);
  const got = downloads.find((d) => d.state === "completed");
  ok(!!got && got.name === "qua-tao-do.jpg", "nút tải về lưu đúng tên", JSON.stringify(downloads));
  const file = got && readdirSync(DL).map((f) => path.join(DL, f)).find((f) => statSync(f).size > 0);
  const bytes = file ? readFileSync(file) : Buffer.alloc(0);
  ok(bytes[0] === 0xff && bytes[1] === 0xd8, "tệp tải về đúng là ảnh JPEG", bytes.length);

  console.log("4. Điện thoại");
  await P("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await P("Page.reload");
  await until(`!!document.querySelector(".outs-imgs img")`, 30000, "thẻ ảnh sau khi tải lại");
  await sleep(1200);
  ok(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), "điện thoại: không tràn ngang", await ev(`document.documentElement.scrollWidth`));
  ok(await ev(`(() => { const b = document.querySelector(".out-card").getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1; })()`), "thẻ tệp nằm trọn trong màn hình");
  ok(await ev(`document.querySelector(".outs-imgs img").naturalWidth > 0`), "tải lại trang: ảnh vẫn hiện");
  await shot("4-phone");
  await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
} catch (e) {
  fail++;
  console.log("  ✗ lỗi:", e.message);
  await shot("fail").catch(() => {});
} finally {
  ws.close(); chrome.kill();
}
console.log(`\nẢnh chụp: ${SCR}`);
console.log(`${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
