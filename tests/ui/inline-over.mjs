// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/inline-over.mjs [tệp.json]
// B5 bước 4: chỗ style nội dòng từng thua khai báo !important (gỡ !important thì style nội dòng thắng, vòng rà B5 tìm ra), ở 1440 / 768 / 390px:
// - ô soạn tin trang dự án: menu +, menu model, menu con Mức độ nỗ lực và menu micro có chiều cao (không sập vì top + bottom cùng đặt), mở
//   xuống dưới ô soạn tin, menu con Mức độ nỗ lực cao đúng theo nội dung (không bị kéo dãn bằng menu model);
// - Cài đặt (General, Account, Administrator): hàng đầu mỗi tấm có viền trên 1px, h3 margin 28/10 (0 khi đứng đầu trang), ô
//   trong hàng rộng 100% và nút chủ đề đệm 8px khi ≤860px.
// Ghi số đo ra tệp JSON (nếu có) để so hai phiên bản (vd. trước / sau một lần đổi CSS): node -e so hai tệp, hoặc diff.
// Tài khoản quản trị thử; chưa có dự án thì tạo một dự án như người dùng. BASE, CDP_PORT đổi được.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const B = process.env.BASE ?? process.env.SYNCHRO_URL ?? "http://localhost:3200", CDP = Number(process.env.CDP_PORT ?? 9381);
const OUT = process.argv[2];
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + `chrome-prof-inline-over-${CDP}`;
rmSync(PROF, { recursive: true, force: true });

const email = "admin@synchro.test", password = "synchro-mock-123";
let cookie = "";
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email, password }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  if (!cookie) throw new Error("login failed");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Cổng gỡ lỗi đang có Chrome khác (lần chạy trước bị ngắt giữa chừng): báo ngay, không nối nhầm vào trình duyệt đó.
if (await fetch(`http://127.0.0.1:${CDP}/json/version`).then(() => true, () => false)) throw new Error(`cổng ${CDP} đang có Chrome khác: đóng nó hoặc đặt CDP_PORT`);
// Micro giả (không hỏi quyền) để menu micro mở được trong Chrome ẩn.
const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "about:blank"], { stdio: "ignore" });
// Lỗi giữa chừng (máy giả lập tắt, hết giờ chờ…) vẫn đóng Chrome: Chrome bị bỏ lại giữ cổng và làm treo bộ chạy sau dùng cùng cổng.
process.on("exit", () => { try { chrome.kill(); } catch {} });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable");
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
await send("Browser.grantPermissions", { origin: B, permissions: ["audioCapture"] }).catch(() => {});
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(250); } return false; };
const click = async (expr) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) return false;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  return true;
};
const hover = async (expr) => { const r = await ev(`(() => { const el = ${expr}; if (!el) return null; const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`); if (r) await P("Input.dispatchMouseEvent", { type: "mouseMoved", x: r[0], y: r[1] }); return !!r; };
const esc = async () => { for (const type of ["keyDown", "keyUp"]) await P("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); };
// Tắt chuyển động (lớp khai báo đầu tiên, như cascade.mjs): đo khung menu khi đã đứng yên.
const FREEZE = `(() => { let first = null;
  for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules) { if (r instanceof CSSLayerStatementRule) { first = r.nameList[0]; break; } if (r instanceof CSSLayerBlockRule) { first = r.name; break; } if (!(r instanceof CSSImportRule)) break; }
    if (first) break; }
  const css = "*,*::before,*::after{animation:none!important;transition:none!important}";
  const s = document.createElement("style"); s.textContent = first ? "@layer " + first + "{" + css + "}" : css; document.head.appendChild(s); return first; })()`;

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const out = {};
// Khung menu so với khung ô soạn tin của trang dự án.
const box = (sel) => `(() => { const m = document.querySelector(${JSON.stringify(sel)}), c = document.querySelector(".pj-compose .composer"); if (!m || !c) return null;
  const a = m.getBoundingClientRect(), k = c.getBoundingClientRect(), cs = getComputedStyle(m);
  const kids = [...m.children].filter((e) => getComputedStyle(e).position !== "absolute").map((e) => e.getBoundingClientRect()).filter((r) => r.height);
  const content = kids.length ? Math.max(...kids.map((r) => r.bottom)) - Math.min(...kids.map((r) => r.top)) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) : 0;
  return { top: Math.round(a.top), bottom: Math.round(a.bottom), h: Math.round(a.height), content: Math.round(content), ct: Math.round(k.top), cb: Math.round(k.bottom), vh: innerHeight }; })()`;

const VIEWS = [{ w: 1440, h: 900, mobile: false }, { w: 768, h: 1024, mobile: false }, { w: 390, h: 844, mobile: true }];
for (const v of VIEWS) {
  console.log(`— ${v.w}px`);
  await P("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.mobile });
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`);
  await sleep(1200);
  await ev(FREEZE);

  // Trang dự án.
  const nav = async () => { if (v.mobile) { await click(`document.querySelector(".side-toggle")`); await sleep(500); } return click(`[...document.querySelectorAll(".nav-item")].find((e) => e.textContent.trim().startsWith("Dự án"))`); };
  await nav(); await sleep(1200);
  if (!(await ev(`!!document.querySelector(".pj-gcard")`)) && (await ev(`!!document.querySelector(".pj-slot, .pj-new")`))) {
    await click(`document.querySelector(".pj-slot, .pj-new")`); await sleep(600);
    await click(`document.querySelector("#sy-pj-name")`); await P("Input.insertText", { text: "Dự án thử menu" });
    for (const type of ["keyDown", "keyUp"]) await P("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
    await sleep(1500);
  }
  if (!(await ev(`!!document.querySelector(".pj-compose")`))) { await click(`document.querySelector(".pj-gcard")`); await until(`!!document.querySelector(".pj-compose .composer")`, 8000); }
  if (!(await ev(`!!document.querySelector(".pj-compose .composer")`))) { ok(false, "mở được trang dự án"); continue; }
  await sleep(600);
  const check = (name, r) => {
    out[`${v.w} ${name}`] = r;
    ok(r && r.h > 40, `${name}: có chiều cao`, JSON.stringify(r));
    // Mở xuống: mép trên ở nửa dưới ô soạn tin trở xuống (neo dưới nút của hàng công cụ), thân menu thò ra dưới ô soạn tin.
    ok(r && r.top >= (r.ct + r.cb) / 2 && r.bottom > r.cb + 40, `${name}: mở xuống dưới ô soạn tin`, JSON.stringify(r));
  };
  // Menu +.
  await click(`document.querySelector(".pj-compose [aria-label='Thêm']")`); await sleep(500);
  check("menu +", await ev(box(".pj-compose .plus-menu")));
  await esc(); await sleep(300);
  // Menu model → Mức độ nỗ lực.
  await click(`document.querySelector(".pj-compose .model-btn")`); await sleep(600);
  check("menu model", await ev(box(".pj-compose .model-menu")));
  const eff = `[...document.querySelectorAll(".pj-compose .model-menu .menu-item")].find((e) => e.textContent.trim().startsWith("Mức độ nỗ lực"))`;
  await hover(eff); await click(eff); await sleep(600);
  const r = await ev(box(".pj-compose .model-sub:not(.msub-models)"));
  check("menu con Mức độ nỗ lực", r);
  ok(r && Math.abs(r.h - r.content) <= 2, "menu con Mức độ nỗ lực: cao đúng theo nội dung (không bị kéo dãn)", JSON.stringify(r));
  await esc(); await sleep(200); await esc(); await sleep(300);
  // Menu micro.
  if (await click(`document.querySelector(".pj-compose .mic-wrap .chev")`)) {
    await until(`!!document.querySelector(".pj-compose .mic-menu")`, 3000); await sleep(500);
    check("menu micro", await ev(box(".pj-compose .mic-menu")));
    await esc(); await sleep(300);
  } else ok(false, "có nút chọn micro trong ô soạn tin dự án");

  // Cài đặt.
  await ev(`window.dispatchEvent(new Event("synchro:providers")); 1`);
  await until(`!!document.querySelector(".sy-settings .s-body")`, 8000);
  await ev(FREEZE);
  // Tên mục (nguồn tiếng Anh) hiện ra theo ngôn ngữ giao diện: so cả hai. "Time and focus" (h3 Quiet hours) không có trong danh sách mục
  // của modals.tsx nên không mở được từ giao diện (#s=… lạ thì về General); chỗ đó do scripts/css-inline.mjs canh.
  for (const [tab, vi] of [["General", "Chung"], ["Account", "Tài khoản"], ["Administrator", "Quản trị viên"]]) {
    const names = JSON.stringify([tab, vi]);
    await click(`[...document.querySelectorAll(".sy-settings .s-item")].find((e) => ${names}.some((t) => e.getAttribute("title") === t || e.textContent.trim() === t))`);
    const opened = await until(`${names}.includes(document.querySelector(".sy-sbody-h h2")?.textContent.trim()) && document.querySelectorAll(".sy-settings .s-body .row").length > 0`, 10000);
    ok(opened, `Cài đặt: mở được mục ${tab}`);
    if (!opened) continue;
    await sleep(tab === "Administrator" ? 2500 : 900);
    const m = await ev(`(() => { const body = document.querySelector(".sy-settings .s-body"), px = (v) => Math.round(parseFloat(v) * 10) / 10;
      const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).display !== "none";
      const firstRows = [...body.querySelectorAll(".row")].filter((e) => vis(e) && !(e.previousElementSibling?.classList.contains("row"))).map((e) => ({ t: e.querySelector(".t")?.textContent.trim().slice(0, 30), bt: getComputedStyle(e).borderTopWidth }));
      const h3 = [...body.querySelectorAll("h3")].filter(vis).map((e) => ({ t: e.textContent.trim().slice(0, 30), mt: px(getComputedStyle(e).marginTop), mb: px(getComputedStyle(e).marginBottom) }));
      const fields = [...body.querySelectorAll(".row>.field")].filter(vis).map((e) => { const r = e.parentElement, cs = getComputedStyle(r); return { w: Math.round(e.getBoundingClientRect().width), row: Math.round(r.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) }; });
      const seg = [...body.querySelectorAll(".row>.group>button")].filter(vis).slice(0, 3).map((e) => getComputedStyle(e).paddingLeft + " " + getComputedStyle(e).paddingRight);
      return { firstRows, h3, fields, seg }; })()`);
    out[`${v.w} settings ${tab}`] = m;
    ok(m.firstRows.length > 0 && m.firstRows.every((x) => x.bt === "1px"), `Cài đặt ${tab}: hàng đầu mỗi tấm có viền trên 1px`, JSON.stringify(m.firstRows));
    ok(m.h3.length > 0 && m.h3.every((x) => (x.mt === 28 || x.mt === 0) && x.mb === 10), `Cài đặt ${tab}: h3 margin 28 (hoặc 0 khi đứng đầu) / 10`, JSON.stringify(m.h3));
    if (v.w <= 860) {
      ok(m.fields.every((x) => Math.abs(x.w - x.row) <= 1), `Cài đặt ${tab}: ô trong hàng rộng 100% (≤860px)`, JSON.stringify(m.fields));
      if (tab === "General") ok(m.seg.length > 0 && m.seg.every((x) => x === "8px 8px"), "Cài đặt General: nút chủ đề đệm 8px (≤860px)", JSON.stringify(m.seg));
    } else if (tab === "Account") ok(m.fields.length > 0 && m.fields.every((x) => x.w === 280), "Cài đặt Account: ô hồ sơ rộng 280px ở màn rộng (style nội dòng)", JSON.stringify(m.fields));
  }
  await esc(); await sleep(300);
}
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\n${pass} đạt, ${fail} hỏng`);
ws.close(); chrome.kill();
await sleep(500); try { rmSync(PROF, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
