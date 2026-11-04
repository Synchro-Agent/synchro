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
const say = (ok, msg, x = "") => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`, ok ? "" : String(x ?? "")); };

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
  const ALLOW = `new Promise((r) => { const t = setInterval(() => { const a = document.querySelector("#allow"); if (a) { clearInterval(t); r(true); a.click(); } }, 100); })`;
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

  // ---- các ca dưới đều đi theo đúng đường người dùng, nhưng tránh mọi hãng thật: danh mục giả qua fetch, còn lại dùng máy chủ MCP giả lập ----
  console.log("━━ trình duyệt chặn cửa sổ khi đang mở danh mục: lời nhắc nằm ngay trong danh mục, bấm là mở lại đúng địa chỉ");
  const LOGIN = `${MCP}/authorize?state=thu`;
  const FAKE = { id: "conn-gia", name: "Notion", url: "https://mcp.notion.com/mcp", host: "mcp.notion.com", dir: "notion", enabled: true, status: "needs_auth", error: null, serverName: null, auth: "none", tools: [], checkedAt: null, settings: { chat: true, projects: true, newTools: "auto", destructive: true, maxCalls: 0 }, adminBlocked: false };
  const pageB = await open(`${B}/?settings=Connectors`, `window.__opens = []; window.__posts = 0; window.open = (u) => { window.__opens.push(String(u)); return window.__opens.length > 1 ? { closed: false } : null; };
    { const f = window.fetch, json = (x) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } }); let made = false;
      window.fetch = async (u, i) => { const p = String(u);
        if (p.endsWith("/api/connectors") && i?.method === "POST") { window.__posts++; made = true; return json({ connector: ${JSON.stringify(FAKE)}, connectors: [${JSON.stringify(FAKE)}], authorizeUrl: ${JSON.stringify(LOGIN)} }); }
        if (p.endsWith("/api/connectors") && made) { const j = await (await f(u, i)).json(); j.connectors.push(${JSON.stringify(FAKE)}); return json(j); }
        return f(u, i); }; }`);
  await pageB.until(`!!${BROWSE}`, 30000);
  await pageB.click(BROWSE);
  await pageB.until(`!!document.querySelector(".cn-browse")`);
  // Theo đúng tên hãng: mô tả của mục khác cũng có thể nhắc tới Notion.
  const notion = `[...document.querySelectorAll(".cn-browse .cn-item")].find((i) => i.querySelector(".cn-item-m b")?.textContent.trim() === "Notion")`;
  await pageB.until(`!!${notion}?.querySelector(".cn-item-btn")`);
  await pageB.click(`${notion}.querySelector(".cn-item-btn")`);
  say(await pageB.until(`!!${notion}?.querySelector(".cn-pop button")`), "bị chặn: lời nhắc hiện ngay trên mục trong danh mục");
  const inView = await pageB.ev(`(() => { const b = ${notion}.querySelector(".cn-pop button").getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest(".cn-browse") != null; })()`);
  say(inView, "nút mở lại nằm trên cùng, không bị che");
  await pageB.click(`${notion}.querySelector(".cn-pop button")`);
  say(await pageB.until(`window.__opens.length === 2`, 3000), "bấm: mở cửa sổ ngay trong lúc bấm");
  say(await pageB.ev(`window.__opens[1] === window.__opens[0] && window.__posts === 1`), "dùng lại đúng địa chỉ, không gọi máy chủ lần nữa");
  say(await pageB.until(`!${notion}?.querySelector(".cn-pop")`, 3000), "mở được rồi thì lời nhắc biến mất");
  await pageB.P("Page.navigate", { url: "about:blank" });

  // Mọi trang Synchro khác rời đi để không ai xác nhận hộ cửa sổ đăng nhập.
  await page2.P("Page.navigate", { url: "about:blank" });
  console.log("━━ đã rời màn hình Connectors: cửa sổ tự đóng, trang chính vẫn báo kết quả");
  await page.P("Page.navigate", { url: `${B}/?settings=Connectors` });
  await page.until(`!!${ADD}`, 30000);
  await sleep(300);
  let k3 = new Set(popups.keys());
  await addCustom(page, "Mock Notes", `${MCP}/mcp`);
  const pop4 = await openedPopup(page, k3);
  say(!!pop4, "mở cửa sổ đăng nhập");
  await page.P("Page.navigate", { url: `${B}/` });
  await page.until(`!!document.querySelector("textarea")`, 30000);
  await sleep(500);
  if (pop4) await inPopup(pop4, ALLOW);
  say(await page.until(`/(Đã kết nối|Connected) Mock Notes/.test(document.body.innerText)`, 12000), "trang chính có thông báo đã kết nối");
  for (let i = 0; i < 40 && popups.has(pop4); i++) await sleep(100);
  say(!popups.has(pop4), "cửa sổ tự đóng");

  console.log("━━ không còn trang nào: cửa sổ tự đóng, không nạp cả ứng dụng vào đó");
  await wipe();
  await page.P("Page.navigate", { url: `${B}/?settings=Connectors` });
  await page.until(`!!${ADD}`, 30000);
  await sleep(300);
  k3 = new Set(popups.keys());
  await addCustom(page, "Mock Notes", `${MCP}/mcp`);
  const pop5 = await openedPopup(page, k3);
  say(!!pop5, "mở cửa sổ đăng nhập");
  await page.P("Page.navigate", { url: "about:blank" });
  await sleep(500);
  if (pop5) await inPopup(pop5, ALLOW);
  let sawApp = false;
  for (let i = 0; i < 60 && popups.has(pop5); i++) { if (/settings=Connectors/.test(popups.get(pop5)?.url ?? "")) sawApp = true; await sleep(100); }
  say(!popups.has(pop5) && !sawApp, "cửa sổ tự đóng, không chuyển sang ứng dụng", popups.get(pop5)?.url);
  const made = (await api("GET", "/api/connectors")).connectors ?? [];
  say(made.some((c) => c.name === "Mock Notes" && c.status === "ok"), "kết nối vẫn thành công");

  console.log("━━ thẻ kết nối lại ở lại sau khi trả lời xong");
  await fetch(`${MCP}/__revoke`, { method: "POST" });
  const notesId = made.find((c) => c.name === "Mock Notes")?.id;
  await api("POST", `/api/connectors/${notesId}/refresh`);
  await page.P("Page.navigate", { url: `${B}/` });
  await page.until(`!!document.querySelector("textarea")`, 30000);
  await sleep(1500);
  const sendMsg = async (pg, text) => { await pg.click(`document.querySelector("textarea")`); await pg.P("Input.insertText", { text }); await pg.P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }); };
  await sendMsg(page, "Mock Notes của mình có gì mới?");
  say(await page.until(`!!document.querySelector(".cn-rc")`, 30000), "khi đang trả lời: có thẻ kết nối lại");
  await page.until(`!document.querySelector(".ai-streaming") && !!document.querySelector(".ai-msg")`, 40000);
  await sleep(1500);
  say(await page.ev(`!!document.querySelector(".cn-rc")`), "trả lời xong: thẻ vẫn còn");
  k3 = new Set(popups.keys());
  await page.click(`document.querySelector(".cn-rc .btn.dark")`);
  const pop6 = await openedPopup(page, k3);
  say(!!pop6, "bấm Kết nối lại: mở cửa sổ đăng nhập");
  if (pop6) await inPopup(pop6, ALLOW);
  say(await page.until(`/Đã kết nối lại|Reconnected/.test(document.querySelector(".cn-rc")?.textContent ?? "")`, 15000), "đăng nhập xong: thẻ báo đã kết nối lại");

  console.log("━━ thẻ duyệt: gửi câu trả lời hỏng thì nút mở lại, cột bên có dấu chờ duyệt");
  const uid = (await api("GET", "/api/auth/me")).user.id;
  await api("POST", "/api/engines/claude/login/start", {});
  await api("POST", "/api/engines/claude/login/code", { code: /id="code"[^>]*>([^<]+)</.exec(await fetch("http://127.0.0.1:4010/mock-login/claude").then((x) => x.text()))?.[1] });
  const pageA = await open(`${B}/`, `try { localStorage.setItem("u:${uid}:model", "sub-claude/sonnet"); } catch {}
    window.__fail = true; { const f = window.fetch; window.fetch = (u, i) => String(u).includes("/api/approve") && window.__fail ? Promise.resolve(new Response(JSON.stringify({ error: "Không gửi được câu trả lời." }), { status: 500, headers: { "content-type": "application/json" } })) : f(u, i); }`);
  await pageA.until(`!!document.querySelector("textarea")`, 30000);
  await sleep(1500);
  await sendMsg(pageA, `#tool=mock_notes__create_note #args={"title":"Thẻ duyệt"}`);
  const ALLOW_BTN = `document.querySelector(".ag-ask:not(.cn-rc) .ag-ask-a .btn.dark")`;
  say(await pageA.until(`!!${ALLOW_BTN}`, 40000), "có thẻ duyệt");
  say(await pageA.until(`!!document.querySelector(".ct-need")`, 5000), "cột bên có dấu riêng cho đoạn chat đang chờ duyệt");
  await pageA.click(ALLOW_BTN);
  say(await pageA.until(`!!document.querySelector(".ag-ask:not(.cn-rc) .api-err")`, 5000), "gửi hỏng: thẻ báo lỗi");
  say(await pageA.until(`!${ALLOW_BTN}?.disabled`, 3000), "gửi hỏng: nút mở lại");
  await pageA.ev(`window.__fail = false`);
  await pageA.click(ALLOW_BTN);
  say(await pageA.until(`!!document.querySelector(".ag-asked")`, 15000), "bấm lại: câu trả lời được nhận");
  say(await pageA.until(`!document.querySelector(".ct-need")`, 15000), "hết chờ thì mất dấu ở cột bên");
} finally {
  await wipe().catch(() => {});
  chrome.kill();
}
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exitCode = fails ? 1 : 0;
