// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/connector-login.mjs
// Đăng nhập connector trong cửa sổ bật lên quay về được dù trang Synchro gửi COOP same-origin: cửa sổ đi qua trang của hãng thì mất window.opener, nên trang chính
// từng vẫn hiện "Cần kết nối" tới khi tải lại, còn cửa sổ thì nạp cả ứng dụng. Đi đúng đường thật trong trình duyệt thật với máy chủ MCP giả lập (trang đồng ý ở 127.0.0.1 khác nguồn).
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const B = "http://localhost:3200", MCP = "http://127.0.0.1:4011";
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-conn-login";
rmSync(PROF, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };

let cookie = "";
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("login failed");
}
const api = (method, p, body) => fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json());
const wipe = async () => { for (const x of (await api("GET", "/api/connectors")).connectors ?? []) await api("DELETE", `/api/connectors/${x.id}`); };
await wipe();

const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9353", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
try {
  let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9353/json/version").then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map(), popups = new Map();
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
    if (m.method === "Target.targetCreated" && m.params.targetInfo.type === "page") popups.set(m.params.targetInfo.targetId, m.params.targetInfo);
    if (m.method === "Target.targetInfoChanged" && popups.has(m.params.targetInfo.targetId)) popups.set(m.params.targetInfo.targetId, m.params.targetInfo);
    if (m.method === "Target.targetDestroyed") popups.delete(m.params.targetId);
  });
  await send("Target.setDiscoverTargets", { discover: true });
  const open = async (url, init) => {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
    const P = (method, params) => send(method, params, S);
    await P("Runtime.enable"); await P("Page.enable");
    await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
    if (init) await P("Page.addScriptToEvaluateOnNewDocument", { source: init });
    await P("Page.navigate", { url });
    const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exceptionDetails?.text ?? r.exceptionDetails.text); return r.result.value; };
    const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(200); } return false; };
    const click = async (expr) => {
      const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
      if (!r) throw new Error("not found: " + expr);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
    };
    const type = async (sel, text) => { await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); await P("Input.insertText", { text }); };
    return { P, ev, until, click, type, targetId };
  };
  // Giao diện mặc định tiếng Việt nên tìm nút theo vị trí, không theo chữ.
  const ADD = `document.querySelector(".cn-bar .btn:not(.dark)")`, BROWSE = `document.querySelector(".cn-bar .btn.dark")`;
  const byText = (sel, t) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.includes(${JSON.stringify(t)}) && b.getBoundingClientRect().width)`;
  // Cửa sổ đăng nhập vừa mở (đích không phải trang chính).
  const waitPopup = async (known, ms = 15000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      for (const [id, info] of popups) if (!known.has(id) && /\/authorize/.test(info.url)) return id;
      await sleep(100);
    }
    return null;
  };
  const inPopup = async (id, expr) => {
    const { sessionId } = await send("Target.attachToTarget", { targetId: id, flatten: true });
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    return r.result?.value;
  };
  const addCustom = async (page, name, url) => {
    await page.click(ADD);
    await page.until(`!!document.querySelector("#cn-name")`);
    await page.type("#cn-name", name);
    await page.type("#cn-url", url);
    await page.click(`document.querySelector(".cn-custom button[type=submit]")`);
  };
  // Trình duyệt chặn cửa sổ (bấm đã quá lâu): có nút bấm lại.
  const openedPopup = async (page, known) => {
    let id = await waitPopup(known, 6000);
    if (!id && await page.ev(`!!document.querySelector(".cn-pop button")`)) { await page.click(`document.querySelector(".cn-pop button")`); id = await waitPopup(known, 6000); }
    return id;
  };

  console.log("━━ cho phép: trang chính tự cập nhật, cửa sổ tự đóng");
  const page = await open(`${B}/?settings=Connectors`);
  if (!(await page.until(`!!${ADD}`, 30000))) throw new Error("không mở được Connectors");
  await sleep(300);
  const known = new Set(popups.keys());
  await addCustom(page, "Mock Notes", `${MCP}/mcp`);
  const pop = await openedPopup(page, known);
  say(!!pop, "bấm Thêm: mở cửa sổ đăng nhập của hãng");
  if (!pop) throw new Error("không thấy cửa sổ đăng nhập");
  // Đúng tình huống COOP: cửa sổ đã bị tách khỏi trang mở nó.
  say((await inPopup(pop, "window.opener === null")) === true, "cửa sổ đăng nhập không còn window.opener (COOP đã tách)");
  await inPopup(pop, `new Promise((r) => { const t = setInterval(() => { const a = document.querySelector("#allow"); if (a) { clearInterval(t); r(true); a.click(); } }, 100); })`);
  const updated = await page.until(`!!document.querySelector(".cn-sub.ok") && ${byText(".cn-card", "Mock Notes")}?.textContent.match(/3 (tools|công cụ)/)`, 12000);
  say(updated, "trang chính hiện đã kết nối, không cần tải lại");
  await sleep(1500);
  say(!popups.has(pop), "cửa sổ đăng nhập tự đóng");
  await wipe();

  console.log("━━ từ chối: lý do nằm ngay trên thẻ");
  await page.P("Page.navigate", { url: `${B}/?settings=Connectors` });
  await page.until(`!!${ADD}`, 30000);
  await sleep(300);
  let k2 = new Set(popups.keys());
  await addCustom(page, "Mock Notes", `${MCP}/mcp`);
  const pop2 = await openedPopup(page, k2);
  if (pop2) await inPopup(pop2, `new Promise((r) => { const t = setInterval(() => { const a = document.querySelector("#deny"); if (a) { clearInterval(t); r(true); a.click(); } }, 100); })`);
  say(await page.until(`${byText(".cn-card", "Mock Notes")}?.querySelector(".api-err")?.textContent.length > 5`, 12000), "từ chối cấp quyền: thẻ hiện lý do, có nút kết nối");
  await wipe();

  console.log("━━ trang chính không nhận được tin (không có BroadcastChannel): tự hỏi lại máy chủ");
  const page2 = await open(`${B}/?settings=Connectors`, "delete window.BroadcastChannel;");
  await page2.until(`!!${ADD}`, 30000);
  await sleep(300);
  k2 = new Set(popups.keys());
  await addCustom(page2, "Mock Notes", `${MCP}/mcp`);
  const pop3 = await openedPopup(page2, k2);
  if (pop3) await inPopup(pop3, `new Promise((r) => { const t = setInterval(() => { const a = document.querySelector("#allow"); if (a) { clearInterval(t); r(true); a.click(); } }, 100); })`);
  say(await page2.until(`${byText(".cn-card", "Mock Notes")}?.textContent.match(/3 (tools|công cụ)/)`, 15000), "trang chính vẫn tự cập nhật nhờ hỏi lại máy chủ");
  await wipe();

  console.log("━━ hãng chưa duyệt Synchro: không mở cửa sổ");
  await page.P("Page.navigate", { url: `${B}/?settings=Connectors` });
  await page.until(`!!${BROWSE}`, 30000);
  const before = new Set(popups.keys());
  await page.click(BROWSE);
  await page.until(`!!document.querySelector(".cn-browse")`);
  const figma = byText(".cn-item", "Figma");
  say(await page.until(`${figma}?.textContent.includes("Needs vendor approval") || ${figma}?.textContent.includes("Cần nhà cung cấp duyệt")`), "Figma hiện cần nhà cung cấp duyệt, không phải nút Kết nối");
  await page.click(`${figma}.querySelector(".cn-vendor-tag")`);
  say(await page.until(`${figma}?.querySelector(".cn-vendor")?.textContent.length > 40`), "bấm vào: thấy lý do và cách có thể thử");
  await sleep(500);
  say([...popups.keys()].every((id) => before.has(id)), "không có cửa sổ nào mở ra");
  await page.click(`${figma}.querySelector(".cn-vendor .cn-link")`);
  say(await page.until(`!!document.querySelector("#cn-token")`), "Dùng token thay thế: mở ô nhập token");
  const leftover = (await api("GET", "/api/connectors")).connectors ?? [];
  say(leftover.length === 0, "xem lý do không tạo hàng connector nào");
} finally {
  await wipe().catch(() => {});
  chrome.kill();
}
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exitCode = fails ? 1 : 0;
