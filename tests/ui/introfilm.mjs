// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/introfilm.mjs
// Phim giới thiệu cho tài khoản mới (app/introfilm.tsx): đăng ký bằng email → lời chào → vòng tròn của logo nở ra phủ màn hình → phim phát
// có tiếng, phụ đề tiếng Việt → Bỏ qua (tài khoản 1) / hết phim (tài khoản 2) → logo bay về chỗ trong app, nền phim tan ra → vào app; tải lại không
// phát lại. Hai tài khoản thử (mật khẩu ngẫu nhiên) tự xoá khi xong.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-introfilm";

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
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}introfilm-${n}.png`, Buffer.from(data, "base64")); };
const type = async (text) => { await P("Input.insertText", { text }); await sleep(120); };
const enter = async () => { await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); };
// Ô nhập theo autocomplete (chữ gợi ý được dịch theo ngôn ngữ giao diện).
const field = (sel, i = 0) => `[...document.querySelectorAll(${JSON.stringify(sel)})].at(${i})`;
const made = [];

// Đăng ký bằng email như người dùng (gõ phím, Enter), trả về khi lời chào hiện ra.
async function signup(tag) {
  const email = `intro-ui-${tag}-${Date.now()}@synchro.test`, password = crypto.randomBytes(12).toString("base64url");
  made.push({ email, password });
  await P("Network.clearBrowserCookies");
  await P("Page.navigate", { url: B + "/" });
  await until(`!!${field("input[type=email]")}`, 30000, "sign-in form");
  await sleep(600);
  await click(field("input[type=email]"), "email"); await type(email); await enter();
  await until(`!!${field("input[autocomplete=new-password]")}`, 15000, "password step"); await sleep(500);
  await click(field("input[autocomplete=new-password]"), "password"); await type(password); await enter();
  await until(`!!document.querySelector("input[autocomplete=new-password]:not([readonly])") && [...document.querySelectorAll("input[autocomplete=new-password]")].length >= 1 && /confirm/i.test(document.querySelector("form")?.innerHTML ?? "") || document.querySelectorAll("input[autocomplete=new-password]").length === 2`, 15000, "confirm step"); await sleep(900);
  await click(field("input[autocomplete=new-password]", -1), "confirm"); await type(password); await enter();
  await until(`!!${field("input[autocomplete=name]")}`, 15000, "profile step"); await sleep(900);
  // Ô vừa hiện còn đang chạy hiệu ứng: gõ lại tới khi ô nhận chữ.
  for (let i = 0; i < 4 && !(await ev(`${field("input[autocomplete=name]")}?.value`)); i++) { await click(field("input[autocomplete=name]"), "name"); await type("Lâm Thử Phim"); await sleep(300); }
  await click(field("input[autocomplete=bday]"), "dob"); await type("01022000"); await enter();
  await until(`!!document.querySelector(".auth-welcome")`, 20000, "welcome");
}

try {
  await P("Network.enable");
  // ---- Tài khoản 1: Bỏ qua giữa phim
  await signup("skip");
  await shot("1-welcome");
  await until(`!!document.querySelector(".intro")`, 6000, "intro mounted");
  ok(await ev(`document.querySelector(".intro").dataset.phase === "iris" && !!document.querySelector(".intro-iris")`), "lời chào xong: bắt đầu bằng vòng tròn nở ra (không hiện phim đột ngột)");
  const irisR = () => ev(`(() => { const e = document.querySelector(".intro-iris"); if (!e) return -1; const r = /circle\\(([\\d.]+)px/.exec(getComputedStyle(e).clipPath); return r ? +r[1] : -1; })()`);
  const r1 = await irisR(); await sleep(300); const r2 = await irisR();
  ok(r2 > r1 && r2 > 0 && r2 < Math.hypot(1440, 900), "giữa lúc chuyển: vòng tròn đang nở dần, chưa phủ kín", `${r1} → ${r2}`);
  ok(await ev(`!!document.querySelector(".auth-root")`), "màn lời chào vẫn ở dưới cho tới khi phủ kín");
  await shot("2-iris");
  await until(`["wait","play"].includes(document.querySelector(".intro")?.dataset.phase)`, 4000, "covered");
  ok(await ev(`!document.querySelector(".auth-root")`), "phủ kín rồi mới gỡ màn đăng nhập");
  await until(`document.querySelector(".intro")?.dataset.phase === "play"`, 20000, "playing");
  await sleep(2400);
  const st = await ev(`(() => { const v = document.querySelector(".intro-v"); return { t: v.currentTime, paused: v.paused, muted: v.muted, src: v.currentSrc.split("/").pop(), op: getComputedStyle(document.querySelector(".intro-host")).opacity }; })()`);
  ok(st.t > 1.5 && !st.paused && st.op === "1", "phim đang phát và đã hiện hẳn", JSON.stringify(st));
  ok(!st.muted, "phát có tiếng (người dùng vừa thao tác trên trang)", JSON.stringify(st));
  ok(st.src === "synchro-intro.mp4", "màn rộng dùng bản 1080p", st.src);
  const cap = await ev(`document.querySelector(".intro-cap")?.textContent ?? ""`);
  ok(/Claude, ChatGPT, Gemini, Grok và DeepSeek/.test(cap), "phụ đề tiếng Việt theo cảnh", cap);
  ok(await ev(`getComputedStyle(document.querySelector(".intro-btn.skip")).opacity === "1"`), "nút Bỏ qua đã hiện");
  await shot("3-playing");
  await click(`document.querySelector(".intro-btn.skip")`, "skip");
  await sleep(150);
  const out = await ev(`(() => ({ phase: document.querySelector(".intro").dataset.phase, mk: !!document.querySelector(".intro-fly .fly-mk svg"), wd: !!document.querySelector(".intro-fly .fly-wd svg"), host: getComputedStyle(document.querySelector(".intro-host")).opacity }))()`);
  ok(out.phase === "out" && out.mk && out.wd, "Bỏ qua: phim mờ đi, logo của khung cuối hiện lên (biểu tượng + chữ)", JSON.stringify(out));
  // Logo bắt đầu bay sau ~0,65 giây; chờ tới khi đang bay (Chrome ẩn trên máy dev có thể chậm vài trăm ms).
  // Chữ bay sau biểu tượng 70 ms: chờ cả hai cùng đang bay.
  await until(`(() => { const m = document.querySelector(".fly-mk"), w = document.querySelector(".fly-wd"); return !!m && !!w && new DOMMatrix(getComputedStyle(m).transform).a < 0.9 && new DOMMatrix(getComputedStyle(w).transform).a < 0.9; })()`, 3000, "flight").catch(() => {});
  const mid = await ev(`(() => { const m = document.querySelector(".fly-mk"), w = document.querySelector(".fly-wd"); return { m: m && new DOMMatrix(getComputedStyle(m).transform).a, w: w && new DOMMatrix(getComputedStyle(w).transform).a, reveal: document.querySelector(".app")?.classList.contains("app-reveal"), hidden: getComputedStyle(document.querySelector(".greeting .greet-mark")).opacity === "0", stage: +getComputedStyle(document.querySelector(".intro-stage")).opacity }; })()`);
  ok(mid.m < 0.9 && mid.w < 0.9, "logo đang bay về chỗ (thu nhỏ dần)", JSON.stringify(mid));
  ok(mid.reveal && mid.hidden && mid.stage < 1, "nền phim tan ra, app lắng xuống, logo thật của app chờ logo bay tới", JSON.stringify(mid));
  ok(await ev(`[...document.querySelectorAll(".intro-cap, .intro-ui")].every((e) => +getComputedStyle(e).opacity < 0.05)`), "phụ đề và nút đã mờ hết khi logo bay");
  await shot("4-flight");
  await until(`!document.querySelector(".intro")`, 4000, "intro gone");
  await sleep(300);
  ok(await ev(`!document.querySelector(".app.app-reveal") && !!document.querySelector(".greeting") && getComputedStyle(document.querySelector(".greeting .greet-mark")).opacity === "1"`), "xong: vào trang chủ, logo thật của app hiện lại, lớp chuyển cảnh đã gỡ");
  await shot("5-home");
  await P("Page.reload"); await sleep(3500);
  ok(await ev(`!document.querySelector(".intro") && !!document.querySelector(".greeting")`), "tải lại trang: không phát lại phim");

  // ---- Tài khoản 2: xem hết phim (tua tới gần cuối)
  await signup("end");
  await until(`document.querySelector(".intro")?.dataset.phase === "play"`, 25000, "playing 2");
  await ev(`(() => { const v = document.querySelector(".intro-v"); v.currentTime = v.duration - 0.6; return 1; })()`);
  await until(`document.querySelector(".intro")?.dataset.phase === "out"`, 6000, "ended → out");
  ok(await ev(`!!document.querySelector(".intro-fly .fly-mk") && !document.querySelector(".intro-fly.skip")`), "hết phim: logo của khung cuối ở lại (đè khít, không hiện lại), phim mờ đi");
  await shot("6-end-hold");
  await sleep(900); await shot("6b-end-flight");
  await until(`!document.querySelector(".intro")`, 4000, "intro gone 2");
  ok(await ev(`!!document.querySelector(".greeting")`), "hết phim: vào trang chủ");

  // ---- Tài khoản 3: điện thoại, bật giảm chuyển động — bản 720p, không tự phát, chỉ mờ dần
  await P("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await signup("reduced");
  await until(`document.querySelector(".intro")?.dataset.phase === "ask"`, 8000, "ask");
  ok(await ev(`!document.querySelector(".intro-iris") && !!document.querySelector(".intro-ask img") && document.querySelector(".intro-v").paused`), "giảm chuyển động: không nở vòng tròn, không tự phát, hỏi Xem phim / Vào Synchro");
  ok(await ev(`document.querySelector(".intro-v").currentSrc.endsWith("synchro-intro-720.mp4")`), "màn hẹp dùng bản 720p", await ev(`document.querySelector(".intro-v").currentSrc`));
  await shot("7-reduced-ask");
  await click(`document.querySelector(".intro-btn.pri")`, "watch");
  await until(`document.querySelector(".intro")?.dataset.phase === "play"`, 20000, "reduced play");
  ok(await ev(`!document.querySelector(".auth-root")`), "bấm Xem phim: phim phát, màn đăng nhập đã gỡ");
  await sleep(800);
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(150);
  ok(await ev(`document.querySelector(".intro")?.dataset.phase === "out" && !document.querySelector(".intro-split")`), "Esc: mờ dần ra, không tách đôi");
  await until(`!document.querySelector(".intro")`, 3000, "reduced gone");
  ok(await ev(`!!document.querySelector(".greeting") || !!document.querySelector(".app")`), "giảm chuyển động: vào app");
  await P("Emulation.setEmulatedMedia", { features: [] });
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
// Xoá các tài khoản thử.
for (const m of made) {
  await P("Network.clearBrowserCookies").catch(() => {});
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: m.email, password: m.password }) });
  const c = (r.headers.getSetCookie?.() ?? []).find((x) => x.startsWith("synchro_session="))?.split(";")[0];
  if (c) await fetch(B + "/api/auth/account", { method: "DELETE", headers: { "content-type": "application/json", origin: B, cookie: c }, body: JSON.stringify({ password: m.password }) });
}
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
