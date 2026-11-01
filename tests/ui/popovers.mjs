// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/popovers.mjs
// Mọi menu / bảng nổi quanh khung chat và màn Code mở ra đều nằm trên cùng, không bị lớp nào che: mở lần lượt từng cái ở thanh bên mở
// và thu gọn (máy tính) và trên điện thoại, dò lưới điểm bên trong khung, điểm nào trúng phần tử ngoài khung là bị che.
// Từng sót: thanh bên thu gọn thì ô soạn tin và dải kính mờ của khối soạn tin (z 6) che nửa dưới menu tài khoản (thanh bên z 5).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/popovers/";
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
  for (const m of document.querySelectorAll(".menu:not(.out),.model-menu,.model-sub,.usermenu,.cx-pop,.modal,[role=dialog]")) {
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
  // OLD=1: tạm đưa thanh bên (z 5) và khối soạn tin (z 6) về lớp cũ để chứng minh phép thử bắt được hai lỗi bị che đã sửa.
  if (process.env.OLD) await P("Page.addScriptToEvaluateOnNewDocument", { source: `addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ".shell-side:has(.menu,[data-tip]:hover){z-index:5} html body .main>.dock:has(.menu,.cx-pop){z-index:6}"; document.head.append(s); });` });
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
    const { data } = await P("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${SCR}${size}-${label.replace(/[^\p{L}\p{N}]+/gu, "-")}.png`, Buffer.from(data, "base64"));
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
      await chatBoxes(tag);
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
    } else { console.log("  ✗ không mở được trang dự án để kiểm"); fails++; }
  } else {
    await chatBoxes("điện thoại ·");
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
  }
  ws.close(); chrome.kill(); await sleep(400);
};

for (const size of process.argv[2] ? [process.argv[2]] : ["desktop", "mobile"]) await runSize(size);
console.log(fails ? `\n${fails} lỗi / ${checked} khung` : `\nTất cả ${checked} khung đạt`);
process.exit(fails ? 1 : 0);
