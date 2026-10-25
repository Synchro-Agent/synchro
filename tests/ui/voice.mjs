// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/voice.mjs
// Giọng nói hai luồng:
// 1. Chế độ trình duyệt (chưa có khóa ElevenLabs): nói câu xác nhận ngay, việc chính chạy trong khung chat, xong đọc bản tóm tắt;
//    người dùng nói chen thì dừng đọc trong ≤ 200 ms. Nhận dạng / đọc giọng của trình duyệt và micro được thay bằng bản giả trong trang.
// 2. Chế độ ElevenLabs Realtime (máy chủ giả lập): model giọng nói xác nhận rồi gọi giao_viec, Synchro làm trong khung chat,
//    bản tóm tắt gửi về cho model giọng nói đọc; lượt giao việc không bị ghi trùng vào khung chat.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200", LLM = "http://127.0.0.1:4010";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-voice";
rmSync(PROF, { recursive: true, force: true });

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
{ const R = createRequire(process.cwd() + "/package.json");
  const db = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db"); db.pragma("busy_timeout = 5000");
  db.prepare("DELETE FROM usage_events WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email); db.close(); }
const had = !!(await api("GET", "/api/admin/apikeys")).j?.providers?.find((p) => p.id === "elevenlabs")?.configured;
if (had) await api("DELETE", "/api/admin/apikeys?id=elevenlabs");
const rtCfg = (c) => fetch(`${LLM}/_debug/rt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }).then((r) => r.json());

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", "--remote-debugging-port=9335", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9335/json/version").then((r) => r.json()).catch(() => null); }
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
await P("Network.enable");
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
// Bản giả trong trang: micro là tiếng ồn trắng điều chỉnh được (__mic(0) im lặng, __mic(1) đang nói), nhận dạng giọng nói
// trả về một câu một lần, đọc giọng ghi lại câu đã đọc (mỗi câu 0,6 giây, câu dài 4 giây) và lúc bị hủy.
await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const ctx = new AudioContext(); const g = ctx.createGain(); g.gain.value = 0;
  const buf = ctx.createBuffer(1, 48000, 48000), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(g); const dest = ctx.createMediaStreamDestination(); g.connect(dest); src.start();
  window.__mic = (v) => { ctx.resume(); g.gain.value = v; window.__micAt = performance.now(); };
  navigator.mediaDevices.getUserMedia = async () => { await ctx.resume(); return new MediaStream(dest.stream.getAudioTracks().map((t) => t.clone())); };
  window.__say = []; window.__heard = 0;
  class Rec { start() { const first = window.__heard++ === 0 && window.__ask; setTimeout(() => { if (first) this.onresult?.({ results: [Object.assign([{ transcript: window.__ask }], { isFinal: true })] }); this.onend?.(); }, first ? 400 : 4000); } stop() {} abort() {} }
  window.webkitSpeechRecognition = Rec; window.SpeechRecognition = Rec;
  const q = []; let cur = null, timer = 0;
  const next = () => { cur = q.shift() ?? null; if (!cur) return; window.__say.push({ text: cur.text, at: performance.now() }); cur.onstart?.(); timer = setTimeout(() => { const u = cur; cur = null; u.onend?.(); next(); }, cur.text.length > 60 ? 4000 : 600); };
  window.speechSynthesis.speak = (u) => { q.push(u); if (!cur) next(); };
  window.speechSynthesis.cancel = () => { window.__cancelAt = performance.now(); q.length = 0; clearTimeout(timer); cur = null; };
  window.speechSynthesis.getVoices = () => [];
})();`, runImmediately: true });

const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(150); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const results = [];
const ok = (c, n, x = "") => { results.push([c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}voice-${n}.png`, Buffer.from(data, "base64")); };
const state = () => ev(`document.querySelector(".vm-state")?.textContent ?? ""`);

try {
  console.log("1. Chế độ trình duyệt: xác nhận ngay → tóm tắt → nói chen để ngắt");
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`, 30000, "app");
  await sleep(1200);
  await click(byText(".nav-item", "Mới"), "new chat"); await sleep(600);
  await ev(`window.__ask = "Làm trang web cho quán cà phê"; 1`);
  await click(`document.querySelector(".vm-open")`, "voice");
  await until(`!!document.querySelector(".vm")`, 8000, "voice mode");
  await until(`window.__say.length >= 1`, 10000, "ack");
  const ack = await ev(`window.__say[0].text`);
  const ackDelay = await ev(`window.__say[0].at`);
  ok(/mình|đợi|xem/i.test(ack) && ack.length < 50, `nói câu xác nhận ngay khi nghe xong: “${ack}”`, ack);
  await until(`document.querySelector(".vm-state")?.textContent === "Đang làm việc…"`, 8000, "work state");
  ok(true, "sau câu xác nhận: trạng thái “Đang làm việc…”, việc chính chạy trong khung chat");
  await shot("1-work");
  await until(`window.__say.length >= 2`, 60000, "brief");
  const brief = await ev(`window.__say[1].text`);
  ok(/khung chat/.test(brief) && !/[<#*`]/.test(brief) && brief.length < 300, `đọc bản tóm tắt thay vì cả câu trả lời: “${brief}”`, brief);
  const caption = await ev(`document.querySelector(".vm-cap p")?.textContent ?? ""`);
  ok(caption === brief, "phụ đề hiện câu đang đọc", caption);
  await shot("2-brief");
  // Nói chen: chờ qua thời gian đo nền (0,5 giây) rồi bật micro to, đo thời gian tới lúc dừng đọc.
  await sleep(800);
  await ev(`window.__mic(1); 1`);
  await until(`window.__cancelAt > window.__micAt`, 3000, "barge-in");
  const lat = await ev(`window.__cancelAt - window.__micAt`);
  ok(lat <= 200, `nói chen: dừng đọc sau ${Math.round(lat)} ms (≤ 200 ms)`, lat);
  await until(`document.querySelector(".vm-state")?.textContent === "Đang nghe…"`, 3000, "listen again");
  ok(true, "sau khi ngắt: quay lại nghe");
  await ev(`window.__mic(0); 1`);
  await click(`document.querySelector(".vm-btn.end")`, "end voice"); await sleep(800);
  const thread = await ev(`[...document.querySelectorAll(".user-msg")].map((e) => e.textContent)`);
  const card = await ev(`document.querySelectorAll(".art-card").length`);
  ok(thread.length === 1 && thread[0] === "Làm trang web cho quán cà phê" && card >= 1, "khung chat có câu hỏi và câu trả lời đầy đủ (kèm sản phẩm)", JSON.stringify([thread, card]));
  ok(ackDelay > 0, "đã ghi nhận thời điểm đọc");

  console.log("2. Chế độ ElevenLabs Realtime (giả lập): giao việc qua công cụ");
  await api("POST", "/api/admin/apikeys", { id: "elevenlabs", kind: "elevenlabs", key: "sk_mock_eleven_0001", baseUrl: `${LLM}/elevenlabs` });
  await rtCfg({ tools: true, say: "Làm trang web cho quán cà phê" });
  await click(byText(".nav-item", "Mới"), "new chat"); await sleep(600);
  await click(`document.querySelector(".vm-open")`, "voice rt");
  await until(`!!document.querySelector(".vm")`, 8000, "voice mode rt");
  let seen = "";
  for (let i = 0; i < 100 && seen !== "Đang làm việc…"; i++) { seen = await state(); await sleep(100); }
  ok(seen === "Đang làm việc…", "model giọng nói xác nhận rồi giao việc: hiện “Đang làm việc…”", seen);
  await shot("3-rt-work");
  let dbg;
  for (let i = 0; i < 120; i++) { dbg = await fetch(`${LLM}/_debug/rt`).then((r) => r.json()); if (dbg.log.some((x) => x.t === "response.create")) break; await sleep(500); }
  const outItem = dbg.log.find((x) => x.item?.type === "function_call_output")?.item;
  let tom = ""; try { tom = JSON.parse(outItem?.output ?? "{}").tom_tat ?? ""; } catch {}
  ok(outItem?.call_id === "call_mock_1" && /khung chat/.test(tom), `gửi bản tóm tắt về cho model giọng nói: “${tom}”`, JSON.stringify(dbg.log));
  ok(dbg.log.findIndex((x) => x.t === "conversation.item.create") < dbg.log.findIndex((x) => x.t === "response.create"), "gửi kết quả rồi mới yêu cầu đọc (response.create)");
  await until(`(document.querySelector(".vm-cap p")?.textContent ?? "").includes("khung chat")`, 10000, "rt caption");
  ok(true, "phụ đề hiện lời model giọng nói đọc bản tóm tắt");
  await shot("4-rt-brief");
  await sleep(1500);
  await click(`document.querySelector(".vm-btn.end")`, "end rt"); await sleep(800);
  const rtThread = await ev(`[...document.querySelectorAll(".user-msg")].map((e) => e.textContent)`);
  const rtAi = await ev(`[...document.querySelectorAll(".ai-msg")].map((e) => e.textContent).join(" | ")`);
  ok(rtThread.length === 1 && rtThread[0] === "Làm trang web cho quán cà phê" && !/Được, để mình xem nhé/.test(rtAi), "khung chat chỉ có một lượt (yêu cầu + câu trả lời đầy đủ), không ghi trùng câu xác nhận hay lời tóm tắt", JSON.stringify([rtThread, rtAi.slice(0, 200)]));

  console.log("3. ElevenLabs chưa nhận công cụ: trò chuyện như cũ");
  await rtCfg({ tools: false });
  await click(byText(".nav-item", "Mới"), "new chat"); await sleep(600);
  await click(`document.querySelector(".vm-open")`, "voice rt2");
  await until(`(document.querySelector(".vm-cap p")?.textContent ?? "").includes("bản giả lập")`, 15000, "plain rt answer");
  await sleep(1800);
  await click(`document.querySelector(".vm-btn.end")`, "end rt2"); await sleep(800);
  const plain = await ev(`[...document.querySelectorAll(".ai-msg")].map((e) => e.textContent).join(" | ")`);
  ok(/bản giả lập/.test(plain), "phiên thường: lượt nói được ghi vào khung chat như trước", plain.slice(0, 200));
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
await rtCfg({ tools: true, say: "Làm trang web cho quán cà phê" }).catch(() => {});
// Trả lại như cũ: bản giả lập chỉ có khóa ElevenLabs giả.
if (had) await api("POST", "/api/admin/apikeys", { id: "elevenlabs", kind: "elevenlabs", key: "sk_mock_eleven_0001", baseUrl: `${LLM}/elevenlabs` });
else await api("DELETE", "/api/admin/apikeys?id=elevenlabs");
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
