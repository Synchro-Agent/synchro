// Nhóm B của ma trận H1 (tài khoản miễn phí, khung chat): mỗi lỗi một phép thử trong Chrome ẩn trên npm run dev:mock, ở 1440px và 390px.
//  B7  link sandbox:/outputs/<tệp> trong câu trả lời thành link tải đúng tệp (thẻ tệp cùng tên), không còn là chữ trần.
//  B8  danh sách việc ("Tasks n/3", vòng xoay ở việc đang làm) cập nhật ngay trong lượt khi model dùng update_plan dựng sẵn của Codex.
//  B9  bản đầy đủ + bản sửa (mode="patch") của cùng artifact trong một câu trả lời: một thẻ, ghi "Phiên bản 2", bấm mở phiên bản 2/2 (mới nhất).
//  B14 khung xem bản trình bày: bấm mũi tên nhanh thì khung lớn không chậm một slide so với nhãn "Slide n / N"; mũi tên lùi và Thử lại không ghi clipboard.
//  B14b khung xem hẹp dựng slide đúng 1280×720 rồi thu nhỏ vừa khung: không cắt phần dưới slide.
// Chạy tay: BASE=http://localhost:3200 node tests/ui/h1-chatui.mjs [B7 B8 …]. SHOTS=<thư mục>: lưu ảnh từng ca.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { login, sleep } from "../lib/cdp.mjs";
import { idbDel } from "../lib/idbchats.mjs";

const B = process.env.BASE ?? process.env.SYNCHRO_URL ?? "http://localhost:3200";
const PORT = Number(process.env.CDP_PORT ?? 9371);
const SHOTS = process.env.SHOTS;
const ONLY = new Set(process.argv.slice(2).map((s) => s.toUpperCase()));
const VIEW = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
};

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const { cookie, uid } = await login(B);

// ---------------------------------------------------------------- Chrome (một tab; khung iframe sandbox chạy ở tiến trình riêng: phiên gắn tự động)
const PROF = `${tmpdir()}/synchro-ui/chrome-prof-h1-chatui`;
rmSync(PROF, { recursive: true, force: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 60 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
if (!ver) { chrome.kill(); throw new Error("Chrome không mở được"); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const waits = new Map(), frames = new Map(), jsErr = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [y, n] = waits.get(m.id); waits.delete(m.id); m.error ? n(new Error(JSON.stringify(m.error))) : y(m.result); return; }
  if (m.method === "Target.attachedToTarget" && m.params.targetInfo?.type === "iframe") frames.set(m.params.sessionId, m.params.targetInfo.targetId);
  if (m.method === "Target.detachedFromTarget") frames.delete(m.params.sessionId);
  if (m.method === "Runtime.exceptionThrown" && !m.sessionId?.length) jsErr.push((m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "").split("\n")[0]);
});
const send = (method, params = {}, sessionId) => new Promise((y, n) => {
  const id = ++seq;
  const tm = setTimeout(() => { waits.delete(id); n(new Error("Chrome không trả lời: " + method)); }, 90_000);
  waits.set(id, [(v) => { clearTimeout(tm); y(v); }, (err) => { clearTimeout(tm); n(err); }]);
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (m, p) => send(m, p, S);
await P("Page.enable"); await P("Runtime.enable"); await P("Network.enable");
await P("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
// Ghi clipboard của trang (cả trong khung artifact: cầu nối cho phép clipboard-write): đếm mọi lần gọi, kể cả document.execCommand("copy").
const CLIP_SPY = `(() => { if (window.__clip) return; window.__clip = []; const n = navigator.clipboard; if (n) { for (const k of ["writeText", "write"]) { const f = n[k]?.bind(n); if (f) n[k] = (...a) => { window.__clip.push(k); return f(...a).catch(() => {}); }; } }
  const ex = document.execCommand.bind(document); document.execCommand = (c, ...a) => { if (/^(copy|cut)$/i.test(c)) window.__clip.push(c); return ex(c, ...a); }; })()`;
await P("Page.addScriptToEvaluateOnNewDocument", { source: CLIP_SPY });

const ev = async (expr) => {
  const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
const mouse = async (x, y) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const pos = async (expr) => ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
const click = async (expr, what = expr) => { const r = await pos(expr); if (!r) throw new Error("không thấy: " + what); await mouse(r[0], r[1]); };
const key = async (k, code, vk) => { await P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(k === "Enter" ? { text: "\r" } : {}) }); await P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
const shot = async (name) => { if (!SHOTS) return; const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, "base64")); };
const setSize = async (size) => { await P("Emulation.setDeviceMetricsOverride", VIEW[size]); await sleep(300); };
let navN = 0;
const open = async (size, hash = "") => {
  await setSize(size);
  await P("Page.navigate", { url: "about:blank" }); await sleep(100);
  await P("Page.navigate", { url: `${B}/?h1c=${++navN}${hash}` });
  if (!(await until(`!!document.querySelector("#main") && !!document.querySelector(".composer textarea")`, 40000))) throw new Error("app không mở được");
  await sleep(900);
};
// Khung bản trình bày lớn (iframe.deck-frame, sandbox, tiến trình riêng): tìm phiên gắn tự động của nó theo kích thước khung 1280×720 / số slide.
const deckEval = async (expr) => {
  for (const sid of [...frames.keys()].reverse()) {
    try {
      const r = await send("Runtime.evaluate", { expression: `(() => { if (window.__sxThumb || !window.__sxAll || !window.__sxAll().length) return null; return (${expr}); })()`, returnByValue: true, awaitPromise: true }, sid);
      if (!r.exceptionDetails && r.result.value != null) return r.result.value;
    } catch { /* khung đã đóng */ }
  }
  return null;
};
const NO_HSCROLL = `(document.scrollingElement.scrollWidth <= innerWidth + 1)`;

// ---------------------------------------------------------------- dữ liệu mẫu
const now = Date.now(), R = String(now % 100000);
const ids = { b7: now + 7, b9: now + 9, deck: now + 14 };
const xlsx = { id: `h1c${R}x`, name: "bang_luong_thang_11.xlsx", size: 8123, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
const pdf = { id: `h1c${R}p`, name: "bản xem trước.pdf", size: 40211, mime: "application/pdf" };
const b7Chat = { id: ids.b7, title: `H1 B7 ${R}`, msgs: [
  { role: "user", text: "Tạo file Excel bảng lương", time: ids.b7 },
  { role: "ai", done: true, time: ids.b7 + 1, outs: [xlsx, pdf],
    text: "Đã xong bảng lương tháng 11.\n\n- [Tải file Excel](sandbox:/outputs/bang_luong_thang_11.xlsx)\n- [Tải bản PDF xem trước](sandbox:/outputs/b%E1%BA%A3n%20xem%20tr%C6%B0%E1%BB%9Bc.pdf)\n- [Tệp không có](sandbox:/outputs/khong-co.csv)\n\nTổng thực lĩnh 68.965.000 đ." },
] };
// Bản trình bày bằng bộ thiết kế: nhiều ô chữ data-node-id tràn khung để bộ tự vá (co chữ, đổi màu chữ) có việc thật khi mỗi slide hiện ra.
const slide = (k, n, title) => `<section class="slide sx-slide" data-slide="${k}" style="padding:56px;box-sizing:border-box;height:100vh;overflow:hidden;background:${k % 2 ? "#F4EFE6" : "#1f2a44"};color:${k % 2 ? "#222" : "#ddd"}">
<p class="sx-eyebrow" data-node-id="s${k}.eyebrow">0${k} · ${title}</p><h2 class="sx-title" data-node-id="s${k}.title" style="font-size:64px">${title} ${k}</h2>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">${Array.from({ length: 48 }, (_, j) => `<div class="sx-card" data-node-id="s${k}.c${j}" style="font-size:22px;color:${j % 3 ? "#8a8a8a" : "#9aa"}">Mốc ${j + 1}: tăng trưởng đều mỗi tháng trên ${n} micro-hub</div>`).join("")}</div>
<footer data-node-id="s${k}.foot" style="position:absolute;bottom:24px">${String(k).padStart(2, "0")} / ${String(n).padStart(2, "0")}</footer></section>`;
const deckHtml = (n, title) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui}</style></head><body data-sx-preset="swiss-grid">
${Array.from({ length: n }, (_, k) => slide(k + 1, n, title)).join("\n")}
<script>addEventListener("keydown",function(e){if(e.key==="ArrowRight")void 0})</script></body></html>`;
const v1 = deckHtml(7, "Trà Một Chạm");
const b9Chat = { id: ids.b9, title: `H1 B9 ${R}`, msgs: [
  { role: "user", text: "Làm bộ slide gọi vốn 6 trang", time: ids.b9 },
  { role: "ai", done: true, time: ids.b9 + 1,
    text: `Bản đầu tiên:\n\n<artifact identifier="tra-mot-cham-deck" type="text/html" title="Trà Một Chạm — Deck gọi vốn 6 trang">\n${v1}\n</artifact>\n\nRút gọn còn 6 trang:\n\n<artifact identifier="tra-mot-cham-deck" mode="patch">\n<<<<<<< SEARCH\n${slide(7, 7, "Trà Một Chạm")}\n=======\n\n>>>>>>> REPLACE\n</artifact>\n\nĐã xong.` },
] };
const deckChat = { id: ids.deck, title: `H1 B14 ${R}`, msgs: [
  { role: "user", text: "Làm bộ slide 6 trang", time: ids.deck },
  { role: "ai", done: true, time: ids.deck + 1, text: `<artifact identifier="h1-deck-${R}" type="text/html" title="Deck kiểm thử ${R}">\n${deckHtml(6, "Lợi thế vận hành")}\n</artifact>\n\nBộ slide 6 trang đã xong.` },
] };
const SEEDS = [b7Chat, b9Chat, deckChat], SEED_IDS = SEEDS.map((c) => c.id);
// Đoạn chat B8 tạo bằng cách gửi tin thật: xóa cùng dữ liệu mẫu khi xong.
const unseed = async () => {
  await ev(idbDel(uid, SEED_IDS)).catch(() => {});
  await ev(`(() => { const k = "u:${uid}:chats", ids = new Set(${JSON.stringify(SEED_IDS)}); try { const cur = JSON.parse(localStorage.getItem(k) || "[]"); localStorage.setItem(k, JSON.stringify(cur.filter((c) => !ids.has(c.id)))); } catch {} return true; })()`).catch(() => {});
  const r = await fetch(B + "/api/chats", { method: "PUT", headers: { cookie, origin: B, "content-type": "application/json" }, body: JSON.stringify({ items: SEED_IDS.map((id) => ({ kind: "chat", id: String(id), upd: Date.now(), deleted: true })) }) }).catch(() => null);
  console.log(r?.ok ? `  (đã xóa ${SEED_IDS.length} đoạn chat mẫu)` : "  (cảnh báo: chưa xóa được đoạn chat mẫu trên máy chủ)");
};
const run = async (id, name, fn) => {
  if (ONLY.size && !ONLY.has(id)) return;
  console.log(`━━ ${id}: ${name}`);
  try { await fn(); } catch (e) { ok(false, `${id} chạy được tới cuối`, e.message.split("\n")[0]); await shot(`${id}-loi`).catch(() => {}); }
};
const lastAi = `[...document.querySelectorAll(".ai-msg")].at(-1)`;

try {
  await open("desktop");
  const { identifier: seedJs } = await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { if (location.origin !== ${JSON.stringify(B)}) return; const k = "u:${uid}:chats", seeds = ${JSON.stringify(SEEDS)}, ids = new Set(seeds.map((c) => c.id)); let cur = []; try { cur = JSON.parse(localStorage.getItem(k) || "[]"); } catch {} localStorage.setItem(k, JSON.stringify([...seeds, ...cur.filter((c) => !ids.has(c.id))])); })()` });
  await open("desktop");
  await P("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedJs });

  await run("B7", "link sandbox:/outputs/… thành link tải tệp", async () => {
    for (const size of ["desktop", "mobile"]) {
      await open(size, `#c=${ids.b7}`);
      ok(await until(`!!${lastAi}?.querySelector(".outs")`, 15000), `${size}: đoạn chat mẫu có thẻ tệp`);
      const r = await ev(`(() => { const m = ${lastAi}; const a = [...m.querySelectorAll("a.md-file")].map((x) => ({ href: x.getAttribute("href"), dl: x.getAttribute("download"), t: x.textContent.trim(), r: x.getBoundingClientRect().right, w: m.getBoundingClientRect().right }));
        const li = [...m.querySelectorAll("li")].map((x) => ({ t: x.textContent.trim(), a: !!x.querySelector("a") })); return { a, li }; })()`);
      const xl = r.a.find((x) => x.t === "Tải file Excel"), pd = r.a.find((x) => x.t === "Tải bản PDF xem trước");
      ok(xl?.href === `/api/outputs/${xlsx.id}` && xl.dl === xlsx.name, `${size}: "Tải file Excel" tải đúng tệp ${xlsx.name}`, r);
      ok(pd?.href === `/api/outputs/${pdf.id}` && pd.dl === pdf.name, `${size}: tên tệp có dấu cách / chữ có dấu (đã mã hóa %20) vẫn khớp thẻ tệp`, r);
      ok(r.li.find((x) => x.t === "Tệp không có")?.a === false && r.a.length === 2, `${size}: tệp không có thẻ: chỉ hiện chữ, không link hỏng`, r);
      ok(r.a.every((x) => x.r <= x.w + 1) && (await ev(NO_HSCROLL)), `${size}: link nằm trong khung tin nhắn, không tràn ngang`, r.a);
      const head = await fetch(`${B}/api/outputs/${xlsx.id}`, { headers: { cookie } }).then((x) => x.status).catch(() => 0);
      ok(head === 404 || head === 200, `${size}: đường tải /api/outputs/<id> tồn tại (tệp mẫu không có thật: ${head})`);
      await shot(`B7-${size}`);
    }
  });

  await run("B9", "bản đầy đủ + bản sửa trong một câu trả lời: một thẻ, phiên bản mới nhất", async () => {
    for (const size of ["desktop", "mobile"]) {
      await open(size, `#c=${ids.b9}`);
      ok(await until(`${lastAi}?.querySelectorAll(".art-card").length > 0`, 15000), `${size}: có thẻ artifact`);
      const cards = await ev(`[...${lastAi}.querySelectorAll(".art-card")].map((c) => c.textContent.replace(/\\s+/g, " ").trim())`);
      ok(cards.length === 1, `${size}: đúng một thẻ cho một artifact (trước đây 2 thẻ cùng "Phiên bản 1")`, cards);
      ok(/(Phiên bản|Version) 2\b/.test(cards[0] ?? "") && !/(Phiên bản|Version) 1\b/.test(cards[0] ?? ""), `${size}: thẻ ghi phiên bản 2 (bản sửa)`, cards);
      const texts = await ev(`[...${lastAi}.querySelectorAll("p")].map((p) => p.textContent.trim())`);
      ok(texts.includes("Bản đầu tiên:") && texts.includes("Rút gọn còn 6 trang:") && texts.includes("Đã xong."), `${size}: chữ quanh hai khối artifact vẫn giữ nguyên`, texts);
      await click(`${lastAi}.querySelector(".art-card")`, "thẻ artifact");
      ok(await until(`/\\b2\\/2\\b/.test(document.querySelector(".art-panel .art-ver")?.textContent || "")`, 15000), `${size}: bấm thẻ mở phiên bản 2/2 (mới nhất), không phải 1/2`, await ev(`document.querySelector(".art-panel .art-ver")?.textContent`));
      ok(await until(`/Slide\\s*1\\s*\\/\\s*6/.test(document.querySelector(".art-panel .deck-count")?.textContent || "")`, 20000), `${size}: bản mở ra là bản 6 slide`, await ev(`document.querySelector(".art-panel .deck-count")?.textContent`));
      ok(await ev(NO_HSCROLL), `${size}: không tràn ngang`);
      await shot(`B9-${size}`);
    }
  });

  await run("B14", "khung xem bản trình bày: không chậm một slide, không ghi clipboard; khung hẹp không cắt slide", async () => {
    for (const size of ["desktop", "mobile"]) {
      await open(size, `#c=${ids.deck}`);
      await click(`${lastAi}.querySelector(".art-card")`, "thẻ bản trình bày");
      ok(await until(`/Slide\\s*1\\s*\\/\\s*6/.test(document.querySelector(".art-panel .deck-count")?.textContent || "")`, 25000), `${size}: khung xem có 6 slide`);
      await sleep(1500);
      // Khung lớn dựng đúng 1280×720 và thu nhỏ vừa khung xem (B14b).
      const fit = await ev(`(() => { const s = document.querySelector(".art-panel .deck-stage"), f = s?.querySelector("iframe.deck-frame"); if (!f) return null; const a = s.getBoundingClientRect(), b = f.getBoundingClientRect(); return { sw: a.width, sh: a.height, fw: b.width, fh: b.height, dl: b.left - a.left, dt: b.top - a.top, w: f.offsetWidth, h: f.offsetHeight }; })()`);
      ok(fit && fit.w === 1280 && fit.h === 720, `${size}: khung slide dựng đúng 1280×720`, fit);
      ok(fit && Math.abs(fit.fw - fit.sw) <= 2 && Math.abs(fit.fh - fit.sh) <= 2 && Math.abs(fit.dl) <= 1 && Math.abs(fit.dt) <= 1, `${size}: thu nhỏ vừa khung xem (${fit && Math.round(fit.sw)}×${fit && Math.round(fit.sh)}), không cắt`, fit);
      const inner = await deckEval(`(() => { const s = window.__sxAll()[window.__sxIdx()], r = s.getBoundingClientRect(), foot = s.querySelector("footer").getBoundingClientRect(); return { iw: innerWidth, ih: innerHeight, bottom: Math.round(r.bottom), foot: Math.round(foot.bottom) }; })()`);
      ok(inner && inner.iw === 1280 && inner.ih === 720 && inner.bottom <= 720 && inner.foot <= 720, `${size}: trong khung: viewport 1280×720, chân slide nằm trong khung`, inner);
      await shot(`B14-${size}-fit`);
      if (size === "desktop") {
        // Đo thời gian từ lúc khung nhận lệnh chuyển slide tới lần vẽ đầu có slide mới (rAF rồi setTimeout: sau lần vẽ đó).
        await deckEval(`(() => { const g = window.__sxGo; window.__lag = []; window.__sxGo = function (i) { const t0 = performance.now(); g(i); requestAnimationFrame(() => setTimeout(() => window.__lag.push(Math.round(performance.now() - t0)), 0)); }; return 1; })()`);
        await ev(`window.__clip = []`);
        const next = `document.querySelector(".art-panel .deck-bar button[aria-label='Slide sau']")`;
        const nx = await pos(next);
        for (let k = 0; k < 3; k++) { await mouse(nx[0], nx[1]); await sleep(60); }
        ok(await until(`/Slide\\s*4\\s*\\/\\s*6/.test(document.querySelector(".art-panel .deck-count")?.textContent || "")`, 8000), "bấm “Slide sau” 3 lần liền: nhãn tới Slide 4 / 6", await ev(`document.querySelector(".art-panel .deck-count")?.textContent`));
        await sleep(2500);
        const st = await deckEval(`({ idx: window.__sxIdx(), lag: window.__lag })`);
        ok(st?.idx === 3, "khung lớn cũng ở slide 4 (khớp nhãn)", st);
        const worst = Math.max(...(st?.lag ?? [99999]));
        ok(st?.lag?.length >= 3 && worst <= 250, `slide mới hiện ra trong ≤ 250 ms sau lệnh chuyển (chậm nhất ${worst} ms; trước đây bộ tự vá chạy trước lần vẽ)`, st);
        const fitted = await deckEval(`document.querySelectorAll("[data-sx-fitok]").length`);
        ok(fitted >= 3, "bộ tự vá vẫn chạy cho từng slide đã xem (sau lần vẽ)", fitted);
        const pv = `document.querySelector(".art-panel .deck-bar button[aria-label='Slide trước']")`;
        const pp = await pos(pv);
        for (let k = 0; k < 2; k++) { await mouse(pp[0], pp[1]); await sleep(80); }
        ok(await until(`/Slide\\s*2\\s*\\/\\s*6/.test(document.querySelector(".art-panel .deck-count")?.textContent || "")`, 8000), "bấm “Slide trước” 2 lần: về Slide 2 / 6");
        await sleep(400);
        const clipFrame = await deckEval(`(window.__clip || []).length`);
        ok((await ev(`window.__clip.length`)) === 0 && !clipFrame, "mũi tên tới / lùi không ghi clipboard (trang và khung)", { page: await ev(`window.__clip`), frame: clipFrame });
        // Thử lại ở câu trả lời cuối: gửi lại tin, không ghi clipboard.
        await click(`document.querySelector(".art-panel button[aria-label='Đóng']")`, "đóng khung xem");
        await sleep(400);
        await ev(`window.__clip = []`);
        // Nút không xê dịch khi rê chuột vào tin nhắn (bấm theo tọa độ không trúng nút Sao chép bên cạnh).
        const RETRY = `[...document.querySelectorAll(".actions.in button[aria-label='Thử lại']")].at(-1)`;
        const r0 = await ev(`(() => { const b = ${RETRY}; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; })()`);
        await P("Input.dispatchMouseEvent", { type: "mouseMoved", x: r0[0] + 8, y: r0[1] + 8 }); await sleep(400);
        const r1 = await ev(`(() => { const r = ${RETRY}.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; })()`);
        ok(r0[0] === r1[0] && r0[1] === r1[1], "nút Thử lại đứng yên khi rê chuột tới", { r0, r1 });
        await click(RETRY, "nút Thử lại");
        await sleep(1500);
        ok((await ev(`window.__clip.length`)) === 0, "nút Thử lại không ghi clipboard", await ev(`window.__clip`));
        await until(`!document.querySelector(".wl-status")`, 60000);
        await shot(`B14-${size}-after`);
      } else {
        ok(await ev(NO_HSCROLL), "390px: không tràn ngang khi mở bản trình bày");
      }
    }
  });

  await run("B8", "danh sách việc cập nhật ngay trong lượt (update_plan dựng sẵn của Codex)", async () => {
    const models = await fetch(`${B}/api/models`, { headers: { cookie } }).then((r) => r.json()).catch(() => null);
    const cx = (models?.providers ?? []).flatMap((p) => p.models ?? []).map((m) => m.key ?? m.id).find((k) => /^sub-codex\//.test(k ?? ""));
    if (!cx) { ok(false, "tài khoản mock có gói ChatGPT (sub-codex/…)", models?.providers?.map((p) => p.id)); return; }
    for (const size of ["desktop", "mobile"]) {
      await open(size);
      await ev(`localStorage.setItem("u:${uid}:model", ${JSON.stringify(cx)})`);
      await open(size);
      await click(`document.querySelector(".composer textarea")`, "ô soạn tin");
      await P("Input.insertText", { text: `[mock:nativeplan] Tạo file Excel bảng lương ${R} ${size}` });
      await key("Enter", "Enter", 13);
      const seen = [], t0 = Date.now();
      let spinAt = new Set(), wide = [];
      while (Date.now() - t0 < 30000) {
        const s = await ev(`(() => { const p = document.querySelector(".ai-msg .wl-plan"); const live = !!document.querySelector(".wl-status"); if (!p) return { live };
          const items = [...p.querySelectorAll(".wl-pi")]; const r = p.getBoundingClientRect();
          return { live, head: p.querySelector(".wl-plan-h span")?.textContent, spin: items.findIndex((x) => !!x.querySelector(".wl-spin")), right: r.right, vw: innerWidth }; })()`).catch(() => ({}));
        if (s.head && s.live && seen.at(-1)?.head !== s.head) seen.push({ head: s.head, ms: Date.now() - t0 });
        if (s.head && s.live) { spinAt.add(s.spin); if (s.right > s.vw + 1) wide.push(s.right); }
        if (seen.length && !s.live) break;
        await sleep(100);
      }
      const heads = seen.map((x) => x.head);
      ok(["0/3", "1/3", "2/3"].every((h) => heads.includes(h)), `${size}: lúc đang chạy thấy "0/3" → "1/3" → "2/3" (không đứng yên tới cuối)`, seen);
      ok([0, 1, 2].every((k) => spinAt.has(k)), `${size}: vòng xoay chuyển theo việc đang làm (việc 1 → 2 → 3)`, [...spinAt]);
      ok(!wide.length, `${size}: danh sách việc nằm trong màn hình`, wide);
      ok(await until(`/3\\/3/.test(${lastAi}?.querySelector(".wl-sum-h")?.textContent || "")`, 15000), `${size}: xong lượt: tổng kết "3/3"`, await ev(`${lastAi}?.querySelector(".wl-sum-h")?.textContent`));
      await shot(`B8-${size}`);
      const made = await ev(`Number((/#c=(\\d+)/.exec(location.hash) || [])[1] || 0)`);
      if (made) SEED_IDS.push(made);
    }
  });

  ok(!jsErr.length, "không có lỗi JavaScript trên trang", jsErr.slice(0, 5));
} finally {
  await ev(`localStorage.removeItem("u:${uid}:model")`).catch(() => {});
  await unseed().catch((e) => console.log(`  (cảnh báo: ${e.message})`));
  try { ws.close(); } catch {}
  chrome.kill();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
