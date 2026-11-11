// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/popovers.mjs
// Mọi menu / bảng nổi quanh khung chat và màn Code mở ra đều nằm trên cùng, không bị lớp nào che: mở lần lượt từng cái ở thanh bên mở
// và thu gọn (máy tính) và trên điện thoại, dò lưới điểm bên trong khung, điểm nào trúng phần tử ngoài khung là bị che.
// Từng sót: thanh bên thu gọn thì ô soạn tin và dải kính mờ của khối soạn tin (z 6) che nửa dưới menu tài khoản (thanh bên z 5).
// Cùng lượt: khoảng cách trong khung (mục hai dòng không có đệm trên dưới, chữ đầu dòng lệch cột vài px — menu Tải về của bộ slide), và gợi ý
// khi rê chuột (data-tip) bị cắt ở mép trên (thanh công cụ khung artifact) hay không hiện (nút trên thanh trên).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = process.env.SYNCHRO_URL ?? process.env.BASE ?? "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + `/synchro-ui/popovers${process.env.THEME === "dark" ? "-dark" : ""}/`;
mkdirSync(SCR, { recursive: true });
const PROF = (await import("node:os")).tmpdir() + "/synchro-ui/chrome-prof-popovers";

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email, password }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("login failed");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Dò che khuất: mọi khung nổi đang mở; trả về danh sách "tên khung: n điểm bị che bởi …".
const COVERED = `(() => {
  const name = (el) => el ? el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "") : "?";
  const out = [];
  for (const m of document.querySelectorAll(".menu:not(.out),.model-menu,.model-sub,.usermenu,.cx-pop,.at-menu,.modal,[role=dialog]")) {
    const cs = getComputedStyle(m); if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
    const q = m.getBoundingClientRect(); if (q.width < 40 || q.height < 30) continue;
    let n = 0, hit = null, pts = 0;
    for (let x = q.left + 6; x < q.right - 4; x += 10) for (let y = q.top + 6; y < q.bottom - 4; y += 10) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      // Điểm nằm ngoài góc bo tròn của khung thì không tính.
      const rr = parseFloat(cs.borderTopLeftRadius) || 0, dx = Math.max(q.left + rr - x, 0, x - (q.right - rr)), dy = Math.max(q.top + rr - y, 0, y - (q.bottom - rr));
      if (dx > 0 && dy > 0 && dx * dx + dy * dy > rr * rr - 4) continue;
      pts++;
      const t = document.elementFromPoint(x, y);
      if (t && !m.contains(t) && !t.contains(m) && !t.closest(".toast,[role=tooltip]")) { n++; hit ??= t; }
    }
    out.push({ box: name(m), pts, covered: n, by: n ? name(hit) : "" });
  }
  return out;
})()`;

// Nền đặc: mọi khung nổi đang mở (menu, bảng, gợi ý, thẻ nguồn…) phải che kín chữ phía dưới. Nền là nền của chính khung hoặc lớp ::before
// (kính của glass.css); độ đục < 0.95 là lỗi (chủ dự án: "các tab hiện lên không trong suốt nữa").
const OPAQUE = `(() => {
  const a = (c) => { if (!c || c === "transparent") return 0; const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return p.length >= 4 ? p[3] : 1; };
  const name = (el) => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
  const out = [];
  for (const m of document.querySelectorAll(".menu:not(.out),.model-menu,.model-sub,.usermenu,.cx-pop,.modal,.cite-pop,.tip-float.on,.cv-mention,.cv-sel,.toast:not(.out)")) {
    const cs = getComputedStyle(m); if (cs.display === "none" || cs.visibility === "hidden") continue;
    const q = m.getBoundingClientRect(); if (q.width < 20 || q.height < 14) continue;
    const own = a(cs.backgroundColor), pre = getComputedStyle(m, "::before").content !== "none" ? a(getComputedStyle(m, "::before").backgroundColor) : 0;
    const v = Math.max(own, pre);
    if (v < 0.95) out.push(name(m) + " độ đục " + v.toFixed(2));
  }
  return out;
})()`;

// Khoảng cách trong khung đang mở: mục nhiều dòng phải có đệm trên dưới (chữ cách mép mục >= 5px); chữ / icon đầu dòng các mục và tiêu đề
// trong cùng khung không lệch nhau 1–6px (lệch hẳn từ 7px trở lên là thụt lề có chủ ý, như mục con).
const SPACING = `(() => {
  const out = [];
  const name = (el) => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
  const textBox = (el) => { const rg = document.createRange(); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) { const t = tw.currentNode; if (!t.nodeValue.trim()) continue; rg.selectNodeContents(t); for (const r of rg.getClientRects()) { if (!r.width) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); } }
    return x1 > x0 ? { left: x0, top: y0, right: x1, bottom: y1 } : null; };
  for (const m of document.querySelectorAll(".menu:not(.out),.model-menu,.model-sub,.usermenu")) {
    if (getComputedStyle(m).display !== "none" && !m.classList.contains("fl-flat") && /(auto|scroll)/.test(getComputedStyle(m).overflowY) && getComputedStyle(m, "::before").content !== "none") out.push("khung kính tự cuộn, nền và viền sẽ trôi theo nội dung: " + (m.className || m.tagName));
  }
  for (const m of document.querySelectorAll(".menu:not(.out),.model-menu,.model-sub,.usermenu,.cx-pop")) {
    if (getComputedStyle(m).display === "none") continue;
    const items = [...m.querySelectorAll(".menu-item")].filter((e) => e.closest(".menu,.model-menu,.model-sub,.usermenu,.cx-pop") === m && e.getBoundingClientRect().height);
    for (const it of items) {
      const r = it.getBoundingClientRect(), t = textBox(it); if (!t) continue;
      if (t.bottom - t.top > 22) { const pad = Math.min(t.top - r.top, r.bottom - t.bottom); if (pad < 5) { out.push("mục nhiều dòng sát mép trên/dưới (" + Math.round(pad) + "px): “" + it.textContent.trim().slice(0, 24) + "” trong " + name(m)); break; } }
    }
    // Đầu dòng: icon đầu tiên nếu có (cả ô logo connector: chữ cái trong ô màu nằm giữa ô, không phải đầu dòng), không thì chữ. Tiêu đề khung (không phải mục) cũng tính.
    const rows = [...items, ...[...m.children].filter((e) => !e.matches(".menu-item,hr,.menu,.model-sub") && e.textContent.trim() && !e.querySelector(".menu-item") && e.getBoundingClientRect().height)];
    const starts = rows.map((e) => { const ic = e.querySelector(":scope > svg, :scope > img, :scope > .avatar, :scope > .bk-check, :scope > .cn-logo, :scope > span > svg"); const t = textBox(e); const a = ic ? ic.getBoundingClientRect().left : 1e9; return { e, x: Math.min(a, t ? t.left : 1e9) }; }).filter((v) => v.x < 1e8 && !v.e.matches(".sub"));
    for (let i = 0; i < starts.length; i++) for (let j = i + 1; j < starts.length; j++) {
      const d = Math.abs(starts[i].x - starts[j].x);
      if (d > 1 && d < 6.5) { out.push("lệch cột " + d.toFixed(1) + "px: “" + starts[i].e.textContent.trim().slice(0, 18) + "” / “" + starts[j].e.textContent.trim().slice(0, 18) + "” trong " + name(m)); i = starts.length; break; }
    }
  }
  return out;
})()`;

let fails = 0, checked = 0;
const runSize = async (size) => {
  const mobile = size === "mobile";
  rmSync(PROF, { recursive: true, force: true });
  const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--remote-debugging-port=9343", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "about:blank"], { stdio: "ignore" });
  let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9343/json/version").then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); } });
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable");
  // Màn máy tính thấp (720px) để menu dễ chạm khối soạn tin nhất.
  await P("Emulation.setDeviceMetricsOverride", mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  if (mobile) await P("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  // THEME=dark: chạy toàn bộ ở giao diện tối (nền đặc phải đúng ở cả hai giao diện).
  if (process.env.THEME === "dark") { await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("theme", "dark"); } catch {}` }); await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }); }
  // OLD=1: tạm đưa về cách cũ (thanh bên z 5, khối soạn tin z 6, gợi ý luôn nằm trên, mục menu Tải về không có đệm trên dưới) để chứng minh
  // phép thử bắt được các lỗi đã sửa.
  if (process.env.OLD) await P("Page.addScriptToEvaluateOnNewDocument", { source: `addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ".shell-side:has(.menu,[data-tip]:hover){z-index:5} html body .main>.dock:has(.menu,.cx-pop){z-index:6} .tip-float{display:none!important} html[data-tips=js] body [data-tip]:hover::after{content:attr(data-tip)!important;display:block!important} html body .art-dl-menu .menu-item{padding:0 12px!important} .warn{background:rgba(198,66,47,.15);color:#e0604f;border-radius:12px;padding:8px 10px;font-size:13px}"; document.head.append(s); });` });
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
  const click = async (expr, what) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("not found: " + what);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };
  const hover = async (expr) => { const r = await ev(`(() => { const el = ${expr}; if (!el) return null; const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`); if (r) await P("Input.dispatchMouseEvent", { type: "mouseMoved", x: r[0], y: r[1] }); };
  const key = (k, code, vk) => P("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(k === "Enter" ? { text: "\r" } : {}) }).then(() => P("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }));
  const esc = async () => { await key("Escape", "Escape", 27); await sleep(250); await P("Input.dispatchMouseEvent", { type: "mousePressed", x: 640, y: 8, button: "left", clickCount: 1 }); await P("Input.dispatchMouseEvent", { type: "mouseReleased", x: 640, y: 8, button: "left", clickCount: 1 }); await sleep(350); };
  const sideOpen = () => ev(`!document.querySelector(".sidebar.closed, .shell-side.closed") && !!document.querySelector(".sidebar")?.getBoundingClientRect().width`);
  const check = async (label) => {
    await sleep(650);
    const boxes = await ev(COVERED);
    if (!boxes.length) { console.log(`  ✗ ${label}: không mở được khung nào`); fails++; return; }
    for (const b of boxes) {
      checked++;
      const ok = b.covered === 0;
      if (!ok) fails++;
      console.log(`  ${ok ? "✓" : "✗"} ${label} · ${b.box}${ok ? "" : ` — ${b.covered}/${b.pts} điểm bị ${b.by} che`}`);
    }
    for (const sp of await ev(SPACING)) { fails++; console.log(`  ✗ ${label} · ${sp}`); }
    const thin = await ev(OPAQUE);
    checked++;
    if (thin.length) fails++;
    console.log(`  ${thin.length ? "✗" : "✓"} ${label} · nền đặc${thin.length ? ` — ${thin.join(", ")}` : ""}`);
    const { data } = await P("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${SCR}${size}-${label.replace(/[^\p{L}\p{N}]+/gu, "-")}.png`, Buffer.from(data, "base64"));
  };
  // Gợi ý khi rê chuột: rê vào từng phần tử có data-tip trong vùng sel, đo hộp thật của gợi ý (::after, qua DOM của DevTools); bị cắt bởi mép màn
  // hình hay khung tổ tiên (overflow), hoặc không hiện, là lỗi.
  const CLIP = `(el) => { let top = 0, left = 0, right = innerWidth, bottom = innerHeight; for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX !== "visible" || cs.overflowY !== "visible") { const r = a.getBoundingClientRect(); if (cs.overflowY !== "visible") { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); } if (cs.overflowX !== "visible") { left = Math.max(left, r.left); right = Math.min(right, r.right); } } if (cs.position === "fixed") break; } return { top, left, right, bottom }; }`;
  // Vòng Mức dùng ở cả ba mức (thường / warn / hot, đúng class usageui.tsx gắn): hình nằm giữa nút, không có nền khi chưa rê chuột.
  // Từng sót: quy tắc chung .warn (hộp cảnh báo đỏ, đệm 8×10px) rò vào vòng ở mức cảnh báo → nền đỏ nâu, hình lệch 7px / 5px.
  const ringLevels = async (label) => {
    for (const lv of ["", "warn", "hot"]) {
      const r = await ev(`(() => { const b = document.querySelector(".main>.dock .us-ring"); if (!b) return null; b.classList.remove("warn", "hot"); if (${JSON.stringify(lv)}) b.classList.add(${JSON.stringify(lv)});
        const q = b.getBoundingClientRect(), s = b.querySelector("svg").getBoundingClientRect(), bg = getComputedStyle(b).backgroundColor;
        return { dx: s.x + s.width / 2 - q.x - q.width / 2, dy: s.y + s.height / 2 - q.y - q.height / 2, bg }; })()`);
      if (!r) continue;
      checked++;
      // Nút có thêm số % cạnh vòng: chiều ngang không còn đối xứng, chỉ xét chiều dọc.
      const hasN = await ev(`!!document.querySelector(".main>.dock .us-ring .us-ring-n")`);
      const off = Math.max(hasN ? 0 : Math.abs(r.dx), Math.abs(r.dy)), clear = /rgba\(0, 0, 0, 0\)|transparent/.test(r.bg);
      if (off > 0.5 || !clear) fails++;
      console.log(`  ${off <= 0.5 && clear ? "✓" : "✗"} ${label} vòng Mức dùng mức “${lv || "thường"}”${off > 0.5 ? ` lệch tâm ${r.dx.toFixed(1)}/${r.dy.toFixed(1)}px` : ""}${clear ? "" : ` có nền ${r.bg}`}`);
    }
    await ev(`document.querySelector(".main>.dock .us-ring")?.classList.remove("warn", "hot")`);
  };
  const tips = async (label, sel) => {
    await P("DOM.enable");
    const n = await ev(`(() => { document.querySelectorAll("[data-tipcheck]").forEach((e) => e.removeAttribute("data-tipcheck")); let i = 0; for (const el of document.querySelectorAll(${JSON.stringify(sel)})) { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); if (!el.getAttribute("data-tip") || !r.width || !r.height || cs.visibility === "hidden" || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue; const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); if (!t || !(t === el || el.contains(t))) continue; el.setAttribute("data-tipcheck", String(i++)); } return i; })()`);
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const c = await ev(`(() => { const el = document.querySelector('[data-tipcheck="${i}"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, tip: el.getAttribute("data-tip") }; })()`);
      if (!c) continue;
      await P("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y }); await sleep(650);
      checked++;
      // Gợi ý nổi (tips.ts): khung .tip-float gắn vào body; phải hiện đúng chữ và nằm trọn trong màn hình.
      const fl = await ev(`(() => { const t = document.querySelector(".tip-float.on"); if (!t) return null; const r = t.getBoundingClientRect(); return { text: t.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom, cut: t.scrollWidth > t.clientWidth + 1 }; })()`);
      if (fl) {
        const out = Math.max(-fl.left, -fl.top, fl.right - (await ev("innerWidth")), fl.bottom - (await ev("innerHeight")));
        if (fl.text !== c.tip) { bad++; console.log(`  ✗ ${label} · gợi ý sai chữ: “${fl.text}” thay vì “${c.tip}”`); }
        else if (out > 0.5) { bad++; console.log(`  ✗ ${label} · gợi ý tràn khỏi màn hình ${Math.round(out)}px: “${c.tip}”`); }
        else if (fl.cut) { bad++; console.log(`  ✗ ${label} · gợi ý bị cắt chữ: “${c.tip}”`); }
        continue;
      }
      const { root } = await P("DOM.getDocument", { depth: 0 });
      const { nodeId } = await P("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-tipcheck="${i}"]` });
      const d = nodeId ? await P("DOM.describeNode", { nodeId, depth: 1 }) : null;
      const after = (d?.node.pseudoElements ?? []).find((p) => p.pseudoType === "after");
      if (!after) { bad++; console.log(`  ✗ ${label} · gợi ý không hiện: “${c.tip}”`); continue; }
      const q = (await P("DOM.getBoxModel", { backendNodeId: after.backendNodeId })).model.border;
      const box = { left: Math.min(q[0], q[6]), top: Math.min(q[1], q[3]), right: Math.max(q[2], q[4]), bottom: Math.max(q[5], q[7]) };
      const cl = await ev(`(${CLIP})(document.querySelector('[data-tipcheck="${i}"]'))`);
      const cut = Math.max(cl.left - box.left, box.right - cl.right, cl.top - box.top, box.bottom - cl.bottom);
      if (cut > 1) { bad++; console.log(`  ✗ ${label} · gợi ý bị cắt ${Math.round(cut)}px: “${c.tip}”`); }
    }
    await P("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 400 }); await sleep(200);
    fails += bad;
    console.log(`  ${bad ? "✗" : "✓"} ${label} · ${n} gợi ý${bad ? `, ${bad} lỗi` : " hiện đủ, không bị cắt"}`);
  };
  const tryOpen = async (label, open) => { try { await open(); await check(label); } catch (e) { console.log(`  ✗ ${label}: ${e.message.split("\n")[0]}`); fails++; } await esc(); };

  console.log(`━━ ${size}`);
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`, 30000, "app");
  await sleep(1200);
  // Một đoạn chat dài vừa đủ để có khối soạn tin ở đáy màn hình.
  await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: "Viết kế hoạch ra mắt sản phẩm có bảng lịch trình" }); await key("Enter", "Enter", 13);
  await until(`!!document.querySelector(".main>.dock") && !document.querySelector(".wl-status")`, 60000, "reply");
  await sleep(800);
  // Điện thoại: khung artifact mở toàn màn hình sau câu trả lời; đóng như người dùng bấm X.
  if (mobile && (await ev(`!!document.querySelector(".art-panel")`))) { await click(`document.querySelector(".art-panel [aria-label='Đóng']")`, "close art"); await sleep(600); }

  // Các khung mở trong khung chat (thanh trên, khối soạn tin).
  const chatBoxes = async (tag) => {
    await tryOpen(`${tag} tên đoạn chat`, () => click(`document.querySelector(".topbar .title-wrap .sel")`, "title"));
    await tryOpen(`${tag} menu +`, () => click(`document.querySelector(".dock .composer [aria-label='Thêm']")`, "plus"));
    const item = (t) => `[...document.querySelectorAll(".plus-menu .menu-item")].find((e) => e.textContent.includes(${JSON.stringify(t)}))`;
    await tryOpen(`${tag} menu + › Kho kỹ năng`, async () => { await click(`document.querySelector(".dock .composer [aria-label='Thêm']")`, "plus"); await sleep(400); await click(item("Kho kỹ năng"), "skills"); });
    await tryOpen(`${tag} menu + › Connectors`, async () => { await click(`document.querySelector(".dock .composer [aria-label='Thêm']")`, "plus"); await sleep(400); await click(item("Connectors"), "conn"); });
    await tryOpen(`${tag} chọn micro`, () => click(`document.querySelector(".dock [aria-label='Chọn micro']")`, "mic"));
    await tryOpen(`${tag} chọn model`, () => click(`document.querySelector(".dock .model-btn")`, "model"));
    await tryOpen(`${tag} mức nỗ lực`, async () => { await click(`document.querySelector(".dock .model-btn")`, "model"); await sleep(400); await hover(`[...document.querySelectorAll(".model-menu .menu-item")].find((e) => /nỗ lực|Effort/i.test(e.textContent))`); await sleep(300); if (!(await ev(`!!document.querySelector(".model-sub")`))) throw new Error("menu con không mở"); });
    await tryOpen(`${tag} mức dùng`, () => click(`document.querySelector(".dock .us-ring")`, "usage"));
    await tryOpen(`${tag} bàn trộn ngữ cảnh`, () => click(`document.querySelector(".dock .cx-pill")`, "mixer"));
  };
  if (!mobile) {
    for (const collapsed of [false, true]) {
      const tag = collapsed ? "thu gọn ·" : "thanh bên mở ·";
      if (collapsed === (await sideOpen())) { await click(`document.querySelector(".rail-mark")`, "toggle side"); await sleep(700); }
      await tryOpen(`${tag} menu tài khoản`, () => click(`document.querySelector(".rail .user")`, "user"));
      if (!collapsed) await tryOpen(`${tag} ⋮ đoạn chat`, async () => { await hover(`document.querySelector(".chat-wrap")`); await click(`document.querySelector(".chat-wrap .dots")`, "dots"); });
      // Khung Gắn thẻ (thay nội dung menu ⋮): cùng khung nổi, cũng phải nền đặc và nằm trên các hàng sau.
      if (!collapsed) await tryOpen(`${tag} ⋮ đoạn chat › Gắn thẻ`, async () => { await hover(`[...document.querySelectorAll(".chat-wrap")].find((w) => w.querySelector(":scope > .chat-item:not(.code-item)") && w.getBoundingClientRect().height > 0 && !w.closest(".pj-kids") && !w.querySelector(".pj-tg, .pj-ic"))`); await click(`[...document.querySelectorAll(".chat-wrap")].find((w) => w.querySelector(":scope > .chat-item:not(.code-item)") && w.getBoundingClientRect().height > 0 && !w.closest(".pj-kids") && !w.querySelector(".pj-tg, .pj-ic"))?.querySelector(".dots")`, "dots"); await sleep(350); await click(`[...document.querySelectorAll(".chat-wrap .menu:not(.out) .menu-item")].find((e) => e.textContent.includes("Gắn thẻ"))`, "tags"); });
      await chatBoxes(tag);
      await ringLevels(tag);
      await tips(`${tag} gợi ý thanh trên`, ".topbar [data-tip]");
      await tips(`${tag} gợi ý khối soạn tin`, ".main>.dock [data-tip]");
      await tips(`${tag} gợi ý thanh điều hướng`, ".rail [data-tip]");
    }
    // Bộ slide (chế độ Trang trình bày): thanh công cụ của khung artifact và menu Tải về (PDF / PowerPoint / HTML / PNG, mỗi mục hai dòng),
    // ở khung thường và khung phóng to toàn màn hình (thanh công cụ sát mép trên: gợi ý phải lật xuống).
    if (!(await sideOpen())) { await click(`document.querySelector(".rail-mark")`, "toggle side"); await sleep(700); }
    await click(`document.querySelector(".rail-new")`, "new"); await sleep(700);
    await click(`[...document.querySelectorAll(".hero-chip")].find((e) => e.textContent.includes("Trang trình bày"))`, "slides"); await sleep(400);
    await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text: "Làm bộ slide giới thiệu quán cà phê" }); await key("Enter", "Enter", 13);
    await until(`!!document.querySelector(".art-panel") && !document.querySelector(".wl-status")`, 60000, "deck");
    // Nút trên thanh công cụ không nhảy chỗ khi hội đồng phản biện chạy xong (viên phản biện đổi rộng / hẹp).
    const btnPos = () => ev(`[...document.querySelectorAll(".art-panel .art-acts > button[data-tip]")].map((e) => e.getAttribute("aria-label") + "@" + Math.round(e.getBoundingClientRect().left))`);
    const pos0 = await btnPos();
    await until(`!document.querySelector(".art-panel .cr-pill.run")`, 30000, "critic done").catch(() => {});
    await sleep(600);
    const pos1 = await btnPos(), moved = pos0.filter((p) => !pos1.includes(p));
    checked++; if (moved.length) fails++;
    console.log(`  ${moved.length ? "✗" : "✓"} bộ slide · nút thanh công cụ đứng yên khi phản biện xong${moved.length ? ` — nhảy: ${moved.join(", ")} → ${pos1.join(", ")}` : ""}`);
    for (const full of [false, true]) {
      const tag = full ? "bộ slide phóng to ·" : "bộ slide ·";
      if (full) { await click(`document.querySelector(".art-panel [aria-label='Toàn màn hình']")`, "expand"); await sleep(900); }
      await tips(`${tag} gợi ý thanh công cụ`, ".art-panel [data-tip]");
      await tryOpen(`${tag} Tải về`, () => click(`document.querySelector(".art-panel [aria-label='Tải về']")`, "download"));
      // Esc (đóng menu Tải về) cũng thu nhỏ khung đang phóng to; chỉ bấm Thu nhỏ khi khung vẫn còn phóng to.
      if (full && (await ev(`!!document.querySelector(".art-panel [aria-label='Thu nhỏ']")`))) { await click(`document.querySelector(".art-panel [aria-label='Thu nhỏ']")`, "shrink"); await sleep(700); }
    }
    // Màn Code có khối soạn tin riêng: menu tài khoản và các menu của ô soạn tin, cả hai trạng thái thanh bên.
    await click(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Code"))`, "code"); await sleep(1800);
    for (const collapsed of [true, false]) {
      const tag = collapsed ? "Code · thu gọn ·" : "Code · thanh bên mở ·";
      if (collapsed === (await sideOpen())) { await click(`document.querySelector(".rail-mark")`, "toggle side"); await sleep(700); }
      await tryOpen(`${tag} menu tài khoản`, () => click(`document.querySelector(".rail .user")`, "user"));
      await tryOpen(`${tag} chế độ`, () => click(`document.querySelector(".cv-modebtn:not(.cv-perm)")`, "mode"));
      await tryOpen(`${tag} quyền`, () => click(`document.querySelector(".cv-modebtn.cv-perm")`, "perm"));
      await tryOpen(`${tag} thêm ngữ cảnh`, () => click(`document.querySelector("[aria-label='Thêm ngữ cảnh']")`, "plus"));
    }
    await tips("Code · gợi ý", ".cv [data-tip]");
    // Trang dự án: ô soạn tin của dự án mở menu xuống dưới.
    await click(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Dự án"))`, "projects"); await sleep(1500);
    // Tài khoản thử chưa có dự án (hồ sơ Chrome mới): tạo một dự án như người dùng (ô "Dự án mới", gõ tên, Enter).
    if (!(await ev(`!!document.querySelector(".pj-gcard")`)) && (await ev(`!!document.querySelector(".pj-slot, .pj-new")`))) {
      await click(`document.querySelector(".pj-slot, .pj-new")`, "new project"); await sleep(600);
      await click(`document.querySelector("#sy-pj-name")`, "name"); await P("Input.insertText", { text: "Dự án thử khung nổi" }); await key("Enter", "Enter", 13); await sleep(1500);
      if (!(await ev(`!!document.querySelector(".pj-compose")`)) && (await ev(`!!document.querySelector(".pj-gcard")`))) { await click(`document.querySelector(".pj-gcard")`, "project"); await sleep(1200); }
    }
    if (!(await ev(`!!document.querySelector(".pj-compose")`)) && (await ev(`!!document.querySelector(".pj-gcard")`))) { await click(`document.querySelector(".pj-gcard")`, "project"); await sleep(1500); }
    if (await ev(`!!document.querySelector(".pj-compose")`)) {
      const plus = `document.querySelector(".pj-compose [aria-label='Thêm']")`;
      const item = (t) => `[...document.querySelectorAll(".plus-menu .menu-item")].find((e) => e.textContent.includes(${JSON.stringify(t)}))`;
      await tryOpen("Dự án · chọn model", () => click(`document.querySelector(".pj-compose .model-btn")`, "pj model"));
      await tryOpen("Dự án · menu +", () => click(plus, "pj plus"));
      await tryOpen("Dự án · menu + › Kho kỹ năng", async () => { await click(plus, "pj plus"); await sleep(400); await click(item("Kho kỹ năng"), "skills"); });
      await tryOpen("Dự án · menu + › Connectors", async () => { await click(plus, "pj plus"); await sleep(400); await click(item("Connectors"), "conn"); });
      // Gõ @ trong ô soạn của dự án: menu chọn connector mở ngay dưới ô (trước đây neo vào .main, nằm ngoài màn hình mà Enter vẫn bị chặn).
      await tryOpen("Dự án · menu @ connector", async () => {
        await click(`document.querySelector(".pj-compose textarea")`, "pj textarea"); await P("Input.insertText", { text: "@" }); await sleep(600);
        const r = await ev(`(() => { const m = document.querySelector(".pj-compose .at-menu"), c = document.querySelector(".pj-compose .composer"); if (!m) return null; const a = m.getBoundingClientRect(); return { top: a.top, bottom: a.bottom, cb: c.getBoundingClientRect().bottom, vh: innerHeight }; })()`);
        if (!r || r.top < r.cb - 1 || r.bottom > r.vh + 1) throw new Error("menu @ không nằm ngay dưới ô soạn, trong màn hình: " + JSON.stringify(r));
      });
      await ev(`(() => { const t = document.querySelector(".pj-compose textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, ""); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    } else { console.log("  ✗ không mở được trang dự án để kiểm"); fails++; }
  } else {
    await chatBoxes("điện thoại ·");
    await ringLevels("điện thoại ·");
    await tips("điện thoại · gợi ý thanh trên", ".topbar [data-tip]");
    await tips("điện thoại · gợi ý khối soạn tin", ".main>.dock [data-tip]");
    // Ngăn kéo thanh bên nằm trên lớp nền mờ (không bị phủ xám), kể cả khi đang mở menu trong nó.
    const drawer = async (label) => {
      const n = await ev(`(() => { const d = document.querySelector(".app>.shell-side"); if (!d) return -1; const q = d.getBoundingClientRect(); let n = 0;
        for (let x = q.left + 20; x < Math.min(q.right, innerWidth) - 10; x += 40) for (let y = q.top + 20; y < q.bottom - 10; y += 60) { const t = document.elementFromPoint(x, y); if (t && !d.contains(t) && !t.closest(".menu")) n++; } return n; })()`);
      checked++; if (n !== 0) fails++;
      console.log(`  ${n === 0 ? "✓" : "✗"} ${label}${n === 0 ? "" : ` — ${n} điểm của ngăn kéo bị lớp khác phủ`}`);
    };
    await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "burger"); await sleep(700);
    await drawer("điện thoại · ngăn kéo thanh bên");
    await tryOpen("điện thoại · menu tài khoản", async () => { if (!(await ev(`!!document.querySelector(".side-scrim")`))) { await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "burger"); await sleep(700); } await click(`document.querySelector(".rail .user")`, "user"); await sleep(300); await drawer("điện thoại · ngăn kéo khi menu tài khoản mở"); });
    await tryOpen("điện thoại · ⋮ đoạn chat", async () => { if (!(await ev(`!!document.querySelector(".side-scrim")`))) { await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "burger"); await sleep(700); } await click(`document.querySelector(".chat-wrap .dots")`, "dots"); await sleep(300); await drawer("điện thoại · ngăn kéo khi ⋮ mở"); });
    await tryOpen("điện thoại · ⋮ đoạn chat › Gắn thẻ", async () => { if (!(await ev(`!!document.querySelector(".side-scrim")`))) { await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "burger"); await sleep(700); } await click(`[...document.querySelectorAll(".chat-wrap")].find((w) => w.querySelector(":scope > .chat-item:not(.code-item)") && w.getBoundingClientRect().height > 0 && !w.closest(".pj-kids") && !w.querySelector(".pj-tg, .pj-ic"))?.querySelector(".dots")`, "dots"); await sleep(350); await click(`[...document.querySelectorAll(".chat-wrap .menu:not(.out) .menu-item")].find((e) => e.textContent.includes("Gắn thẻ"))`, "tags"); await sleep(300); });
  }
  ws.close(); chrome.kill(); await sleep(400);
};

for (const size of process.argv[2] ? [process.argv[2]] : ["desktop", "mobile"]) await runSize(size);
console.log(fails ? `\n${fails} lỗi / ${checked} khung` : `\nTất cả ${checked} khung đạt`);
process.exit(fails ? 1 : 0);
