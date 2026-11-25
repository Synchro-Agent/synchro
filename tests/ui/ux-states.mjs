// Kiểm thử giao diện bằng Chrome ẩn trên npm run dev:mock. Chạy tay: node tests/ui/ux-states.mjs
// Trạng thái lỗi và bàn phím: bấm Mới và bấm chỗ trống là gõ được, Esc và mũi tên trong menu, thẻ lỗi không gửi lại cho model, sửa và sao chép tin đã gửi,
// ô soạn tin không bị ép cạnh khung xem, tab Mức dùng không sập, phiên hết hạn giữ phần đang gõ, đổi ngôn ngữ ở màn hình đăng nhập, trang 404.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";

const B = "http://localhost:3200";
const SCR = os.tmpdir() + "/synchro-ui/ux/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof";
rmSync(PROF, { recursive: true, force: true });
const results = [];
const ok = (c, n, x = "") => { results.push([!!c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };

const email = "ux-states@synchro.test", password = "Ux-states-pass-1";
let cookie = "";
const api = async (p, body) => {
  const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return r.status;
};
await api("/api/auth/signup", { email, password, profile: { fullName: "Ux Tester", birthDate: "2000-01-01" } });
await api("/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
// Quyền mặc định của thành viên do quản trị viên đặt: cấp đủ quyền cho tài khoản test (như tests/ui/palette.mjs).
{ const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  const ac = (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("synchro_session="))?.split(";")[0] ?? "";
  const u = (await (await fetch(B + "/api/admin", { headers: { cookie: ac } })).json()).users.find((x) => x.email === email);
  if (u) await fetch(B + `/api/admin/users/${u.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: B, cookie: ac }, body: JSON.stringify({ action: "set_perms", perms: { models: ["*"], features: Object.fromEntries(Object.keys(u.perms.features).map((k) => [k, true])) } }) }); }
const uid = (await (await fetch(B + "/api/auth/me", { headers: { cookie } })).json()).user.id;

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", "--remote-debugging-port=9347", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9347/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
const handlers = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [f, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : f(m.result); } else for (const h of handlers) h(m); });
const send = (method, params = {}, sessionId) => new Promise((f, no) => { const id = ++seq; waits.set(id, [f, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });

const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval"); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
const clickAt = async (x, y) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const click = async (expr, what = expr) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  await clickAt(r[0], r[1]);
};
const KEY = { Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Tab: 9, Home: 36, End: 35 };
const key = async (k) => { for (const type of ["rawKeyDown", "keyUp"]) await P("Input.dispatchKeyEvent", { type, key: k, code: k, windowsVirtualKeyCode: KEY[k], nativeVirtualKeyCode: KEY[k], ...(k === "Enter" && type === "rawKeyDown" ? { text: "\r" } : {}) }); await sleep(120); };
const type = async (t) => { await P("Input.insertText", { text: t }); await sleep(80); };
const go = async (url) => { await P("Page.navigate", { url }); await sleep(400); };
const focusIs = (sel) => ev(`!!document.activeElement?.matches(${JSON.stringify(sel)})`);
const COMPOSER = ".composer textarea";

try {
  // Trang chủ (model giả lập đã có, xem tools/dev-mock.mjs).
  await go(B);
  await until(`!!document.querySelector(${JSON.stringify(COMPOSER)})`);
  await sleep(600);

  console.log("Ô soạn tin nhận tiêu điểm");
  await click(`document.querySelector("[data-nav=autopilot]")`); await sleep(300);
  await click(`document.querySelector(".rail-new")`); await sleep(400);
  ok(await focusIs(COMPOSER), "bấm Mới từ mục khác: con trỏ ở ô nhập");
  await ev(`document.activeElement.blur()`);
  await click(`document.querySelector(".rail-new")`); await sleep(300);
  ok(await focusIs(COMPOSER), "bấm Mới khi đang ở trang chủ: con trỏ ở ô nhập");
  await ev(`document.activeElement.blur()`);
  // Chỗ trống của hàng nút trong khung soạn tin.
  const empty = await ev(`(() => { const r = document.querySelector(".comp-row").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await clickAt(empty[0], empty[1]); await sleep(150);
  ok(await focusIs(COMPOSER), "bấm chỗ trống trong khung soạn tin: con trỏ ở ô nhập");
  await type("chữ gõ sau khi bấm");
  ok((await ev(`document.querySelector(${JSON.stringify(COMPOSER)}).value`)) === "chữ gõ sau khi bấm", "chữ gõ vào đúng ô nhập");
  await ev(`(() => { const t = document.querySelector(${JSON.stringify(COMPOSER)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, ""); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(100);

  console.log("Menu và bàn phím");
  const plus = `document.querySelector('.comp-row [aria-label="Thêm"]')`;
  await click(plus); await until(`!!document.querySelector(".plus-menu")`, 3000);
  ok((await ev(`document.querySelector(".plus-menu").getAttribute("role")`)) === "menu", "menu có vai trò menu");
  ok((await ev(`${plus}.getAttribute("aria-expanded")`)) === "true", "nút mở báo đang mở");
  await key("ArrowDown");
  ok(await ev(`!!document.activeElement.closest(".plus-menu")`), "mũi tên xuống vào menu");
  const a0 = await ev(`document.activeElement.textContent`);
  await key("ArrowDown");
  ok((await ev(`document.activeElement.textContent`)) !== a0, "mũi tên xuống sang mục kế");
  await key("End"); await key("Home");
  ok((await ev(`document.activeElement.textContent`)) === a0, "Home về mục đầu");
  await key("Escape"); await sleep(250);
  ok(await ev(`!document.querySelector(".plus-menu:not(.out)")`), "Esc đóng menu +");
  ok(await ev(`document.activeElement === ${plus}`), "Esc trả tiêu điểm về nút mở");

  await click(`document.querySelector(".model-btn")`); await until(`!!document.querySelector(".model-menu")`, 3000);
  await key("Escape"); await sleep(250);
  ok(await ev(`!document.querySelector(".model-menu:not(.out)")`), "Esc đóng menu model");

  await click(`document.querySelector(".rail-user .user")`, "nút tài khoản"); await until(`!!document.querySelector(".usermenu")`, 3000);
  await click(`document.querySelector(".usermenu .menu-item")`, "Cài đặt");
  await until(`!!document.querySelector(".settings")`, 10000, "mở Cài đặt");
  await sleep(400);
  ok((await ev(`document.querySelector(".settings").getAttribute("role")`)) === "dialog" && (await ev(`document.querySelector(".settings").getAttribute("aria-modal")`)) === "true", "hộp thoại có vai trò dialog");
  const sel = `[...document.querySelectorAll(".settings .row")].find((r) => /Chat font|Phông chữ/i.test(r.textContent))?.querySelector(".dd")`;
  // Thân Cài đặt nạp chậm (khung chờ trước, B3.4 tách thêm settings.css): chờ hàng Phông chữ thật thay vì chỉ 400ms.
  await until(`!!${sel}`, 15000, "hàng Phông chữ (Cài đặt nạp chậm)");
  await click(sel, "dropdown phông chữ"); await until(`!!document.querySelector(".dd-pop")`, 3000);
  await key("Escape"); await sleep(250);
  ok(await ev(`!!document.querySelector(".settings") && !document.querySelector(".dd-pop")`), "Esc đóng dropdown, Cài đặt vẫn mở");
  ok(await ev(`[...document.querySelectorAll(".settings [role=switch]")].every((b) => b.getAttribute("aria-label"))`), "mọi công tắc đang hiện có tên");
  await key("Tab"); await key("Tab");
  ok(await ev(`!!document.activeElement.closest(".overlay")`), "Tab không ra khỏi hộp thoại");

  // Tab Mức dùng khi máy chủ trả lỗi JSON (phiên hết hạn…): từng làm sập cả app.
  await ev(`(() => { const f = window.fetch; window.__usageFail = true; window.fetch = (u, i) => String(u).includes("/api/usage/details") && window.__usageFail ? Promise.resolve(new Response(JSON.stringify({ error: "x" }), { status: 500, headers: { "content-type": "application/json" } })) : f(u, i); })()`);
  await click(`[...document.querySelectorAll(".s-item")].find((b) => /Usage|Mức dùng/.test(b.textContent))`, "tab Mức dùng");
  await until(`!!document.querySelector(".us-page .err-box")`, 10000, "báo lỗi ở tab Mức dùng");
  ok(await ev(`!!document.querySelector(".settings")`), "tab Mức dùng báo lỗi, app không sập");
  await ev(`window.__usageFail = false`);
  await click(`document.querySelector(".us-page .err-box .btn")`, "Thử lại");
  await until(`!document.querySelector(".us-page .err-box")`, 10000, "thử lại được");
  ok(true, "Thử lại tải được số liệu");
  await key("Escape");
  ok(await until(`!document.querySelector(".settings")`, 3000, "Esc đóng Cài đặt").then(() => true, () => false), "Esc đóng Cài đặt");

  console.log("Thẻ lỗi của lượt chat");
  await ev(`(() => { const f = window.fetch; window.__llm = []; window.fetch = (u, i) => { if (String(u).includes("/api/llm") && i?.body) window.__llm.push(i.body); return f(u, i); }; })()`);
  await click(`document.querySelector(${JSON.stringify(COMPOSER)})`);
  await type("Câu thử lỗi #500"); await key("Enter");
  await until(`!!document.querySelector(".msg-err")`, 30000, "hiện thẻ lỗi");
  ok(await ev(`!document.querySelector(".actions.in")`), "câu lỗi không có nút thích, đọc to");
  ok(await ev(`[...document.querySelectorAll(".msg-err button")].some((b) => /Thử lại|Try again/.test(b.textContent))`), "thẻ lỗi có nút Thử lại ghi rõ chữ");
  await click(`document.querySelector(".dock ${COMPOSER}")`);
  const errText = await ev(`document.querySelector(".msg-err p").textContent`);
  await type("Câu tiếp theo sau lỗi"); await key("Enter");
  await until(`!!document.querySelector(".actions.in")`, 30000, "câu sau trả lời được");
  const last = await ev(`window.__llm.at(-1)`);
  ok(last && !last.includes(errText) && last.includes("Câu thử lỗi"), "lượt sau không gửi câu lỗi cho model", last?.slice(0, 300));

  console.log("Sửa và sao chép tin đã gửi");
  const uCount = await ev(`document.querySelectorAll(".user-wrap").length`);
  await ev(`document.querySelectorAll(".user-wrap")[0].scrollIntoView()`);
  ok(await ev(`!!document.querySelector('.u-actions [aria-label="Sao chép"], .u-actions [aria-label="Copy"]')`), "tin đã gửi có nút Sao chép");
  await ev(`document.querySelectorAll('.user-wrap')[0].querySelector('.u-actions [aria-label="Sửa tin nhắn"], .u-actions [aria-label="Edit message"]').click()`);
  await until(`!!document.querySelector(".u-edit textarea")`, 3000);
  ok(await focusIs(".u-edit textarea"), "ô sửa nhận tiêu điểm");
  await key("Escape"); await sleep(150);
  ok(await ev(`!document.querySelector(".u-edit")`), "Esc hủy sửa");
  await ev(`document.querySelectorAll('.user-wrap')[0].querySelector('.u-actions [aria-label="Sửa tin nhắn"], .u-actions [aria-label="Edit message"]').click()`);
  await until(`!!document.querySelector(".u-edit textarea")`, 3000);
  await ev(`document.activeElement.select()`); await type("Câu đã sửa"); await key("Enter");
  await until(`document.querySelectorAll(".user-wrap").length === 1 && !!document.querySelector(".actions.in")`, 30000, "gửi lại tin đã sửa");
  ok(uCount > 1 && /đã sửa/.test(await ev(`document.querySelector(".user-msg").textContent`)), "các tin sau bị thay, tin đầu mang nội dung mới");

  console.log("404");
  await go(B + "/khong-co-trang-nay");
  await until(`!!document.querySelector(".err-page")`, 15000);
  ok(await ev(`!!document.querySelector('.err-page a[href="/"]')`), "trang 404 có đường về");

  console.log("Ô soạn tin cạnh khung xem");
  const art = '<artifact identifier="t1" type="text/html" title="Thử">\\n<!doctype html><h1>Thử</h1>\\n</artifact>';
  await go(B);
  await until(`!!document.querySelector(${JSON.stringify(COMPOSER)})`);
  // Chờ lần lưu định kỳ của trang mới mở xong, không thì nó ghi đè đoạn chat dựng sẵn.
  await sleep(1500);
  await ev(`localStorage.setItem("u:${uid}:chats", JSON.stringify([{ id: ${Date.now()}, title: "Có artifact", msgs: [{ role: "user", text: "Làm trang", time: ${Date.now()} }, { role: "ai", text: ${JSON.stringify(art)}.replace(/\\\\n/g, "\\n"), done: true, time: ${Date.now() + 1} }] }]))`);
  // Chrome ẩn coi trang là "hidden" và không chạy ResizeObserver (khung soạn đo bề rộng bằng nó): đưa trang ra trước như người dùng đang xem.
  await P("Page.bringToFront");
  for (const [w, h] of [[1280, 800], [1100, 760], [1024, 720]]) {
    await P("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await go(B);
    // Đoạn chat theo tài khoản: danh sách còn các đoạn chat khác từ máy chủ.
    const row = `[...document.querySelectorAll(".chat-item")].find((e) => e.textContent.includes("Có artifact"))`;
    await until(`!!${row}`, 15000, "đoạn chat có artifact");
    await click(row);
    await until(`!!document.querySelector(".art-card")`, 8000, "thẻ artifact");
    await click(`document.querySelector(".art-card")`);
    await until(`!!document.querySelector(".art-panel")`, 8000, "khung xem");
    await sleep(500);
    const tw = await ev(`document.querySelector(".dock ${COMPOSER}").getBoundingClientRect().width`);
    ok(tw >= 200, `${w}px: ô nhập rộng ${Math.round(tw)}px khi mở khung xem`, tw);
  }
  await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log("Tài khoản chưa có model");
  const { identifier } = await P("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.removeItem("u:${uid}:model"); { const f = window.fetch; window.fetch = (u, i) => String(u).includes("/api/models") ? Promise.resolve(new Response(JSON.stringify({ providers: [], default: null, allowed: [], effort: {} }), { status: 200, headers: { "content-type": "application/json" } })) : f(u, i); }` });
  // A3: HTML của trang chủ mang sẵn danh sách model (gói khởi động), không hỏi /api/models lúc mở. Làm rỗng danh sách hãng ngay trong HTML
  // (mảng cũ dời sang khóa _x, kể cả các tham chiếu tới nó) để trang đi đúng đường "chưa có model" như khi /api/models trả rỗng.
  const noModels = (m) => {
    if (m.method !== "Fetch.requestPaused" || m.sessionId !== S) return;
    const id = m.params.requestId;
    void (async () => {
      const r = await P("Fetch.getResponseBody", { requestId: id });
      const html = (r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body)
        .replaceAll('\\"models\\":{\\"providers\\":[', '\\"models\\":{\\"providers\\":[],\\"_x\\":[').replaceAll(":boot:models:providers:", ":boot:models:_x:");
      const headers = (m.params.responseHeaders ?? []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name));
      await P("Fetch.fulfillRequest", { requestId: id, responseCode: m.params.responseStatusCode ?? 200, responseHeaders: headers, body: Buffer.from(html).toString("base64") });
    })().catch(() => P("Fetch.continueRequest", { requestId: id }).catch(() => {}));
  };
  handlers.push(noModels);
  await P("Fetch.enable", { patterns: [{ urlPattern: B + "/", resourceType: "Document", requestStage: "Response" }] });
  await go(B);
  await click(`document.querySelector(".rail-new")`).catch(() => {});
  await until(`!!document.querySelector(".ob-card")`, 15000, "thẻ hướng dẫn kết nối gói");
  ok(await ev(`document.querySelectorAll(".ob-card .btn").length === 4`), "có nút cho từng gói");
  await click(`document.querySelector(${JSON.stringify(COMPOSER)})`);
  await type("tin đầu tiên"); await key("Enter");
  await until(`!!document.querySelector(".settings")`, 15000, "gửi khi chưa có model: mở Providers");
  ok((await ev(`document.querySelector(${JSON.stringify(COMPOSER)}).value`)) === "tin đầu tiên", "tin đang gõ vẫn còn");
  await key("Escape"); await sleep(300);
  await P("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  await P("Fetch.disable"); handlers.splice(handlers.indexOf(noModels), 1);

  console.log("Ô tìm của Cài đặt ra đúng dòng");
  await go(B);
  await until(`!!document.querySelector(${JSON.stringify(COMPOSER)})`);
  await click(`document.querySelector(".rail .user")`); await sleep(400);
  await click(`[...document.querySelectorAll(".menu-item")].find((e) => /^(Cài đặt|Settings)/.test(e.textContent.trim()))`); await until(`!!document.querySelector(".modal.settings")`, 10000, "mở Cài đặt");
  await click(`document.querySelector(".modal.settings .s-search input")`); await type("cookie");
  await until(`!!document.querySelector(".modal.settings .s-found")`, 5000, "kết quả tìm");
  await click(`document.querySelector(".modal.settings .s-found")`);
  await until(`!!document.querySelector(".modal.settings .s-hit")`, 8000, "dòng được làm nổi");
  ok(await ev(`/cookie/i.test(document.querySelector(".modal.settings .s-hit").textContent)`), "bấm kết quả: mở đúng tab, cuộn tới đúng dòng");
  await click(`document.querySelector(".modal.settings .close")`); await sleep(300);

  console.log("Autopilot: tab nào lỗi cũng có nút thử lại, không quay mãi");
  await ev(`(() => { window.__f = window.fetch; window.fetch = (u, i) => (/\\/api\\/(tasks|autopilot)/.test(String(u)) ? Promise.reject(new TypeError("Failed to fetch")) : window.__f(u, i)); })()`);
  await click(`document.querySelector("[data-nav=autopilot]")`);
  await until(`!!document.querySelector(".err-box")`, 8000, "hộp lỗi tab Kết quả");
  ok(!/Failed to fetch/.test(await ev(`document.querySelector(".err-box").textContent`)), "không lộ Failed to fetch", await ev(`document.querySelector(".err-box").textContent`));
  await ev(`window.fetch = window.__f`);
  await click(`document.querySelector(".err-box .btn")`);
  await until(`!document.querySelector(".err-box")`, 8000, "thử lại được");
  ok(true, "bấm Thử lại: tải lại được");

  console.log("Phiên hết hạn");
  await go(B);
  await until(`!!document.querySelector(${JSON.stringify(COMPOSER)})`);
  await click(`document.querySelector(".rail-new")`); await sleep(300);
  await type("nháp đang gõ dở");
  await P("Network.deleteCookies", { name: "synchro_session", url: B });
  await ev(`fetch("/api/usage/details?tz=0").then((r) => r.status)`);
  await until(`!!document.querySelector(".auth-notice")`, 15000, "màn hình đăng nhập phủ lên");
  ok(String(await ev(`document.querySelector(${JSON.stringify(COMPOSER)})?.value`)).includes("nháp đang gõ dở"), "phần đang gõ vẫn còn dưới màn hình đăng nhập");

  console.log("Đổi ngôn ngữ ở màn hình đăng nhập");
  await click(`document.querySelector('.auth-lang button[lang="en"]')`); await sleep(400);
  ok((await ev(`document.documentElement.lang`)) === "en", "bấm English: giao diện tiếng Anh");
  ok(await ev(`/expired/i.test(document.querySelector(".auth-notice").textContent)`), "câu báo phiên hết hạn đã dịch");
  await click(`document.querySelector('.auth-lang button[lang="vi"]')`); await sleep(300);
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await P("Page.captureScreenshot", {}).catch(() => null); }

const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
