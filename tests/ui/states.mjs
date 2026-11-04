// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/states.mjs
// Các trạng thái dễ bị bỏ sót: tải lại trang giữ đoạn chat, mất mạng lúc mở trang, phiên hết hạn, thẻ kết nối lại sau khi xong lượt, nhãn cần duyệt ở thanh bên,
// chữ không còn bọc từng từ sau khi xong, chỉ một từ điển ngôn ngữ, khôi phục sau khi sửa tin, bảng lệnh đúng vai trò.
// BASE, MCP_URL, MOCK_URL, CDP_PORT đổi được để chạy song song trên máy chủ riêng.
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const B = process.env.BASE ?? "http://localhost:3200", MCP = process.env.MCP_URL ?? "http://127.0.0.1:4011", LLM = process.env.MOCK_URL ?? "http://127.0.0.1:4010", CDP = Number(process.env.CDP_PORT ?? 9361);
const PROF = `${tmpdir()}/synchro-ui/chrome-prof-states-${CDP}`;
rmSync(PROF, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, total = 0;
const ok = (c, n, x = "") => { total++; if (!c) fails++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };

let cookie = "";
const login = async () => {
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("login failed");
};
await login();
const api = (method, p, body) => fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));

const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
try {
  let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map(), popups = new Map(), handlers = [];
  const send = (method, params = {}, sessionId) => new Promise((res, no) => { const id = ++seq; waits.set(id, [res, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [res, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : res(m.result); return; }
    if (m.method === "Target.targetCreated" && m.params.targetInfo.type === "page") popups.set(m.params.targetInfo.targetId, m.params.targetInfo);
    if (m.method === "Target.targetInfoChanged" && popups.has(m.params.targetInfo.targetId)) popups.set(m.params.targetInfo.targetId, m.params.targetInfo);
    if (m.method === "Target.targetDestroyed") popups.delete(m.params.targetId);
    for (const h of handlers) h(m);
  });
  await send("Target.setDiscoverTargets", { discover: true });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
  await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const setCookie = () => P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await setCookie();
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval"); return r.result.value; };
  const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; };
  const click = async (expr) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("not found: " + expr);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };
  const key = async (k, code, vk, modifiers = 0) => { await P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
  const sendMsg = async (t) => { await ev(`document.querySelector("textarea").focus()`); await P("Input.insertText", { text: t }); await sleep(100); await key("Enter", "Enter", 13); };
  const reload = async () => { await P("Page.reload"); await until(`!!document.querySelector("textarea")`, 30000); await sleep(800); };
  const home = async () => { await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("textarea")`, 30000); await sleep(1200); };
  await home();

  console.log("━━ Tải lại trang giữ đoạn chat");
  ok(await ev(`!location.hash`), "trang chủ: địa chỉ không có mã đoạn chat");
  await sendMsg("Kể ngắn về lịch sử cà phê #streamslow");
  ok(await until(`/^#c=\\d+$/.test(location.hash)`, 5000), "gửi tin: mã đoạn chat vào địa chỉ", await ev("location.href"));
  ok(await until(`!!document.querySelector(".wl-status")`, 8000), "đang trả lời: có dòng trạng thái");
  const live = await ev(`(() => { const s = document.querySelector(".wl-status"); return { region: !!s.querySelector("[role=status]"), timerHidden: s.querySelector(".wl-st-m")?.getAttribute("aria-hidden") === "true", timerInRegion: !!s.querySelector("[role=status] .wl-st-m") }; })()`);
  ok(live.region && live.timerHidden && !live.timerInRegion, "vùng đọc cho trình đọc màn hình không chứa đồng hồ giây", JSON.stringify(live));
  ok(await until(`!!document.querySelector(".ai-streaming .w")`, 15000), "đang chảy chữ: dòng cuối còn hiệu ứng từng từ");
  const blur = await ev(`[...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).filter((r) => r.name === "wIn").map((r) => r.cssText).join("")`);
  ok(blur && !/blur/.test(blur), "hiệu ứng hiện chữ không còn làm mờ nhòe", blur);
  await reload();
  ok(await ev(`!!document.querySelector(".thread") && /cà phê/.test(document.querySelector(".thread").textContent)`), "F5 giữa lượt đang chạy: vẫn ở đoạn chat đó, không về trang chủ");
  ok(await until(`!!document.querySelector(".wl-status") || !document.querySelector(".ai-streaming")`, 8000), "F5: nối lại lượt, thấy trạng thái đang làm hoặc câu trả lời đã xong");
  ok(await until(`!document.querySelector(".ai-streaming") && document.querySelector(".ai-msg")?.textContent.length > 40`, 60000), "câu trả lời hiện đủ sau khi tải lại");
  await sleep(500);
  ok(await ev(`document.querySelectorAll(".ai-msg .w").length === 0`), "câu trả lời đã xong: không còn thẻ bọc từng từ", await ev(`document.querySelectorAll(".ai-msg .w").length`));
  ok(await ev(`!!document.querySelector("main>.sr-only[role=status]")`), "vùng báo cho trình đọc màn hình có mặt");
  await click(`document.querySelector(".nav-item.rail-new")`); await sleep(400);
  ok(await until(`!location.hash && !!document.querySelector(".hero")`, 4000), "bấm Mới: bỏ mã đoạn chat khỏi địa chỉ");
  await P("Page.navigate", { url: `${B}/#c=999` }); await until(`!!document.querySelector("textarea")`, 30000);
  ok(await ev(`!!document.querySelector(".hero")`), "mã đoạn chat không có: ở trang chủ, không vỡ");

  console.log("━━ Sửa tin: cảnh báo và khôi phục được");
  await home();
  await sendMsg("Câu hỏi đầu tiên để sửa");
  await until(`!document.querySelector(".ai-streaming") && !!document.querySelector(".actions.in")`, 30000);
  const before = await ev(`document.querySelector(".ai-msg").textContent`);
  await ev(`document.querySelector(".u-actions [aria-label] ~ [aria-label], .u-actions button:last-child").click()`);
  ok(await until(`!!document.querySelector(".u-edit-n")`, 3000), "sửa tin cuối: có lời báo câu trả lời phía sau sẽ bị thay");
  await P("Input.insertText", { text: " đã sửa" }); await sleep(100); await key("Enter", "Enter", 13);
  ok(await until(`!!document.querySelector(".turn-undo .lnk")`, 5000), "sau khi gửi lại: có nút khôi phục bản cũ");
  await until(`!document.querySelector(".ai-streaming")`, 30000);
  await click(`document.querySelector(".turn-undo .lnk")`); await sleep(500);
  ok(await ev(`document.querySelector(".ai-msg").textContent === ${JSON.stringify(before)} && !/đã sửa/.test(document.querySelector(".user-msg").textContent)`), "khôi phục: về đúng tin và câu trả lời cũ");

  console.log("━━ Bảng lệnh");
  await key("k", "KeyK", 75, 4); await until(`!!document.querySelector(".pal input")`, 5000);
  const pal = await ev(`(() => { const i = document.querySelector(".pal input"), l = document.querySelector(".pal .s-list"); return { role: i.getAttribute("role"), ctl: i.getAttribute("aria-controls") === l.id, list: l.getAttribute("role"), opt: l.querySelector(".s-row")?.getAttribute("role") }; })()`);
  ok(pal.role === "combobox" && pal.ctl && pal.list === "listbox" && pal.opt === "option", "ô tìm là combobox, danh sách là listbox", JSON.stringify(pal));
  await key("ArrowDown", "ArrowDown", 40); await sleep(150);
  ok(await ev(`document.querySelector(".pal input").getAttribute("aria-activedescendant") === "pal-o-1" && document.getElementById("pal-o-1").getAttribute("aria-selected") === "true"`), "mũi tên xuống: mục đang chọn được báo cho trình đọc màn hình");
  await key("Escape", "Escape", 27); await sleep(300);

  console.log("━━ Cài đặt");
  await key(",", "Comma", 188, 4 | 8); await until(`!!document.querySelector(".sy-settings")`, 6000);
  await ev(`(() => { const e = document.querySelector(".s-search input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, "mat khau"); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  ok(await until(`[...document.querySelectorAll(".s-found")].some((b) => /Password|Mật khẩu/.test(b.textContent)) || [...document.querySelectorAll(".s-item")].some((b) => /Account|Tài khoản/.test(b.textContent))`, 2000), "tìm 'mat khau': ra mục Tài khoản");
  await ev(`(() => { const e = document.querySelector(".s-search input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, "zzqq"); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  ok(await until(`!!document.querySelector(".s-none")`, 2000), "không khớp: nói rõ không có kết quả");
  const name1 = await ev(`document.querySelector(".sy-settings").getAttribute("aria-label")`);
  ok(!!name1, "hộp Cài đặt có tên cố định", name1);
  await key("Escape", "Escape", 27); await sleep(400);

  console.log("━━ Mất mạng lúc mở trang");
  await P("Fetch.enable", { patterns: [{ urlPattern: "*/api/auth/me*" }] });
  const fail = (m) => { if (m.method === "Fetch.requestPaused") void send("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "ConnectionRefused" }, S).catch(() => {}); };
  handlers.push(fail);
  await P("Page.navigate", { url: B + "/" });
  ok(await until(`!!document.querySelector(".boot-err")`, 15000), "đã đăng nhập mà mất mạng: báo chưa kết nối được");
  ok(await ev(`!document.querySelector("input[type=email]")`), "không hiện màn hình đăng ký / đăng nhập");
  ok(await ev(`localStorage.getItem("signedIn") === "1"`), "vẫn nhớ đã đăng nhập");
  handlers.splice(handlers.indexOf(fail), 1);
  await P("Fetch.disable");
  ok(await until(`!!document.querySelector("textarea") && !document.querySelector(".boot-err")`, 12000), "có mạng lại: tự vào app, không cần tải lại");

  console.log("━━ Phiên hết hạn");
  await P("Network.deleteCookies", { name: "synchro_session", url: B });
  await ev(`document.querySelector("textarea").focus(); fetch("/api/connectors").catch(() => {}); 1`);
  ok(await until(`!!document.querySelector(".app[inert]")`, 8000), "phần app bên dưới không nhận tiêu điểm");
  ok(await until(`document.activeElement?.matches("input[type=email]")`, 6000), "con trỏ ở ô email, không còn trong ô soạn tin bị che", await ev(`document.activeElement?.tagName`));
  ok(await ev(`/Cần đăng nhập lại|Sign in again/.test(document.querySelector(".auth-title")?.textContent ?? "")`), "tiêu đề nói đăng nhập lại, không phải Bắt đầu", await ev(`document.querySelector(".auth-title")?.textContent`));
  await login(); await setCookie();
  await home();
  ok(await ev(`!document.querySelector(".app[inert]")`), "đăng nhập lại: app dùng được");

  const oauth = async (url) => {
    const link = /id="allow" href="([^"]+)"/.exec(await fetch(url).then((r) => r.text()))[1].replace(/&amp;/g, "&");
    const back = (await fetch(link, { redirect: "manual" })).headers.get("location");
    await fetch(back, { headers: { cookie } });
  };

  console.log("━━ Thẻ kết nối lại sau khi xong lượt");
  for (const x of (await api("GET", "/api/connectors")).j.connectors ?? []) await api("DELETE", `/api/connectors/${x.id}`);
  const made = await api("POST", "/api/connectors", { name: "Mock Notes", url: `${MCP}/mcp` });
  if (made.j.authorizeUrl) {
    const id = made.j.connector.id;
    await oauth(made.j.authorizeUrl);
    await fetch(`${MCP}/__revoke`, { method: "POST" });
    await api("POST", `/api/connectors/${id}/refresh`);
    const c = (await api("GET", "/api/connectors")).j.connectors.find((x) => x.id === id);
    if (c?.status === "needs_auth") {
      await sendMsg("Mock Notes của mình có gì mới?");
      await until(`!document.querySelector(".ai-streaming") && !!document.querySelector(".actions.in")`, 40000);
      ok(await until(`!!document.querySelector(".cn-rc")`, 5000), "lượt đã xong: thẻ kết nối lại vẫn còn");
      await reload();
      ok(await until(`!!document.querySelector(".cn-rc")`, 8000), "tải lại trang: thẻ vẫn còn");
      const known = new Set(popups.keys());
      await click(`document.querySelector(".cn-rc .btn.dark")`);
      let pop = null; const t0 = Date.now();
      while (!pop && Date.now() - t0 < 8000) { for (const [pid, info] of popups) if (!known.has(pid) && /\/authorize/.test(info.url)) pop = pid; await sleep(100); }
      ok(!!pop, "bấm thẻ: mở cửa sổ đăng nhập của hãng");
      if (pop) {
        const { sessionId } = await send("Target.attachToTarget", { targetId: pop, flatten: true });
        await send("Runtime.evaluate", { expression: `new Promise((r) => { const t = setInterval(() => { const a = document.querySelector("#allow"); if (a) { clearInterval(t); r(true); a.click(); } }, 100); })`, awaitPromise: true }, sessionId);
        ok(await until(`/Đã kết nối lại|Reconnected/.test(document.querySelector(".cn-rc")?.textContent ?? "")`, 12000), "đăng nhập xong: thẻ báo đã kết nối lại");
      }
      await reload();
      ok(await until(`!document.querySelector(".cn-rc")`, 6000), "đã nối xong, mở lại đoạn chat: không nhắc nữa");
    } else ok(false, "không đưa được connector về trạng thái cần đăng nhập lại", JSON.stringify(c));
    await api("DELETE", `/api/connectors/${id}`);
  } else ok(false, "không tạo được connector thử", JSON.stringify(made.j));

  console.log("━━ Cần duyệt: thấy được ở ngoài đoạn chat");
  // Lượt thật trên CLI giả lập gọi công cụ ghi (hỏi trước); đường máy chủ nằm ở tests/api/connapprove.test.mjs, ở đây xét phần người dùng thấy.
  for (const x of (await api("GET", "/api/connectors")).j.connectors ?? []) await api("DELETE", `/api/connectors/${x.id}`);
  const nt = await api("POST", "/api/connectors", { name: "Mock Notes", url: `${MCP}/mcp` });
  await oauth(nt.j.authorizeUrl);
  await api("PATCH", `/api/connectors/${nt.j.connector.id}`, { perms: { create_note: "ask" } });
  await api("POST", "/api/engines/claude/login/start", {});
  const lc = /id="code"[^>]*>([^<]+)</.exec(await fetch(`${LLM}/mock-login/claude`).then((x) => x.text()))?.[1];
  await api("POST", "/api/engines/claude/login/code", { code: lc });
  await home();
  const uid = (await api("GET", "/api/auth/me")).j.user?.id;
  await ev(`localStorage.setItem("u:${uid}:model", JSON.stringify("sub-claude/sonnet")); 1`);
  await home();
  await sendMsg('#tool=mock_notes__create_note #args={"title":"Duyệt từ thanh bên"}');
  ok(await until(`!!document.querySelector(".ag-ask")`, 30000), "lượt gọi công cụ ghi: có thẻ duyệt trong đoạn chat", await ev(`document.querySelector(".thread")?.textContent.slice(0, 200)`));
  await click(`document.querySelector(".nav-item.rail-new")`);
  ok(await until(`!!document.querySelector(".chat-item .ct-need")`, 5000), "sang màn hình khác: thanh bên hiện nhãn Cần bạn");
  ok(await until(`/^\\(1\\)/.test(document.title)`, 3000), "tiêu đề thẻ trình duyệt báo có việc cần bạn", await ev("document.title"));
  await click(`document.querySelector(".chat-item .ct-need").closest(".chat-item")`);
  await until(`!!document.querySelector(".ag-ask")`, 5000);
  await click(`[...document.querySelectorAll(".ag-ask .btn")].find((b) => /Từ chối|Deny|Không/.test(b.textContent))`);
  ok(await until(`!document.querySelector(".ct-need")`, 15000), "trả lời xong: nhãn Cần bạn biến mất");
  ok(await until(`!/^\\(1\\)/.test(document.title)`, 3000), "tiêu đề thẻ trở lại bình thường", await ev("document.title"));
  await until(`!document.querySelector(".ai-streaming")`, 30000);
  await api("DELETE", `/api/connectors/${nt.j.connector.id}`);
  await ev(`localStorage.removeItem("u:${uid}:model"); 1`);

  console.log("━━ Ô nhập, nút đều có tên cho trình đọc màn hình");
  // Chữ giữ chỗ cũng được tính là tên (trình duyệt dùng nó khi không có gì khác); ô không có cả chữ giữ chỗ thì trình đọc màn hình chỉ đọc "ô nhập".
  const NO_NAME = `[...document.querySelectorAll("input:not([type=hidden]),select,textarea,button,a[href],[role=button],[role=switch]")].filter((el) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (!r.width || !r.height || s.visibility === "hidden" || el.closest("[inert],[aria-hidden=true],.xterm,.monaco-editor")) return false;
    if (el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.closest("label")?.textContent.trim() || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'))) return false;
    const lb = el.getAttribute("aria-labelledby"); if (lb && document.getElementById(lb)?.textContent.trim()) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !(el.textContent.trim() || el.querySelector("img[alt]:not([alt=''])"));
  }).map((el) => el.tagName + "." + el.className).slice(0, 8).join(" | ")`;
  await home();
  await key(",", "Comma", 188, 4 | 8); await until(`!!document.querySelector(".sy-settings")`, 6000);
  const tabs = await ev(`document.querySelectorAll(".s-item").length`);
  for (let i = 0; i < tabs; i++) {
    await click(`document.querySelectorAll(".s-item")[${i}]`); await sleep(1200);
    const bad = await ev(NO_NAME);
    ok(!bad, `Cài đặt, mục ${await ev(`document.querySelectorAll(".s-item")[${i}].textContent`)}`, bad);
  }
  await key("Escape", "Escape", 27); await sleep(400);

  console.log("━━ CSS theo màn hình");
  const hasRule = (c) => `[...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.selectorText === ${JSON.stringify(c)}); } catch { return false; } })`;
  await home();
  ok(!(await ev(hasRule(".sp-crumb"))) && !(await ev(hasRule(".cv-hello"))), "trang chat không tải CSS của Speech và Code");
  await click(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Speech"))`);
  ok(await until(hasRule(".sp-crumb"), 15000), "mở Speech: CSS của Speech về cùng màn hình");
  ok(await until(`(() => { const c = document.querySelector(".sp-crumb"); return !!c && getComputedStyle(c).cursor === "pointer" && getComputedStyle(c).backgroundColor === "rgba(0, 0, 0, 0)"; })()`, 5000), "nút trong Speech có kiểu đúng, không nháy kiểu mặc định");

  // Enter thật của bàn phím (kèm ký tự): bấm được nút, gửi được biểu mẫu; key() ở trên chỉ tới onKeyDown.
  const enter = async () => { await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); };
  console.log("━━ Dòng dự án ở thanh bên");
  await home();
  await click(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Dự án"))`); await sleep(1500);
  if (!(await ev(`!!document.querySelector(".chat-wrap>.pj-tg")`))) {
    await click(`document.querySelector(".pj-slot, .pj-new")`); await sleep(600);
    await click(`document.querySelector("#sy-pj-name")`); await P("Input.insertText", { text: "Dự án thử bàn phím" }); await key("Enter", "Enter", 13);
  }
  ok(await until(`!!document.querySelector(".chat-wrap>.pj-tg") && !document.querySelector(".overlay")`, 8000), "nút thu gọn là nút riêng, không lồng trong nút của dòng");
  ok(await ev(`(() => { const t = document.querySelector(".chat-wrap>.pj-tg"), i = t.parentElement.querySelector(".pj-ic"), a = t.getBoundingClientRect(), b = i.getBoundingClientRect(); return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 4 && Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 4; })()`), "nút nằm đúng chỗ biểu tượng dự án");
  await ev(`document.querySelector(".chat-wrap>.pj-tg").parentElement.querySelector(".pj-row").focus()`);
  await key("Tab", "Tab", 9);
  ok(await ev(`document.activeElement?.classList.contains("pj-tg")`), "Tab từ dòng dự án tới được nút thu gọn", await ev(`document.activeElement?.className`));
  const tgWas = await ev(`document.activeElement.getAttribute("aria-expanded")`), tgView = await ev(`location.href`);
  await enter();
  ok(await until(`document.querySelector(".chat-wrap>.pj-tg").getAttribute("aria-expanded") !== ${JSON.stringify(tgWas)}`, 3000) && (await ev(`location.href`)) === tgView, "Enter: đổi trạng thái thu gọn, báo aria-expanded, không chuyển trang");
  await enter();

  console.log("━━ Hộp xem ảnh");
  await home();
  const png = `${tmpdir()}/synchro-ui/states-${CDP}.png`;
  writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64"));
  const inp = await P("Runtime.evaluate", { expression: `document.querySelector("input[type=file][multiple]")` });
  await P("DOM.setFileInputFiles", { files: [png], objectId: inp.result.objectId });
  ok(await until(`!!document.querySelector(".attach img, .attach [class*=thumb]")`, 8000), "ảnh đã đính kèm ở ô soạn");
  await click(`document.querySelector(".attach img, .attach [class*=thumb]")`);
  ok(await until(`!!document.querySelector(".overlay.ft-lightbox [role=dialog][aria-modal=true]")`, 4000), "bấm ảnh: hộp xem ảnh có vai trò hộp thoại");
  ok(await until(`getComputedStyle(document.querySelector(".ft-lightbox")).backgroundColor === "rgba(0, 0, 0, 0.72)" && getComputedStyle(document.querySelector(".ft-lightbox")).zIndex === "420"`, 2000), "giữ nền tối và lớp phủ trên cùng của hộp xem ảnh", await ev(`getComputedStyle(document.querySelector(".ft-lightbox")).backgroundColor`));
  await key("Tab", "Tab", 9); await key("Tab", "Tab", 9);
  ok(await ev(`!!document.activeElement?.closest(".ft-lightbox")`), "Tab không rời hộp xem ảnh");
  await key("Escape", "Escape", 27);
  ok(await until(`!document.querySelector(".ft-lightbox")`, 3000), "Esc đóng hộp xem ảnh");
  ok(await ev(`!document.querySelector(".app")?.inert`), "đóng xong: phần nền dùng lại được");
  rmSync(png, { force: true });

  console.log("━━ Hộp hỏi ở Synchro Code");
  await home();
  // Không cần repo thật: trả trạng thái git giả ở trình duyệt để các nút Tạo PR, Nhánh mới hiện ra, và ghi lại lệnh gửi đi.
  await ev(`(() => { const f = window.fetch; window.__git = []; window.__prompted = 0; window.prompt = () => { window.__prompted++; return null; }; window.fetch = (u, o) => { let b = null; try { b = u === "/api/ws" && o?.body ? JSON.parse(o.body) : null; } catch {} if (b?.op === "git") { window.__git.push(b); return Promise.resolve(new Response(JSON.stringify({ git: true, repo: "a/b", branch: "main", ahead: 0, files: [] }), { status: 200, headers: { "content-type": "application/json" } })); } return f(u, o); }; })()`);
  await click(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Code"))`);
  if (await until(`!!document.querySelector(".cv textarea, .cv-compose textarea, main textarea")`, 15000)) {
    await sendMsg("Thử hộp hỏi");
    await until(`!!document.querySelector(".cv-bar")`, 15000); await sleep(1500);
    if (!(await ev(`!!document.querySelector("aside.sr")`))) await click(`document.querySelector(".cv-bar [aria-label='Ẩn/hiện bảng phiên']")`);
  }
  const srBtn = (t) => `[...document.querySelectorAll("aside.sr .ctxp-btn")].find((e) => e.textContent.trim() === ${JSON.stringify(t)})`;
  if (await until(`!!${srBtn("Nhánh mới")}`, 45000)) {
    await click(srBtn("Nhánh mới"));
    ok(await until(`document.activeElement?.matches(".overlay .modal input")`, 4000), "Nhánh mới: hộp của Synchro, con trỏ ở ô nhập");
    ok(await ev(`document.querySelector(".overlay .modal input").value.startsWith("synchro/") && window.__prompted === 0`), "có sẵn tên gợi ý, không dùng hộp của trình duyệt");
    await key("Escape", "Escape", 27);
    ok(await until(`!document.querySelector(".overlay .modal input")`, 3000) && !(await ev(`window.__git.some((b) => b.action === "branch")`)), "Esc: đóng hộp, không tạo nhánh");
    await click(srBtn("Nhánh mới")); await until(`document.activeElement?.matches(".overlay .modal input")`, 4000);
    await P("Input.insertText", { text: "synchro/thu" }); await enter();
    ok(await until(`window.__git.some((b) => b.action === "branch" && b.name === "synchro/thu")`, 4000), "Enter: tạo nhánh đúng tên đã gõ");
    await click(srBtn("Tạo PR")); await until(`document.activeElement?.matches(".overlay .modal input")`, 4000);
    await P("Input.insertText", { text: "Tiêu đề thử" }); await enter();
    ok(await until(`window.__git.some((b) => b.action === "pr" && b.title === "Tiêu đề thử")`, 4000), "Tạo PR: gửi đúng tiêu đề");
  } else ok(false, "bảng phiên hiện nút Nhánh mới", await ev(`document.querySelector("aside.sr")?.innerText.slice(0, 300) ?? "không có bảng phiên"`));

  console.log("━━ Một từ điển ngôn ngữ");
  await P("Network.setCacheDisabled", { cacheDisabled: true });
  const js = [];
  const onResp = (m) => { if (m.method === "Network.responseReceived" && /_next\/static\/.*\.js/.test(m.params.response.url)) js.push(m.params.requestId); };
  handlers.push(onResp);
  await home();
  handlers.splice(handlers.indexOf(onResp), 1);
  // Dấu hiệu chỉ có trong từ điển của từng thứ tiếng (chữ tiếng Việt nằm cả trong mã giao diện nên không dùng làm dấu hiệu từ điển Anh).
  let vi = 0, en = 0;
  for (const requestId of js) {
    const b = await P("Network.getResponseBody", { requestId }).catch(() => null);
    if (!b) continue;
    if (b.body.includes("Quá giới hạn")) vi++;
    if (b.body.includes("plan sign-in is no longer valid")) en++;
  }
  const lang = await ev(`document.documentElement.lang`);
  ok(lang === "vi" ? en === 0 : vi === 0, `giao diện ${lang}: không tải từ điển của ngôn ngữ kia`, `en=${en} vi=${vi}`);
} catch (e) { ok(false, "lỗi khi chạy", e.stack); }
console.log(`${total - fails}/${total} đạt`);
chrome.kill();
process.exit(fails ? 1 : 0);
