// Đổi phong cách artifact không tốn lượt model, trên bản chạy giả lập (npm run dev:mock; đổi địa chỉ bằng SYNCHRO_URL).
// Đoạn chat có một bộ slide viết bằng mẫu điền sẵn (khối JSON): mở khung xem, đổi phong cách, khung đổi ngay, Giữ thành phiên bản 2.
// Chạy: node tests/ui/style-switch.mjs   (OUT=<thư mục ảnh>)
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const B = process.env.SYNCHRO_URL ?? "http://localhost:3200";
const OUT = process.env.OUT ?? path.join(os.tmpdir(), "synchro-ui", "style-switch");
const CDP = Number(process.env.CDP_PORT ?? 9341), PROF = path.join(os.tmpdir(), `synchro-ui/chrome-prof-style-${CDP}`);
mkdirSync(OUT, { recursive: true }); rmSync(PROF, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, n, x = "") => { console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); if (!c) fails++; };

const email = "style-switch@synchro.test", password = "Member-pass-123";
let cookie = "";
const api = async (p, body, method = "POST") => {
  const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  return r;
};
await api("/api/auth/signup", { email, password, profile: { fullName: "Style Tester", birthDate: "2000-01-01" } });
await api("/api/auth/login", { email, password });
if (!cookie) throw new Error("login failed");
await api("/api/chats", { wipe: Date.now() }, "PUT");

const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(), handlers = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [a, b] = waits.get(m.id); waits.delete(m.id); m.error ? b(new Error(JSON.stringify(m.error))) : a(m.result); } else if (m.method) for (const h of handlers) h(m); });
const send = (method, params = {}, sessionId) => new Promise((a, b) => { const id = ++seq; waits.set(id, [a, b]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (m, p) => send(m, p, S);
const frames = [];
handlers.push(async (m) => {
  if (m.method !== "Target.attachedToTarget") return;
  const s = m.params.sessionId;
  if (m.params.targetInfo?.type === "iframe") frames.push(s);
  await send("Runtime.enable", {}, s).catch(() => {});
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s).catch(() => {});
  await send("Runtime.runIfWaitingForDebugger", {}, s).catch(() => {});
});
const inFrames = async (expr) => { const out = []; for (const s of frames) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }, s).catch(() => null); if (r?.result?.value !== undefined) out.push(r.result.value); } return out; };
await P("Runtime.enable"); await P("Page.enable");
await P("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
await P("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await P("Network.setCookie", { name: "synchro_session", value: cookie.split("=")[1], url: B });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const until = async (expr, ms = 30000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(300); } throw new Error("timeout: " + what); };
const click = async (expr, what) => {
  const r = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error("not found: " + what);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 });
};
const shot = async (n) => { const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(OUT, `${n}.png`), Buffer.from(data, "base64")); };

// Câu trả lời của model chỉ có khối JSON của mẫu: Synchro dựng thành bộ slide.
const spec = { styleArchetype: "linear-dark", pages: [
  { templateId: "slide-cover", props: { badge: "Quý 3 · 2026", title: "Tự động hóa đưa doanh thu vượt kế hoạch", subtitle: "Tổng kết cho ban điều hành", author: "Phòng Tài chính", date: "11/2026" } },
  { templateId: "slide-fact", props: { eyebrow: "Tăng trưởng doanh thu", bigMetric: "+142%", description: "Gấp đôi mục tiêu nhờ tự động hóa phễu khách hàng." } },
  { templateId: "slide-chart", props: { eyebrow: "Theo quý", title: "Quý 3 cao nhất năm", chart: { kind: "bar", labels: ["Q1", "Q2", "Q3", "Q4"], values: [8.2, 9.6, 14.8, 12.1], unit: " tỷ", highlight: "Q3" }, insight: "Kênh trực tiếp đóng góp 61%." } },
] };
const ai = `Đây là bộ slide.\n<artifact identifier="bao-cao-q3" type="text/html" title="Báo cáo Q3"><html><body><script type="application/json" data-sx-template>${JSON.stringify(spec)}</script></body></html></artifact>`;
await sleep(30);
const now = Date.now();
const chat = { id: now, title: "Báo cáo Q3", msgs: [{ role: "user", text: "Làm bộ slide báo cáo Q3", time: now, done: true }, { role: "ai", text: ai, time: now + 1, done: true }] };
// Đoạn chat đi theo tài khoản (chatstore.ts): đẩy thẳng lên máy chủ như thiết bị khác vừa đồng bộ.
const pushed = await (await api("/api/chats", { items: [{ kind: "chat", id: String(now), upd: now + 1, data: JSON.stringify(chat) }] }, "PUT")).json();
if (!pushed.results?.[0]?.ok && !pushed[0]?.ok && !JSON.stringify(pushed).includes('"ok":true')) throw new Error("không đẩy được đoạn chat: " + JSON.stringify(pushed));
try {
  await P("Page.navigate", { url: B + "/" });
  await until(`!!document.querySelector("textarea")`, 30000, "app loaded");
  await until(`[...document.querySelectorAll("a,button,[role=button],li,div,span")].some((e) => e.textContent.trim() === "Báo cáo Q3" && e.getBoundingClientRect().width > 0)`, 20000, "chat in sidebar");
  await click(`[...document.querySelectorAll("a,button,[role=button],li,div,span")].filter((e) => e.textContent.trim() === "Báo cáo Q3" && e.getBoundingClientRect().width > 0).pop()`, "chat");
  await until(`!!document.querySelector(".art-card")`, 15000, "artifact card");
  ok(await ev(`/Bản trình bày/.test(document.querySelector(".art-card").textContent)`), "câu trả lời chỉ có khối JSON: thẻ artifact là Bản trình bày");
  if (!(await ev(`!!document.querySelector(".art-panel")`))) await click(`document.querySelector(".art-card")`, "open card");
  await until(`!!document.querySelector('.art-acts [aria-label="Đổi phong cách"]')`, 20000, "style button");
  await sleep(2500);
  const before = (await inFrames(`document.documentElement.getAttribute("data-sx-preset")`)).filter(Boolean);
  ok(before.includes("midnight-tech"), "khung dựng đúng phong cách của khối JSON (linear-dark → midnight-tech)", JSON.stringify(before));
  await shot("1-truoc");
  await click(`document.querySelector('.art-acts [aria-label="Đổi phong cách"]')`, "palette");
  await until(`!!document.querySelector(".art-style-menu .menu-item")`, 5000, "menu");
  const items = await ev(`[...document.querySelectorAll(".art-style-menu .menu-item")].map((e) => e.textContent.trim())`);
  ok(items.length === 8 && items.some((t) => t.startsWith("Kính cực quang")) && items.some((t) => /Đang dùng/.test(t)), "menu có 8 phong cách, đánh dấu phong cách đang dùng", JSON.stringify(items));
  await sleep(500);
  // Lớp kính của giao diện vẽ nền menu ở ::before: một trong hai lớp phải đặc hoàn toàn.
  const bg = await ev(`(() => { const m = document.querySelector(".art-style-menu"); return [getComputedStyle(m).backgroundColor, getComputedStyle(m, "::before").backgroundColor]; })()`);
  ok(bg.some((c) => /^rgb\(/.test(c)), "menu nền đặc, không nhìn xuyên", JSON.stringify(bg));
  await shot("2-menu");
  const t0 = Date.now();
  await click(`[...document.querySelectorAll(".art-style-menu .menu-item")].find((e) => e.textContent.trim().startsWith("Kính cực quang"))`, "aurora");
  let after = [];
  for (let i = 0; i < 20 && !after.includes("aurora-glass"); i++) { await sleep(50); after = (await inFrames(`document.documentElement.getAttribute("data-sx-preset")`)).filter(Boolean); }
  ok(after.includes("aurora-glass") && Date.now() - t0 < 1500, `bấm là khung đổi ngay, không gọi model (${Date.now() - t0} ms)`, JSON.stringify(after));
  await sleep(800);
  await shot("3-xem-thu");
  ok(await ev(`!!document.querySelector(".art-style-acts")`), "hiện Giữ / Bỏ khi đang xem thử");
  await click(`[...document.querySelectorAll(".art-style-acts button")].find((e) => e.textContent.trim() === "Giữ phong cách này")`, "keep");
  await until(`[...document.querySelectorAll(".art-ver span")].some((e) => e.textContent.trim() === "2/2")`, 15000, "version 2");
  await sleep(2500);
  const v2 = (await inFrames(`document.documentElement.getAttribute("data-sx-preset")`)).filter(Boolean);
  ok(v2.includes("aurora-glass"), "Giữ: phiên bản 2 mang phong cách mới", JSON.stringify(v2));
  await shot("4-phien-ban-2");
  // Điện thoại: thêm nút không làm tràn đầu khung xem, menu nằm trong màn hình.
  await P("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1200);
  // Đổi khổ khi thanh bên đang mở thì ngăn kéo điện thoại mở theo: bấm lớp phủ để đóng.
  if (await ev(`!!document.querySelector(".side-scrim")`)) { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await P("Input.dispatchMouseEvent", { type, x: 382, y: 700, button: "left", clickCount: 1 }); await sleep(700); }
  const head = await ev(`(() => { const h = document.querySelector(".art-head"), b = document.querySelector('.art-acts [aria-label="Đổi phong cách"]'); if (!h || !b) return null; const r = b.getBoundingClientRect(); return { over: h.scrollWidth > h.clientWidth + 1, inView: r.right <= innerWidth && r.left >= 0, page: document.documentElement.scrollWidth <= innerWidth + 1 }; })()`);
  ok(head && !head.over && head.inView && head.page, "điện thoại: đầu khung xem không tràn, nút đổi phong cách trong màn hình", JSON.stringify(head));
  if (head?.inView) {
    await click(`document.querySelector('.art-acts [aria-label="Đổi phong cách"]')`, "palette phone"); await sleep(600); await shot("5-dien-thoai");
    const m = await ev(`(() => { const r = document.querySelector(".art-style-menu").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), innerWidth]; })()`);
    ok(m[0] >= 0 && m[1] <= m[2], "điện thoại: menu phong cách nằm trọn trong màn hình", JSON.stringify(m));
    await shot("5-dien-thoai");
  }
} catch (e) { ok(false, "chạy hết kịch bản", e.message); await shot("loi").catch(() => {}); }
ws.close(); chrome.kill();
console.log(`\nẢnh: ${OUT}\n${fails ? `${fails} lỗi` : "Tất cả đạt"}`);
process.exit(fails ? 1 : 0);
