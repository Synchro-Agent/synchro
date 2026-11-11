// Đồ họa nâng cao trong khung artifact, kiểm bằng Chrome ẩn thật, không cần máy chủ Synchro, không gọi mạng (mọi yêu cầu do bài thử trả lời, yêu cầu lạ tính là lỗi):
// 1. Khung ảnh chia sẻ .sx-og 1200×630 và PNG 3x đúng cỡ (3600×1890, poster 3240×4320), chữ vẫn nét.
// 2. PowerPoint: vật thể có tên (data-pptx-object-name / data-sx-morph) thành ảnh riêng mang đúng tên "!!…", hộp chữ mang tên, slide sau có chuyển cảnh Morph; xuất cũ không đổi.
// 3. Biểu đồ ECharts của bộ thiết kế (data-sx-chart): 6 loại vẽ được bằng SVG, PowerPoint có biểu đồ gốc (waterfall là cột chồng có chuỗi nền trong suốt), sankey giữ trong ảnh.
// 4. Nền shader 3D (data-sx-shader): tải lười đúng khi dùng, có lớp CSS dự phòng, giảm chuyển động thì đứng yên, PNG / PowerPoint không trắng.
// Chạy: node tests/ui/media-kit.mjs   (SHOTS=<thư mục> để lưu ảnh chụp các trạng thái)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

const R = createRequire(path.join(process.cwd(), "package.json"));
const ts = R("typescript"), JSZip = R("jszip");
const { artdoc, deckpptx, designpresets } = await loadTs(["artdoc", "deckpptx", "designpresets"]);
const { buildDocCore } = artdoc;
const SHOTS = process.env.SHOTS ?? "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const CDP = Number(process.env.CDP_PORT ?? 9388), PROF = path.join(os.tmpdir(), `synchro-ui/chrome-prof-media-${CDP}`);
rmSync(PROF, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails++; };

// Mã dựng tệp PowerPoint thật (deckpptx.ts) chạy trong trang: dịch TypeScript, bỏ import / export, phông của bộ thiết kế truyền vào dạng JSON.
const DECK_JS = (() => {
  const src = readFileSync("app/deckpptx.ts", "utf8").replace(/^"use client";\n/, "").replace(/^import .*$/m, `const FONT_SPEC = ${JSON.stringify(designpresets.FONT_SPEC)};`);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^export /gm, "")
    + "\nwindow.__deck = { buildPptx, chartArgs, morphSlides };";
})();

const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb", "--hide-scrollbars", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 60 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null); }
if (!ver) throw new Error("không mở được Chrome");
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const waits = new Map(), errs = [], stray = [], cspErr = [], pages = new Map(), vendorLoads = [];
const ORIGIN = "https://app.test";
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const answer = (S, requestId, body, type) => send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: type }, { name: "access-control-allow-origin", value: "*" }], body: Buffer.from(body).toString("base64") }, S);
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0]);
  if (m.method === "Log.entryAdded" && /Content Security Policy/i.test(m.params.entry.text)) cspErr.push(m.params.entry.text.slice(0, 200));
  if (m.method === "Fetch.requestPaused") {
    const { requestId, request } = m.params, S = m.sessionId, u = request.url;
    if (u.startsWith(`${ORIGIN}/doc/`)) return answer(S, requestId, pages.get(u) ?? "", "text/html; charset=utf-8");
    if (u.startsWith(`${ORIGIN}/vendor/`)) { const f = path.join("public/vendor", path.basename(new URL(u).pathname)); vendorLoads.push(path.basename(f)); if (existsSync(f)) return answer(S, requestId, readFileSync(f), "application/javascript"); }
    // Phông Google: không có mạng thì trả CSS rỗng (chữ dùng phông dự phòng), không tính là lỗi.
    if (u.startsWith("https://fonts.googleapis.com/")) return answer(S, requestId, "", "text/css");
    if (u.endsWith("/favicon.ico")) return send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, S);
    stray.push(u.slice(0, 120));
    send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, S);
  }
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable"); await P("Log.enable");
await P("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const view = (width, height) => P("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
const media = (features = []) => P("Emulation.setEmulatedMedia", { media: "", features });
const BR = `<script>window.__posts=[];function post(m){window.__posts.push(m)}${deckpptx.PPTX_FRAME_JS}</script><script src="${ORIGIN}/vendor/${artdoc.H2I[0]}"></script><script>${DECK_JS.replace(/<\/script/gi, "<\\/script")}</script>`;
let docN = 0;
const open = async (content, { deck = false, type = "html" } = {}) => {
  const url = `${ORIGIN}/doc/${++docN}`;
  pages.set(url, buildDocCore(type, content, ORIGIN, "t", false, BR, deck ? { fixed: null } : undefined));
  const done = new Promise((r) => { const h = (e) => { const m = JSON.parse(e.data); if (m.method === "Page.loadEventFired" && m.sessionId === S) { ws.removeEventListener("message", h); r(); } }; ws.addEventListener("message", h); });
  await P("Page.navigate", { url });
  await done;
  await ev(`document.fonts.ready.then(() => 1)`);
  await sleep(150);
};
const shot = async (name) => { if (!SHOTS) return; const r = await P("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, "base64")); };
const waitPost = async (pred, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { const m = await ev(`window.__posts.find(${pred}) || null`); if (m) return m; await sleep(150); } return null; };
// Kích thước và độ "nét" của PNG: số điểm ảnh đổi màu mạnh theo hàng ngang ở giữa ảnh (chữ mờ / phóng to thì gần như không có).
// up: phóng ảnh lên đúng chiều rộng đó trước khi đo (giả lập "ảnh nhỏ phóng to" để so với ảnh vẽ thật ở cỡ lớn).
const pngInfo = (data, up = 0) => ev(`new Promise((ok) => { const im = new Image(); im.onload = () => { const W = ${up} || im.width, H = Math.round(im.height * W / im.width), c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, W, H);
  let edges = 0, energy = 0, colors = new Set(); for (let f = 0.05; f < 0.96; f += 0.015) { const d = x.getImageData(0, Math.round(H * f), W, 1).data; for (let i = 4; i < d.length; i += 4) { const dl = (d[i] + d[i + 1] + d[i + 2] - d[i - 4] - d[i - 3] - d[i - 2]) / 3; energy += dl * dl; if (Math.abs(d[i] - d[i - 4]) + Math.abs(d[i + 1] - d[i - 3]) + Math.abs(d[i + 2] - d[i - 2]) > 120) edges++; if (i % 40 === 0) colors.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); } }
  ok({ w: W, h: H, edges, energy: Math.round(energy / 1000), colors: colors.size }); }; im.onerror = () => ok(null); im.src = ${JSON.stringify(data)}; })`);

// ---------------------------------------------------------------- 1. ảnh chia sẻ, PNG 3x
console.log("1. Khung ảnh chia sẻ .sx-og 1200×630 và PNG 3x");
const OG = `<html data-sx-preset="midnight-tech"><body><div class="sx-og sx-aurora"><div class="sx-row sx-between"><span class="sx-badge">Báo cáo quý</span><span class="sx-small">Synchro Research</span></div><div class="sx-row sx-between" style="align-items:flex-end"><h1 class="sx-display" style="max-width:calc(700*var(--sx-u))">Tự động hóa đưa biên ròng lên mức kỷ lục</h1><div class="sx-card"><p class="sx-kpi sx-up">+14,2%</p><p class="sx-small">Biên lợi nhuận ròng</p></div></div></div></body></html>`;
for (const [w, h] of [[1280, 800], [1920, 700], [640, 900], [390, 844]]) {
  await view(w, h); await open(OG);
  const g = await ev(`(() => { const s = document.querySelector(".sx-og"), b = s.getBoundingClientRect(), d = document.documentElement; return { w: b.width, h: b.height, l: b.left, t: b.top, cw: d.clientWidth, ch: d.clientHeight, sw: d.scrollWidth, sh: d.scrollHeight, over: s.scrollHeight > s.clientHeight + 1 }; })()`);
  check(`ảnh chia sẻ ở cửa sổ ${w}×${h}: đúng 1200:630, không cuộn, nằm giữa, chữ không tràn`, Math.abs(g.w / g.h - 1200 / 630) < 0.01 && g.sw <= g.cw && g.sh <= g.ch && Math.abs(g.l - (g.cw - g.w) / 2) < 1 && Math.abs(g.t - (g.ch - g.h) / 2) < 1 && !g.over, JSON.stringify(g));
  if (w === 1280) await shot("og-1280.png");
}
await view(640, 900); await open(OG);
await ev(`sxCapture("og3", "", 3)`);
const og3 = await waitPost(`(p) => p.id === "og3"`);
const og3i = og3?.data ? await pngInfo(og3.data) : null;
check("PNG 3x ảnh chia sẻ: đúng 3600×1890 dù khung xem chỉ rộng 640", og3i?.w === 3600 && og3i?.h === 1890, JSON.stringify(og3i ?? og3?.error));
await ev(`window.__posts = []; sxCapture("og1", "")`);
const og1 = await waitPost(`(p) => p.id === "og1"`), og1i = og1?.data ? await pngInfo(og1.data) : null;
// Chữ vẽ lại ở cỡ đích: số cạnh sắc trên mỗi hàng tăng theo cỡ ảnh, không nhòe như phóng ảnh nhỏ.
const upi = og1?.data ? await pngInfo(og1.data, 3600) : null;
// Nét thật: mép chữ ở cỡ 3600 vẫn gắt (năng lượng tần số cao Σ(chênh lệch sáng giữa hai điểm kề nhau)² lớn); ảnh thường phóng lên 3600 thì mép nhòe ra nhiều điểm ảnh, năng lượng tụt hẳn.
check("PNG 3x: chữ vẽ lại ở cỡ đích, không nhòe như ảnh nhỏ phóng to", og3i && upi && og3i.energy > upi.energy * 1.3, `3x ${og3i?.energy} · thường ${og1i?.w}px phóng lên 3600: ${upi?.energy}`);
if (SHOTS && og3?.data) writeFileSync(path.join(SHOTS, "og-3x.png"), Buffer.from(og3.data.split(",")[1], "base64"));
const POSTER = `<html data-sx-preset="exec-navy"><body><div class="sx-poster"><p class="sx-eyebrow">Nhãn sự kiện</p><h1 class="sx-display">Đêm nhạc cuối năm</h1><p class="sx-source">Nguồn: ban tổ chức</p></div></body></html>`;
await view(700, 900); await open(POSTER);
await ev(`sxCapture("p3", "", 3)`);
const p3 = await waitPost(`(p) => p.id === "p3"`), p3i = p3?.data ? await pngInfo(p3.data) : null;
check("PNG 3x poster: đúng 3240×4320, có chữ", p3i?.w === 3240 && p3i?.h === 4320 && p3i.edges > 50, JSON.stringify(p3i ?? p3?.error));
if (SHOTS && p3?.data) writeFileSync(path.join(SHOTS, "poster-3x.png"), Buffer.from(p3.data.split(",")[1], "base64"));
// In: ảnh chia sẻ in ra một trang đúng khổ.
await view(1000, 700); await open(OG);
const pdf = await P("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
const pdfTxt = Buffer.from(pdf.data, "base64").toString("latin1"), box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/.exec(pdfTxt);
check("in ảnh chia sẻ: một trang 1200×630 (12,5×6,5625 in)", (pdfTxt.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length === 1 && box && Math.abs(box[1] / box[2] - 1200 / 630) < 0.01, box?.slice(1).join("×"));

// ---------------------------------------------------------------- 2. PowerPoint: vật thể có tên, Morph
console.log("2. PowerPoint: vật thể có tên (!!) thành đối tượng riêng, chuyển cảnh Morph");
const IMG = "data:image/svg+xml;base64," + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="90" fill="#0EA5E9"/></svg>`).toString("base64");
const MORPH_DECK = `<html data-sx-preset="midnight-tech"><body>
<section class="slide sx-slide"><p class="sx-eyebrow">Ra mắt</p><h2 class="sx-title" data-pptx-object-name="!!title">Sản phẩm mới đã sẵn sàng</h2><img data-sx-morph="!!hero" src="${IMG}" style="width:calc(320*var(--sx-u));height:calc(320*var(--sx-u))"><div class="sx-card" data-sx-morph="!!kpi"><p class="sx-kpi">98%</p><p class="sx-small">Khách hàng hài lòng</p></div></section>
<section class="slide sx-slide"><h2 class="sx-title" data-pptx-object-name="!!title">Chi tiết sản phẩm</h2><div class="sx-row"><img data-sx-morph="!!hero" src="${IMG}" style="width:calc(160*var(--sx-u));height:calc(160*var(--sx-u))"><div class="sx-card" data-sx-morph="!!kpi"><p class="sx-kpi">98%</p><p class="sx-small">Khách hàng hài lòng</p></div></div></section>
<section class="slide sx-slide"><h2 class="sx-title">Slide không có vật thể chung</h2><p class="sx-text">Không chuyển cảnh Morph ở đây.</p></section></body></html>`;
const buildDeck = async () => {
  await ev(`window.__posts = []; sxPptx("d", "")`);
  const m = await waitPost(`(p) => p.t === "pptx"`, 120000);
  if (!m || m.error) return { error: m?.error ?? "hết giờ" };
  const b64 = await ev(`(async () => { const m = window.__posts.find((p) => p.t === "pptx"); const b = await window.__deck.buildPptx(m.slides, m.w, m.h, "t"); const a = new Uint8Array(await b.arrayBuffer()); let s = ""; for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode(...a.subarray(i, i + 32768)); return btoa(s); })()`);
  const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  const slides = [];
  for (let i = 1; zip.file(`ppt/slides/slide${i}.xml`); i++) slides.push(await zip.file(`ppt/slides/slide${i}.xml`).async("string"));
  const charts = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).sort().map((f) => zip.file(f).async("string")));
  return { m, slides, charts, buf: Buffer.from(b64, "base64") };
};
await view(1280, 720); await open(MORPH_DECK, { deck: true });
await shot("morph-slide1.png");
const md = await buildDeck();
check("dựng tệp PowerPoint có vật thể tên không lỗi", !md.error && md.slides?.length === 3, md.error ?? `${md.slides?.length} slide`);
if (!md.error) {
  const names = (x) => [...x.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map((m) => m[1]);
  const n1 = names(md.slides[0]), n2 = names(md.slides[1]);
  check("slide 1 và 2 có ảnh !!hero, thẻ !!kpi và hộp chữ !!title cùng tên", ["!!hero", "!!kpi", "!!title"].every((n) => n1.includes(n) && n2.includes(n)), `${n1.join(", ")} | ${n2.join(", ")}`);
  check("chữ trong thẻ có tên vẫn là hộp chữ sửa được, mang tên theo thẻ (!!kpi·1, !!kpi·2)", n1.includes("!!kpi·1") && n2.includes("!!kpi·2") && /98%/.test(md.slides[0]) && /hài lòng/.test(md.slides[0]), n1.join(", "));
  check("ảnh vật thể là ảnh riêng (p:pic), không dàn phẳng vào nền", (md.slides[0].match(/<p:pic>/g) ?? []).length >= 2, `${(md.slides[0].match(/<p:pic>/g) ?? []).length} ảnh`);
  check("slide 2 có chuyển cảnh Morph (p159:morph, dự phòng Fade), slide 1 và 3 không", md.slides[1].includes(`<p159:morph option="byObject"/>`) && md.slides[1].includes("<mc:Fallback><p:transition spd=\"slow\"><p:fade/>") && !md.slides[0].includes("p159") && !md.slides[2].includes("p159"));
  check("chuyển cảnh nằm ngay sau p:clrMapOvr (đúng thứ tự phần tử của p:sld)", /<\/p:clrMapOvr><mc:AlternateContent/.test(md.slides[1]));
  if (SHOTS) writeFileSync(path.join(SHOTS, "morph.pptx"), md.buf);
}
// Bản trình bày không có tên: tệp như cũ, không thêm chuyển cảnh hay ảnh lạ.
const PLAIN = `<html data-sx-preset="exec-navy"><body><section class="slide sx-slide"><p class="sx-eyebrow">Nhãn</p><h2 class="sx-title">Biên lợi nhuận lên 14,2%</h2></section><section class="slide sx-slide"><p class="sx-kpi">+3,1 đ.p.</p></section></body></html>`;
await open(PLAIN, { deck: true });
const pd = await buildDeck();
check("bản trình bày không có tên: không chuyển cảnh, không ảnh riêng, chữ vẫn là hộp chữ", !pd.error && pd.slides.every((x) => !x.includes("p:transition") && !x.includes("<p:pic>")) && /14,2%/.test(pd.slides[0]), pd.error ?? "");

check("không có yêu cầu mạng lạ", !stray.length, stray.slice(0, 5).join(" | "));
check("CSP không chặn gì", !cspErr.length, cspErr.slice(0, 3).join(" | "));
check("không có lỗi JavaScript", !errs.length, errs.slice(0, 3).join(" | "));
ws.close(); chrome.kill();
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exit(fails ? 1 : 0);
