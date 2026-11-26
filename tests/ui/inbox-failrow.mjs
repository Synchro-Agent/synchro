// Trên app thật (Chrome ẩn, npm run dev:mock): dòng lỗi trong Autopilot hiện "Lỗi: <lý do>" màu --ds-bad (sáng /
// tối), nút "Chạy lại" cạnh dòng (không lồng nút, không tràn), điện thoại chỉ còn biểu tượng; dòng quá cũ không đỏ,
// không nút; mở ra thấy "Chi tiết kỹ thuật"; bấm Chạy lại thì lần lỗi cũ không còn nút và không bị bộ hẹn giờ tự chạy
// lại (retried = 2).
// Chạy tay: node tests/ui/inbox-failrow.mjs   (ONLY=sang-chay-lai chỉ chạy một phần; BASE=http://localhost:3200, MOCK_DB=data-mock/synchro.db, CDP_PORT=9341; ảnh ở <tmp>/synchro-ui/failrow-*.png)
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const B = process.env.BASE ?? "http://localhost:3200";
const DBP = path.resolve(process.env.MOCK_DB ?? "data-mock/synchro.db");
const CDP = Number(process.env.CDP_PORT ?? 9341);
const SCR = path.join(os.tmpdir(), "synchro-ui") + "/", PROF = SCR + "chrome-prof-failrow";
mkdirSync(SCR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOO_OLD = "Kết quả này đã quá cũ nên không còn lưu.";

// Tài khoản riêng của bài này; dọn việc và dòng Autopilot của lần chạy trước.
const email = "inbox-failrow@synchro.test", password = "Member-pass-123";
let cookie = "";
const api = async (method, p, body) => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return { s: r.status, j: await r.json().catch(() => null) };
};
await api("POST", "/api/auth/signup", { email, password, profile: { fullName: "Inbox Failrow", birthDate: "2000-01-01" } });
await api("POST", "/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
for (const t of (await api("GET", "/api/tasks")).j?.tasks ?? []) await api("DELETE", `/api/tasks/${t.id}`);
const TITLE1 = "Gửi bản tin khách hàng hằng tuần qua email cho toàn bộ danh sách đăng ký nhận tin", TITLE2 = "Tổng hợp tin tức ngành";
const mk = async (title) => (await api("POST", "/api/tasks", { title, prompt: "Viết một câu chào.", schedule: { kind: "daily", time: "08:00", tz: "Asia/Ho_Chi_Minh" } })).j.task.id;
const t1 = await mk(TITLE1), t2 = await mk(TITLE2);

const R = createRequire(path.join(process.cwd(), "package.json"));
const db = new (R("better-sqlite3"))(DBP); db.pragma("busy_timeout = 5000");
const uid = db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
db.prepare("DELETE FROM task_runs WHERE owner = ?").run(uid);
const now = Date.now(), tag = now.toString(36);
const R1 = `run_fr1_${tag}`, R2 = `run_fr2_${tag}`, R3 = `run_fr3_${tag}`;
const row = (id, task, title, at, kept) => db.prepare("INSERT INTO task_runs (run_id, task_id, owner, title, at, kind, result) VALUES (?, ?, ?, ?, ?, 'run', ?)").run(id, task, uid, title, at, JSON.stringify(kept));
// R1: lỗi mạng vừa xảy ra; bản ghi runs "error" có giờ cập nhật đặt sau một giờ nữa để bộ hẹn giờ (dev:mock thử lại sau 4 giây) chưa tự chạy lại
// trong lúc bài chạy (retried vẫn 0) — để thấy chính nút Chạy lại trên dòng đánh dấu nó đã xử lý.
db.prepare("INSERT INTO runs (id, user_id, kind, status, result, events, created_at, updated_at) VALUES (?, ?, 'chat', 'error', ?, '[]', ?, ?)").run(R1, uid, JSON.stringify({ error: "fetch failed" }), now - 60_000, now + 3600_000);
row(R1, t1, TITLE1, now - 60_000, { status: "error", text: "", error: "fetch failed" });
row(R2, t2, TITLE2, now - 120_000, { status: "error", text: "" }); // lỗi không ghi lý do
row(R3, t2, TITLE2, now - 26 * 3600_000, { status: "error", error: TOO_OLD }); // quá cũ (bản ghi kiểu cũ)

const results = [];
const ok = (c, n, x = "") => { results.push(c); console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };

async function session(theme, view) {
  rmSync(PROF, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
    ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ver; for (let i = 0; i < 150 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const waits = new Map(), errs = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { const [y, n] = waits.get(m.id); waits.delete(m.id); m.error ? n(new Error(JSON.stringify(m.error))) : y(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0]);
  });
  const send = (method, params = {}, sessionId) => new Promise((y, n) => { const id = ++seq; waits.set(id, [y, n]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (method, params) => send(method, params, S);
  await P("Runtime.enable"); await P("Page.enable");
  await P("Emulation.setDeviceMetricsOverride", view);
  if (view.mobile) await P("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("theme", ${JSON.stringify(theme)}); } catch {}` });
  await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
  const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(250); } throw new Error("timeout: " + what); };
  const click = async (expr, what) => {
    const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    if (!r) throw new Error("not found: " + what);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
  };
  const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
  const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SCR}failrow-${n}.png`, Buffer.from(data, "base64")); };
  const side = async () => { if (await ev(`!!document.querySelector(".sidebar.closed, .shell-side.closed")`)) { await click(`document.querySelector("[aria-label='Mở thanh bên']")`, "burger"); await sleep(600); } };
  // Mở Autopilot từ thanh bên như người dùng (chế độ dev biên dịch trang lần đầu khá lâu).
  const open = async () => {
    await P("Page.navigate", { url: B + "/" });
    await until(`!!document.querySelector("textarea")`, 120000, "app loaded");
    await sleep(1200);
    await side();
    await click(byText(".nav-item", "Autopilot"), "inbox");
    await until(`!!document.querySelector(".tk-top")`, 120000, "inbox open");
    if (await ev(`!!${byText(".pl-seg button", "Kết quả")}`)) await click(byText(".pl-seg button", "Kết quả"), "results tab");
    await until(`[...document.querySelectorAll(".tk-item")].some((e) => e.textContent.includes(${JSON.stringify(TITLE2)}))`, 60000, "seeded rows");
    // Nút Chạy lại cần danh sách việc (/api/tasks tải song song với Autopilot): chờ tối đa 30 giây, quá thì các bước đo
    // dưới báo thiếu nút.
    const t0 = Date.now();
    await until(`document.querySelectorAll(".tk-rerun").length >= 2`, 30000, "rerun buttons").catch(() => {});
    console.log(`    nút Chạy lại hiện sau ${Date.now() - t0} ms kể từ khi có dòng`);
    await sleep(800);
  };
  return { P, ev, until, click, byText, shot, side, open, errs, close: async () => { ws.close(); chrome.kill(); await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once("exit", r))); } };
}

// Đo dòng: lý do, màu, nút, tràn khung.
const MEASURE = `(() => {
  const items = [...document.querySelectorAll(".tk-item")];
  const find = (t, i = 0) => items.filter((e) => e.querySelector(".tk-t b")?.textContent === t)[i];
  const pick = (el) => { if (!el) return null; const why = el.querySelector(".tk-why"), btn = el.querySelector(".tk-rerun"), box = el.getBoundingClientRect(), b = btn?.getBoundingClientRect(), row = el.querySelector(".tk-row");
    const lbl = btn?.querySelector("span:not(.art-spin)");
    return { em: el.querySelector(".tk-t em")?.textContent ?? "", why: why?.textContent ?? null, color: why ? getComputedStyle(why).color : null, btn: !!btn, nested: !!row?.querySelector("button"),
      inside: b ? b.left >= box.left - 0.5 && b.right <= box.right + 0.5 && b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5 : null, bw: b ? Math.round(b.width) : 0,
      label: lbl ? getComputedStyle(lbl).display !== "none" : false, failed: el.classList.contains("failed"), rowW: Math.round(row.getBoundingClientRect().width) }; };
  return { r1: pick(find(${JSON.stringify(TITLE1)})), r2: pick(find(${JSON.stringify(TITLE2)}, 0)), r3: pick(find(${JSON.stringify(TITLE2)}, 1)), hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
})()`;
const BAD = { light: "rgb(184, 65, 47)", dark: "rgb(240, 132, 114)" };
const DESK = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

function checkRows(tagName, m, theme, phone) {
  ok(m.r1?.why === "Lỗi: Mất kết nối tới model.", `${tagName}: dòng lỗi ghi "Lỗi: <lý do>"`, JSON.stringify(m.r1));
  ok(m.r1?.color === BAD[theme], `${tagName}: lý do màu --ds-bad của nền ${theme} (${m.r1?.color})`, m.r1?.color);
  ok(m.r2?.why === "Lỗi: Lần chạy này không hoàn thành nhưng không ghi lại lý do.", `${tagName}: lỗi không lý do ghi câu trung tính`, m.r2?.why);
  ok(m.r1?.btn && m.r2?.btn && !m.r1.nested && m.r1.inside && m.r2.inside, `${tagName}: nút Chạy lại cạnh dòng, không lồng, nằm trong khung dòng`, JSON.stringify(m.r1));
  ok(m.r3 && !m.r3.btn && m.r3.why === null && !m.r3.failed && m.r3.em === "Kết quả đã quá cũ, không còn lưu", `${tagName}: dòng quá cũ không đỏ, không nút`, JSON.stringify(m.r3));
  ok(!m.hscroll, `${tagName}: không cuộn ngang`);
  if (phone) ok(m.r1.btn && m.r1.bw >= 44 && m.r1.bw <= 48 && !m.r1.label && m.r1.rowW >= 250, `${tagName}: điện thoại chỉ còn biểu tượng, vùng bấm 44px (${m.r1.bw}px), tên việc còn ${m.r1.rowW}px`, JSON.stringify(m.r1));
  else ok(m.r1.btn && m.r1.label, `${tagName}: máy tính có chữ "Chạy lại"`);
}

try {
  for (const [name, theme, view, collapse] of [["sang-may-tinh", "light", DESK, false], ["toi-may-tinh", "dark", DESK, false], ["sang-thu-gon", "light", DESK, true], ["toi-dien-thoai", "dark", PHONE, false], ["sang-dien-thoai", "light", PHONE, false], ["sang-chay-lai", "light", DESK, false]]) {
    if (process.env.ONLY && !process.env.ONLY.split(",").includes(name)) continue;
    console.log(`━━ ${name}`);
    const s = await session(theme, view);
    try {
      await s.open();
      if (collapse) { await s.click(`document.querySelector(".rail-mark")`, "collapse"); await sleep(800); ok(await s.ev(`!!document.querySelector(".sidebar.closed, .shell-side.closed") || (document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0) < 90`), `${name}: thanh bên đã thu gọn`); }
      checkRows(name, await s.ev(MEASURE), theme, view.mobile);
      await s.shot(name);
      if (name === "sang-may-tinh") {
        await s.click(`[...document.querySelectorAll(".tk-item")].find((e) => e.textContent.includes(${JSON.stringify(TITLE1)}))?.querySelector(".tk-row")`, "open r1");
        await s.until(`!!document.querySelector(".tk-err")`, 10000, "details");
        const d = await s.ev(`(() => { const e = document.querySelector(".tk-err"); return { text: e.querySelector("span").textContent, sum: e.querySelector("summary")?.textContent ?? "", raw: e.querySelector("code")?.textContent ?? "" }; })()`);
        ok(/^Mất kết nối tới model/.test(d.text) && d.sum === "Chi tiết kỹ thuật" && d.raw === "fetch failed", "mở dòng lỗi: câu đọc được, lỗi thô trong Chi tiết kỹ thuật", JSON.stringify(d));
        await s.shot("sang-mo-dong-loi");
        await s.click(`[...document.querySelectorAll(".tk-item")].find((e) => e.textContent.includes(${JSON.stringify(TITLE1)}))?.querySelector(".tk-row")`, "close r1");
        await sleep(400);
        await s.click(`[...document.querySelectorAll(".tk-item")].find((e) => e.textContent.includes(${JSON.stringify(TITLE2)}) && !e.querySelector(".tk-rerun"))?.querySelector(".tk-row")`, "open expired");
        await sleep(600);
        ok(await s.ev(`(() => { const n = document.querySelector(".tk-body .tk-note"); return !!n && n.textContent.includes("quá cũ") && !document.querySelector(".tk-body .sk-err"); })()`), "mở dòng quá cũ: ghi chú xám, không khung lỗi");
      }
      // Bước cuối (đổi dữ liệu): bấm Chạy lại trên dòng lỗi R1.
      if (name === "sang-chay-lai") {
        ok(db.prepare("SELECT retried FROM task_runs WHERE run_id = ?").get(R1).retried === 0, "trước khi bấm: lần lỗi còn chờ bộ hẹn giờ tự chạy lại");
        await s.click(`[...document.querySelectorAll(".tk-item")].find((e) => e.querySelector(".tk-t b")?.textContent === ${JSON.stringify(TITLE1)})?.querySelector(".tk-rerun")`, "rerun");
        await s.until(`[...document.querySelectorAll(".tk-item")].filter((e) => e.querySelector(".tk-t b")?.textContent === ${JSON.stringify(TITLE1)}).length >= 2`, 240000, "new run row");
        await sleep(800);
        const after = await s.ev(`[...document.querySelectorAll(".tk-item")].filter((e) => e.querySelector(".tk-t b")?.textContent === ${JSON.stringify(TITLE1)}).map((e) => ({ failed: e.classList.contains("failed"), btn: !!e.querySelector(".tk-rerun") }))`);
        ok(after.some((x) => x.failed) && !after.some((x) => x.failed && x.btn), "sau khi bấm: dòng lỗi cũ không còn nút Chạy lại", JSON.stringify(after));
        ok(db.prepare("SELECT retried FROM task_runs WHERE run_id = ?").get(R1).retried === 2, "sau khi bấm: lần lỗi cũ đánh dấu đã xử lý, bộ hẹn giờ không chạy lại lần nữa");
        await s.shot("sang-sau-chay-lai");
      }
      if (view.mobile && theme === "light") { await s.side(); await sleep(600); await s.shot(name + "-thanh-ben");
        ok(await s.ev(`!document.querySelector(".sidebar.closed, .shell-side.closed")`),
        `${name}: mở ngăn kéo thanh bên trên trang Autopilot`); }
      ok(!s.errs.length, `${name}: không lỗi JS`, s.errs.join(" | "));
    } catch (e) { ok(false, `${name}: lỗi khi chạy`, e.stack); await s.shot(name + "-fail").catch(() => {}); }
    await s.close();
    await sleep(500);
  }
} finally {
  for (const t of [t1, t2]) await api("DELETE", `/api/tasks/${t}`);
  db.close();
}
const fails = results.filter((c) => !c).length;
console.log(`\n${results.length - fails}/${results.length} đạt · ảnh: ${SCR}failrow-*.png`);
process.exit(fails ? 1 : 0);
