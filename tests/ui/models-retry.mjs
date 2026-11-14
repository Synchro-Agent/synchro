// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/models-retry.mjs
// Bộ chọn model không trống khi lần hỏi danh sách model đầu tiên lỗi. Từng sót (synchro.net.nz, ngay sau deploy: máy chủ khởi động lại,
// nginx nạp lại cấu hình): /api/models lỗi một lần, models.ts bỏ qua và không hỏi lại, bộ chọn chỉ còn "Tự động — mọi hãng đã kết nối ()"
// tới khi tải lại trang. Ở đây chặn hai lần hỏi đầu (lỗi kết nối) rồi cho qua: trình duyệt phải tự hỏi lại và menu hiện đủ các hãng.
// A3: HTML của trang chủ mang sẵn danh sách model (gói khởi động); danh sách chỉ thiếu khi máy chủ dựng quá hạn 300ms (ngay sau deploy, CLI
// khởi động chậm: đúng lúc lỗi từng xảy ra), khi đó trình duyệt tự hỏi /api/models. Bộ này bỏ danh sách khỏi HTML để đi đúng đường đó.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const B = "http://localhost:3200";
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-models-retry";
rmSync(PROF, { recursive: true, force: true });

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email, password }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("login failed");
}
const names = ((await fetch(B + "/api/models", { headers: { cookie } }).then((r) => r.json())).providers ?? []).map((p) => p.name);
if (!names.length) throw new Error("máy giả lập không có hãng nào trong /api/models");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };

const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9351", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
try {
  let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9351/json/version").then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0, asked = 0, blocked = 0, allow = false; const waits = new Map();
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
    // Lần hỏi danh sách model trước khi cho qua: lỗi kết nối (như lúc máy chủ đang khởi động lại).
    if (m.method === "Fetch.requestPaused" && m.params.resourceType === "Document") {
      // Gói khởi động không có danh sách model (như khi máy chủ dựng quá hạn): đổi tên khóa models (kể cả các tham chiếu tới nó) trong HTML.
      const id = m.params.requestId;
      void (async () => {
        const r = await send("Fetch.getResponseBody", { requestId: id }, m.sessionId);
        const html = (r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body)
          .replaceAll('\\"models\\":{\\"providers\\":', '\\"_m\\":{\\"providers\\":').replaceAll(":boot:models:", ":boot:_m:");
        const headers = (m.params.responseHeaders ?? []).filter((x) => !/^(content-length|content-encoding)$/i.test(x.name));
        await send("Fetch.fulfillRequest", { requestId: id, responseCode: m.params.responseStatusCode ?? 200, responseHeaders: headers, body: Buffer.from(html).toString("base64") }, m.sessionId);
      })().catch(() => send("Fetch.continueRequest", { requestId: id }, m.sessionId).catch(() => {}));
      return;
    }
    if (m.method === "Fetch.requestPaused") {
      asked++;
      if (!allow) { blocked++; send("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "ConnectionRefused" }, m.sessionId).catch(() => {}); }
      else send("Fetch.continueRequest", { requestId: m.params.requestId }, m.sessionId).catch(() => {});
    }
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable");
  await P("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await P("Fetch.enable", { patterns: [{ urlPattern: "*/api/models*", requestStage: "Request" }, { urlPattern: B + "/", resourceType: "Document", requestStage: "Response" }] });
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(250); } return false; };
  const click = async (expr) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("not found: " + expr);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };

  console.log("━━ danh sách model lỗi ở lần hỏi đầu");
  await P("Page.navigate", { url: B + "/" });
  const btn = `[...document.querySelectorAll(".model-btn")].find((b) => b.getBoundingClientRect().width)`;
  if (!(await until(`!!document.querySelector("textarea") && !!${btn}`, 30000))) throw new Error("trang chủ không tải được");
  const menu = `(document.querySelector(".model-menu")?.textContent ?? "").replace(/\\s+/g, " ")`;
  // Mở menu khi danh sách chưa về: báo đang tải, không để "Tự động — mọi hãng đã kết nối ()" và danh sách trống.
  await click(btn);
  await until(`!!document.querySelector(".model-menu")`, 3000);
  const early = await ev(menu);
  say(/Đang tải danh sách model/.test(early) && !/\(\s*\)/.test(early), `menu báo đang tải khi danh sách chưa về (${blocked} lần hỏi bị lỗi): “${early.slice(0, 120)}”`);
  // Máy chủ hết lỗi: trình duyệt tự hỏi lại, menu đang mở hiện đủ các hãng mà không phải tải lại trang.
  allow = true;
  const listed = await until(`(() => { const t = ${menu}; return ${JSON.stringify(names)}.every((n) => t.includes(n)); })()`, 25000);
  const text = await ev(menu);
  say(listed, `trình duyệt tự hỏi lại, menu hiện đủ các hãng (${names.join(", ")}) sau ${asked} lần hỏi: “${text.slice(0, 120)}”`);
  say(!/\(\s*\)/.test(text) && !/Đang tải danh sách model/.test(text), "mô tả Tự động không còn “()” trống, hết dòng đang tải");
} finally {
  chrome.kill();
}
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exitCode = fails ? 1 : 0;
