// Bộ tự vá của bộ thiết kế (FIT_JS, shared/artkit.ts) trong khung bản trình bày, đo trên Chrome ẩn, không cần dev:mock (trang dựng bằng buildDocCore, mở file://).
// Bản trình bày mẫu NẶNG: mỗi slide có nhiều ô chữ tự có khung cố định tràn (fitSelf) và cả slide tràn (fitFrame), để lần vá một slide tốn hàng trăm ms như
// bản trình bày thật ở T8 (lỗi 14 của ma trận H1: nhãn "Slide n / N" đã sang slide mới mà khung đứng ở slide cũ ~1,5 giây).
//  1. Chuyển slide: slide mới được vẽ trong ≤ 250 ms sau lệnh chuyển, dù lần vá tốn ≥ 300 ms (bộ vá cũ chạy trong rAF, trước lần vẽ: hỏng ở đây).
//  2. Sau lần vẽ đó, cỡ chữ / màu chữ đã vá xong trong thời gian ngắn (đo "cú nhảy" từ lần vẽ đầu tới lúc vá xong) và chỉ một lần mỗi slide.
//  3. Phông web tải xong sau khi slide đã được vá bằng phông dự phòng: slide đang hiện vá lại ngay, slide đã rời đi vá lại (từ cỡ gốc) lần hiện ra tới.
//  4. Tiêu đề dài ở khung 1280×720: tiêu đề co không dưới 28px và 1,4 lần chữ thân; co hết bậc mà vẫn tràn thì mọi ô
//     giữ cỡ gốc và khung mang data-sx-fitover (bộ kiểm tra báo tràn cho model); slide không ô nào co được cũng vậy.
// Chạy: node tests/ui/deck-fit.mjs. SHOTS=<thư mục>: ảnh slide. So với bộ vá khác: FIT_FROM=<shared/artkit.ts của một
// bản nguồn khác> (worktree, hay thư mục giải từ git archive): thư mục shared/ của bản đó được nạp như mô-đun (loadTs)
// và FIT_JS của nó thay cho bộ vá đang có trong mọi trang của bài này.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sleep } from "../lib/wait.mjs";
import { loadTs } from "../lib/ts.mjs";

const PORT = Number(process.env.CDP_PORT ?? 9397);
const SHOTS = process.env.SHOTS;
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };
const { artdoc: D, artkit: A, deckfit: DF } = await loadTs(["artdoc", "artkit", "deckfit"]);

// ---------------------------------------------------------------- bản trình bày mẫu
// Ô chữ tự có khung cố định (overflow:hidden, cao 34px) mà chữ 64px: fitSelf co từng 1px tới khi vừa, mỗi bước một lần dàn trang.
// Lưới 40 thẻ chữ dài trong slide cao đúng 720px: cả slide tràn, fitFrame co mọi ô chữ của slide theo tỉ lệ.
const slide = (k, n) => `<section class="slide sx-slide" data-slide="${k}" style="position:relative;padding:48px;box-sizing:border-box;height:100vh;overflow:hidden;background:${k % 2 ? "#F4EFE6" : "#1f2a44"};color:${k % 2 ? "#222" : "#ddd"}">
<h2 class="sx-title" data-node-id="s${k}.title" style="font-size:64px;margin:0 0 12px">Lợi thế vận hành ${k}</h2>
<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-bottom:10px">${Array.from({ length: Number(process.env.DECK_KPI ?? 200) }, (_, j) => `<div data-node-id="s${k}.k${j}" style="height:34px;overflow:hidden;font-size:64px;line-height:1.1;background:${k % 2 ? "#e8e1d4" : "#2b3756"}">KPI ${j + 1}: +${j + 3}% mỗi tháng</div>`).join("")}</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${Array.from({ length: Number(process.env.DECK_CARDS ?? 90) }, (_, j) => `<div class="sx-card" data-node-id="s${k}.c${j}" style="font-size:22px;color:${j % 3 ? "#8a8a8a" : "#9aa"}">Mốc ${j + 1}: tăng trưởng đều mỗi tháng trên ${n} micro-hub, chi phí giao hàng giảm</div>`).join("")}</div>
<footer data-node-id="s${k}.foot" style="position:absolute;bottom:20px;font-size:18px">${String(k).padStart(2, "0")} / ${String(n).padStart(2, "0")}</footer></section>`;
// Slide 5, 6 (phần 2) nhẹ: 12 ô KPI có khung cố định, slide không tràn, nên cỡ chữ sau khi vá nằm giữa chừng (không chạm sàn 11) và khác nhau theo phông.
const light = (k, n) => `<section class="slide sx-slide" data-slide="${k}" style="position:relative;padding:48px;box-sizing:border-box;height:100vh;overflow:hidden;background:#F4EFE6;color:#222">
<h2 class="sx-title" data-node-id="s${k}.title" style="font-size:56px;margin:0 0 24px">Chỉ số chính ${k}</h2>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">${Array.from({ length: 12 }, (_, j) => `<div data-node-id="s${k}.k${j}" style="height:60px;overflow:hidden;white-space:nowrap;font-size:64px;line-height:1.1;background:#e8e1d4">KPI ${j + 1}: +${j + 3}% mỗi tháng</div>`).join("")}</div>
<footer data-node-id="s${k}.foot" style="position:absolute;bottom:20px;font-size:18px">${String(k).padStart(2, "0")} / ${String(n).padStart(2, "0")}</footer></section>`;
const N = 6;
const deck = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui}html.fb [data-node-id]{letter-spacing:.35em}</style></head><body data-sx-preset="swiss-grid">
${Array.from({ length: N }, (_, k) => (k < 4 ? slide : light)(k + 1, N)).join("\n")}</body></html>`;
// FIT_JS của bản nguồn khác: chép shared/ của bản đó vào node_modules/.cache của bản này (gói npm vẫn tìm thấy) rồi
// nạp như mô-đun: FIT_JS ghép từ hằng số và mã của tệp khác (TYPE_ELS_JS, TITLE_FLOOR), cắt chuỗi từ mã nguồn thì
// thiếu các phần đó và trang báo lỗi cú pháp.
async function fitFrom(file) {
  const tmp = mkdtempSync(path.join(process.cwd(), "node_modules", ".cache", "fit-from-"));
  const here = process.cwd();
  cpSync(path.dirname(path.resolve(file)), path.join(tmp, "shared"), { recursive: true });
  process.chdir(tmp);
  try {
    const name = `shared/${path.basename(file, ".ts")}`;
    return (await loadTs([name]))[name].FIT_JS;
  } finally {
    process.chdir(here);
    rmSync(tmp, { recursive: true, force: true });
  }
}
const FIT = process.env.FIT_FROM ? await fitFrom(process.env.FIT_FROM) : A.FIT_JS;
if (process.env.FIT_FROM) console.log(`(bộ vá lấy từ ${process.env.FIT_FROM})`);
const withFit = (html) => {
  if (!html.includes(A.FIT_JS)) throw new Error("trang không có bộ tự vá (FIT_JS)");
  return html.split(A.FIT_JS).join(FIT);
};
const built = D.buildDocCore("html", deck, "http://127.0.0.1:9", "deckfit", false, "", { fixed: null }, "Deck", false);
let doc = withFit(built);
// Phông web: không phụ thuộc mạng. document.fonts.status đọc qua getter giả lập; "tải xong" = bỏ lớp fb (chữ dự phòng rộng hơn) rồi phát sự kiện loadingdone.
const FONT_SIM = `<script>(function(){var st="loaded";try{Object.defineProperty(document.fonts,"status",{configurable:true,get:function(){return st}})}catch(e){}
window.__fontsLoading=function(){st="loading";document.documentElement.classList.add("fb")};
window.__fontsLoaded=function(){st="loaded";document.documentElement.classList.remove("fb");document.fonts.dispatchEvent(new Event("loadingdone"))}})()</script>`;
doc = doc.replace(/<head>/i, `<head>${FONT_SIM}`);
const dir = path.join(tmpdir(), "synchro-ui", "deck-fit");
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const file = path.join(dir, "deck.html");
writeFileSync(file, doc);

// Bản trình bày tiêu đề dài (phần 4): slide của bộ thiết kế (.sx-slide, cỡ theo --sx-u).
//  1. Bìa: tiêu đề .sx-display 80px có data-sx-fit, dòng mô tả 26px, chín đoạn văn 20px làm tràn mà không ô nào co
//     được ngoài tiêu đề (đúng cảnh bộ slide của tài khoản miễn phí: tiêu đề bị co còn nhỏ hơn dòng mô tả).
//  2. Tràn ít, co tiêu đề một chút là vừa; chữ thân 32px nên tiêu đề không dưới 45px (1,4 lần).
//  3. Tiêu đề tự có khung cố định (overflow hidden) quá thấp: co tới sàn vẫn không vừa.
//  4. Tiêu đề, hai số KPI, chú thích có data-sx-fit và mười hai đoạn văn không đánh dấu: co hết bậc vẫn tràn.
//  5. Không ô nào có data-sx-fit, mười hai đoạn văn làm tràn.
//  6. Tiêu đề 60px dài, năm đoạn văn 24px: chỉ vừa khi tiêu đề còn ~31px, dưới 1,4 lần chữ thân (34px). Bộ tự co
//     giữ cỡ gốc và báo tràn, không để lại tiêu đề mà bộ kiểm tra thứ bậc bắt lỗi (sàn 28px từng cho ra đúng 31px).
const LONG = "Kế hoạch mở rộng chuỗi trà sữa giao bằng xe điện ra mười hai quận nội thành Hà Nội trong năm 2027";
const PARA = "Mỗi micro-hub phục vụ bán kính ba ki-lô-mét, giao trong mười tám phút, chi phí giảm dần theo mật độ.";
const big = (n) => `style="font-size:calc(${n}*var(--sx-u))"`;
const paras = (n, attr = "") => Array.from({ length: n }, () => `<p class="sx-text" ${attr}>${PARA}</p>`).join("\n");
const TITLE_SLIDES = 6;
const titleDeck = `<!doctype html><html><head><meta charset="utf-8"></head><body data-sx-preset="swiss-grid">
<section class="slide sx-slide"><h1 class="sx-display" data-sx-fit>${LONG}</h1>
<p class="sx-text" ${big(26)}>Dòng mô tả của slide: vì sao năm 2027 là thời điểm mở rộng.</p>
${paras(9)}</section>
<section class="slide sx-slide"><h1 class="sx-display" data-sx-fit>${LONG} và mười quận ngoại thành lân cận</h1>
${paras(2, big(32))}</section>
<section class="slide sx-slide">
<h2 class="sx-title" data-sx-fit style="height:calc(40*var(--sx-u));overflow:hidden">${LONG}</h2>
<p class="sx-text">${PARA}</p></section>
<section class="slide sx-slide"><h2 class="sx-title" data-sx-fit>Doanh thu quý ba vượt kế hoạch</h2>
<div style="display:flex;gap:calc(24*var(--sx-u))"><div class="sx-card"><p class="sx-kpi" data-sx-fit>42%</p>
<p class="sx-small" data-sx-fit>Tăng trưởng so với cùng kỳ</p></div>
<div class="sx-card"><p class="sx-kpi" data-sx-fit>18'</p></div></div>
${paras(12)}</section>
<section class="slide sx-slide"><h2 class="sx-title">${LONG}</h2>
${paras(12)}</section>
<section class="slide sx-slide"><h2 class="sx-title" data-sx-fit style="font-size:calc(60*var(--sx-u))">${LONG} ${LONG}</h2>
${paras(5, big(24))}</section></body></html>`;
const titleFile = path.join(dir, "title.html");
writeFileSync(titleFile, withFit(D.buildDocCore("html", titleDeck, "http://127.0.0.1:9", "deckfit", false, "",
  { fixed: null }, "Deck")));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- Chrome
const chrome = spawn(process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"),
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(dir, "prof")}`, "--window-size=1280,720", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 60 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null); }
if (!ver) { chrome.kill(); throw new Error("Chrome không mở được"); }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const waits = new Map(), errs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [y, n] = waits.get(m.id); waits.delete(m.id); m.error ? n(new Error(JSON.stringify(m.error))) : y(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "").split("\n")[0]);
});
const send = (method, params = {}, sessionId) => new Promise((y, n) => { const id = ++seq; waits.set(id, [y, n]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (m, p) => send(m, p, S);
const ev = async (expr) => {
  const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(60); } return false; };
const shot = async (name) => { if (!SHOTS) return; const { data } = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, "base64")); };

// Trong trang: mỗi lệnh chuyển slide ghi lúc gọi (t0), lần vẽ đầu sau đó (paint: rAF rồi setTimeout, tức sau lần vẽ) và lúc slide được ghi đã vá (fit).
const PROBE = `(() => { const g = window.__sxGo; window.__log = []; window.__sxGo = function (i) { const e = { i, t0: performance.now() }; window.__log.push(e); g(i);
  requestAnimationFrame(() => setTimeout(() => { e.paint = performance.now() - e.t0; e.shown = window.__sxIdx(); }, 0)); };
  new MutationObserver((ms) => { for (const m of ms) { const t = m.target; if (!t.hasAttribute("data-sx-fitok") && !t.hasAttribute("data-sx-fitpre")) continue; const e = [...window.__log].reverse().find((x) => window.__sxAll()[x.i] === t); if (e && e.fit == null) e.fit = performance.now() - e.t0; } })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-sx-fitok", "data-sx-fitpre"] }); return 1; })()`;
const sizes = (k) => `(() => { const s = window.__sxAll()[${k}]; return [...s.querySelectorAll("[data-node-id]")].map((e) => parseFloat(getComputedStyle(e).fontSize)); })()`;
const fitDone = (k) => `(() => { const s = window.__sxAll()[${k}]; return s.hasAttribute("data-sx-fitok") || s.hasAttribute("data-sx-fitpre"); })()`;

try {
  await P("Page.enable"); await P("Runtime.enable");
  await P("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await P("Page.navigate", { url: "file://" + file });
  ok(await until(`typeof window.__sxGo === "function" && typeof window.__sxFit === "function" && window.__sxAll().length === ${N}`), `trang mở được, ${N} slide, có bộ tự vá`);
  await until(fitDone(0), 8000);
  await sleep(300);
  await ev(PROBE);

  console.log("1. Chuyển slide: slide mới vẽ ngay, không chờ bộ vá");
  // CPU chậm 2 lần cho phần đo này: bộ vá co chữ bằng chia đôi (896590ea) nhanh hơn ~2,5 lần, máy rảnh vá một slide chỉ ~210 ms (đo trên
  // w10-integ), dưới mức 300 ms để bộ vá cũ (chạy trước lần vẽ) chắc chắn làm hỏng cổng vẽ ≤ 250 ms. Chậm 2 lần: ~420 ms, đo vẫn có nghĩa.
  await P("Emulation.setCPUThrottlingRate", { rate: 2 });
  for (const k of [1, 2, 3]) {
    await ev(`window.__sxGo(${k})`);
    await until(`window.__log.at(-1).paint != null && window.__log.at(-1).fit != null`, 8000);
    await sleep(150);
  }
  const log = await ev(`window.__log.map((e) => ({ i: e.i, paint: Math.round(e.paint), fit: Math.round(e.fit), shown: e.shown }))`);
  await P("Emulation.setCPUThrottlingRate", { rate: 1 });
  console.log("   ", JSON.stringify(log));
  const heavy = Math.min(...log.map((e) => e.fit - (e.paint > e.fit ? 0 : e.paint)));
  ok(log.every((e) => e.fit >= 300 || e.paint >= 300), "bản trình bày mẫu đủ nặng: mỗi lần vá một slide tốn ≥ 300 ms (bộ vá cũ, chạy trước lần vẽ, sẽ chậm theo)", { log, heavy });
  ok(log.every((e) => e.paint <= 250), `slide mới được vẽ trong ≤ 250 ms sau lệnh chuyển (chậm nhất ${Math.max(...log.map((e) => e.paint))} ms)`, log);
  ok(log.every((e) => e.shown === e.i), "lần vẽ đầu là đúng slide vừa chuyển tới", log);
  ok(log.every((e) => e.fit >= e.paint), "bộ vá chạy SAU lần vẽ đầu", log);
  // Cú nhảy: slide hiện chữ chưa vá từ lần vẽ đầu tới lúc vá xong. Đo để biết, có giới hạn trên để không tệ hơn khung chờ của bộ kiểm tra (650 ms) quá nhiều.
  const jump = Math.max(...log.map((e) => e.fit - e.paint));
  ok(jump <= 1500, `cú nhảy (từ lần vẽ đầu tới lúc cỡ / màu chữ đã vá) ≤ 1500 ms (lâu nhất ${jump} ms)`, log);
  const shrunk = await ev(`(() => { const s = window.__sxAll()[3]; return { fitted: s.querySelectorAll("[data-sx-fitted]").length, fitok: s.hasAttribute("data-sx-fitok") }; })()`);
  ok(shrunk.fitted >= 30 && shrunk.fitok, "bộ vá vẫn co chữ của slide (≥ 30 ô) và ghi đã vá", shrunk);
  await shot("deck-fit-slide4");
  // Quay lại slide đã vá: không vá lại (ghi data-sx-fitok), nên không có cú nhảy lần thứ hai.
  await ev(`window.__sxGo(1)`); await sleep(400);
  const back = await ev(`window.__log.at(-1)`);
  ok(back.fit == null && back.paint <= 250, "quay lại slide đã vá: vẽ ngay, không vá lại lần nữa", back);

  console.log("2. Phông web tải xong sau khi đã vá bằng phông dự phòng");
  await ev(`window.__fontsLoading()`);
  await ev(`window.__sxGo(4)`);
  ok(await until(fitDone(4), 8000), "slide 5 (phông dự phòng) được vá");
  const pre = await ev(`(() => { const s = window.__sxAll()[4]; return { pre: s.hasAttribute("data-sx-fitpre"), ok: s.hasAttribute("data-sx-fitok") }; })()`);
  ok(pre.pre && !pre.ok, "vá lúc phông chưa tải: chỉ ghi data-sx-fitpre, chưa ghi đã vá xong", pre);
  const fb4 = await ev(sizes(4));
  await ev(`window.__sxGo(5)`);
  ok(await until(fitDone(5), 8000), "slide 6 (phông dự phòng) được vá");
  const fb5 = await ev(sizes(5));
  // Rời slide 5, rồi phông tải xong khi đang ở slide 6.
  await ev(`window.__fontsLoaded()`);
  await sleep(200);
  const after = await ev(`(() => { const a = window.__sxAll(); return { s5: { pre: a[4].hasAttribute("data-sx-fitpre"), ok: a[4].hasAttribute("data-sx-fitok") }, s6: { pre: a[5].hasAttribute("data-sx-fitpre"), ok: a[5].hasAttribute("data-sx-fitok") } }; })()`);
  ok(after.s6.ok && !after.s6.pre, "slide đang hiện: vá lại ngay khi phông tải xong và ghi đã vá", after);
  ok(after.s5.pre && !after.s5.ok, "slide đã rời đi: chờ vá lại lần hiện ra tới (không còn ghi đã vá)", after);
  const real5 = await ev(sizes(5));
  // Chữ dự phòng rộng hơn nên co nhỏ hơn: vá lại từ cỡ gốc thì các ô chữ lớn lên lại; chỉ vá chồng lên (không trả về cỡ gốc) thì không ô nào lớn lên.
  const grew = (a, b) => b.filter((x, i) => x > a[i] + 0.5).length;
  ok(grew(fb5, real5) >= 10, `slide đang hiện: vá lại từ cỡ gốc theo phông thật (${grew(fb5, real5)} ô chữ lớn lên lại), không chỉ co thêm`, { fb5, real5 });
  await ev(`window.__sxGo(4)`);
  ok(await until(`window.__sxAll()[4].hasAttribute("data-sx-fitok")`, 8000), "quay lại slide 5: được vá lại và ghi đã vá");
  const real4 = await ev(sizes(4));
  ok(grew(fb4, real4) >= 10, `slide 5 vá lại từ cỡ gốc theo phông thật (${grew(fb4, real4)} ô chữ lớn lên lại)`, { fb4, real4 });
  const ovf = await ev(`(() => { const s = window.__sxAll()[4]; return [...s.querySelectorAll("[data-node-id]")].filter((e) => getComputedStyle(e).overflow !== "visible" && (e.scrollHeight > e.clientHeight + 1)).length; })()`);
  ok(ovf === 0, "slide 5 sau khi vá lại: không ô chữ có khung cố định nào còn tràn", ovf);
  await shot("deck-fit-slide5");

  console.log("4. Tiêu đề dài ở khung 1280×720: sàn 28px và 1,4 lần chữ thân, co không vừa thì giữ cỡ gốc và báo");
  const openTitle = async (f) => {
    await P("Page.navigate", { url: "file://" + f });
    return until(`typeof window.__sxGo === "function" && window.__sxAll().length === ${TITLE_SLIDES}`);
  };
  // Cỡ chữ đo ở khung rộng 1280 bằng đúng hàm đo của bộ kiểm tra hiển thị (TYPE_JS), cùng cờ báo tràn của bộ tự co.
  // fit: cỡ mọi ô data-sx-fit sau bộ tự co; orig: cỡ của chúng khi trả về như gốc (__sxReset), để biết ô nào đã co.
  const typeOf = async (k) => {
    await ev(`window.__sxGo(${k})`);
    await until(fitDone(k), 8000);
    await sleep(150);
    return ev(`(() => { const s = window.__sxCur(), t = s.querySelector("h1,h2");
      const fz = () => [...s.querySelectorAll("[data-sx-fit]")].map((e) => parseFloat(getComputedStyle(e).fontSize));
      const r = { ...(${DF.TYPE_JS})(s), px: parseFloat(getComputedStyle(t).fontSize), fit: fz(),
        fitted: s.querySelectorAll("[data-sx-fitted]").length, over: s.hasAttribute("data-sx-fitover"),
        titleOver: t.hasAttribute("data-sx-fitover") };
      window.__sxReset(s);
      return { ...r, orig: fz() }; })()`);
  };
  const weakOf = (t) => DF.weakType([{ slide: 1, h: 720, w: 1280, vh: 720, vw: 1280, ...t }]);
  const kept = (t) => t.fit.every((v, i) => Math.abs(v - t.orig[i]) < 0.01) && t.fitted === 0;
  ok(await openTitle(titleFile), `trang tiêu đề dài mở được, ${TITLE_SLIDES} slide`);
  const t1 = await typeOf(0);
  console.log("    slide 1:", JSON.stringify(t1));
  ok(t1.over, "đoạn văn làm tràn mà co hết bậc vẫn không vừa: slide mang data-sx-fitover", t1);
  ok(kept(t1) && t1.title === 80, `không vừa thì tiêu đề giữ cỡ gốc 80px (còn ${t1.title}px), không ô nào bị co`, t1);
  ok(!weakOf(t1).length, "thứ bậc cỡ chữ của bìa vẫn đạt", t1);
  await shot("deck-fit-title1");
  const t2 = await typeOf(1);
  console.log("    slide 2:", JSON.stringify(t2));
  ok(t2.title < 80 && t2.title >= 45, `tràn ít: tiêu đề co còn ${t2.title}px, không dưới 1,4 lần chữ thân 32px`, t2);
  ok(!t2.over && !weakOf(t2).length, "co vừa khung: không báo tràn, thứ bậc đạt", t2);
  const t3 = await typeOf(2);
  console.log("    slide 3:", JSON.stringify(t3));
  ok(t3.titleOver && kept(t3), `tiêu đề tự có khung quá thấp: giữ cỡ gốc ${t3.title}px và báo tràn`, t3);
  const t4 = await typeOf(3);
  console.log("    slide 4:", JSON.stringify(t4));
  ok(t4.over && kept(t4), "tiêu đề, KPI, chú thích có data-sx-fit, đoạn văn không đánh dấu làm tràn: giữ cỡ gốc, báo"
    + ` tràn (KPI ${t4.fit[1]}px, chú thích ${t4.fit[2]}px, tiêu đề ${t4.fit[0]}px)`, t4);
  await shot("deck-fit-title4");
  const t5 = await typeOf(4);
  console.log("    slide 5:", JSON.stringify(t5));
  ok(t5.over && t5.fitted === 0, "slide không ô nào có data-sx-fit mà tràn: vẫn mang data-sx-fitover", t5);
  const t6 = await typeOf(5);
  console.log("    slide 6:", JSON.stringify(t6));
  ok(t6.over && kept(t6) && !weakOf(t6).length,
    `chỉ vừa khi tiêu đề dưới 1,4 lần chữ thân 24px: giữ cỡ gốc ${t6.title}px và báo tràn, thứ bậc đạt`, t6);
  // Khung xem trong trang chat hẹp hơn 1280 (577px): --sx-u của slide nhỏ hơn 1px của trang. Bộ vá phải co đúng
  // như ở 1280, không co thêm theo tỉ lệ thu nhỏ của khung.
  await P("Emulation.setDeviceMetricsOverride", { width: 577, height: 325, deviceScaleFactor: 1, mobile: false });
  ok(await openTitle(titleFile), "khung xem hẹp 577×325: trang mở được");
  const n1 = await typeOf(0), n2 = await typeOf(1);
  console.log("    577×325, slide 1, 2:", JSON.stringify([n1.title, n1.over, n2.title, n2.over]));
  ok(n1.title === t1.title && n1.over && Math.abs(n2.title - t2.title) <= 1 && !n2.over,
    `khung hẹp: tiêu đề ${n1.title}px, ${n2.title}px ở khung 1280, như ở 1280×720`, { n1, n2 });
  await P("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  ok(await openTitle(titleFile), "trở lại 1280×720");
  await ev(`window.__sxGo(2)`);
  await until(fitDone(2), 8000);
  await ev(`window.__sxReset()`);
  const cleared = await ev(`document.querySelectorAll("[data-sx-fitover]").length`);
  ok(cleared === 0, "trả về như gốc (đổi phong cách) thì bỏ cả cờ báo tràn", cleared);
  ok(!errs.length, "không có lỗi JavaScript trong trang", errs.slice(0, 5));
} finally {
  try { ws.close(); } catch {}
  chrome.kill();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
