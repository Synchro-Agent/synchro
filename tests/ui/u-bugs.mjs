// Một phép thử giao diện cho mỗi lỗi U2–U14 của blueprint (mục 3, nghiệm thu B1.14), chạy thật trong Chrome ẩn trên npm run dev:mock.
// Mỗi ca dựng đúng tình huống người dùng gặp (7 tệp đính kèm, 24 đoạn chat, gõ ngay sau ⌘K, nút Back…) rồi đo trên trang thật ở các
// chiều rộng blueprint nêu (390 / 768 / 1440px). Chạy tay: BASE=http://localhost:3200 node tests/ui/u-bugs.mjs [U3 U6 …]
// THEME=dark: chạy ở giao diện tối. SHOTS=<thư mục>: lưu ảnh từng ca để xem bằng mắt.
// Ca nào không dựng được tình huống trên máy giả lập (vd. model giả lập không tạo ra tệp Excel) thì báo "bỏ qua", không tính đạt.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { login, sleep } from "../lib/cdp.mjs";
import { idbDel } from "../lib/idbchats.mjs";

const B = process.env.BASE ?? process.env.SYNCHRO_URL ?? "http://localhost:3200";
const PORT = Number(process.env.CDP_PORT ?? 9364);
const THEME = process.env.THEME === "dark" ? "dark" : "light";
const SHOTS = process.env.SHOTS;
const ONLY = new Set(process.argv.slice(2).map((s) => s.toUpperCase()));
// Ba chiều rộng của blueprint; máy tính bảng không giả lập cảm ứng (cửa sổ hẹp trên máy tính / iPad có bàn phím).
const VIEW = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  tablet: { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
};

let pass = 0, fail = 0, skip = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); };
const skipped = (n, why) => { skip++; console.log("  –", n, `(bỏ qua: ${why})`); };

const { cookie, uid } = await login(B);

// ---------------------------------------------------------------- Chrome (một tab, có phiên phụ cho khung iframe chạy ở tiến trình riêng)
const PROF = `${tmpdir()}/synchro-ui/chrome-prof-u-bugs`;
rmSync(PROF, { recursive: true, force: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 60 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
if (!ver) { chrome.kill(); throw new Error("Chrome không mở được"); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const waits = new Map(), hooks = new Map(), frames = new Set(), jsErr = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [y, n] = waits.get(m.id); waits.delete(m.id); m.error ? n(new Error(JSON.stringify(m.error))) : y(m.result); return; }
  if (m.method === "Target.attachedToTarget" && m.params.targetInfo?.type === "iframe") frames.add(m.params.sessionId);
  if (m.method === "Target.detachedFromTarget") frames.delete(m.params.sessionId);
  if (m.method === "Runtime.exceptionThrown") jsErr.push((m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "").split("\n")[0]);
  for (const f of hooks.get(m.method) ?? []) f(m.params, m.sessionId);
});
const on = (method, f) => { if (!hooks.has(method)) hooks.set(method, []); hooks.get(method).push(f); };
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
await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: THEME }] });
await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("theme", ${JSON.stringify(THEME)}); } catch {}` });

const ev = async (expr) => {
  const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; };
const mouse = async (x, y) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
// Bấm như người dùng: chuột thật vào giữa phần tử (không gọi .click(): lớp phủ che thì cú bấm trúng lớp phủ, đúng như người dùng gặp).
const click = async (expr, what = expr) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("không thấy: " + what);
  await mouse(r[0], r[1]);
};
const key = async (k, code, vk, mods = 0, text) => {
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(text ? { text, unmodifiedText: text } : {}) });
  await P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
};
const esc = () => key("Escape", "Escape", 27);
const shot = async (name) => { if (!SHOTS) return; const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${THEME}-${name}.png`, Buffer.from(data, "base64")); };
const setSize = async (size) => {
  const v = typeof size === "string" ? VIEW[size] : size;
  await P("Emulation.setDeviceMetricsOverride", v);
  await sleep(300);
};
// Mở app từ đầu (tải lại hẳn trang) ở cỡ màn hình size, kèm địa chỉ #… nếu có.
let navN = 0;
const home = async (size, hash = "") => {
  await setSize(size);
  await P("Page.navigate", { url: "about:blank" }); await sleep(100);
  await P("Page.navigate", { url: `${B}/?ub=${++navN}${hash}` });
  if (!(await until(`!!document.querySelector("#main") && !!document.querySelector(".rail")`, 40000))) throw new Error("app không mở được");
  await sleep(900);
};
// Chạy biểu thức trong khung iframe (khung xem tệp Office: srcdoc, sandbox): cùng tiến trình thì qua thế giới cô lập của khung,
// khác tiến trình (Chrome tách iframe sandbox) thì qua phiên gắn tự động của khung đó.
const frameEval = async (expr) => {
  const { frameTree } = await P("Page.getFrameTree");
  const list = []; const walk = (n) => { for (const c of n.childFrames ?? []) { list.push(c.frame.id); walk(c); } }; walk(frameTree);
  for (const frameId of list) {
    try {
      const { executionContextId } = await P("Page.createIsolatedWorld", { frameId, worldName: "u-bugs" });
      const r = await P("Runtime.evaluate", { expression: expr, contextId: executionContextId, returnByValue: true });
      if (!r.exceptionDetails && r.result.value != null) return r.result.value;
    } catch { /* khung ở tiến trình khác */ }
  }
  for (const sid of frames) {
    try { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid); if (!r.exceptionDetails && r.result.value != null) return r.result.value; } catch { /* khung đã đóng */ }
  }
  return null;
};
// Phần tử đang thật sự nhìn thấy (không display:none, không hidden, có kích thước, trong màn hình).
const VIS = `((el) => { if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; })`;
const RED = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c ?? ""); if (!m) return false; const [r, g, b] = m[1].split(/[,\s/]+/).map(Number); return r > g + 40 && r > b + 40; };

// ---------------------------------------------------------------- dữ liệu mẫu: 24 đoạn chat (U3, U4) và một đoạn chat có bảng, nguồn web, sơ đồ, công cụ lỗi (U9–U13)
const now = Date.now(), R = String(now % 100000);
const MD_ID = now + 500, MD_TITLE = `U-bugs ${R}`;
const fillers = Array.from({ length: 24 }, (_, i) => {
  const id = now - (i + 1) * 1000;
  return { id, title: `U4 ${R} · ${String(i + 1).padStart(2, "0")}`, msgs: [{ role: "user", text: `Câu hỏi ${i + 1}`, time: id }, { role: "ai", text: `Trả lời ${i + 1}.`, done: true, time: id + 1 }] };
});
const T = MD_ID;
const mdChat = {
  id: MD_ID, title: MD_TITLE, msgs: [
    { role: "user", text: "Liệt kê các tệp", time: T },
    { role: "ai", done: true, time: T + 1, text: "| Tệp | Mô tả |\n|---|---|\n| hoa-don.png | Hóa đơn tháng mười của khách hàng, kèm một ghi chú thật dài để cột thứ hai chiếm gần hết chỗ và ép cột đầu tiên hẹp lại hết mức có thể |\n| Hóa đơn tháng 10 | Ô có khoảng trắng vẫn ngắt dòng bình thường |" },
    { role: "user", text: "Tìm trên web", time: T + 2 },
    { role: "ai", done: true, time: T + 3, text: "Theo các nguồn bên dưới, đây là tóm tắt.", webs: [
      { title: "Không có biểu tượng", url: "https://noicon.example/a" },
      ...Array.from({ length: 8 }, (_, i) => ({ title: `Nguồn ${i + 2}`, url: `https://site${i + 2}.example/bai-${i + 2}` })),
    ] },
    { role: "user", text: "Vẽ sơ đồ", time: T + 4 },
    { role: "ai", done: true, time: T + 5, text: "```mermaid\ngraph TD\n  A[Bắt đầu] --> B[Thu thập yêu cầu]\n  B --> C[Phân tích]\n  C --> D[Thiết kế]\n  D --> E[Lập trình]\n  E --> F[Kiểm thử]\n  F --> G[Triển khai]\n  G --> H[Theo dõi]\n  H --> I[Kết thúc]\n```" },
    { role: "user", text: "Lấy dữ liệu", time: T + 6 },
    { role: "ai", done: true, time: T + 7, dur: 64000, text: "Đã lấy xong dữ liệu.", parts: [{ k: "tools", items: [{ seq: 1, label: "fetch", ok: false }, { seq: 2, label: "fetch", ok: true }, { seq: 3, label: "write", ok: true }] }] },
    { role: "user", text: "Ghi tệp", time: T + 8 },
    { role: "ai", done: true, time: T + 9, dur: 5000, text: "Đã ghi tệp.", parts: [{ k: "tools", items: [{ seq: 1, label: "fetch", ok: false }, { seq: 2, label: "write", ok: true }] }] },
  ],
};
const SEEDS = [mdChat, ...fillers];
const SEED_IDS = SEEDS.map((c) => c.id);
// Dọn dữ liệu mẫu khi xong (kể cả khi lỗi giữa chừng): mỗi lần chạy gieo 25 đoạn chat id mới vào tài khoản quản trị dùng chung, không dọn thì
// danh sách và thanh phân trang của audit.mjs, popovers.mjs, skeletons… cứ dài thêm sau mỗi lần chạy. Bỏ khỏi bộ nhớ của trình duyệt (để app
// không đẩy lại lên máy chủ) rồi xóa trên máy chủ qua đường đồng bộ của app (PUT /api/chats, deleted), như người dùng xóa đoạn chat.
// Đoạn chat của thiết bị nằm trong kho IndexedDB (app/chatidb.ts): bỏ cả ở đó, và ở khóa cũ (không thì lần mở sau nhập lại).
const unseedBrowser = async () => { await ev(idbDel(uid, SEED_IDS)); return ev(`(() => { const k = "u:${uid}:chats", ids = new Set(${JSON.stringify(SEED_IDS)}); try { const cur = JSON.parse(localStorage.getItem(k) || "[]"); localStorage.setItem(k, JSON.stringify(cur.filter((c) => !ids.has(c.id)))); } catch {} return true; })()`); };
const unseedServer = async () => {
  const r = await fetch(B + "/api/chats", { method: "PUT", headers: { cookie, origin: B, "content-type": "application/json" }, body: JSON.stringify({ items: SEED_IDS.map((id) => ({ kind: "chat", id: String(id), upd: Date.now(), deleted: true })) }) });
  const j = await r.json().catch(() => null);
  const left = (j?.results ?? []).filter((x) => !x.ok || !x.deleted).map((x) => x.id);
  if (!r.ok || left.length || (j?.results?.length ?? 0) !== SEED_IDS.length) console.log(`  (cảnh báo: chưa xóa hết đoạn chat mẫu trên máy chủ: ${r.status} ${left.join(",")})`);
  else console.log(`  (đã xóa ${SEED_IDS.length} đoạn chat mẫu)`);
};
const row = (title) => `[...document.querySelectorAll(".chat-wrap")].find((w) => w.querySelector(".ct-t")?.textContent === ${JSON.stringify(title)})`;
const panelSel = (size) => (size === "mobile" ? ".app>.shell-side" : ".app aside.sidebar");
const isClosed = `!!document.querySelector(".shell-side.closed")`;
const openPanel = async () => {
  if (!(await ev(isClosed))) return;
  await click(`[...document.querySelectorAll(".side-toggle,.rail-mark")].find((e) => ${VIS}(e))`, "nút mở thanh bên");
  await until(`!${isClosed}`, 3000); await sleep(450);
};

const run = async (id, name, fn) => {
  if (ONLY.size && !ONLY.has(id)) return;
  console.log(`━━ ${id}: ${name}`);
  try { await fn(); } catch (e) { ok(false, `${id} chạy được tới cuối`, e.message.split("\n")[0]); await shot(`${id}-loi`).catch(() => {}); }
};

try {
  // Gieo dữ liệu mẫu vào trình duyệt (đồng bộ lên máy chủ như đoạn chat thật), giữ nguyên đoạn chat sẵn có. Gieo bằng lệnh chạy trước mã
  // của trang ở lần mở sau: ghi thẳng vào trang đang mở thì lúc rời trang app có thể lưu lại danh sách trong bộ nhớ của nó (đã có đoạn chat
  // của máy chủ) đè mất phần vừa gieo.
  await home("desktop");
  const { identifier: seedJs } = await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { if (location.origin !== ${JSON.stringify(B)}) return; const k = "u:${uid}:chats", seeds = ${JSON.stringify(SEEDS)}, ids = new Set(seeds.map((c) => c.id)); let cur = []; try { cur = JSON.parse(localStorage.getItem(k) || "[]"); } catch {} localStorage.setItem(k, JSON.stringify([...seeds, ...cur.filter((c) => !ids.has(c.id))])); })()` });
  await home("desktop");
  await P("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedJs });
  if (!(await until(`!!${row(MD_TITLE)}`, 20000))) console.log("  (cảnh báo: chưa thấy đoạn chat mẫu ở thanh bên)");

  // U2 — 7 tệp đính kèm: "+N" luôn thấy được bên trong ô soạn ở cả ba chiều rộng; không thẻ nào bị cắt; bấm "+N" thì trải lưới, không thẻ nào
  // bị cắt ngang; bỏ bớt tệp rồi thêm lại thì dải về một hàng (không nhớ trạng thái trải lưới cũ).
  await run("U2", "dải thẻ tệp với 7 tệp", async () => {
    const dir = `${tmpdir()}/synchro-ui/u-bugs-files`; mkdirSync(dir, { recursive: true });
    const files = Array.from({ length: 10 }, (_, i) => { const f = `${dir}/tep-dinh-kem-${i + 1}.txt`; writeFileSync(f, `Tệp thử số ${i + 1}\n`); return f; });
    const attach = async (list) => {
      const inp = await P("Runtime.evaluate", { expression: `document.querySelector(".main input[type=file][multiple]") || document.querySelector("input[type=file][multiple]")` });
      if (!inp.result.objectId) throw new Error("không thấy ô chọn tệp của ô soạn");
      await P("DOM.setFileInputFiles", { files: list, objectId: inp.result.objectId });
    };
    // Mép mờ 18px chỉ tính theo chiều ngang khi lớp mờ là dải ngang (90deg); lưới đã trải mờ mép trên / dưới (180deg), không cắt thẻ theo chiều ngang.
    const STRIP = `(() => { const a = document.querySelector(".composer .attach:not(.sent)"); if (!a) return null; const m = a.querySelector(":scope>.attach-more"), C = a.closest(".composer").getBoundingClientRect(), A = a.getBoundingClientRect();
      const cs = getComputedStyle(a), mask = (cs.maskImage && cs.maskImage !== "none" ? cs.maskImage : cs.webkitMaskImage) || "none", fade = /gradient\\(90deg/.test(mask) ? 18 : 0;
      const cards = [...a.children].filter((k) => k !== m && k.matches(".ft,.pick-chip"));
      const vis = cards.filter((k) => k.getBoundingClientRect().width > 0);
      const where = (k) => { const q = k.getBoundingClientRect(); if (q.left >= A.left + fade - 0.5 && q.right <= A.right - fade + 0.5 && q.top >= A.top - 0.5 && q.bottom <= A.bottom + 0.5) return "in"; return q.right <= A.left || q.left >= A.right || q.bottom <= A.top || q.top >= A.bottom ? "out" : "cut"; };
      const cut = vis.filter((k) => where(k) === "cut").map((k) => k.textContent.trim().slice(0, 20)), out = vis.filter((k) => where(k) === "out").length;
      let more = null;
      if (m) { const M = m.getBoundingClientRect(), hit = document.elementFromPoint(M.left + M.width / 2, M.top + M.height / 2);
        more = { text: m.textContent.trim(), label: m.getAttribute("aria-label") || "", inComposer: M.left >= C.left - 0.5 && M.right <= C.right + 0.5 && M.top >= C.top - 0.5 && M.bottom <= C.bottom + 0.5 && M.right <= innerWidth,
          inStrip: M.left >= A.left + fade - 0.5 && M.right <= A.right - fade + 0.5, hit: !!hit && (hit === m || m.contains(hit)) }; }
      // rendered: thẻ đang dựng (thẻ gom vào "+N" không dựng); hidden: số "+N" nói đang ẩn.
      return { grid: a.classList.contains("attach-grid"), rendered: cards.length, shown: vis.length, hidden: m ? Number(m.textContent.trim().replace(/^\\+/, "")) || 0 : 0, cut, out, more, mask, overflow: a.scrollWidth > a.clientWidth + 1 }; })()`;
    const clear = async () => { for (let i = 0; i < 15 && (await ev(`!!document.querySelector(".composer .attach .ft-x")`)); i++) { await click(`document.querySelector(".composer .attach .ft-x")`, "nút xóa tệp"); await sleep(200); } };
    for (const size of ["mobile", "tablet", "desktop"]) {
      await home(size);
      await clear();
      await attach(files.slice(0, 7));
      await until(`!!document.querySelector(".composer .attach .attach-more")`, 8000);
      const s = await ev(STRIP);
      ok(s && s.more, `${size}: 7 tệp → dải có nút “+N”`, s);
      if (!s?.more) { await clear(); continue; }
      ok(s.rendered + s.hidden === 7 && s.shown === s.rendered, `${size}: “${s.more.text}” cộng ${s.rendered} thẻ đang hiện đúng bằng 7 tệp`, s);
      ok(s.more.inComposer && s.more.inStrip && s.more.hit, `${size}: “+N” nằm trọn trong ô soạn, không bị mép mờ hay phần tử khác che, bấm được`, s.more);
      ok(!s.cut.length && !s.out, `${size}: thẻ nào đang dựng cũng hiện trọn (không bị mép dải cắt, không khuất ngoài dải)`, s);
      ok(s.overflow || s.mask === "none", `${size}: dải không tràn thì không phủ mép mờ (thẻ đầu, nút xóa của thẻ cuối rõ nét)`, s.mask);
      await shot(`U2-${size}-strip`);
      await click(`document.querySelector(".composer .attach .attach-more")`, "+N");
      await sleep(500);
      const g = await ev(STRIP);
      ok(g?.grid && !g.more && g.rendered === 7, `${size}: bấm “+N” → lưới dựng đủ 7 thẻ`, g);
      ok(g && !g.cut.length, `${size}: lưới không cắt ngang thẻ nào (hàng nào hiện là hiện trọn)`, g?.cut);
      await shot(`U2-${size}-grid`);
      // Bỏ 3 tệp (còn 4) rồi thêm 3 tệp mới: lại là dải một hàng có “+N”, không bung sẵn lưới.
      for (let i = 0; i < 3; i++) { await click(`document.querySelector(".composer .attach .ft-x")`, "nút xóa tệp"); await sleep(250); }
      await attach(files.slice(7, 10));
      await until(`!!document.querySelector(".composer .attach .attach-more") || document.querySelectorAll(".composer .attach .ft").length >= 7`, 8000); await sleep(300);
      const again = await ev(STRIP);
      ok(again && !again.grid && !!again.more && again.rendered + again.hidden === 7, `${size}: bỏ bớt rồi thêm lại tới 7 tệp → về dải một hàng có “+N”`, again);
      await clear();
    }
  });

  // U3 — dưới 860px thanh đoạn chat mặc định đóng; mở ra là lớp nổi trên lớp phủ tối (không đẩy nội dung, không bị lớp phủ che);
  // chọn một đoạn chat thì mở đúng đoạn chat và thanh tự đóng; bấm lớp phủ thì đóng.
  await run("U3", "thanh đoạn chat nổi dưới 860px", async () => {
    for (const size of ["tablet", "mobile"]) {
      const W = VIEW[size].width, H = VIEW[size].height, panel = panelSel(size);
      await home(size);
      ok(await ev(isClosed), `${size}: mở app → thanh đoạn chat đang đóng`);
      const main0 = await ev(`(() => { const m = document.querySelector("#main").getBoundingClientRect(); const t = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2); return { left: Math.round(m.left), free: !!t && !!t.closest("#main") }; })()`);
      ok(main0.free, `${size}: khi đóng, nội dung chat không bị gì che`, main0);
      await openPanel();
      const st = await ev(`(() => { const p = document.querySelector(${JSON.stringify(panel)}), r = p.getBoundingClientRect(), s = document.querySelector(".side-scrim"), m = document.querySelector("#main").getBoundingClientRect();
        let covered = 0, n = 0; for (let x = Math.max(r.left, 0) + 16; x < Math.min(r.right, innerWidth) - 8; x += 40) for (let y = r.top + 40; y < r.bottom - 20; y += 80) { n++; const t = document.elementFromPoint(x, y); if (!t || !p.contains(t)) covered++; }
        const out = document.elementFromPoint(innerWidth - 20, innerHeight / 2);
        return { open: !document.querySelector(".shell-side.closed"), w: Math.round(r.width), scrim: !!s && ${VIS}(s), scrimHit: !!out && !!out.closest(".side-scrim"), covered, n, mainLeft: Math.round(m.left) }; })()`);
      ok(st.open && st.w > 150, `${size}: bấm nút mở → thanh hiện ra`, st);
      ok(st.scrim && st.scrimHit, `${size}: có lớp phủ tối phủ phần còn lại của màn hình`, st);
      ok(st.covered === 0, `${size}: thanh nằm trên lớp phủ (không bị phủ xám, bấm được)`, st);
      ok(Math.abs(st.mainLeft - main0.left) <= 1, `${size}: thanh nổi đè lên, không đẩy nội dung chat sang phải`, { trước: main0.left, sau: st.mainLeft });
      await shot(`U3-${size}-open`);
      await click(`${row(MD_TITLE)}?.querySelector(".chat-item")`, "đoạn chat mẫu");
      const picked = await until(`${isClosed} && !document.querySelector(".side-scrim") && location.hash === "#c=${MD_ID}"`, 4000);
      ok(picked, `${size}: chọn một đoạn chat → mở đúng đoạn chat đó, thanh và lớp phủ đóng`, await ev(`({ hash: location.hash, closed: ${isClosed}, scrim: !!document.querySelector(".side-scrim") })`));
      await openPanel();
      await mouse(W - 20, Math.round(H / 2));
      ok(await until(`${isClosed} && !document.querySelector(".side-scrim")`, 3000), `${size}: bấm lớp phủ → thanh đóng`);
    }
  });

  // U4 — gập mục "Đoạn chat và tác vụ" thì cả danh sách lẫn thanh phân trang "1-20/…" cùng ẩn.
  await run("U4", "gập mục ẩn cả thanh phân trang", async () => {
    await home("desktop");
    const SEC = `[...document.querySelectorAll(".sec-btn")].find((b) => b.textContent.includes("Đoạn chat và tác vụ"))`;
    const FOLD = `${SEC}?.closest(".section-label")?.nextElementSibling`;
    // Thanh bên có thêm mục khác phía trên (Đã ghim, Code với dữ liệu các bộ khác để lại) thì thanh phân trang nằm dưới mép màn hình:
    // mục đang mở thì cuộn tới nó như người dùng rồi mới đo (mục đã gập không cuộn, vẫn phải không thấy).
    const PAGER = `(() => { const f = ${FOLD}, p = f?.querySelector(".adm-pager"); if (!p) return null; if (f.classList.contains("open")) p.scrollIntoView({ block: "nearest" }); const q = p.getBoundingClientRect(), r = f.getBoundingClientRect();
      const h = Math.max(0, Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top)); return { open: f.classList.contains("open"), fold: Math.round(r.height), seen: q.height > 0 && ${VIS}(p) ? Math.round(h) : 0 }; })()`;
    if (!(await ev(`${FOLD}?.classList.contains("open")`))) { await click(SEC, "mục Đoạn chat và tác vụ"); await sleep(600); }
    const a = await ev(PAGER);
    ok(a && a.open && a.seen > 0, "hơn 20 đoạn chat: mục đang mở có thanh phân trang", a);
    await click(SEC, "mục Đoạn chat và tác vụ"); await sleep(700);
    const b = await ev(PAGER);
    ok(b && !b.open && b.fold <= 1 && b.seen === 0, "gập mục → danh sách và thanh phân trang cùng ẩn", b);
    await shot("U4-folded");
    await click(SEC, "mục Đoạn chat và tác vụ"); await sleep(600);
    ok((await ev(PAGER))?.seen > 0, "mở lại → thanh phân trang hiện lại");
  });

  // U5 — gõ ngay sau ⌘K (bảng lệnh còn đang tải): không rơi phím nào, chữ không lọt vào ô soạn tin.
  await run("U5", "gõ ngay sau ⌘K", async () => {
    await home("desktop");
    await until(`!!document.querySelector(".main textarea")`, 15000);
    // Mạng chậm để phần mềm của bảng lệnh (tải lazy) chắc chắn về sau các phím gõ.
    await P("Network.emulateNetworkConditions", { offline: false, latency: 900, downloadThroughput: -1, uploadThroughput: -1 });
    await key("k", "KeyK", 75, 4);
    for (const ch of "abc") await key(ch, `Key${ch.toUpperCase()}`, ch.toUpperCase().charCodeAt(0), 0, ch);
    await P("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const opened = await until(`!!document.querySelector(".pal input")`, 20000);
    ok(opened, "⌘K mở bảng lệnh");
    const got = await until(`document.querySelector(".pal input")?.value === "abc"`, 4000);
    const st = await ev(`({ pal: document.querySelector(".pal input")?.value ?? null, focus: !!document.activeElement?.closest(".pal"), composer: document.querySelector(".main textarea")?.value ?? "" })`);
    ok(got, "ba phím gõ trước khi ô tìm có tiêu điểm đều vào ô tìm (“abc”)", st);
    ok(st.focus, "ô tìm của bảng lệnh có tiêu điểm", st);
    ok(!/[abc]/.test(st.composer), "phím gõ không lọt vào ô soạn tin", st);
    await shot("U5-palette");
    await esc(); await sleep(300);
  });

  // U6 — mỗi mục có địa chỉ riêng: #v=… khi đổi mục, Back / Forward quay đúng mục, mở thẳng link #v= / #s=; Cài đặt không chèn mục lịch sử.
  await run("U6", "địa chỉ #v= / #s= và nút Back", async () => {
    await home("desktop");
    const cur = `[...document.querySelectorAll(".rail .nav-item[aria-current=page]")].map((e) => e.getAttribute("data-nav") || (e.classList.contains("rail-new") ? "new" : "?")).join()`;
    ok((await ev(`location.hash`)) === "", "trang Mới: địa chỉ không có #v=");
    await click(`document.querySelector(".rail [data-nav=projects]")`, "Dự án");
    ok(await until(`location.hash === "#v=projects"`, 4000), "bấm Dự án → #v=projects", await ev(`location.hash`));
    await click(`document.querySelector(".rail [data-nav=inbox]")`, "Hộp thư");
    ok(await until(`location.hash === "#v=inbox"`, 4000), "bấm Hộp thư → #v=inbox", await ev(`location.hash`));
    await ev(`history.back()`);
    ok(await until(`location.hash === "#v=projects" && (${cur}) === "projects"`, 4000), "Back → về lại Dự án", { hash: await ev(`location.hash`), nav: await ev(cur) });
    await ev(`history.forward()`);
    ok(await until(`location.hash === "#v=inbox" && (${cur}) === "inbox"`, 4000), "Forward → sang lại Hộp thư", { hash: await ev(`location.hash`), nav: await ev(cur) });
    await ev(`history.back()`); await until(`location.hash === "#v=projects"`, 3000);
    await ev(`history.back()`);
    ok(await until(`location.hash === "" && (${cur}) === "new"`, 4000), "Back lần nữa → về trang Mới", { hash: await ev(`location.hash`), nav: await ev(cur) });
    await home("desktop", "#v=artifacts");
    ok(await until(`(${cur}) === "artifacts" && location.hash === "#v=artifacts"`, 10000), "mở thẳng link #v=artifacts → đúng trang Artifacts", { hash: await ev(`location.hash`), nav: await ev(cur) });
    await home("desktop", "#v=skills");
    ok(await until(`(${cur}) === "customize"`, 10000), "mở thẳng link #v=skills → Kho kỹ năng", await ev(cur));
    // Cài đặt: ⇧⌘, → #s=<mục>; Esc đóng thì địa chỉ không còn #s=; Back không mở lại Cài đặt.
    // Mở Cài đặt là một mục lịch sử (LIVE-8, hashnav.ts): Back lúc Cài đặt đang mở chỉ đóng Cài đặt, về đúng trang đã mở nó — thay thế mục
    // của trang đó thì Back bỏ qua luôn trang ấy. Đóng bằng Esc thì app history.back() bỏ mục #s= vừa thêm, nên Back sau đó không mở lại Cài đặt.
    await home("desktop");
    await click(`document.querySelector(".rail [data-nav=inbox]")`, "Hộp thư"); await until(`location.hash === "#v=inbox"`, 4000);
    await key(",", "Comma", 188, 4 | 8);
    ok(await until(`!!document.querySelector(".modal.settings") && location.hash.startsWith("#s=")`, 6000), "⇧⌘, → Cài đặt mở, địa chỉ #s=<mục>", await ev(`location.hash`));
    await ev(`history.back()`);
    ok(await until(`!document.querySelector(".modal.settings") && location.hash === "#v=inbox" && (${cur}) === "inbox"`, 4000), "Back lúc Cài đặt đang mở → chỉ đóng Cài đặt, về lại Hộp thư", { hash: await ev(`location.hash`), nav: await ev(cur) });
    await key(",", "Comma", 188, 4 | 8);
    ok(await until(`!!document.querySelector(".modal.settings") && location.hash.startsWith("#s=")`, 6000), "mở lại Cài đặt", await ev(`location.hash`));
    await esc();
    ok(await until(`!document.querySelector(".modal.settings") && location.hash === "#v=inbox"`, 4000), "Esc đóng Cài đặt → địa chỉ về #v=inbox", await ev(`location.hash`));
    await ev(`history.back()`);
    ok(await until(`location.hash === "" && (${cur}) === "new"`, 4000) && !(await ev(`!!document.querySelector(".modal.settings")`)), "đóng Cài đặt rồi Back → về trang trước Hộp thư, không mở lại Cài đặt", { hash: await ev(`location.hash`), nav: await ev(cur) });
    await home("desktop", "#s=General");
    ok(await until(`!!document.querySelector(".modal.settings")`, 10000), "mở thẳng link #s=General → Cài đặt mở sẵn");
    await esc(); await sleep(300);
  });

  // U7 — Synchro Code: ba nút Chế độ / Quyền / Model có nhãn phân loại; dưới 1100px chỉ còn biểu tượng nhưng aria-label vẫn đầy đủ (tên + giá trị).
  await run("U7", "nhãn ba nút ở Synchro Code", async () => {
    const B3 = `(() => { const u = document.querySelector(".cv-under"); if (!u) return null; const mode = u.querySelector(".cv-modebtn:not(.cv-perm)"), perm = u.querySelector(".cv-modebtn.cv-perm"), model = u.querySelector(".cv-model .model-btn");
      // value: giá trị chính sau "Tên:" (bỏ phần phụ màu nhạt như mức nỗ lực của model).
      const one = (b, lbl) => { if (!b) return null; const t = b.querySelector(lbl), c = t?.cloneNode(true); c?.querySelectorAll(".muted").forEach((x) => x.remove());
        return { label: b.getAttribute("aria-label") || "", text: t && ${VIS}(t) ? t.textContent.replace(/\\s+/g, " ").trim() : "", value: (c?.textContent ?? "").split(":").slice(1).join(":").replace(/\\s+/g, " ").trim() }; };
      return { mode: one(mode, ".cv-mb-t"), perm: one(perm, ".cv-mb-t"), model: one(model, ".mp-lbl") }; })()`;
    await home("desktop");
    await click(`document.querySelector(".rail [data-nav=code]")`, "Code");
    if (!(await until(`!!document.querySelector(".cv-under .cv-modebtn")`, 20000))) throw new Error("màn Code không có hàng nút dưới ô soạn");
    await sleep(500);
    const w = await ev(B3);
    ok(/^Chế độ:\s*\S/.test(w.mode?.text ?? "") && /^Quyền:\s*\S/.test(w.perm?.text ?? "") && /^Model:\s*\S/.test(w.model?.text ?? ""), "1440px: ba nút hiện “Chế độ: …”, “Quyền: …”, “Model: …”", w);
    await shot("U7-1440");
    for (const width of [1000, 768]) {
      await setSize({ width, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(500);
      const n = await ev(B3);
      ok(n.mode && n.perm && n.model && !n.mode.text && !n.perm.text && !n.model.text, `${width}px: ba nút chỉ còn biểu tượng`, n);
      for (const [k, name] of [["mode", "Chế độ"], ["perm", "Quyền"], ["model", "Model"]]) {
        const b = n[k];
        ok(b && b.label.startsWith(name) && (!b.value || b.label.includes(b.value)), `${width}px: nút ${name} có aria-label đầy đủ (“${name}: <giá trị>”)`, b);
      }
      await shot(`U7-${width}`);
    }
  });

  // U8 — khung xem Excel: thanh cuộn ngang luôn có, có nút "Vừa chiều rộng". Dùng tệp Excel thật do model giả lập tạo trong đoạn chat.
  await run("U8", "khung xem Excel", async () => {
    await home("desktop");
    // Model của nhà cung cấp giả lập (như audit.mjs): có kịch bản "Chạy code" tạo tệp Excel.
    await ev(`(async () => { const me = await (await fetch("/api/auth/me")).json(), m = await (await fetch("/api/models")).json(), k = m.providers.flatMap((p) => p.models).find((x) => !x.key.startsWith("sub-"))?.key; if (k) localStorage.setItem("u:" + me.user.id + ":model", k); })()`);
    await home("desktop");
    await click(`document.querySelector(".main textarea")`, "ô soạn");
    await P("Input.insertText", { text: "Tạo file Excel báo cáo doanh thu" });
    await key("Enter", "Enter", 13, 0, "\r");
    await until(`!!document.querySelector(".user-msg")`, 15000); await sleep(1500);
    await until(`!document.querySelector(".thinking") && !document.querySelector(".art-card.busy") && !document.querySelector(".msg-stop, .stop-btn, [aria-label='Dừng']")`, 120000);
    await sleep(1200);
    const card = `[...document.querySelectorAll(".out-card:not(.out-missed)")].find((c) => /\\.xlsx\\b/i.test(c.textContent))`;
    if (!(await until(`!!${card}`, 8000))) { skipped("U8 khung xem Excel", "model giả lập không tạo ra tệp .xlsx"); return; }
    await click(card, "thẻ tệp Excel");
    ok(await until(`!!document.querySelector(".fp-frame")`, 10000), "bấm thẻ tệp → khung xem trước mở");
    let r = null;
    for (let i = 0; i < 60 && !r; i++) { await sleep(300); r = await frameEval(`(() => { const s = document.querySelector(".sheet"); if (!s) return null; const fit = [...document.querySelectorAll("button")].find((b) => /Vừa chiều rộng|Kích thước thật|Fit width|Actual size/.test(b.textContent)); return { ox: getComputedStyle(s).overflowX, fit: !!fit, fitText: fit ? fit.textContent : "" }; })()`); }
    if (!r) { ok(false, "đọc được nội dung khung xem Excel", "không thấy .sheet trong khung"); return; }
    ok(r.ox === "scroll", "bảng tính luôn có thanh cuộn ngang (cột F trở đi không bị cắt im lặng)", r);
    ok(r.fit, "có nút “Vừa chiều rộng”", r);
    await shot("U8-xlsx");
  });

  // U9–U13 dùng đoạn chat mẫu.
  const openMd = async (size) => {
    await home(size, `#c=${MD_ID}`);
    if (!(await until(`!!document.querySelector(".ai-msg")`, 20000))) throw new Error("đoạn chat mẫu không mở được");
    await sleep(800);
  };

  // U9 — ô đầu của bảng là tên tệp / mã ngắn không dấu cách: không ngắt giữa từ ("hoa-" / "don.png"), kể cả trên điện thoại.
  await run("U9", "ô đầu của bảng không ngắt giữa từ", async () => {
    for (const size of ["mobile", "desktop"]) {
      await openMd(size);
      const r = await ev(`(() => { const td = [...document.querySelectorAll(".ai-msg td")].find((t) => t.textContent.trim() === "hoa-don.png"), sp = [...document.querySelectorAll(".ai-msg td")].find((t) => t.textContent.trim() === "Hóa đơn tháng 10");
        if (!td) return null; td.scrollIntoView({ block: "center" }); const rg = document.createRange(); rg.selectNodeContents(td); const tops = new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        return { cls: td.className, ws: getComputedStyle(td).whiteSpace, lines: tops.size, spaced: sp ? sp.className : null }; })()`);
      ok(r && r.lines === 1, `${size}: “hoa-don.png” nằm trên một dòng`, r);
      ok(r && /nowrap/.test(r.ws), `${size}: ô đầu ngắn không dấu cách dùng white-space: nowrap`, r);
      ok(r && r.spaced !== null && !/md-nw/.test(r.spaced), `${size}: ô có khoảng trắng vẫn ngắt dòng bình thường`, r);
      await shot(`U9-${size}`);
    }
  });

  // U10 — lỗi công cụ đã được gọi lại thành công: "1 bước đã thử lại" màu trung tính; lỗi còn lại mới tô đỏ.
  await run("U10", "lỗi đã tự khắc phục không tô đỏ", async () => {
    await openMd("desktop");
    const r = await ev(`[...document.querySelectorAll(".wl-sum-h em")].map((e) => ({ text: e.textContent.trim(), soft: e.classList.contains("soft"), color: getComputedStyle(e).color }))`);
    const retried = r.find((x) => x.text === "1 bước đã thử lại"), left = r.find((x) => x.text === "1 lỗi");
    ok(retried && retried.soft && !RED(retried.color), "lượt có lỗi đã gọi lại thành công: “1 bước đã thử lại”, màu trung tính", r);
    ok(left && !left.soft && RED(left.color), "lỗi chưa được gọi lại: “1 lỗi”, màu đỏ", r);
    ok(await ev(`[...document.querySelectorAll(".wl-sum-h")].some((h) => /3 bước/.test(h.textContent) && /1m 04s/.test(h.textContent))`), "dòng tổng kết vẫn đủ: số bước, thời gian");
    await shot("U10");
  });

  // U11 — chip nguồn: favicon hỏng thành chữ cái đầu trên nền trung tính; tối đa 6 chip, còn lại gom vào "+N nguồn".
  await run("U11", "chip nguồn web", async () => {
    await openMd("desktop");
    const SRC = `(() => { const box = document.querySelector(".msg-sources"); if (!box) return null; box.scrollIntoView({ block: "center" }); const chips = [...box.querySelectorAll(".src-chip")];
      return { total: chips.length, shown: chips.filter((c) => ${VIS}(c)).length, more: box.querySelector(".src-more")?.textContent.trim() ?? null,
        letter: !!chips.find((c) => c.href.includes("noicon.example"))?.querySelector(".src-fav-l"),
        broken: [...box.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth < 2 && ${VIS}(i)).length }; })()`;
    const a = await ev(SRC);
    ok(a && a.total === 9 && a.shown === 6 && a.more === "+3 nguồn", "9 nguồn: hiện 6 chip và “+3 nguồn”", a);
    ok(await until(`${SRC}?.letter === true`, 10000), "trang không có biểu tượng: chip hiện chữ cái đầu");
    await sleep(1500);
    ok((await ev(SRC))?.broken === 0, "không còn ô ảnh hỏng / ô vuông trắng", await ev(SRC));
    await click(`document.querySelector(".msg-sources .src-more")`, "+3 nguồn"); await sleep(300);
    const b = await ev(SRC);
    ok(b && b.shown === 9 && b.more === "Thu gọn", "bấm “+3 nguồn” → hiện đủ 9 chip, nút thành “Thu gọn”", b);
    await shot("U11");
  });

  // U12 — trang Speech dựng ngay bố cục và khung chờ trong lúc đọc gói ElevenLabs (không còn trang trống hơn 2 giây).
  await run("U12", "trang Speech khi gói còn đang đọc", async () => {
    const held = [];
    let release = false;
    on("Fetch.requestPaused", (p, sid) => { if (sid !== S) return; if (release) send("Fetch.continueRequest", { requestId: p.requestId }, S).catch(() => {}); else held.push(p.requestId); });
    await P("Fetch.enable", { patterns: [{ urlPattern: "*/api/speech/plan*", requestStage: "Request" }] });
    try {
      await home("desktop");
      if (!(await ev(`!!document.querySelector(".rail [data-nav=speech]")`))) { skipped("U12 trang Speech", "tài khoản thử không có mục Speech"); return; }
      const t0 = Date.now();
      await click(`document.querySelector(".rail [data-nav=speech]")`, "Speech");
      // Chờ mã trang Speech (tải chậm, trước đó là vòng xoay chung) thay vì 700ms cố định; gói vẫn đang bị giữ nên vẫn đo đúng lúc chờ.
      // Vẫn giữ đúng ngưỡng của U12: bố cục phải hiện trong 2 giây kể từ lúc bấm.
      await until(`!!document.querySelector(".sp-home")`, 10000);
      const took = Date.now() - t0;
      ok(took <= 2000, `bố cục Speech hiện trong 2 giây sau khi bấm (${took} ms)`, { took });
      const r = await ev(`(() => { const h = document.querySelector(".sp-home"); if (!h) return null; const q = h.getBoundingClientRect();
        return { busy: h.getAttribute("aria-busy") === "true", h: Math.round(q.height), skel: h.querySelectorAll(".sk-blk").length, input: !!h.querySelector("textarea, input, [contenteditable=true]") }; })()`);
      ok(held.length > 0 || r?.busy, "gói ElevenLabs còn đang đọc lúc mở trang", { held: held.length, r });
      ok(r && r.h > 200 && (r.skel > 0 || r.input), "trong lúc chờ: bố cục và khung chờ đã hiện (không trang trống)", r);
      await shot("U12-waiting");
    } finally {
      release = true;
      for (const id of held.splice(0)) await P("Fetch.continueRequest", { requestId: id }).catch(() => {});
      await P("Fetch.disable").catch(() => {});
    }
    ok(await until(`!!document.querySelector(".sp-home") && !document.querySelector(".sp-home[aria-busy=true]")`, 15000) || (await ev(`!document.querySelector(".sp-home")`)), "đọc gói xong: trang Speech điền phần còn lại");
  });

  // U13 — sơ đồ mermaid không cao quá min(70vh, 520px); có nút phóng to (hộp thoại có tên, Esc đóng).
  await run("U13", "sơ đồ mermaid giới hạn chiều cao", async () => {
    for (const size of ["desktop", "mobile"]) {
      await openMd(size);
      await ev(`document.querySelector(".viz-mm")?.scrollIntoView({ block: "center" })`);
      // Chờ chính sơ đồ (.art-mermaid svg): ".viz-mm svg" khớp ngay icon của nút phóng to trong lúc mermaid còn đang tải, rồi đo nhầm icon 15px.
      if (!(await until(`!!document.querySelector(".viz-mm .art-mermaid svg")`, 25000))) { ok(false, `${size}: sơ đồ mermaid vẽ ra được`); continue; }
      await sleep(500);
      const r = await ev(`(() => { const s = document.querySelector(".viz-mm .art-mermaid svg"), q = s.getBoundingClientRect(); return { h: Math.round(q.height), max: Math.round(Math.min(innerHeight * 0.7, 520)), card: Math.round(document.querySelector(".viz-mm").getBoundingClientRect().height) }; })()`);
      ok(r.h > 40 && r.h <= r.max + 1, `${size}: sơ đồ 9 nút cao ${r.h}px ≤ ${r.max}px`, r);
      ok((await ev(`document.querySelector(".viz-mm .viz-zoom")?.getAttribute("aria-label")`)) === "Phóng to sơ đồ", `${size}: có nút “Phóng to sơ đồ”`);
      await click(`document.querySelector(".viz-mm .viz-zoom")`, "Phóng to sơ đồ");
      ok(await until(`!!document.querySelector("[role=dialog][aria-label='Sơ đồ']")`, 4000), `${size}: bấm phóng to → hộp thoại “Sơ đồ” cả màn hình`);
      await shot(`U13-${size}-full`);
      await esc();
      ok(await until(`!document.querySelector("[role=dialog][aria-label='Sơ đồ']")`, 3000), `${size}: Esc đóng hộp thoại sơ đồ`);
    }
  });

  // U14 — màn cảm ứng: nút biểu tượng / mục menu / mục điều hướng ≥ 44×44; không chữ nào dưới 12px; nút chỉ có biểu tượng đều có tên.
  await run("U14", "vùng bấm, cỡ chữ, tên nút", async () => {
    const SMALL_TEXT = `(() => { const out = new Set(); const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let t; (t = tw.nextNode());) { const p = t.parentElement; if (!t.nodeValue.trim() || !p || p.closest("svg,script,style,noscript,[aria-hidden=true],.sr-only,.art-thumb-doc,.dl-win,.dl-phone,iframe")) continue;
        if (!${VIS}(p)) continue; const fs = parseFloat(getComputedStyle(p).fontSize); if (fs < 11.95) out.add(Math.round(fs * 10) / 10 + "px “" + t.nodeValue.trim().slice(0, 24) + "” (" + p.tagName.toLowerCase() + "." + String(p.className).split(" ")[0] + ")"); if (out.size > 12) break; }
      return [...out]; })()`;
    const UNNAMED = `[...document.querySelectorAll("button,[role=button]")].filter((b) => ${VIS}(b) && !b.textContent.trim() && !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby") && !b.getAttribute("title")).map((b) => b.outerHTML.slice(0, 90))`;
    // Máy tính: chữ và tên nút ở trang chủ, thanh bên, Cài đặt.
    await home("desktop");
    const s1 = await ev(SMALL_TEXT), u1 = await ev(UNNAMED);
    await key(",", "Comma", 188, 4 | 8); await until(`!!document.querySelector(".modal.settings")`, 6000); await sleep(800);
    const s2 = await ev(SMALL_TEXT), u2 = await ev(UNNAMED);
    await esc(); await sleep(300);
    ok(!s1.length && !s2.length, "1440px: không chữ nào dưới 12px (trang chủ, thanh bên, Cài đặt)", [...s1, ...s2]);
    ok(!u1.length && !u2.length, "1440px: nút chỉ có biểu tượng đều có tên (aria-label / title)", [...u1, ...u2]);
    // Điện thoại có cảm ứng: (pointer: coarse) phải khớp, rồi đo vùng bấm.
    await P("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    try {
      await home("mobile");
      if (!(await ev(`matchMedia("(pointer: coarse)").matches`))) { skipped("U14 vùng bấm 44px", "Chrome ẩn không giả lập được (pointer: coarse)"); return; }
      const TAP = `[...document.querySelectorAll(".icon-btn,.menu-item,.nav-item")].filter((b) => ${VIS}(b)).map((b) => { const q = b.getBoundingClientRect(); return { w: q.width, h: q.height, n: (b.getAttribute("aria-label") || b.textContent.trim() || b.className).slice(0, 30) }; }).filter((x) => x.w < 43.5 || x.h < 43.5).map((x) => x.n + " " + Math.round(x.w) + "×" + Math.round(x.h))`;
      const t1 = await ev(TAP);
      await openPanel();
      const t2 = await ev(TAP);
      ok(!t1.length && !t2.length, "390px cảm ứng: nút biểu tượng, mục menu, mục điều hướng đều ≥ 44×44", [...t1, ...t2].slice(0, 12));
      await shot("U14-mobile-drawer");
    } finally {
      await P("Emulation.setTouchEmulationEnabled", { enabled: false });
    }
  });
} finally {
  if (jsErr.length) console.log(`\n(lỗi JavaScript trên trang: ${[...new Set(jsErr)].slice(0, 5).join(" | ")})`);
  await unseedBrowser().catch(() => {});
  try { ws.close(); } catch { /* đã đóng */ }
  chrome.kill();
  // Sau khi đóng Chrome: trình duyệt không còn đẩy lại bản cũ lên máy chủ.
  await unseedServer().catch((e) => console.log(`  (cảnh báo: không xóa được đoạn chat mẫu: ${e.message})`));
}
console.log(`\n${pass} đạt, ${fail} lỗi${skip ? `, ${skip} bỏ qua` : ""}`);
process.exit(fail ? 1 : 0);
