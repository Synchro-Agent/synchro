// Không nháy chữ tiếng Việt khi tải trang ở giao diện tiếng Anh (Blueprint B6 bước 10): trang dựng ở máy chủ bằng tiếng Việt (điều khoản,
// quyền riêng tư, 404, chia sẻ) giữ <body> ẩn tới khi bộ dịch duyệt xong lần đầu. Bộ lấy mẫu theo khung hình (tests/lib/flashprobe.mjs) ghi mọi chữ
// tiếng Việt hiện trên màn hình. Mỗi lần tải trang tắt bộ nhớ đệm (lần mở đầu tiên của người dùng). Đối chứng: gỡ cờ chờ dịch ngay khi nó xuất hiện
// thì bộ lấy mẫu phải thấy chữ nháy (chứng minh phép đo bắt được), rồi đo lại với mạng 3G nhanh. Nên chạy trên bản production (npm run dev:mock:fast).
// Chạy tay: node tests/ui/langflash.mjs
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { FLASH_READ, flashProbe } from "../lib/flashprobe.mjs";
import { loadTs } from "../lib/ts.mjs";

const B = process.env.BASE ?? "http://localhost:3200", H = { "content-type": "application/json", origin: B };
const PROF = tmpdir() + "/synchro-ui/chrome-prof-langflash";
const { "i18n-dict": D, langdetect: L } = await loadTs(["i18n-dict", "langdetect"]);
const FLASH = flashProbe([...D.SAME_WORDS], 9000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };

// Một liên kết chia sẻ để có trang /share/… (ShareView dựng ở máy chủ bằng tiếng Việt).
let cookie = "", share = null;
{
  const r = await fetch(B + "/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ email: "admin@synchro.test", password: "synchro-mock-123" }) });
  for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
  const s = await fetch(B + "/api/share", { method: "POST", headers: { ...H, cookie }, body: JSON.stringify({ conv: `flash-${Date.now()}`, title: "Flash", msgs: [{ role: "user", text: "Xin chào" }, { role: "ai", text: "Chào bạn" }] }) }).then((x) => x.json()).catch(() => null);
  share = s?.share?.token ?? null;
}

rmSync(PROF, { recursive: true, force: true });
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9381", `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); ver = await fetch("http://127.0.0.1:9381/json/version").then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [y, n] = waits.get(m.id); waits.delete(m.id); m.error ? n(new Error(JSON.stringify(m.error))) : y(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((y, n) => { const id = ++seq; waits.set(id, [y, n]); ws.send(JSON.stringify({ id, method, params, sessionId })); });

// Gỡ cờ ngay khi nó xuất hiện (giả lập bản chưa có cổng). Quan sát cả document vì lúc mã này chạy <html> có thể chưa có.
const NO_GATE = `new MutationObserver(() => { const h = document.documentElement; if (h && h.dataset.trwait) delete h.dataset.trwait; }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-trwait"] });`;
// Thời điểm (ms) <body> hết ẩn và lúc tiêu đề trang đã là tiếng Anh.
const TIMES = `(() => { const t0 = performance.now(); const f = () => { const t = Math.round(performance.now() - t0), h = document.documentElement;
  if (document.body && h && !h.dataset.trwait && window.__shown == null) window.__shown = t;
  if (h && h.dataset.trwait && window.__gated == null) window.__gated = t;
  if (t < 9000) requestAnimationFrame(f); }; requestAnimationFrame(f); })()`;

/** Mở url ở tiếng Anh, bộ nhớ đệm trống; net: [độ trễ ms, byte/giây] hoặc null (mạng máy). */
async function load(url, { gate = true, net = null, lang = "en", wait = 9500 } = {}) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
  const P = (m, p) => send(m, p, S);
  try {
    await P("Page.enable"); await P("Network.enable"); await P("Runtime.enable");
    await P("Network.setCacheDisabled", { cacheDisabled: true });
    if (net) await P("Network.emulateNetworkConditions", { offline: false, latency: net[0], downloadThroughput: net[1], uploadThroughput: net[1] / 2 });
    await P("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("p:uilang", ${JSON.stringify(JSON.stringify(lang))}); } catch {}` });
    if (!gate) await P("Page.addScriptToEvaluateOnNewDocument", { source: NO_GATE });
    await P("Page.addScriptToEvaluateOnNewDocument", { source: FLASH });
    await P("Page.addScriptToEvaluateOnNewDocument", { source: TIMES });
    await P("Page.navigate", { url: B + url });
    await sleep(wait);
    const r = await P("Runtime.evaluate", { expression: `({ flash: ${FLASH_READ}, shown: window.__shown ?? null, gated: window.__gated ?? null, wait: document.documentElement.dataset.trwait ?? null, h1: document.querySelector("h1")?.textContent ?? "", title: document.title })`, returnByValue: true });
    return r.result.value;
  } finally { await send("Target.closeTarget", { targetId }).catch(() => {}); }
}
const fmt = (r) => `h1=${JSON.stringify(r.h1)} hiện lúc ${r.shown}ms · ${r.flash.slice(0, 3).join(" | ")}`;

try {
  const pages = [["/terms", /Terms/], ["/privacy", /Privacy/], ["/khong-co-trang-nay", /find|exist|not found/i], ...(share ? [[`/share/${share}`, null]] : [])];
  if (!share) console.log("  (không tạo được liên kết chia sẻ, bỏ trang /share)");
  console.log("1. Có cổng, mạng máy: không chữ tiếng Việt nào hiện");
  for (const [u, re] of pages) {
    const r = await load(u);
    ok(r.gated !== null && !r.flash.length && r.wait === null && (!re || re.test(r.h1 + r.title)), `${u}: 0 chữ nháy, trang đã dịch và hiện lại`, fmt(r));
  }
  console.log("2. Đối chứng: gỡ cổng thì bộ lấy mẫu thấy chữ nháy");
  {
    const r = await load("/terms", { gate: false });
    ok(r.flash.length > 0, `/terms không cổng: ${r.flash.length} chữ tiếng Việt hiện trước khi dịch (phép đo bắt được nháy)`, fmt(r));
  }
  console.log("3. 3G nhanh (1,6 Mb/s, 562 ms), bộ nhớ đệm trống");
  const FAST3G = [562, (1.6e6 * 0.9) / 8];
  {
    const raw = await load("/terms", { gate: false, net: FAST3G, wait: 9500 });
    const r = await load("/terms", { net: FAST3G, wait: 9500 });
    console.log(`     không cổng: chữ tiếng Việt hiện ${raw.flash.length ? raw.flash.map((x) => x.match(/@(\d+)–(\d+)ms$/)).filter(Boolean).reduce((m, x) => Math.max(m, x[2] - x[1]), 0) + "ms" : "0ms"}; có cổng: trang hiện lúc ${r.shown}ms`);
    ok(raw.flash.length > 0, "không cổng: thấy chữ tiếng Việt trong lúc tải", fmt(raw));
    ok(!r.flash.length && r.shown !== null && /Terms/.test(r.h1), `có cổng: 0 chữ nháy, trang hiện bằng tiếng Anh trước lưới cuối ${L.TRWAIT_MS}ms`, fmt(r));
  }
  console.log("4. Không ảnh hưởng chỗ khác");
  {
    const vi = await load("/terms", { lang: "vi", wait: 3000 });
    ok(vi.gated === null && /Điều khoản/.test(vi.h1), "giao diện tiếng Việt: không ẩn trang", fmt(vi));
    const home = await load("/", { wait: 4000 });
    ok(home.gated === null && !home.flash.length, "trang chủ tiếng Anh: không ẩn (khung chờ của Home), không nháy chữ", fmt(home));
  }
} finally {
  ws.close(); chrome.kill();
  if (share) await fetch(`${B}/api/share?token=${share}`, { method: "DELETE", headers: { ...H, cookie } }).catch(() => {});
}
console.log(`\n${pass} đúng, ${fail} sai`);
process.exit(fail ? 1 : 0);
