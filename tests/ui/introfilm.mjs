// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/introfilm.mjs
// Phim giới thiệu cho tài khoản mới (ui/introfilm.tsx, chuyển cảnh ui/handoff.ts): đăng ký bằng email → Kiểm tra email → Đăng nhập lần đầu → lời chào → vòng tròn kính quanh logo
// hoá mực rồi nở ra phủ màn hình, logo thu về giữa thành chấm mở đầu của phim → phim phát có tiếng, phụ đề tiếng Việt, chấm của phim thế chỗ
// bản sao → Bỏ qua (tài khoản 1) / hết phim (tài khoản 2) → logo bay về chỗ trong app, nền phim mở ra thành lỗ tròn, trang chủ lắp lại → vào app;
// tải lại không phát lại; đăng xuất rồi đăng nhập lại (tài khoản 1): logo của lời chào bay về cạnh lời chào ở trang chủ, màn đăng nhập mở ra
// thành lỗ tròn. Các tài khoản thử (mật khẩu ngẫu nhiên) tự xoá khi xong.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
// Phim (hai tệp mp4) không nằm trong git (Blueprint H3.9): dev:mock tự lấy về public/intro/ (tools/fetch-intro.mjs). Máy chủ giả lập không có
// thì không có gì để kiểm: bỏ qua, nói rõ lý do và cách lấy, không báo lỗi giả. tools/qa.mjs đọc dòng "BỎ QUA:" và ghi bộ này là bỏ qua.
{
  const miss = [];
  for (const f of ["synchro-intro-720.mp4", "synchro-intro.mp4"]) {
    const r = await fetch(`${B}/intro/${f}`, { headers: { range: "bytes=0-11" } }).catch((e) => ({ ok: false, status: e.message }));
    const head = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    if (!head || head.toString("latin1", 4, 8) !== "ftyp") miss.push(`${f} (${r.status})`);
  }
  if (miss.length) {
    console.log(`BỎ QUA: máy chủ ở ${B} không có phim giới thiệu: ${miss.join(", ")}. Chạy node tools/fetch-intro.mjs trong thư mục của dev:mock rồi bật lại dev:mock.`);
    process.exit(0);
  }
}
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
  // Màn hình không cho biết email đã có tài khoản hay chưa: luôn tới bước đăng nhập, người mới bấm tạo tài khoản.
  await until(`[...document.querySelectorAll("button")].some((b) => /Create an account|Tạo tài khoản/i.test(b.textContent))`, 15000, "password step"); await sleep(500);
  await click(`[...document.querySelectorAll("button")].find((b) => /Create an account|Tạo tài khoản/i.test(b.textContent))`, "create account");
  await until(`!!${field("input[autocomplete=new-password]")}`, 8000, "new password"); await sleep(300);
  await click(field("input[autocomplete=new-password]"), "password"); await type(password); await enter();
  await until(`!!document.querySelector("input[autocomplete=new-password]:not([readonly])") && [...document.querySelectorAll("input[autocomplete=new-password]")].length >= 1 && /confirm/i.test(document.querySelector("form")?.innerHTML ?? "") || document.querySelectorAll("input[autocomplete=new-password]").length === 2`, 15000, "confirm step"); await sleep(900);
  await click(field("input[autocomplete=new-password]", -1), "confirm"); await type(password); await enter();
  await until(`!!${field("input[autocomplete=name]")}`, 15000, "profile step"); await sleep(900);
  // Ô vừa hiện còn đang chạy hiệu ứng: gõ lại tới khi ô nhận chữ.
  for (let i = 0; i < 4 && !(await ev(`${field("input[autocomplete=name]")}?.value`)); i++) { await click(field("input[autocomplete=name]"), "name"); await type("Lâm Thử Phim"); await sleep(300); }
  await click(field("input[autocomplete=bday]"), "dob"); await type("01022000"); await enter();
  // Đăng ký không tự đăng nhập (blueprint F2.4): bước "Kiểm tra email" giống hệt email đã có tài khoản, có nút Đăng nhập; lần đăng nhập đầu
  // của tài khoản vừa tạo mới phát phim.
  await until(`/Check your email|Kiểm tra email/.test(document.body.innerText)`, 20000, "check-email step");
  const signInBtn = `[...document.querySelectorAll("button")].find((b) => /^(Sign in|Đăng nhập)$/.test(b.textContent.trim()))`;
  await until(`!!${signInBtn}`, 8000, "sign-in button"); await sleep(500);
  await click(signInBtn, "sign in");
  await until(`!!${field("input[type=password]")}`, 15000, "password (first login)"); await sleep(500);
  await click(field("input[type=password]"), "password"); await type(password); await enter();
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
  // Vòng tròn bắt đầu nở sau ~0,2 giây (hiện dần trước); máy bận thì trễ hơn chút: dò tới 1,5 giây cho tới khi bán kính tăng.
  const r1 = await irisR(); let r2 = r1;
  for (let i = 0; i < 15 && r2 <= r1; i++) { await sleep(100); r2 = await irisR(); }
  ok(r2 > r1 && r2 > 0 && r2 < Math.hypot(1440, 900), "giữa lúc chuyển: vòng tròn đang nở dần, chưa phủ kín", `${r1} → ${r2}`);
  ok(await ev(`!!document.querySelector(".auth-root")`), "màn lời chào vẫn ở dưới cho tới khi phủ kín");
  const seed = await ev(`(() => { const s = document.querySelector(".intro-seed"), a = document.querySelector(".auth-root .auth-mark"); if (!s) return null; const b = s.getBoundingClientRect();
    return { vis: getComputedStyle(s).visibility, cx: b.left + b.width / 2, cy: b.top + b.height / 2, h: b.height, auth: a ? getComputedStyle(a).visibility : "-" }; })()`);
  ok(seed && seed.vis === "visible" && seed.auth === "hidden", "logo của lời chào không bị cắt: bản sao nằm trên vòng mực, logo thật nhường chỗ", JSON.stringify(seed));
  // Đo bản sao đúng lúc phủ kín (đổi pha), vì ngay sau đó chấm của phim thế chỗ.
  await ev(`(() => { const i = document.querySelector(".intro"); new MutationObserver(() => { if (i.dataset.phase === "iris" || window.__dot) return; const s = document.querySelector(".intro-seed"); if (!s) { window.__dot = { gone: true }; return; }
    const b = s.getBoundingClientRect(), k = Math.min(innerWidth / 1920, innerHeight / 1080);
    window.__dot = { dx: Math.round(b.left + b.width / 2 - innerWidth / 2), dy: Math.round(b.top + b.height / 2 - innerHeight / 2), h: +b.height.toFixed(1), want: +(42 * k).toFixed(1) }; }).observe(i, { attributes: true, attributeFilter: ["data-phase"] }); return 1; })()`);
  await shot("2-iris");
  await until(`["wait","play"].includes(document.querySelector(".intro")?.dataset.phase)`, 4000, "covered");
  ok(await ev(`!document.querySelector(".auth-root")`), "phủ kín rồi mới gỡ màn đăng nhập");
  const dot = await ev(`window.__dot ?? null`);
  ok(dot && Math.abs(dot.dx) <= 1 && Math.abs(dot.dy) <= 1 && Math.abs(dot.h - dot.want) <= 0.6, "phủ kín: logo nằm đúng giữa khung phim, đúng cỡ chấm mở đầu của phim", JSON.stringify(dot));
  await until(`document.querySelector(".intro")?.dataset.phase === "play"`, 20000, "playing");
  await until(`!document.querySelector(".intro-seed")`, 4000, "seed handed off").catch(() => {});
  ok(await ev(`!document.querySelector(".intro-seed") && document.querySelector(".intro-v").currentTime >= 0.3`), "chấm của phim thế chỗ bản sao khi đã đủ cỡ (từ 0,3 s)");
  await sleep(2400);
  const st = await ev(`(() => { const v = document.querySelector(".intro-v"); return { t: v.currentTime, paused: v.paused, muted: v.muted, src: v.currentSrc.split("/").pop(), op: getComputedStyle(document.querySelector(".intro-host")).opacity }; })()`);
  ok(st.t > 1.5 && !st.paused && st.op === "1", "phim đang phát và đã hiện hẳn", JSON.stringify(st));
  ok(!st.muted, "phát có tiếng (người dùng vừa thao tác trên trang)", JSON.stringify(st));
  // B3.5: luôn mở bằng bản 720p; chỉ đổi sang 1080p khi phim vào chế độ toàn màn hình (phim không bắt buộc toàn màn hình).
  ok(st.src === "synchro-intro-720.mp4", "màn rộng vẫn mở bằng bản 720p (1080p chỉ khi toàn màn hình)", st.src);
  const cap = await ev(`document.querySelector(".intro-cap")?.textContent ?? ""`);
  ok(/Claude, ChatGPT, Gemini, Grok và DeepSeek/.test(cap), "phụ đề tiếng Việt theo cảnh", cap);
  ok(await ev(`getComputedStyle(document.querySelector(".intro-btn.skip")).opacity === "1"`), "nút Bỏ qua đã hiện");
  await shot("3-playing");
  // B3.5: nút Toàn màn hình (màn ≥ 1280px) không đè nút tiếng; vào toàn màn hình thì đổi sang bản 1080p, giữ chỗ đang phát.
  const fsb = await ev(`(() => { const a = document.querySelector(".intro-btn.fs")?.getBoundingClientRect(), b = document.querySelector(".intro-btn.snd")?.getBoundingClientRect(); return { can: document.fullscreenEnabled && screen.width >= 1280, has: !!a, apart: !a || !b || a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom }; })()`);
  ok(fsb.has === fsb.can && fsb.apart, "màn lớn có nút Toàn màn hình, không đè nút tiếng", JSON.stringify(fsb));
  if (fsb.has) {
    const t0 = await ev(`document.querySelector(".intro-v").currentTime`);
    await click(`document.querySelector(".intro-btn.fs")`, "fullscreen");
    await sleep(1200);
    const fs1 = await ev(`(() => { const v = document.querySelector(".intro-v"); return { full: !!document.fullscreenElement, src: v.currentSrc.split("/").pop(), t: v.currentTime }; })()`);
    ok(!fs1.full || (fs1.src === "synchro-intro.mp4" && fs1.t >= t0), "toàn màn hình: đổi sang bản 1080p, phát tiếp từ chỗ cũ", JSON.stringify({ ...fs1, t0 }));
    if (fs1.full) { await click(`document.querySelector(".intro-btn.fs")`, "exit fullscreen"); await until(`!document.fullscreenElement`, 3000, "exit fullscreen").catch(() => {}); await sleep(200); }
  }
  await click(`document.querySelector(".intro-btn.skip")`, "skip");
  await sleep(150);
  const out = await ev(`(() => ({ phase: document.querySelector(".intro").dataset.phase, mk: !!document.querySelector(".intro-fly .fly-mk svg"), wd: !!document.querySelector(".intro-fly .fly-wd svg"), host: getComputedStyle(document.querySelector(".intro-host")).opacity }))()`);
  ok(out.phase === "out" && out.mk && out.wd, "Bỏ qua: phim mờ đi, logo của khung cuối hiện lên (biểu tượng + chữ)", JSON.stringify(out));
  // Logo bắt đầu bay sau ~0,65 giây; chờ tới khi đang bay (Chrome ẩn trên máy dev có thể chậm vài trăm ms).
  // Chữ bay sau biểu tượng 70 ms: chờ cả hai cùng đang bay.
  await until(`(() => { const m = document.querySelector(".fly-mk"), w = document.querySelector(".fly-wd"); return !!m && !!w && new DOMMatrix(getComputedStyle(m).transform).a < 0.9 && new DOMMatrix(getComputedStyle(w).transform).a < 0.9; })()`, 3000, "flight").catch(() => {});
  const mid = await ev(`(() => { const m = document.querySelector(".fly-mk"), w = document.querySelector(".fly-wd"), st = getComputedStyle(document.querySelector(".intro-stage")); return { m: m && new DOMMatrix(getComputedStyle(m).transform).a, w: w && new DOMMatrix(getComputedStyle(w).transform).a, reveal: document.querySelector(".app")?.classList.contains("app-reveal"), hidden: getComputedStyle(document.querySelector(".rm-logo svg")).opacity === "0", hole: /radial-gradient/.test(st.maskImage || st.webkitMaskImage || ""), anims: document.querySelector(".app").getAnimations({ subtree: true }).filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).length }; })()`);
  ok(mid.m < 0.9 && mid.w < 0.9, "logo đang bay về chỗ (thu nhỏ dần)", JSON.stringify(mid));
  ok(mid.reveal && mid.hidden && mid.hole && mid.anims > 3, "nền phim mở ra thành lỗ tròn, trang chủ đang lắp lại, logo thật của app chờ logo bay tới", JSON.stringify(mid));
  ok(await ev(`[...document.querySelectorAll(".intro-cap, .intro-ui")].every((e) => +getComputedStyle(e).opacity < 0.05)`), "phụ đề và nút đã mờ hết khi logo bay");
  await shot("4-flight");
  await until(`!document.querySelector(".intro")`, 4000, "intro gone");
  await sleep(300);
  ok(await ev(`!document.querySelector(".app.app-reveal") && !!document.querySelector(".greeting") && getComputedStyle(document.querySelector(".rm-logo svg")).opacity === "1"`), "xong: vào trang chủ, logo thật của app hiện lại, lớp chuyển cảnh đã gỡ");
  await shot("5-home");
  await P("Page.reload"); await sleep(3500);
  ok(await ev(`!document.querySelector(".intro") && !!document.querySelector(".greeting")`), "tải lại trang: không phát lại phim");

  // ---- Tài khoản 1: đăng nhập lại — logo bay về đầu thanh điều hướng, màn đăng nhập mở ra thành lỗ tròn, không có phim
  await P("Network.clearBrowserCookies");
  await P("Page.navigate", { url: B + "/" });
  await until(`!!${field("input[type=email]")}`, 30000, "sign-in form (login)"); await sleep(600);
  await click(field("input[type=email]"), "email"); await type(made[0].email); await enter();
  await until(`!!${field("input[type=password]")}`, 15000, "password (login)"); await sleep(500);
  await click(field("input[type=password]"), "password"); await type(made[0].password); await enter();
  await until(`!!document.querySelector(".auth-welcome")`, 20000, "welcome back");
  await until(`!!document.querySelector(".auth-fly span") && getComputedStyle(document.querySelector(".auth-fly span")).visibility === "visible"`, 6000, "login flight");
  await sleep(450);
  const lf = await ev(`(() => { const c = document.querySelector(".auth-fly span"), r = getComputedStyle(document.querySelector(".auth-root")); return { k: new DOMMatrix(getComputedStyle(c).transform).a, hole: /radial-gradient/.test(r.maskImage || r.webkitMaskImage || ""), reveal: document.querySelector(".app")?.classList.contains("reveal-login"), intro: !!document.querySelector(".intro"), mark: getComputedStyle(document.querySelector(".auth-root .auth-mark")).visibility }; })()`);
  ok(lf.k < 0.95 && lf.hole && lf.reveal && !lf.intro && lf.mark === "hidden", "đăng nhập lại: logo bay về đầu thanh điều hướng, màn đăng nhập mở ra thành lỗ tròn, không phát phim", JSON.stringify(lf));
  await shot("5b-login-flight");
  await until(`!document.querySelector(".auth-root")`, 5000, "login done");
  const land = await ev(`(() => { const g = document.querySelector(".rm-logo svg"); return { op: getComputedStyle(g).opacity, reveal: !!document.querySelector(".app.app-reveal"), fly: !!document.querySelector(".auth-fly") }; })()`);
  ok(land.op === "1" && !land.reveal && !land.fly, "đăng nhập lại xong: logo thật ở thanh điều hướng hiện lại, lớp chuyển cảnh đã gỡ", JSON.stringify(land));

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
  ok(await ev(`!document.querySelector(".intro-btn.fs")`), "điện thoại: không có nút Toàn màn hình cạnh phụ đề");
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
