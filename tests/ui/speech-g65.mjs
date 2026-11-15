// Kiểm thử giao diện bằng Chrome ẩn trên npm run dev:mock (ElevenLabs giả lập). Chạy tay: node tests/ui/speech-g65.mjs
// Các lỗi tìm thấy khi thử Speech trên bản thật (G6.5), xem ở giao diện tiếng Anh, gói Starter (ẩn nhân bản chuyên sâu):
// ước tính credit theo model và theo thời lượng nhạc, chi phí thật của Nhạc / Tách stem khi ElevenLabs không báo trong header và thanh credit cập nhật,
// âm thanh dưới một giây không còn “0:00 / 0:00”, Voice Agent báo rõ khi micro bị chặn, số nhiều tiếng Anh, dấu thập phân, hướng dẫn Tạo giọng khớp số thẻ,
// không còn chữ Việt, danh sách lồng tiếng tự chuyển sang xong (kể cả khi một lần hỏi trạng thái lỗi) và có tiến độ; bố cục điện thoại không tràn ngang.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200", M = "http://127.0.0.1:4010";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-speech-g65";
rmSync(PROF, { recursive: true, force: true });
const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const el = (body) => fetch(`${M}/_debug/el`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email);
  // Lịch sử Speech của tài khoản thử: bắt đầu sạch để đếm đúng mục vừa tạo.
  db.prepare("DELETE FROM speech_items WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email); db.close(); }
await api("POST", "/api/admin/apikeys", { id: "elevenlabs", kind: "elevenlabs", key: "sk_mock_eleven_0001", baseUrl: `${M}/elevenlabs` });
// Gói Starter: có nhân bản nhanh, thiết kế, remix nhưng không có nhân bản chuyên sâu (như tài khoản thật lúc thử). Như bản thật: Nhạc / Tách stem không báo character-cost.
await el({ tier: "starter", studio: false, lockMusic: false, used: 1000, reset: true, noPerms: [], noCost: true });
await api("GET", "/api/speech/plan?fresh=1");

// Tệp WAV thật (1,5 giây im lặng) để thả vào các ô chọn tệp.
const wavFile = (sec, name) => { const n = Math.round(sec * 8000), b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); const p = SCR + name; writeFileSync(p, b); return p; };
const SONG = wavFile(6, "g65-song.wav"), CLIP = wavFile(5, "g65-clip.wav");

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", "--remote-debugging-port=9391", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9391/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(); const handlers = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); }
  else if (m.method) for (const h of handlers) h(m);
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable"); await P("DOM.enable"); await P("Network.enable");
const desk = () => P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await desk();
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
// Giao diện tiếng Anh; micro bị trình duyệt chặn khi window.__micDeny (getUserMedia ném NotAllowedError như khung nhúng không có quyền micro).
await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("p:uilang", '"en"'); localStorage.setItem("p:spGuideHidden", "{}"); } catch {}
  (() => { const real = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async (c) => { if (window.__micDeny) throw new DOMException("Permission denied", "NotAllowedError"); return real(c); }; })();`, runImmediately: true });
// Lần hỏi trạng thái lồng tiếng đầu tiên trả lỗi 504 (như proxy cắt khi máy chủ còn tải âm thanh về): vòng hỏi phải chạy tiếp.
let failDub = 1, dubPolls = 0;
await P("Fetch.enable", { patterns: [{ urlPattern: "*/api/speech/dub?id=*", requestStage: "Request" }] });
handlers.push((m) => {
  if (m.method !== "Fetch.requestPaused" || m.sessionId !== S) return;
  dubPolls++;
  if (failDub-- > 0) void P("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 504, responseHeaders: [{ name: "content-type", value: "text/html" }], body: Buffer.from("<html>504 Gateway Time-out</html>").toString("base64") });
  else void P("Fetch.continueRequest", { requestId: m.params.requestId });
});

const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const fill = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(e.constructor.prototype, "value").set; set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const upload = async (sel, file) => { const { root } = await P("DOM.getDocument", { depth: -1 }); const { nodeId } = await P("DOM.querySelector", { nodeId: root.nodeId, selector: sel }); await P("DOM.setFileInputFiles", { nodeId, files: [file] }); };
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const text = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim()).join(" | ")`);
const results = [];
const ok = (c, n, x = "") => { results.push([c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}speech-g65-${n}.png`, Buffer.from(data, "base64")); };
// Chữ Việt còn sót trong vùng Speech (bỏ nội dung người dùng đánh dấu data-notr, ô nhập).
const viLeft = () => ev(`(() => { const VI = /[ạảãâầấậẩẫăằắặẳẵẹẻẽêềếệểễỉĩịọỏõôồốộổỗơờớợởỡụủũưừứựửữỳỵỷỹđ]/i; const out = [];
  const w = document.createTreeWalker(document.querySelector(".sp-body") ?? document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { const p = n.parentElement; if (!p || p.closest("[data-notr],textarea,input,script,style,pre") || !p.getClientRects().length) continue; if (VI.test(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 60)); }
  for (const e of document.querySelectorAll(".sp-body option")) if (VI.test(e.textContent)) out.push(e.textContent.trim().slice(0, 60));
  return [...new Set(out)]; })()`);
const openTool = async (t) => {
  await ev(`localStorage.setItem("p:spTool", ${JSON.stringify(JSON.stringify(t))}); 1`);
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector('[data-nav="speech"]')`, 40000, "app");
  await sleep(600);
  if (!(await ev(`!!document.querySelector(".sp-tabs")`))) { await click(`document.querySelector('[data-nav="speech"]')`, "speech"); }
  await until(`!!document.querySelector(".sp-body") && !document.querySelector(".sp-tab-wait")`, 30000, "speech " + t);
  await sleep(900);
};
const credit = () => ev(`document.querySelector(".sp-credit-n")?.textContent ?? ""`);
const num = (s) => Number(String(s).replace(/[^\d]/g, "")) || 0;

try {
  console.log("1. Đọc văn bản: ước tính theo bảng giá model, định dạng 44.1 kHz");
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector('[data-nav="speech"]')`, 40000, "app");
  await openTool("tts");
  await fill(".sp-body textarea", "a".repeat(71));
  await sleep(500);
  const cost = await text(".sp-cost");
  ok(/≈\s*28 credits/.test(cost), `Eleven v4, 71 ký tự: “${cost}” (bản thật tốn 28; trước đây ≈71)`, cost);
  const fmts = await ev(`[...document.querySelectorAll("#tts-fmt option")].map((o) => o.textContent)`);
  ok(fmts.some((x) => /44\.1 kHz/.test(x)) && !fmts.some((x) => /44,1/.test(x)), "định dạng tải xuống: “MP3 44.1 kHz”", fmts);
  ok(!(await viLeft()).length, "không còn chữ Việt ở Đọc văn bản", await viLeft());

  console.log("2. Nhạc: ước tính 30 giây và chi phí thật, thanh credit cập nhật");
  await openTool("music");
  const est = await ev(`[...document.querySelectorAll(".sp-gen .sp-muted")].map((e) => e.textContent).join(" | ")`);
  ok(/≈ 375 credits/.test(est), `ước tính nhạc 30 giây: “${est}” (bản thật 375; trước đây ≈3.000)`, est);
  const c0 = num(await credit());
  await fill("#mu-p", "Upbeat lo-fi for studying");
  await click(byText(".sp-go", "Generate music"), "generate music");
  await until(`[...document.querySelectorAll(".sp-hrow .sp-muted")].some((e) => /credit/.test(e.textContent))`, 30000, "music row");
  const row = await text(".sp-hrow .sp-muted");
  // Mock trừ 30 credit/giây vào gói mà không báo header: mục phải ghi 900 (độ tăng của gói), không phải 0.
  ok(/900 credits/.test(row), `mục Nhạc ghi chi phí thật (độ tăng gói): “${row}”`, row);
  const c1 = num(await credit());
  ok(c0 > 0 && c0 - c1 === 900, `thanh credit cập nhật ngay sau Nhạc: ${c0} → ${c1}`, [c0, c1]);
  await shot("1-music");

  console.log("3. Tách stem, Nhạc cho video: tiêu đề tiếng Anh, số nhiều, chi phí");
  await click(byText(".sp-body [role=tab], .sp-body .seg button, .sp-body button", "Stem separation"), "stems tab"); await sleep(500);
  await upload(".sp-body input[type=file]", SONG); await sleep(300);
  await click(byText(".sp-go", "Separate stems") + ` ?? ${byText(".sp-go", "Stem separation")}`, "split");
  await until(`[...document.querySelectorAll(".sp-hrow b")].some((e) => /stems ·/.test(e.textContent))`, 30000, "stems row");
  const stemRow = await text(".sp-hrow");
  ok(/2 stems · g65-song\.wav/.test(stemRow) && !/2 stem ·/.test(stemRow), `tiêu đề: “2 stems · g65-song.wav”`, stemRow);
  ok(/300 credits/.test(stemRow), "Tách stem ghi chi phí thật (trước đây 0)", stemRow);
  ok(num(await credit()) === c1 - 300, "thanh credit cập nhật sau Tách stem", await credit());
  await click(byText(".sp-body button", "Video to music"), "video tab"); await sleep(500);
  await upload(".sp-body input[type=file]", CLIP); await sleep(300);
  await click(`document.querySelector(".sp-go")`, "video music");
  await until(`[...document.querySelectorAll(".sp-hrow b")].some((e) => /Music for/.test(e.textContent))`, 30000, "video music row");
  const vm = await text(".sp-hrow b");
  ok(/Music for g65-clip\.wav/.test(vm) && !/Nhạc cho/.test(vm), "tiêu đề Nhạc cho video ở giao diện tiếng Anh: “Music for …”", vm);
  ok(!(await viLeft()).length, "không còn chữ Việt ở Nhạc", await viLeft());

  console.log("4. Âm thanh dưới một giây");
  await api("POST", "/api/speech/sfx", { text: "Short click", duration: 0.5 });
  await openTool("sfx");
  await until(`!!document.querySelector(".sp-hrow .sp-time") && /\\d\\.\\d/.test(document.querySelector(".sp-hrow .sp-time").textContent)`, 15000, "sfx time");
  const tm = await ev(`document.querySelector(".sp-hrow .sp-time").textContent`);
  ok(/^0:00\.0 \/ 0:00\.5$/.test(tm), `tiếng động 0,5 giây hiện “${tm}” (không còn “0:00 / 0:00”)`, tm);

  console.log("5. Từ điển phát âm: “1 rule”");
  await api("POST", "/api/speech/dicts", { name: "G65 one", rules: [{ word: "Synchro", say: "sin-crow" }] });
  await openTool("dict");
  await until(`/rule/.test(document.querySelector(".sp-dict-t small")?.textContent ?? "")`, 15000, "dict list");
  const dl = await text(".sp-dict-t small");
  ok(/\b1 rule\b/.test(dl) && !/1 rules/.test(dl), `“${dl.split(" | ")[0]}”`, dl);

  console.log("6. Tạo giọng: hướng dẫn khớp số thẻ (gói Starter)");
  await openTool("create");
  if (!(await ev(`!!document.querySelector(".sp-guide-what")`))) await click(byText("button", "Show guide"), "guide");
  await until(`!!document.querySelector(".sp-guide-what")`, 8000, "guide");
  const what = await ev(`document.querySelector(".sp-guide-what").textContent`);
  const cards = await ev(`document.querySelectorAll(".sp-ccard").length + document.querySelectorAll(".sp-remixcard").length`);
  ok(cards === 3 && /three ways/.test(what) && !/four|professional/i.test(what), `${cards} thẻ, hướng dẫn: “${what.slice(0, 80)}…”`, what);
  ok(!(await viLeft()).length, "không còn chữ Việt ở Tạo giọng", await viLeft());

  console.log("7. Audio Native: xem trước trình phát");
  await openTool("native");
  const pv = await ev(`document.querySelector(".sp-anprev b")?.textContent ?? ""`);
  ok(pv === "Listen to this article", `xem trước: “${pv}”`, pv);

  console.log("8. Voice Agent: micro bị chặn thì báo rõ");
  await openTool("agent");
  await ev(`window.__micDeny = true; 1`);
  await click(byText(".sp-call .sp-go", "Test call"), "test call");
  await until(`!!document.querySelector(".sp-call .api-err")`, 25000, "mic error");
  const me = await ev(`document.querySelector(".sp-call .api-err").textContent`);
  ok(/blocking the microphone/.test(me) && /address bar/.test(me), `lỗi trong khung gọi: “${me.slice(0, 90)}…”`, me);
  ok(await ev(`!!${byText(".sp-call .sp-go", "Test call")}`), "nút Test call quay lại, gọi lại được sau khi cho phép micro");
  await shot("2-agent-mic");
  await P("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(800);
  ok(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), "điện thoại: khung gọi có lỗi không tràn ngang");
  await shot("3-agent-phone");
  await desk();

  console.log("9. Lồng tiếng: tự chuyển sang xong, có tiến độ, tên ngôn ngữ tiếng Anh");
  await openTool("dub");
  await upload(".sp-body input[type=file]", CLIP); await sleep(300);
  await click(`document.querySelector(".sp-body .sp-go")`, "dub");
  await until(`!!document.querySelector(".sp-proj .sp-progress")`, 20000, "progress");
  const pg = await ev(`document.querySelector(".sp-proj .sp-progress").textContent`);
  ok(/Translating and dubbing · \d+% · \d:\d\d \/ ~0:20/.test(pg), `tiến độ: “${pg}”`, pg);
  const pill = await text(".sp-proj .sp-pill");
  ok(pill === "English", `ngôn ngữ đích: “${pill}” (không còn “Tiếng Anh”)`, pill);
  await shot("4-dub-progress");
  await P("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(800);
  ok(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), "điện thoại: thanh tiến độ không tràn ngang");
  await shot("5-dub-phone");
  await desk();
  await until(`!!document.querySelector(".sp-proj .sp-player")`, 45000, "dub done");
  ok(dubPolls >= 3, `danh sách tự chuyển sang xong dù lần hỏi đầu lỗi 504 (${dubPolls} lần hỏi), không phải mở lại trang`, dubPolls);
  ok(!(await viLeft()).length, "không còn chữ Việt ở Lồng tiếng", await viLeft());
  await shot("6-dub-done");
} catch (e) {
  ok(false, "lỗi khi chạy", e.stack ?? e.message);
  await shot("error").catch(() => {});
} finally {
  await el({ noCost: false, tier: "free", used: 0 }).catch(() => {});
  ws.close(); chrome.kill();
}
const bad = results.filter(([c]) => !c).length;
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
