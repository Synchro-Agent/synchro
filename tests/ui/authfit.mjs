// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/authfit.mjs
// Màn Đăng nhập và Giới thiệu về bạn trên màn thấp: logo cố định ở đầu không đè lên nội dung, cuộn tới cuối thì nút chính nằm trọn trong
// màn hình và bấm được. Từng sót (synchro.net.nz, cửa sổ thấp): nội dung căn giữa trong vùng overflow:hidden lấn lên, chữ "Giới thiệu
// về bạn" đè logo; thấp hơn nữa thì mất cả nút Tiếp tục, không cuộn được.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/authfit/";
rmSync(SCR, { recursive: true, force: true }); mkdirSync(SCR, { recursive: true });
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-authfit";
rmSync(PROF, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Màn Giới thiệu về bạn chỉ hiện với tài khoản chưa có họ tên / ngày sinh (đăng nhập Google lần đầu); đăng ký bằng email buộc điền
// sẵn. Đăng ký một tài khoản thường rồi sửa phản hồi /api/auth/me thành needsProfile: true, như tài khoản Google vừa tạo.
let cookie = "";
{
  // Đăng ký không cấp phiên (blueprint F2.4): đăng nhập bằng mật khẩu vừa đặt.
  const H = { "content-type": "application/json", origin: B }, email = `authfit-${Date.now()}@synchro.test`, password = "authfit-mock-123";
  await fetch(B + "/api/auth/signup", { method: "POST", headers: H, body: JSON.stringify({ email, password, profile: { fullName: "Authfit Tester", birthDate: "2000-01-01" } }) });
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ email, password }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("signup/login failed: " + r.status);
}

// Logo (.auth-head) không chạm phần tử nào có chữ / ô nhập của khung; trả về danh sách phần tử bị đè.
const OVERLAP = `(() => {
  const h = document.querySelector(".auth-head"); if (!h) return ["không thấy logo"];
  const L = h.getBoundingClientRect(), out = [];
  for (const el of document.querySelectorAll(".auth-root fieldset *, .auth-stage *")) {
    if (el.closest(".auth-head")) continue;
    const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim()) || el.matches("input,button");
    if (!own) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (r.left < L.right && r.right > L.left && r.top < L.bottom && r.bottom > L.top) out.push((el.textContent.trim() || el.getAttribute("placeholder") || el.tagName).slice(0, 40));
  }
  return out.slice(0, 4);
})()`;
// Cuộn tới cuối: nút chính (submit) nằm trọn trong màn hình và điểm giữa nút trúng chính nó.
const REACH = `(async () => {
  const sc = document.querySelector(".auth-scroll"); if (sc) sc.scrollTop = sc.scrollHeight;
  await new Promise((r) => setTimeout(r, 300));
  // Bước email chưa có nút gửi (mũi tên chỉ hiện khi email hợp lệ): lấy ô email làm phần cuối phải với tới.
  const b = [...document.querySelectorAll(".auth-root form button[type=submit]")].filter((x) => x.getBoundingClientRect().width).pop() ?? document.querySelector(".auth-root form input[type=email]");
  if (!b) return "không thấy nút chính";
  const r = b.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) return "nút chính ra ngoài màn hình (" + Math.round(r.top) + "–" + Math.round(r.bottom) + " / " + innerHeight + "px)";
  const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return t && (b.contains(t) || t.contains(b) || t.closest("form button, .glass-input")) ? "" : "nút chính bị che bởi " + (t ? t.tagName.toLowerCase() + "." + String(t.className).split(" ")[0] : "?");
})()`;

let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };

const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9352", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
try {
  let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9352/json/version").then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map();
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  ws.addEventListener("message", async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId } = m.params;
    try {
      const { body, base64Encoded } = await send("Fetch.getResponseBody", { requestId }, m.sessionId);
      const j = JSON.parse(base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body);
      if (j.user) j.user.needsProfile = true;
      await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(j)).toString("base64") }, m.sessionId);
    } catch { send("Fetch.continueRequest", { requestId }, m.sessionId).catch(() => {}); }
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable");
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(200); } return false; };

  const SIZES = [{ w: 1440, h: 900, m: false }, { w: 1280, h: 600, m: false }, { w: 1024, h: 520, m: false }, { w: 390, h: 640, m: true }, { w: 390, h: 844, m: true }];
  for (const [screen, ready] of [["dang-nhap", "input[type=email]"], ["gioi-thieu", "input[autocomplete=bday]"]]) {
    console.log(`━━ ${screen === "dang-nhap" ? "Đăng nhập" : "Giới thiệu về bạn"}`);
    await P("Network.clearBrowserCookies");
    if (screen === "gioi-thieu") {
      await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
      await P("Fetch.enable", { patterns: [{ urlPattern: "*/api/auth/me*", requestStage: "Response" }] });
    }
    for (const s of SIZES) {
      await P("Emulation.setDeviceMetricsOverride", { width: s.w, height: s.h, deviceScaleFactor: s.m ? 2 : 1, mobile: s.m });
      await P("Page.navigate", { url: B + "/" });
      if (!(await until(`!!document.querySelector(${JSON.stringify(ready)})`))) { say(false, `${s.w}×${s.h}: không mở được màn`); continue; }
      await sleep(2600); // các dòng hiện dần (BlurFade)
      const hit = await ev(OVERLAP);
      say(!hit.length, `${s.w}×${s.h}: logo không đè nội dung${hit.length ? " — đè: " + hit.join(" | ") : ""}`);
      const { data } = await P("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${SCR}${screen}-${s.w}x${s.h}.png`, Buffer.from(data, "base64"));
      const reach = await ev(REACH);
      say(!reach, `${s.w}×${s.h}: cuộn tới cuối, nút chính nằm trọn trong màn hình${reach ? " — " + reach : ""}`);
    }
  }
} finally {
  chrome.kill();
}
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
console.log("Ảnh chụp: " + SCR);
process.exitCode = fails ? 1 : 0;
