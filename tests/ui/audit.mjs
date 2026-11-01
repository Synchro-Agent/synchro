// Soát lỗi giao diện toàn trang bằng Chrome ẩn trên npm run dev:mock. Chạy tay: node tests/ui/audit.mjs [light|dark] [desktop|mobile]
// Đi qua mọi màn hình (chat, artifact, các trang, cài đặt, menu, trang đăng nhập…) ở chế độ sáng / tối, máy tính / điện thoại;
// tự bắt lỗi JavaScript, phần tử tràn khỏi màn hình, chữ bị cắt không có dấu …, ảnh hỏng, phông chữ chưa tải, chữ tiếng Anh sót;
// chụp ảnh từng màn hình vào <tmp>/synchro-ui/audit/ để xem bằng mắt.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const OUT = (await import("node:os")).tmpdir() + "/synchro-ui/audit/";
mkdirSync(OUT, { recursive: true });
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-audit";
const THEMES = process.argv[2] ? [process.argv[2]] : ["light", "dark"];
const SIZES = process.argv[3] ? [process.argv[3]] : ["desktop", "mobile"];

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return r.status;
};
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email); db.close(); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const note = (where, what) => { problems.push(`${where}: ${what}`); };

// Kiểm tra trong trang: tràn ngang, chữ bị cắt cụt, ảnh hỏng, phông chữ, chữ tiếng Anh sót (giao diện tiếng Việt).
const CHECK = `(() => {
  const out = [], W = innerWidth, H = innerHeight;
  const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0.05; };
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(cs.overflowX)) { const r = p.getBoundingClientRect(); if (r.right <= W + 1) return true; } if (cs.position === "fixed") break; } return false; };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
  if (document.scrollingElement.scrollWidth > W + 1) out.push("trang tràn ngang " + (document.scrollingElement.scrollWidth - W) + "px");
  let n = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (n > 12) break;
    if (el.closest("svg,canvas,iframe,[aria-hidden=true],.vm-wave")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > H || r.left >= W || r.right <= 0 || !vis(el)) continue;
    if (r.right > W + 2 && !clipped(el)) { out.push("tràn khỏi mép phải " + Math.round(r.right - W) + "px: " + name(el)); n++; continue; }
    if (r.left < -2 && r.right > 8 && !clipped(el) && !el.closest(".sidebar.closed") && getComputedStyle(el).position !== "sticky") { out.push("tràn khỏi mép trái " + Math.round(-r.left) + "px: " + name(el)); n++; continue; }
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim());
    if (own && /(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== "ellipsis" && !el.closest("pre,code,.art-code,textarea")) { out.push("chữ bị cắt (không có …): " + name(el) + " “" + el.textContent.trim().slice(0, 40) + "”"); n++; }
  }
  for (const img of document.images) if (img.complete && img.naturalWidth === 0 && img.getAttribute("src") && vis(img)) out.push("ảnh hỏng: " + img.getAttribute("src").slice(0, 80));
  if (document.fonts.status !== "loaded") out.push("phông chữ chưa tải xong");
  const bad = [...document.fonts].filter((f) => f.status === "error" && !/Fallback/.test(f.family)).map((f) => f.family);
  if (bad.length) out.push("phông lỗi: " + [...new Set(bad)].join(", "));
  // Chữ tiếng Anh sót trong giao diện tiếng Việt (bỏ qua nội dung người dùng, code, tên riêng).
  const EN = /\\b(the|and|your|with|this|that|from|will|Settings|Search|Delete|Cancel|Save|Close|Enable|Disable|Upload|Download|Loading|Untitled|Add|Remove|Edit|Copy|Share|Retry|Error|Failed|Back|Next(?!\\.js)|Done|Open|New|Preview|Learn more|Turn on|Turn off)\\b/;
  const seen = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const t = walk.currentNode, v = t.nodeValue.trim(), p = t.parentElement;
    if (!v || v.length < 3 || !p || p.closest("pre,code,textarea,input,[data-notr],.ai-msg,.user-msg,.mdx,.art-code,.sk-pre,.chat-item,.title-edit,iframe,.cr-by,.pl-row2-h b")) continue;
    if (!vis(p)) continue;
    const r = p.getBoundingClientRect(); if (r.bottom < 0 || r.top > H || !r.width) continue;
    if (EN.test(v) && !/[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(v) && !seen.has(v)) { seen.add(v); out.push("chữ tiếng Anh: “" + v.slice(0, 60) + "”"); }
    if (seen.size > 8) break;
  }
  return out;
})()`;

for (const theme of THEMES) for (const size of SIZES) {
  const tag = `${theme}-${size}`;
  console.log(`\n━━ ${tag}`);
  rmSync(PROF, { recursive: true, force: true });
  const mobile = size === "mobile";
  const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--remote-debugging-port=9339", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9339/json/version").then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map(), errs = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") errs.push("JS: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0].slice(0, 200));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errs.push("console: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
    if (m.method === "Network.responseReceived" && m.params.response.status >= 500) errs.push(`HTTP ${m.params.response.status}: ${m.params.response.url.slice(0, 100)}`);
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
  await P("Emulation.setDeviceMetricsOverride", mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  if (mobile) await P("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("theme", ${JSON.stringify(theme)}); } catch {}` });
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
  const click = async (expr, what) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("not found: " + what);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };
  const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
  const key = (k, code, vk, mods = 0) => P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(k === "Enter" ? { text: "\r" } : {}) }).then(() => P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }));
  const esc = () => key("Escape", "Escape", 27);
  let step = 0;
  const shot = async (name) => {
    await sleep(350);
    const where = `${tag}/${name}`;
    for (const e of errs.splice(0)) note(where, e);
    for (const p of await ev(CHECK).catch((e) => ["kiểm tra lỗi: " + e.message])) note(where, p);
    const { data } = await P("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT}${tag}-${String(++step).padStart(2, "0")}-${name}.png`, Buffer.from(data, "base64"));
    console.log("  ·", name);
  };
  const ask = async (text) => {
    await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text });
    await key("Enter", "Enter", 13);
    await until(`!document.querySelector(".thinking") && !document.querySelector(".art-card.busy") && !document.querySelector(".msg-stop, .stop-btn, [aria-label='Dừng']")`, 90000, "reply " + text);
    await sleep(1200);
  };
  const side = async () => {
    // Điện thoại: khung artifact mở toàn màn hình, đóng trước (như người dùng bấm X) rồi mới mở thanh bên.
    if (mobile && (await ev(`!!document.querySelector(".art-panel")`))) { await click(`document.querySelector(".art-panel [aria-label='Đóng']")`, "close art").catch(() => {}); await sleep(400); }
    if (await ev(`!!document.querySelector(".sidebar.closed, .shell-side.closed")`)) { await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "burger").catch(() => {}); await sleep(500); } };
  const nav = async (label) => { await side(); await click(byText(".nav-item", label), label); await sleep(1500); };
  const step0 = async (name, fn) => { try { await fn(); } catch (e) { note(`${tag}/${name}`, "không chạy được bước: " + e.message.split("\n")[0]); await shot(name + "-fail").catch(() => {}); } };

  // Trang công khai khi chưa đăng nhập.
  await step0("dang-nhap", async () => { await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("input[type=email], input[type=password], form")`, 20000, "login"); await sleep(800); await shot("dang-nhap"); });
  await step0("dieu-khoan", async () => { await P("Page.navigate", { url: B + "/terms" }); await sleep(1500); await shot("dieu-khoan"); });
  await step0("quyen-rieng-tu", async () => { await P("Page.navigate", { url: B + "/privacy" }); await sleep(1500); await shot("quyen-rieng-tu"); });

  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await step0("trang-chu", async () => { await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("textarea")`, 30000, "app"); await sleep(1500); await shot("trang-chu"); });
  await step0("menu-model", async () => { await click(`document.querySelector(".model-btn")`, "model"); await sleep(500); await shot("menu-model"); await esc(); await sleep(300); });
  await step0("chat-artifact", async () => { await ask("Làm trang web cho quán cà phê"); await shot("chat-artifact"); });
  await step0("artifact-ma", async () => { await click(byText(".art-tabs button", "Mã"), "code"); await sleep(800); await shot("artifact-ma"); await click(byText(".art-tabs button", "Xem trước"), "preview"); await sleep(500); });
  await step0("tai-ve", async () => { await click(`document.querySelector(".art-acts [aria-label='Tải về']")`, "dl"); await sleep(500); await shot("menu-tai-ve"); await esc(); await sleep(300); });
  await step0("ban-tron", async () => { await click(`document.querySelector(".art-panel [aria-label='Đóng']")`, "close art").catch(() => {}); await sleep(400); await click(`document.querySelector(".cx-pill")`, "mixer"); await sleep(1200); await shot("ban-tron-ngu-canh"); await esc(); });
  await step0("chat-bieu-do", async () => { await ask("Vẽ biểu đồ doanh thu 6 tháng"); await shot("chat-bieu-do"); });
  await step0("chat-tep", async () => { await ask("Tạo file Excel báo cáo doanh thu"); await shot("chat-tao-tep"); });
  await step0("chat-markdown", async () => { await ask("Viết kế hoạch ra mắt sản phẩm có bảng lịch trình"); await shot("chat-markdown"); });
  await step0("bang-lenh", async () => { await key("k", "KeyK", 75, 4); await sleep(600); await shot("bang-lenh"); await esc(); await sleep(300); });
  await step0("artifacts", async () => { await nav("Artifacts"); await shot("artifacts"); await click(byText("button", "Ứng dụng"), "apps tab").catch(() => {}); await sleep(800); await shot("ung-dung"); });
  await step0("du-an", async () => { await nav("Dự án"); await shot("du-an"); });
  await step0("hop-thu", async () => { await nav("Hộp thư"); await shot("hop-thu"); });
  await step0("code", async () => { await nav("Code"); await sleep(1000); await shot("code"); });
  await step0("speech", async () => { await nav("Speech"); await shot("speech"); });
  await step0("kho-ky-nang", async () => { await nav("Kỹ năng"); await shot("kho-ky-nang"); await click(byText("button, .cz-tab, [role=tab]", "Connectors"), "connectors").catch(() => {}); await sleep(1200); await shot("connectors"); });
  await step0("menu-nguoi-dung", async () => { await side(); await click(`document.querySelector(".rail .user")`, "user"); await sleep(500); await shot("menu-nguoi-dung"); });
  await step0("cai-dat", async () => {
    await click(byText(".menu-item", "Cài đặt"), "settings"); await sleep(1200);
    const n = await ev(`document.querySelectorAll(".modal.settings .s-item").length`);
    for (let i = 0; i < n; i++) {
      await click(`document.querySelectorAll(".modal.settings .s-item")[${i}]`, "tab " + i); await sleep(1300);
      const t = await ev(`document.querySelectorAll(".modal.settings .s-item")[${i}].getAttribute("title")`);
      await shot("cai-dat-" + String(t).toLowerCase().replace(/\s+/g, "-"));
    }
    await esc(); await sleep(400);
  });
  if (mobile) await step0("thanh-ben", async () => { await side(); await shot("thanh-ben"); await esc(); });
  ws.close(); chrome.kill(); await sleep(500);
}

console.log(`\n━━ Vấn đề (${problems.length})`);
for (const p of problems) console.log(" -", p);
console.log(`\nẢnh chụp: ${OUT}`);
