// Kiểm thử giao diện bằng Chrome ẩn (hồ sơ riêng) trên npm run dev:mock. Chạy tay: node tests/ui/critic.mjs
// Hội đồng phản biện: model viết xong một ứng dụng có lỗi → hội đồng đọc lại ở nền, đánh dấu đúng dòng, ghi chú kèm bản sửa;
// "Áp dụng sửa" tạo phiên bản mới ngay (không gọi model), phiên bản mới chạy được và được phản biện lại; tắt trong Cài đặt thì chỉ chạy khi bấm.
import { settle, waitFor } from "../lib/wait.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const B = "http://localhost:3200";
const SCR = (await import("node:os")).tmpdir() + "/synchro-ui/";
mkdirSync(SCR, { recursive: true });
const PROF = SCR + "chrome-prof-critic";
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
// Model viết "#artbug" phải cố định thì hội đồng (hãng khác với model viết, model nhanh rẻ nhất) mới cố định. Trước đây để Tự động nên kết quả
// tùy trạng thái bộ khác để lại: gói Claude của quản trị viên (tests/api/approve-edit.test.mjs, tests/ui/states.mjs đăng nhập mà không đăng xuất)
// còn hạn mức thì Claude Code giả lập viết (không có bản dựng lỗi); hết hạn mức 5 giờ, hay chưa đăng nhập, thì Tự động chọn GPT và hội đồng
// là Gemini / Claude. Bắt đầu như máy chủ mới (chưa đăng nhập gói, nhóm Claude dùng khóa API) và chọn tay Claude Sonnet qua khóa API.
await api("POST", "/api/engines/claude/logout");
const uid = (await api("GET", "/api/auth/me")).j?.user?.id;
const WRITER = "anthropic/claude-sonnet-5-5";
const capsBefore = (await api("GET", "/api/caps")).j?.caps ?? {};
await api("PATCH", "/api/caps", { art: true, crit: true });

const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", "--remote-debugging-port=9337", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9337/json/version").then((r) => r.json()).catch(() => null); }
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
await P("Runtime.enable"); await P("Page.enable"); await P("Network.enable");
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });

const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(200); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const results = [];
const ok = (c, n, x = "") => { results.push([c, n]); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}critic-${n}.png`, Buffer.from(data, "base64")); };
const ask = async (text) => {
  await click(`document.querySelector("textarea")`, "composer"); await P("Input.insertText", { text });
  await P("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
};
const pill = `document.querySelector(".art-panel .cr-pill")?.textContent ?? ""`;

try {
  // Đặt trước khi mã của trang chạy (trang đang mở ghi lại lựa chọn cũ khi tải lại).
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem(${JSON.stringify(`u:${uid}:model`)}, ${JSON.stringify(WRITER)}); } catch {}` });
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`, 30000, "app");
  await sleep(1200);
  await click(byText(".nav-item", "Mới"), "new chat"); await sleep(600);
  await ask("#artbug");
  await until(`document.querySelectorAll(".art-card:not(.busy)").length > 0 && !document.querySelector(".thinking") && !!document.querySelector(".art-panel")`, 60000, "reply");
  let seenRun = false;
  for (let i = 0; i < 60; i++) { const t = await ev(pill); if (/Đang phản biện/.test(t)) seenRun = true; if (/vấn đề/.test(t)) break; await sleep(150); }
  const t1 = await ev(pill);
  ok(/1\s*vấn đề/.test(t1) && (await ev(`!!document.querySelector(".art-panel .cr-pill.has.high")`)), `phản biện chạy ở nền sau khi viết xong${seenRun ? " (thấy “Đang phản biện”)" : ""}: “${t1}”`, t1);
  await shot("1-pill");
  await click(`document.querySelector(".art-panel .cr-pill.has")`, "pill"); await sleep(700);
  const marked = await ev(`[...document.querySelectorAll(".art-code > div.cr")].map((d) => d.querySelector("span").textContent)`);
  ok(JSON.stringify(marked) === '["5"]' && (await ev(`!!document.querySelector(".art-code > div.cr-high")`)), "chế độ Mã: đánh dấu đúng dòng 5 (mức nghiêm trọng)", JSON.stringify(marked));
  const note = await ev(`document.querySelector(".cr-note")?.textContent ?? ""`);
  // Model viết là Claude (WRITER) nên hội đồng tự chạy là model nhanh của hãng khác: GPT (tên hiện như ở bộ chọn model, "GPT-6 Luna").
  const by = await ev(`document.querySelector(".cr-note .cr-by")?.textContent ?? ""`);
  ok(/Nghiêm trọng/.test(note) && /chưa có giá trị/.test(note) && /gpt/i.test(by) && !/claude/i.test(by), "ghi chú ngay dưới dòng: mức độ, lỗi, model đã phản biện (hãng khác model viết)", note);
  await click(byText(".cr-note .lnk", "Xem bản sửa"), "show fix"); await sleep(300);
  ok((await ev(`document.querySelector(".cr-fix")?.textContent ?? ""`)).trim() === "const items = [];", "xem trước bản sửa");
  await shot("2-note");
  await click(byText(".cr-note .btn", "Áp dụng sửa"), "apply");
  await until(`[...document.querySelectorAll(".art-ver span")].some((e) => e.textContent.trim() === "2/2")`, 8000, "version 2");
  const code2 = await ev(`document.querySelector(".art-code")?.textContent ?? ""`);
  ok(code2.includes("const items = [];") && !code2.includes("undefined"), "áp dụng sửa: phiên bản 2 có bản sửa ngay, không cần gọi model");
  // "Đúng 2 tin" có cả vế phủ định (không thêm tin thừa): chờ tin thứ hai rồi đợi danh sách đứng yên 400 ms mới đếm.
  await waitFor(async () => (await ev(`document.querySelectorAll(".user-msg").length`)) >= 2, 5000);
  const thread = await settle(() => ev(`[...document.querySelectorAll(".user-msg")].map((e) => e.textContent)`), 400, 3000);
  ok(thread.length === 2 && /^Áp dụng sửa “.*” \(Bộ đếm, dòng 5\)$/.test(thread[1]), "đoạn chat ghi lại lần áp dụng (lượt sau model thấy bản sửa)", JSON.stringify(thread));
  for (let i = 0; i < 60 && !/Ổn/.test(await ev(pill)); i++) await sleep(150);
  ok(/Ổn/.test(await ev(pill)), "phiên bản mới được phản biện lại: không còn lỗi", await ev(pill));
  await click(byText(".art-tabs button", "Xem trước"), "preview"); await sleep(2500);
  ok(!(await ev(`!!document.querySelector(".art-err")`)), "phiên bản đã sửa chạy được (không còn báo lỗi)");
  await click(`document.querySelector('.art-ver [aria-label="Phiên bản trước"]')`, "v1"); await sleep(400);
  ok(/1\s*vấn đề/.test(await ev(pill)), "quay lại phiên bản 1: kết quả phản biện theo đúng phiên bản", await ev(pill));
  await click(`document.querySelector(".art-panel .cr-pill.has")`, "pill v1"); await sleep(500);
  await click(byText(".cr-note .lnk", "Bỏ qua"), "skip"); await sleep(300);
  ok(!(await ev(`!!document.querySelector(".cr-note")`)) && /Ổn/.test(await ev(pill)), "Bỏ qua: ẩn ghi chú");
  await shot("3-applied");

  // Tắt trong Cài đặt → Khả năng: sản phẩm mới không tự phản biện, bấm nút khiên thì chạy.
  await api("PATCH", "/api/caps", { crit: false });
  await click(byText(".nav-item", "Mới"), "new chat 2"); await sleep(600);
  await P("Page.reload"); await until(`!!document.querySelector("textarea")`, 30000, "reload"); await sleep(1200);
  await ask("Làm ứng dụng todo");
  await until(`document.querySelectorAll(".art-card:not(.busy)").length > 0 && !document.querySelector(".thinking") && !!document.querySelector(".art-panel")`, 60000, "todo");
  await sleep(1500);
  ok(!(await ev(`!!document.querySelector(".art-panel .cr-pill")`)) && (await ev(`!!document.querySelector('.art-panel [aria-label="Phản biện"]')`)), "đã tắt: không tự chạy, còn nút phản biện");
  await click(`document.querySelector('.art-panel [aria-label="Phản biện"]')`, "manual");
  for (let i = 0; i < 60 && !/vấn đề|Ổn/.test(await ev(pill)); i++) await sleep(150);
  ok(/1\s*vấn đề/.test(await ev(pill)), "bấm nút: phản biện ngay (ô nhập thiếu nhãn)", await ev(pill));
  await click(`document.querySelector(".art-panel .cr-pill.has")`, "pill todo"); await sleep(600);
  ok(await ev(`!!document.querySelector(".art-code > div.cr-low") && /Gợi ý/.test(document.querySelector(".cr-note").textContent)`), "mức Gợi ý hiện màu riêng");
  await shot("4-low");

  // W10 nhóm C: giao diện tiếng Anh, bộ slide đánh số lại dở dang (nhãn mục 01–04, chân trang 02 / 05 – 05 / 05).
  // Phản biện viết bằng tiếng Anh; Synchro tự báo đánh số lệch (không phải ý kiến model) bên cạnh ý kiến của model.
  await api("PATCH", "/api/caps", { crit: true });
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("p:uilang", '"en"'); } catch {}` });
  await P("Page.reload"); await until(`!!document.querySelector("textarea")`, 30000, "reload en"); await sleep(1200);
  await click(byText(".nav-item", "New"), "new chat en"); await sleep(600);
  await ask("#decknum");
  await until(`document.querySelectorAll(".art-card:not(.busy)").length > 0 && !document.querySelector(".thinking") && !!document.querySelector(".art-panel")`, 60000, "deck");
  for (let i = 0; i < 80 && !/issue/i.test(await ev(pill)); i++) await sleep(150);
  const tEn = await ev(pill);
  ok(/2\s*issues?/i.test(tEn), `bộ slide, giao diện tiếng Anh: phản biện báo 2 vấn đề: “${tEn}”`, tEn);
  await shot("5-deck-pill-en");
  await click(`document.querySelector(".art-panel .cr-pill.has")`, "pill deck"); await sleep(800);
  const notes = await ev(`[...document.querySelectorAll(".cr-note")].map((n) => ({ t: n.querySelector(".cr-h b")?.textContent, by: n.querySelector(".cr-by")?.textContent, d: n.querySelector("p")?.textContent, fix: !!n.querySelector(".btn") }))`);
  const num = notes.find((n) => n.t === "Inconsistent slide numbering");
  ok(!!num && num.by === "Synchro" && /Section labels \(01–04\) don't match the page numbers \(02–05 \/ 05\)/.test(num.d) && !num.fix, "ghi chú tiếng Anh của Synchro: đánh số lệch, không có nút áp dụng sửa", JSON.stringify(notes));
  ok(notes.some((n) => n.t === "The call-to-action button goes nowhere"), "ý kiến của model phản biện cũng bằng tiếng Anh", JSON.stringify(notes.map((n) => n.t)));
  const viLeft = await ev(`[...document.querySelectorAll(".cr-note")].map((n) => n.textContent).join(" ")`);
  ok(!/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/i.test(viLeft.replace(/Trà Một Chạm|Đặt lịch gặp/g, "")), "không còn chữ tiếng Việt trong ghi chú phản biện", viLeft);
  await shot("6-deck-notes-en");
} catch (e) { ok(false, "lỗi khi chạy", e.stack); await shot("fail"); }
await api("PATCH", "/api/caps", { crit: capsBefore.crit ?? true, art: capsBefore.art ?? true });
const fails = results.filter((r) => !r[0]).length;
console.log(`${results.length - fails}/${results.length} đạt`);
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
