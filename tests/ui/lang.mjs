// Soát ngôn ngữ toàn trang bằng Chrome ẩn trên npm run dev:mock: đi qua mọi màn hình ở giao diện tiếng Việt rồi tiếng Anh,
// gom chữ sai ngôn ngữ (tiếng Anh sót trong giao diện tiếng Việt, tiếng Việt sót trong giao diện tiếng Anh) theo từng màn hình.
// Bỏ qua nội dung người dùng (tin nhắn, code, tên đoạn chat, [data-notr]). Chạy tay: node tests/ui/lang.mjs [vi|en]
// Nháy chữ gốc (B6 bước 10): ở tiếng Anh, mỗi lần tải trang một bộ lấy mẫu chạy theo khung hình (requestAnimationFrame: chữ đúng như sắp vẽ,
// sau khi bộ dịch đã chạy) ghi mọi chữ tiếng Việt đang hiện trên màn hình trong 8 giây đầu, báo ở mục "nháy".
// STRICT=1: thoát mã 1 khi còn chữ sai ngôn ngữ hay chữ nháy (QA chạy như vậy). LANGS=en (hoặc vi,en): chọn ngôn ngữ khi chạy từ QA (QA không truyền đối số).
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadTs } from "../lib/ts.mjs";

const B = "http://localhost:3200";
const LANGS = process.argv[2] ? [process.argv[2]] : process.env.LANGS ? process.env.LANGS.split(",") : ["vi", "en"];
const STRICT = process.env.STRICT === "1" || process.argv.includes("--strict");
const PROF = tmpdir() + "/synchro-ui/chrome-prof-lang";
const { "i18n-dict": D } = await loadTs(["i18n-dict"]);
const SAME_WORDS = [...D.SAME_WORDS];
const SAME = [...D.SAME];

let cookie = "";
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("login failed");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gom chữ sai ngôn ngữ đang hiện trên trang (chữ và các thuộc tính placeholder / title / aria-label / data-tip).
const COLLECT = (lang) => `(() => {
  const lang = ${JSON.stringify(lang)};
  const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  const EN = /\\b(the|and|or|of|for|with|your|you|this|that|from|will|is|are|was|be|been|has|have|not|yes|all|any|more|less|new|add|added|remove|delete|deleted|edit|save|saved|cancel|close|open|show|hide|view|search|settings|loading|error|failed|retry|back|done|create|created|update|updated|upload|download|copy|copied|share|enable|enabled|disable|disabled|turn|learn|select|choose|pick|start|stop|running|send|sent|sign|account|password|name|file|files|folder|used|left|limit|limits|resets|reset|plan|plans|key|keys|balance|usage|today|yesterday|week|month|day|days|hour|hours|minute|minutes|seconds|ago|none|empty|untitled|recent|help|about|privacy|terms|message|messages|session|sessions|project|projects|task|tasks|note|notes|link|links|connect|connected|disconnect|install|installed|uninstall|default|custom|general|appearance|language|theme|dark|light|automatic|members|member|role|invite|people|user|users|details|paid|price|cost|total|input|output|now|later|never|always|only|also|before|after|while|when|what|which|who|how|why|here|there|then|than|into|over|under|between|each|every|other|another|same|first|last|next|previous|page|pages|item|items|result|results|preview|rename|duplicate|move|archive|restore|unpin|export|import|generate|try|again|continue|submit|confirm|apply|clear|refresh|reload|check|checking|working|thinking|waiting|ready|available|unavailable|status|history|activity|logs|feedback|report|voices|text|audio|sound|music|record|recording|play|pause|listen|today|week|weekly|daily|graph|tables?|topics?|memory|brain|hub|connectors? hub)\\b/i;
  const sameW = new Set(${JSON.stringify(SAME_WORDS)});
  const same = new Set(${JSON.stringify(SAME)});
  const strip = (v) => v.split(/[\\s+&/()·:;,.\\-–—|•@#'"“”!?…×=*%$€£¥→←↑↓~≈]+/).filter((w) => w && !sameW.has(w)).join(" ");
  const SKIP = "script,style,pre,code,textarea,input,[data-notr],.ai-msg,.user-msg,.mdx,.art-code,.sk-pre,.chat-item,.title-edit,iframe,.cr-by,.pl-row2-h b,.cm-editor,.monaco-editor,.xterm,.codebox";
  const out = new Set();
  const where = ${JSON.stringify(!!process.env.WHERE)};
  const hint = (el) => { const parts = []; for (let e = el; e && e !== document.body && parts.length < 3; e = e.parentElement) parts.push(e.tagName.toLowerCase() + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/)[0] : "")); return parts.join(" < "); };
  const bad = (v) => {
    v = v.trim();
    if (v.length < 2 || same.has(v) || !/\\p{L}{2}/u.test(v)) return false;
    const w = strip(v);
    return lang === "en" ? VI.test(w) : !VI.test(v) && EN.test(w);
  };
  const shown = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return false; } return true; };
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) {
    const t = tw.currentNode, p = t.parentElement, v = t.nodeValue;
    if (!p || p.closest(SKIP) || !bad(v) || !shown(p)) continue;
    out.add(v.trim().slice(0, 110) + (where ? "   ‹" + hint(p) + "›" : ""));
  }
  // Nút trên khối code và bảng trong câu trả lời là chữ giao diện dù nằm trong .ai-msg (bộ dịch trang bỏ qua vùng này nên chúng phải tự dùng tr()).
  for (const b of document.querySelectorAll(".ai-msg .cb-head button,.mdx .cb-head button,.ai-msg .md-tbl button,.mdx .md-tbl button,.ai-msg .md-th,.mdx .md-th")) {
    if (!shown(b)) continue;
    for (const v of [b.matches(".md-th") ? "" : b.textContent, b.title, b.getAttribute("aria-label")]) if (v && bad(v)) out.add("[md] " + v.trim().slice(0, 80));
  }
  // Thuộc tính nhắc lại nội dung người dùng (aria-label = tên artifact…) thì bỏ qua.
  const content = new Set([...document.querySelectorAll("[data-notr]")].map((e) => e.textContent.trim()));
  for (const el of document.querySelectorAll("[placeholder],[title],[aria-label],[data-tip]")) {
    if (el.closest(SKIP.replace("textarea,input,", "")) || !shown(el)) continue;
    for (const a of ["placeholder", "title", "aria-label", "data-tip"]) { const v = el.getAttribute(a); if (v && !content.has(v.trim()) && bad(v)) out.add("[" + a + "] " + v.trim().slice(0, 100) + (where ? "   ‹" + hint(el) + "›" : "")); }
  }
  return [...out];
})()`;

// Bộ lấy mẫu chữ nháy: cài trước khi trang chạy (Page.addScriptToEvaluateOnNewDocument), lấy mẫu mỗi khung hình trong 8 giây đầu.
// Chỉ requestAnimationFrame, không MutationObserver: bộ theo dõi cài ở đây chạy trước bộ dịch của trang nên sẽ thấy chữ chưa dịch mà chưa bao giờ được vẽ.
const FLASH = `(() => {
  const VI = /[ạảãâầấậẩẫăằắặẳẵẹẻẽêềếệểễỉĩịọỏõôồốộổỗơờớợởỡụủũưừứựửữỳỵỷỹđ]/i;
  const sameW = new Set(${JSON.stringify(SAME_WORDS)});
  const SKIP = "script,style,pre,code,textarea,input,[data-notr],.ai-msg,.user-msg,.mdx,.art-code,.sk-pre,.chat-item,.title-edit,iframe,.cr-by,.cm-editor,.monaco-editor,.xterm,.codebox";
  const strip = (v) => v.split(/[\\s+&/()·:;,.\\-–—|•@#'"“”!?…×=*%$€£¥→←↑↓~≈]+/).filter((w) => w && !sameW.has(w)).join(" ");
  const seen = new Set(), t0 = performance.now();
  window.__flash = seen;
  const tick = () => {
    if (document.body) {
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (tw.nextNode()) {
        const n = tw.currentNode, v = n.nodeValue, p = n.parentElement;
        if (!v || !p || !VI.test(strip(v)) || p.closest(SKIP)) continue;
        if (!p.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        const r = p.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
        seen.add(v.trim().slice(0, 90) + "   @" + Math.round(performance.now() - t0) + "ms");
      }
    }
    if (performance.now() - t0 < 8000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

const report = new Map();
const flashes = new Map();
for (const lang of LANGS) {
  console.log(`\n━━ ${lang}`);
  rmSync(PROF, { recursive: true, force: true });
  const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--remote-debugging-port=9341", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9341/json/version").then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); } });
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable");
  await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("p:uilang", ${JSON.stringify(JSON.stringify(lang))}); } catch {}` });
  if (lang === "en") await P("Page.addScriptToEvaluateOnNewDocument", { source: FLASH });
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
  const click = async (expr, what) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("not found: " + what);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };
  const key = (k, code, vk, mods = 0) => P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(k === "Enter" ? { text: "\r" } : {}) }).then(() => P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }));
  const esc = () => key("Escape", "Escape", 27);
  // Sau một lần tải trang (load = true): chờ hết 8 giây lấy mẫu rồi lấy các chữ tiếng Việt đã hiện trong lúc tải.
  const look = async (name, load = false) => {
    await sleep(700);
    if (load && lang === "en") {
      await sleep(Math.max(0, 8200 - (await ev(`performance.now()`).catch(() => 8200))));
      const fl = await ev(`[...(window.__flash ?? [])]`).catch(() => ["(không đọc được bộ lấy mẫu)"]);
      flashes.set(`${lang} · ${name}`, fl);
      console.log(`  ${fl.length ? "✗" : "✓"} nháy · ${name}${fl.length ? ` (${fl.length})` : ""}`);
    }
    const found = await ev(COLLECT(lang)).catch((e) => ["(lỗi kiểm tra: " + e.message.slice(0, 80) + ")"]);
    const k = `${lang} · ${name}`;
    report.set(k, found);
    console.log(`  ${found.length ? "✗" : "✓"} ${name}${found.length ? ` (${found.length})` : ""}`);
  };
  const step = async (name, fn) => { try { await fn(); } catch (e) { report.set(`${lang} · ${name}`, ["(không chạy được: " + e.message.split("\n")[0].slice(0, 100) + ")"]); console.log("  ! " + name + ": " + e.message.split("\n")[0].slice(0, 100)); } };
  const nav = async (v) => { await click(`document.querySelector('[data-nav="${v}"]')`, v); await sleep(1500); };

  await step("đăng nhập", async () => { await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("input[type=email], input[type=password], form")`, 20000); await look("đăng nhập", true); });
  await step("điều khoản", async () => { await P("Page.navigate", { url: B + "/terms" }); await sleep(1500); await look("điều khoản", true); });
  await step("quyền riêng tư", async () => { await P("Page.navigate", { url: B + "/privacy" }); await sleep(1500); await look("quyền riêng tư", true); });
  await P("Network.enable");
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  await step("trang chủ", async () => { await P("Page.navigate", { url: B + "/" }); await until(`!!document.querySelector("textarea")`, 30000, "app"); await sleep(1500); await look("trang chủ", true); });
  await step("menu model", async () => { await click(`document.querySelector(".model-btn")`, "model"); await look("menu model"); await esc(); });
  await step("menu thêm", async () => { await click(`document.querySelector(".plus-btn, [aria-label='Thêm'], [aria-label='Add']")`, "plus"); await look("menu thêm"); await esc(); });
  await step("bảng lệnh", async () => { await key("k", "KeyK", 75, 4); await look("bảng lệnh"); await esc(); });
  await step("chat", async () => {
    await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: "Làm trang web cho quán cà phê" }); await key("Enter", "Enter", 13);
    await until(`!document.querySelector(".thinking") && !document.querySelector(".art-card.busy") && !document.querySelector("[aria-label='Dừng'], [aria-label='Stop']")`, 90000, "reply");
    await sleep(1500); await look("chat + artifact");
  });
  for (const v of ["projects", "artifacts", "inbox", "code", "customize"]) await step(v, async () => { await nav(v); await look(v); });
  await step("skill hub · connectors", async () => { await click(`[...document.querySelectorAll("button, [role=tab]")].find((e) => /^(Connectors|Kết nối)$/.test(e.textContent.trim()))`, "connectors tab"); await sleep(1200); await look("skill hub · connectors"); });
  // Bộ não: đồ thị, ô tìm nhanh, một ghi chú (kèm cột liên kết), Bảng, Hoạt động.
  await step("bộ não", async () => { await nav("brain"); await sleep(1500); await look("bộ não · đồ thị"); });
  await step("bộ não · tìm", async () => { await click(`document.querySelector(".bw-find input")`, "brain search"); await sleep(600); await look("bộ não · tìm"); await esc(); });
  await step("bộ não · ghi chú", async () => { await click(`document.querySelector(".bw-entry .bw-item")`, "brain note"); await sleep(2000); await look("bộ não · ghi chú"); });
  for (const [i, name] of [[2, "bảng"], [3, "hoạt động"]]) await step(`bộ não · ${name}`, async () => { await click(`document.querySelectorAll(".bw-views button")[${i}]`, name); await sleep(1800); await look(`bộ não · ${name}`); });
  await step("speech", async () => { await nav("speech"); await look("speech"); });
  const spTools = await ev(`[...document.querySelectorAll('[data-nav^="sp-"]')].map((e) => e.dataset.nav)`).catch(() => []);
  for (const t of spTools) await step(t, async () => { await nav(t); await look(t); });
  await step("menu người dùng", async () => { await click(`document.querySelector(".rail .user")`, "user"); await sleep(500); await look("menu người dùng"); });
  await step("cài đặt", async () => {
    await click(`[...document.querySelectorAll(".menu-item")].find((e) => /^(Cài đặt|Settings)/.test(e.textContent.trim()))`, "settings"); await sleep(1200);
    const n = await ev(`document.querySelectorAll(".modal.settings .s-item").length`);
    for (let i = 0; i < n; i++) {
      await click(`document.querySelectorAll(".modal.settings .s-item")[${i}]`, "tab " + i); await sleep(1300);
      const t = await ev(`document.querySelectorAll(".modal.settings .s-item")[${i}].textContent.trim()`);
      await look("cài đặt · " + t);
      const sub = await ev(`document.querySelectorAll(".modal.settings .bn-tabs button").length`).catch(() => 0);
      for (let j = 1; j < sub; j++) { await click(`document.querySelectorAll(".modal.settings .bn-tabs button")[${j}]`, "sub " + j); await sleep(900); await look(`cài đặt · ${t} · ` + (await ev(`document.querySelectorAll(".modal.settings .bn-tabs button")[${j}].textContent.trim()`))); }
    }
    await esc();
  });
  ws.close(); chrome.kill(); await sleep(500);
}

let total = 0;
console.log("\n━━ Chữ sai ngôn ngữ");
for (const [k, v] of report) { if (!v.length) continue; total += v.length; console.log(`\n${k}`); for (const x of v) console.log("   ·", x); }
console.log(total ? `\n${total} chỗ cần xem` : "\nKhông còn chữ sai ngôn ngữ");
let flashN = 0;
if (flashes.size) {
  console.log("\n━━ Nháy chữ tiếng Việt khi tải trang (giao diện tiếng Anh)");
  for (const [k, v] of flashes) { if (!v.length) continue; flashN += v.length; console.log(`\n${k}`); for (const x of v) console.log("   ·", x); }
  console.log(flashN ? `\n${flashN} chữ nháy` : `\nKhông nháy chữ gốc (${flashes.size} lần tải trang)`);
}
if (STRICT && (total || flashN)) process.exit(1);
