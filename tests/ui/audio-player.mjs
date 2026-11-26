// Kiểm thử giao diện trình phát âm thanh dùng chung (ui/audioplayer.tsx) bằng Chrome ẩn trên npm run dev:mock
// (ElevenLabs giả lập). Chạy tay: node tests/ui/audio-player.mjs (SHOTS=<thư mục> để lưu ảnh chụp).
// Lỗi gốc: bản ghi âm MediaRecorder (webm) ở thẻ “Bản gốc” của Đổi giọng hiện “0:13 / 0:00”: thẻ <audio> báo
// thời lượng Infinity nên đồng hồ không có tổng và dạng sóng không chạy theo khi phát.
// Kiểm: tổng thời lượng đúng; dạng sóng theo mẫu âm thanh thật (đoạn nhỏ tiếng có vạch thấp); vệt tiến độ chạy khi
// phát; tua bằng bấm, kéo, phím; trình phát ở đáy trang có tổng thời lượng; kiểm độ dài tối thiểu của Đổi giọng đọc
// được bản ghi webm; bản đã đổi giọng có tổng thời lượng; khung xem trước tệp âm thanh trong đoạn chat dùng cùng trình
// phát, bản dài không bị tải lại và giải mã cả tệp; điện thoại 390px không tràn, vuốt dọc trên dạng sóng cuộn trang
// chứ không tua, chạm nhẹ / kéo ngang thì tua.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const B = "http://localhost:3200", M = "http://127.0.0.1:4010";
const SCR = `${tmpdir()}/synchro-ui/`;
const SHOTS = process.env.SHOTS ?? "";
mkdirSync(SCR, { recursive: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PROF = SCR + "chrome-prof-audio-player";
rmSync(PROF, { recursive: true, force: true });
const email = "admin@synchro.test", password = "synchro-mock-123";
const JSON_HDR = { "content-type": "application/json" };
let cookie = "";
const api = async (method, p, body) => {
  const headers = { ...JSON_HDR, origin: B, cookie };
  const r = await fetch(B + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  let j = null;
  try { j = await r.json(); } catch { /* phản hồi không phải JSON (vd. 204): không cần nội dung */ }
  return { s: r.status, j };
};
const el = (body) => fetch(`${M}/_debug/el`, { method: "POST", headers: JSON_HDR, body: JSON.stringify(body) })
  .then((r) => r.json());
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");

const R = createRequire(process.cwd() + "/package.json");
const openDb = () => {
  const d = new (R("better-sqlite3"))(process.cwd() + "/data-mock/synchro.db");
  d.pragma("busy_timeout = 5000");
  return d;
};
let uid = "";
{
  const db = openDb();
  uid = db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
  db.prepare("DELETE FROM usage_events WHERE user_id = ?").run(uid);
  db.prepare("DELETE FROM speech_items WHERE user_id = ?").run(uid);
  db.close();
}
const ELEVEN = { id: "elevenlabs", kind: "elevenlabs", key: "sk_mock_eleven_0001", baseUrl: `${M}/elevenlabs` };
await api("POST", "/api/admin/apikeys", ELEVEN);
await el({ tier: "starter", studio: false, lockMusic: false, used: 1000, reset: true, noPerms: [], noCost: false });
await api("GET", "/api/speech/plan?fresh=1");

// WAV 16-bit mono 8 kHz: một phần ba to, một phần ba rất nhỏ, một phần ba to — để kiểm dạng sóng lấy từ mẫu thật.
const wavOf = (sec) => {
  const rate = 8000, n = rate * sec, third = n / 3, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const amp = i >= third && i < third * 2 ? 0.03 : 0.8;
    b.writeInt16LE(Math.round(Math.sin(i / 6) * amp * 32000), 44 + i * 2);
  }
  return b;
};

const CHROME = process.env.CHROME_PATH
  ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
// Cổng gỡ lỗi 0: Chrome tự chọn cổng trống rồi ghi vào DevToolsActivePort, không đụng các bộ kiểm thử chạy song song.
const chrome = spawn(CHROME, [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${PROF}`, "--window-size=1440,900",
  "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver;
for (let i = 0; i < 50 && !ver; i++) {
  await sleep(200);
  const portFile = `${PROF}/DevToolsActivePort`;
  const port = existsSync(portFile) ? readFileSync(portFile, "utf8").split("\n")[0].trim() : "";
  if (!port) continue;
  ver = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())
    .catch((e) => { console.debug("  (Chrome chưa sẵn sàng:", e.message, ")"); return null; });
}
if (!ver) throw new Error("Chrome không mở cổng gỡ lỗi");
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const waits = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (!m.id || !waits.has(m.id)) return;
  const [ok, no] = waits.get(m.id);
  waits.delete(m.id);
  if (m.error) no(new Error(JSON.stringify(m.error))); else ok(m.result);
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
  const id = ++seq;
  waits.set(id, [ok, no]);
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable"); await P("DOM.enable");
const view = (width, height, mobile) =>
  P("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
const desk = () => view(1440, 900, false);
await desk();
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });

const ev = async (expr) => {
  const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expr, ms = 30000, what = expr) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); }
  throw new Error("timeout: " + what);
};
const mouse = (type, x, y) => P("Input.dispatchMouseEvent", {
  type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1,
});
const tap = async (x, y) => {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await mouse(type, x, y);
};
const rect = (expr) => ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" });
  const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()`);
const click = async (expr, what) => {
  const r = await rect(expr);
  if (!r) throw new Error("not found: " + what);
  await tap(r[0] + r[2] / 2, r[1] + r[3] / 2);
};
const key = async (k, vk) => {
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: vk });
  await P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: vk });
  await sleep(150);
};
const upload = async (sel, file) => {
  const { root } = await P("DOM.getDocument", { depth: -1 });
  const { nodeId } = await P("DOM.querySelector", { nodeId: root.nodeId, selector: sel });
  await P("DOM.setFileInputFiles", { nodeId, files: [file] });
};
const results = [];
const ok = (c, n, x = "") => {
  results.push([c, n]);
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500));
};
const shot = async (n) => {
  const { data } = await P("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS || SCR}/audio-player-${n}.png`, Buffer.from(data, "base64"));
};
const openTool = async (t) => {
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector('[data-nav="speech"]')`, 40000, "app");
  await sleep(600);
  const nav = `document.querySelector('[data-nav="sp-${t}"]')`;
  if (!(await ev(`!!${nav}`))) await click(`document.querySelector('[data-nav="speech"]')`, "speech");
  await until(`!!${nav}`, 20000, "nav sp-" + t);
  await click(nav, "sp-" + t);
  const ready = `${nav}.classList.contains("active") && !!document.querySelector(".sp-body")
    && !document.querySelector(".sp-tab-wait")`;
  await until(ready, 30000, "speech " + t);
  await sleep(900);
};
// Trạng thái một trình phát: đồng hồ, giá trị thanh tua, phần trăm đã tô của dạng sóng, chiều cao các vạch.
const state = (root) => ev(`(() => {
  const p = ${root}; if (!p) return null;
  const w = p.querySelector(".aud-wave"), on = p.querySelector(".aud-wave-row.on");
  const m = /inset\\(0(?:px)? ([\\d.]+)%/.exec(on.style.clipPath || getComputedStyle(on).clipPath);
  return { time: p.querySelector(".aud-time").textContent, now: Number(w.getAttribute("aria-valuenow")),
    max: Number(w.getAttribute("aria-valuemax")), played: m ? 100 - Number(m[1]) : -1,
    bars: [...p.querySelectorAll(".aud-wave-row:not(.on) i")].map((i) => parseFloat(i.style.height)) }; })()`);
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
// Đoạn giữa nhỏ tiếng hơn hẳn hai đoạn đầu / cuối (bỏ 2 vạch ở mỗi ranh giới).
const quietMiddle = (bars) => {
  const t = Math.floor(bars.length / 3), loud = mean(bars.slice(2, t - 2)), quiet = mean(bars.slice(t + 2, 2 * t - 2));
  return { ok: quiet < loud * 0.5, loud: Math.round(loud), quiet: Math.round(quiet) };
};
// Đã vẽ từ mẫu thật: vạch chờ đều 30%, còn dạng sóng thật của tiếng sin to / nhỏ chỉ có vài mức cao khác nhau.
const peaksIn = (root) => `(() => { const h = [...${root}.querySelectorAll(".aud-wave-row:not(.on) i")]
  .map((i) => parseFloat(i.style.height)); return Math.max(...h) - Math.min(...h) > 20; })()`;
// Bản ghi webm thật bằng MediaRecorder của chính trình duyệt (dao động 220 Hz: to — rất nhỏ — to), như bấm “Ghi âm”.
const record = (sec) => ev(`(async () => {
  const ctx = new AudioContext(), osc = ctx.createOscillator(), g = ctx.createGain();
  const dst = ctx.createMediaStreamDestination();
  osc.frequency.value = 220; osc.connect(g); g.connect(dst);
  const t0 = ctx.currentTime;
  g.gain.setValueAtTime(0.8, t0); g.gain.setValueAtTime(0.02, t0 + ${sec} / 3);
  g.gain.setValueAtTime(0.8, t0 + ${sec} * 2 / 3);
  const r = new MediaRecorder(dst.stream, { mimeType: "audio/webm;codecs=opus" }), parts = [];
  r.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const done = new Promise((ok) => { r.onstop = ok; });
  osc.start(); r.start(250);
  await new Promise((ok) => setTimeout(ok, ${sec} * 1000));
  r.stop(); await done; osc.stop(); await ctx.close();
  const blob = new Blob(parts, { type: "audio/webm" }), u = URL.createObjectURL(blob);
  const meta = await new Promise((ok) => {
    const a = new Audio(); a.preload = "metadata";
    a.onloadedmetadata = () => ok(String(a.duration)); a.onerror = () => ok("error"); a.src = u;
  });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
  return { meta, b64: btoa(s) }; })()`);

// Vị trí cuộn của trang và mọi khung cuộn chứa phần tử (trang Speech cuộn trong khung riêng, không phải window).
const scrollOf = (root) => ev(`(() => { let y = scrollY;
  for (let e = ${root}.parentElement; e; e = e.parentElement) y += e.scrollTop; return Math.round(y); })()`);
// Cảm ứng trên điện thoại: dạng sóng chiếm gần hết bề ngang thẻ, vuốt dọc bắt đầu trên nó phải cuộn trang và không
// tua; chạm nhẹ thì tua tới chỗ chạm; kéo ngang thì tua theo ngón tay.
async function touchChecks(root) {
  await P("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await ev(`${root}.querySelector(".aud-wave").scrollIntoView({ block: "center" })`);
  await sleep(300);
  const before = await state(root), y0 = await scrollOf(root);
  let [x, y, w, h] = await ev(`(() => { const b = ${root}.querySelector(".aud-wave").getBoundingClientRect();
    return [b.x, b.y, b.width, b.height]; })()`);
  // Vuốt lên (nội dung cuộn xuống); nếu đã sát đáy thì vuốt xuống.
  const room = await ev(`(() => { let e = ${root}.parentElement;
    for (; e; e = e.parentElement) {
      const can = e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY);
      if (can) return e.scrollHeight - e.clientHeight - e.scrollTop;
    }
    return document.documentElement.scrollHeight - innerHeight - scrollY; })()`);
  const dist = room > 160 ? -200 : 200;
  const under = `document.elementFromPoint(${x + w * 0.6}, ${y + h / 2})`;
  const hit = await ev(`${root}.querySelector(".aud-wave").contains(${under})`);
  ok(hit, "điện thoại: ngón tay đặt đúng lên dạng sóng (không bị lớp khác phủ)");
  await P("Input.synthesizeScrollGesture", { x: x + w * 0.6, y: y + h / 2, yDistance: dist, xDistance: 0,
    gestureSourceType: "touch", speed: 800, preventFling: true });
  await sleep(500);
  const after = await state(root), y1 = await scrollOf(root);
  const scrolled = Math.abs(y1 - y0) >= 60, kept = after.now === before.now && after.played === before.played;
  const swipe = `cuộn trang ${y1 - y0}px, không tua (${before.now}s → ${after.now}s)`;
  ok(scrolled && kept, `điện thoại: vuốt dọc trên dạng sóng ${swipe}`,
    { y0, y1, before: before.now, after: after.now, room });
  await ev(`${root}.querySelector(".aud-wave").scrollIntoView({ block: "center" })`);
  await sleep(300);
  [x, y, w, h] = await ev(`(() => { const b = ${root}.querySelector(".aud-wave").getBoundingClientRect();
    return [b.x, b.y, b.width, b.height]; })()`);
  await P("Input.synthesizeTapGesture", { x: x + w * 0.25, y: y + h / 2, gestureSourceType: "touch" });
  await sleep(400);
  let st = await state(root);
  const quarter = Math.abs(st.now - st.max * 0.25) < 0.4;
  ok(quarter, `điện thoại: chạm nhẹ vào 1/4 dạng sóng tua tới ${st.now}s / ${st.max}s`, st);
  const pt = (f) => [{ x: x + w * f, y: y + h / 2, id: 1 }];
  await P("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(0.3) });
  for (const f of [0.4, 0.55, 0.7, 0.85]) {
    await P("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(f) });
    await sleep(30);
  }
  await P("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
  st = await state(root);
  ok(Math.abs(st.now - st.max * 0.85) < 0.4, `điện thoại: kéo ngang trên dạng sóng tua theo tới ${st.now}s`, st);
  await P("Emulation.setTouchEmulationEnabled", { enabled: false });
}

try {
  console.log("1. Bản ghi webm từ MediaRecorder");
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector('[data-nav="speech"]')`, 40000, "app");
  const long = await record(6), short = await record(2);
  // Bản ghi phải thật sự thiếu thời lượng ở metadata thì phần sau mới kiểm đường tua thử tới cuối (lỗi gốc).
  const noMeta = long.meta === "Infinity" || long.meta === "NaN";
  ok(noMeta, `bản ghi webm không có thời lượng ở metadata (thẻ <audio> báo ${long.meta}) như bản ghi thật`, long.meta);
  const LONG = SCR + "audio-player-6s.webm", SHORT = SCR + "audio-player-2s.webm";
  writeFileSync(LONG, Buffer.from(long.b64, "base64"));
  writeFileSync(SHORT, Buffer.from(short.b64, "base64"));

  console.log("2. Đổi giọng: kiểm độ dài tối thiểu đọc được bản ghi webm; thẻ “Bản gốc”");
  await openTool("changer");
  await upload(".sp-drop input[type=file]", SHORT);
  await until(`/tối thiểu/.test(document.querySelector(".api-err")?.textContent ?? "")`, 8000, "short error");
  ok(true, "bản ghi 2 giây bị báo dưới mức tối thiểu ngay khi chọn (đọc được độ dài webm)");
  await upload(".sp-drop input[type=file]", LONG);
  const accepted = `!document.querySelector(".api-err") && !document.querySelector(".sp-go").disabled`;
  await until(accepted, 8000, "long accepted");
  await click(`document.querySelector(".sp-go")`, "đổi giọng");
  await until(`document.querySelectorAll(".sp-gcard .aud-player").length === 2`, 30000, "result card");
  const orig = `document.querySelector(".sp-gcard .aud-player")`;
  // Bản dưới 10 giây hiện thêm phần mười giây (“0:05,6”, tiếng Anh “0:05.6”) để tua chính xác hơn.
  await until(`/ 0:0[56]([.,]\\d)?$/.test(${orig}.querySelector(".aud-time").textContent)`, 10000, "orig duration");
  let st = await state(orig);
  const total = /^0:00([.,]0)? \/ 0:0[56]([.,]\d)?$/.test(st.time) && st.max >= 5.5 && st.max <= 6.6;
  ok(total, `“Bản gốc” có tổng thời lượng: “${st.time}”`, st);
  await until(peaksIn(orig), 10000, "peaks");
  st = await state(orig);
  const q1 = quietMiddle(st.bars);
  ok(q1.ok, `dạng sóng theo mẫu thật: đoạn nhỏ tiếng ${q1.quiet}% < đoạn to ${q1.loud}%`, st.bars);
  // Vạch phải trải hết thanh tua: dồn sang trái thì bấm vào khoảng trống bên phải vẫn tua và vệt tô lệch khỏi vạch.
  const span = await ev(`(() => { const w = ${orig}.querySelector(".aud-wave").getBoundingClientRect();
    const is = ${orig}.querySelectorAll(".aud-wave-row:not(.on) i"), first = is[0].getBoundingClientRect();
    const last = is[is.length - 1].getBoundingClientRect();
    return { left: Math.round(first.left - w.left), right: Math.round(w.right - last.right),
      w: Math.round(w.width) }; })()`);
  ok(span.left <= 1 && span.right <= 1, `vạch trải hết thanh tua (lề trái ${span.left}px, phải ${span.right}px)`, span);
  // Bản đã đổi giọng (WAV từ /api/speech/file của máy chủ) cũng phải có tổng thời lượng, không đứng ở “0:00 / 0:00”.
  const conv = `document.querySelectorAll(".sp-gcard .aud-player")[1]`;
  const convTotal = `(() => { const t = ${conv}.querySelector(".aud-time").textContent;
    const m = / (\\d+):(\\d\\d)(?:[.,](\\d))?$/.exec(t);
    return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3] ?? 0) / 10 : 0; })()`;
  const t0 = Date.now();
  await until(`${convTotal} > 0`, 10000, "converted duration").catch((e) => console.log("  ", e.message));
  const cv = await state(conv), waited = Date.now() - t0;
  const convOk = cv && cv.max > 0 && (await ev(convTotal)) > 0;
  ok(convOk, `bản đã đổi giọng có tổng thời lượng: “${cv?.time}” (chờ ${waited}ms)`, cv);
  await shot("1-changer");

  console.log("3. Phát: vệt tiến độ và đồng hồ chạy, trình phát ở đáy có tổng thời lượng");
  await click(`${orig}.querySelector(".aud-btn")`, "phát bản gốc");
  await sleep(1500);
  const a1 = await state(orig);
  await sleep(700);
  const a2 = await state(orig);
  const moved = `${a1.played.toFixed(1)}% → ${a2.played.toFixed(1)}%`;
  ok(a1.played > 5 && a2.played > a1.played, `vệt đã phát chạy theo: ${moved}`, [a1, a2]);
  ok(a2.now > 0.8 && !/^0:00([.,]0)? /.test(a2.time), `đồng hồ chạy: “${a2.time}”`, a2);
  const dock = await ev(`document.querySelector(".sp-dock .aud-time")?.textContent ?? ""`);
  ok(/ 0:0[56]([.,]\d)?$/.test(dock), `trình phát ở đáy trang có tổng thời lượng: “${dock}”`, dock);
  await shot("2-playing");
  await click(`${orig}.querySelector(".aud-btn")`, "tạm dừng");
  await sleep(300);

  console.log("4. Tua: bấm, kéo, bàn phím");
  const [bx, by, bw, bh] = await rect(`${orig}.querySelector(".aud-wave")`);
  const yy = by + bh / 2;
  await tap(bx + bw * 0.5, yy);
  await sleep(250);
  st = await state(orig);
  const mid = Math.abs(st.now - st.max / 2) < 0.4 && Math.abs(st.played - 50) < 6;
  ok(mid, `bấm giữa dạng sóng tua tới giữa (${st.now}s / ${st.max}s, tô ${st.played.toFixed(0)}%)`, st);
  await mouse("mousePressed", bx + bw * 0.2, yy);
  for (const f of [0.4, 0.6, 0.8]) await mouse("mouseMoved", bx + bw * f, yy);
  await mouse("mouseReleased", bx + bw * 0.8, yy);
  await sleep(250);
  st = await state(orig);
  ok(Math.abs(st.now - st.max * 0.8) < 0.4, `kéo trên dạng sóng tua theo tới 80% (${st.now}s)`, st);
  await ev(`${orig}.querySelector(".aud-wave").focus()`);
  const focused = await ev(`document.activeElement?.getAttribute("role") === "slider"
    && document.activeElement.getAttribute("aria-label") === "Tua"`);
  ok(focused, "dạng sóng nhận tiêu điểm bàn phím (role slider, nhãn “Tua”)");
  await key("Home", 36);
  const h = (await state(orig)).now;
  await key("ArrowRight", 39);
  const r1 = (await state(orig)).now;
  await key("End", 35);
  const e1 = await state(orig);
  const keysOk = h === 0 && r1 > 0.3 && r1 < 1 && Math.abs(e1.now - e1.max) < 0.15;
  ok(keysOk, `phím Home → ${h}s, → → ${r1}s, End → ${e1.now}s`, [h, r1, e1]);

  console.log("5. Điện thoại 390px");
  await view(390, 844, true);
  await sleep(800);
  // Thanh bên mở ở máy tính thành ngăn kéo phủ trang trên điện thoại: đóng bằng nền mờ bên phải trước khi kiểm.
  for (let i = 0; i < 3 && (await ev(`!!document.querySelector(".side-scrim")`)); i++) {
    const at = await ev(`(() => { const b = document.querySelector(".side-scrim").getBoundingClientRect();
      return [b.right - 12, b.top + b.height / 2]; })()`);
    await tap(at[0], at[1]);
    await sleep(700);
  }
  ok(!(await ev(`!!document.querySelector(".side-scrim")`)), "điện thoại: ngăn kéo thanh bên đã đóng");
  await ev(`${orig}.scrollIntoView({ block: "center" })`);
  const fit = await ev(`(() => { const p = ${orig}, w = p.querySelector(".aud-wave"), t = p.querySelector(".aud-time");
    const gap = Math.round(t.getBoundingClientRect().left - w.getBoundingClientRect().right);
    const page = document.documentElement.scrollWidth <= innerWidth + 1;
    return { gap, fit: w.scrollWidth <= w.clientWidth + 1, page }; })()`);
  ok(fit.gap >= 8 && fit.fit && fit.page, `điện thoại: dạng sóng không chạm đồng hồ, không tràn: ${fit.gap}px`, fit);
  await shot("3-phone");
  await touchChecks(orig);
  await desk();

  console.log("6. Xem trước tệp âm thanh trong đoạn chat");
  const chatId = Date.now(), fdir = `${process.cwd()}/data-mock/outputs/${uid}`;
  mkdirSync(fdir, { recursive: true });
  // Bản 3 giây (có dạng sóng) và bản 4 phút (dài hơn mức giải mã: chỉ vạch đều, không tải lại cả tệp để vẽ).
  const outs = [["ban-thu.wav", 3], ["ban-dai.wav", 240]].map(([name, sec], i) => {
    const id = `aud${i}${Date.now().toString(36)}`, data = wavOf(sec);
    writeFileSync(`${fdir}/${id}`, data);
    return { id, name, size: data.length, mime: "audio/wav" };
  });
  {
    const db = openDb();
    const add = db.prepare("INSERT INTO outputs (id, user_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const o of outs) add.run(o.id, uid, o.name, o.mime, o.size, Date.now());
    db.close();
  }
  const longOut = outs[1];
  const chat = { id: chatId, title: "Kiểm thử trình phát", msgs: [
    { role: "user", text: "Tạo một đoạn âm thanh", time: chatId },
    { role: "ai", done: true, time: chatId + 1, outs, text: "Đã tạo tệp âm thanh." },
  ] };
  const seed = `(() => { if (location.origin !== ${JSON.stringify(B)}) return;
    const k = "u:${uid}:chats", c = ${JSON.stringify(chat)}; let cur = [];
    try { cur = JSON.parse(localStorage.getItem(k) || "[]"); }
    catch (e) { console.debug("[test] danh sách đoạn chat trong máy hỏng, ghi đè:", e.message); }
    localStorage.setItem(k, JSON.stringify([c, ...cur.filter((x) => x.id !== c.id)])); })()`;
  const { identifier: seedJs } = await P("Page.addScriptToEvaluateOnNewDocument", { source: seed });
  await P("Page.navigate", { url: `${B}/?ap=1#c=${chatId}` });
  await until(`!!document.querySelector(".out-card")`, 40000, "file card");
  await P("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedJs });
  await click(`document.querySelector(".out-card")`, "thẻ tệp");
  const fp = `document.querySelector(".fp-audio .aud-player")`;
  const fpTime = `${fp}.querySelector(".aud-time").textContent`;
  await until(`!!${fp} && / 0:03([.,]0)?$/.test(${fpTime})`, 20000, "file preview player");
  await until(peaksIn(fp), 10000, "chat peaks");
  st = await state(fp);
  const q2 = quietMiddle(st.bars);
  ok(q2.ok, `đoạn chat: xem trước tệp dùng trình phát chung, dạng sóng theo mẫu thật (${q2.quiet}% < ${q2.loud}%)`, st);
  const native = await ev(`!!document.querySelector(".fp-audio audio[controls]")`);
  ok(!native, "đoạn chat: không còn thẻ <audio controls> riêng");
  await ev(`${fp}.querySelector(".aud-wave").focus()`);
  await key("End", 35);
  st = await state(fp);
  const end = Math.abs(st.now - 3) < 0.15 && st.played > 95;
  ok(end, `đoạn chat: phím End tua tới cuối (${st.now}s, tô ${st.played.toFixed(0)}%)`, st);
  await shot("4-chat-preview");
  await click(`document.querySelectorAll(".out-card")[1]`, "thẻ tệp dài");
  const lp = `document.querySelector(".fp-audio .aud-player")`;
  await until(`/ 4:00$/.test(${lp}.querySelector(".aud-time").textContent)`, 20000, "long preview duration");
  // Chờ quá thời hạn chờ thời lượng của trình phát (2,5 giây) để chắc chắn nó đã quyết định không giải mã.
  await sleep(3500);
  st = await state(lp);
  const fetched = await ev(`performance.getEntriesByType("resource")
    .filter((e) => e.name.includes(${JSON.stringify(longOut.id)}) && e.initiatorType === "fetch").length`);
  const even = st.bars.every((b) => b === 30);
  ok(even && fetched === 0, `đoạn chat: bản 4 phút hiện vạch đều, không tải lại để giải mã (${fetched} lần tải)`, st);
  await ev(`${lp}.querySelector(".aud-wave").focus()`);
  await key("End", 35);
  st = await state(lp);
  ok(Math.abs(st.now - 240) < 0.5, `đoạn chat: bản dài vẫn tua được bằng phím (End → ${st.now}s)`, st);
  {
    const db = openDb();
    const del = db.prepare("DELETE FROM outputs WHERE id = ?");
    for (const o of outs) del.run(o.id);
    db.close();
  }
  for (const o of outs) rmSync(`${fdir}/${o.id}`, { force: true });
  await ev(`(() => { const k = "u:${uid}:chats"; try { const cur = JSON.parse(localStorage.getItem(k) || "[]");
    localStorage.setItem(k, JSON.stringify(cur.filter((c) => c.id !== ${chatId}))); return true; }
    catch (e) { console.debug("[test] không dọn được đoạn chat mẫu trong máy:", e.message); return false; } })()`);
  const gone = { items: [{ kind: "chat", id: String(chatId), upd: Date.now(), deleted: true }] };
  const headers = { ...JSON_HDR, cookie, origin: B };
  await fetch(B + "/api/chats", { method: "PUT", headers, body: JSON.stringify(gone) })
    .catch((e) => console.log("  (cảnh báo: chưa xóa được đoạn chat mẫu trên máy chủ:", e.message, ")"));
} catch (e) {
  ok(false, "lỗi khi chạy", e.stack ?? e.message);
  await shot("error").catch((x) => console.log("  (không chụp được màn hình lỗi:", x.message, ")"));
} finally {
  await el({ noCost: false, tier: "free", used: 0 })
    .catch((x) => console.log("  (không trả được gói ElevenLabs giả lập:", x.message, ")"));
  ws.close();
  chrome.kill();
  // Hồ sơ Chrome tạm (hàng trăm MB): xóa sau khi chạy, đợi Chrome thoát hẳn để không còn tệp đang ghi.
  await new Promise((r) => {
    if (chrome.exitCode !== null) return r();
    chrome.once("exit", r);
    setTimeout(r, 3000);
  });
  rmSync(PROF, { recursive: true, force: true });
}
const bad = results.filter(([c]) => !c).length;
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
