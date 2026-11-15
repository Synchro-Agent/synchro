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
const { artdoc, deckpptx, designpresets, designtemplates } = await loadTs(["artdoc", "deckpptx", "designpresets", "designtemplates"]);
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
  const src = readFileSync("ui/deckpptx.ts", "utf8").replace(/^"use client";\n/, "").replace(/^import .*$/m, `const FONT_SPEC = ${JSON.stringify(designpresets.FONT_SPEC)};`);
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
  if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n").slice(0, 4).join(" <- "));
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
// Mẫu poster điền sẵn (poster-og, dựng lại theo MasterPosterTemplate): lưới nền mà mô tả của chủ dự án nhắc tới, màu theo chữ của phong cách (sáng / tối),
// mờ dần ra mép, nằm dưới chữ. Bản Satori ở máy chủ kiểm ở tests/api/poster.test.mjs.
for (const style of ["midnight-tech", "soft-bento"]) {
  const tpl = designtemplates.expandTemplates(`<!doctype html><html><body><script type="application/json" data-sx-template>${JSON.stringify({ styleArchetype: style, pages: [{ templateId: "poster-og", props: { tag: "Báo cáo quý 3", title: "Tự động hóa đưa biên ròng lên mức kỷ lục", metricValue: "+14,2%", metricLabel: "Biên lợi nhuận ròng", author: "Synchro Research" } }] })}</script></body></html>`);
  await view(1280, 720); await open(tpl);
  const gr = await ev(`(() => { const g = document.querySelector(".sx-tpl-poster-grid"), t = document.querySelector(".sx-tpl-poster-title"); if (!g || !t) return null; const cs = getComputedStyle(g), ps = getComputedStyle(document.querySelector(".sx-tpl-poster")), b = g.getBoundingClientRect(), p = document.querySelector(".sx-tpl-poster").getBoundingClientRect();
    return { bg: cs.backgroundImage, mask: cs.maskImage || cs.webkitMaskImage, z: cs.zIndex, cover: Math.abs(b.width - p.width) < 1 && Math.abs(b.height - p.height) < 1, ink: ps.color, top: document.elementFromPoint(t.getBoundingClientRect().left + 10, t.getBoundingClientRect().top + 10) === t || t.contains(document.elementFromPoint(t.getBoundingClientRect().left + 10, t.getBoundingClientRect().top + 10)) }; })()`);
  check(`poster-og (${style}): có lớp lưới nền phủ khung, đường kẻ theo màu chữ, mờ dần ra mép, nằm dưới chữ`, !!gr && /linear-gradient/.test(gr.bg) && /radial-gradient/.test(gr.mask) && gr.z === "-1" && gr.cover && gr.top, JSON.stringify(gr));
  await shot(`poster-og-grid-${style}.png`);
}
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
  const theme = await zip.file("ppt/theme/theme1.xml")?.async("string") ?? "";
  return { m, slides, charts, theme, buf: Buffer.from(b64, "base64") };
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
  // Phông (chủ dự án chốt): tên phông thiết kế của phong cách (midnight-tech: Plus Jakarta Sans / Inter) kèm PANOSE + họ phông của Arial, chữ Đông Á / phức hợp trỏ Arial;
  // theme của tệp đặt phông tiêu đề / nội dung là phông thiết kế. Máy không có phông thì PowerPoint thay bằng phông không chân, không ra Times.
  const pre = designpresets.PRESETS.find((p) => p.id === "midnight-tech");
  const triples = md.slides.flatMap((x) => [...x.matchAll(/<a:latin typeface="([^"]+)"([^>]*)\/><a:ea typeface="([^"]+)"[^>]*\/><a:cs typeface="([^"]+)"/g)].map((m) => ({ f: m[1], a: m[2], ea: m[3], cs: m[4] })));
  const faces = new Set(triples.map((t) => t.f));
  check("hộp chữ ghi đúng tên phông thiết kế (tiêu đề, nội dung)", faces.has(pre.head) && faces.has(pre.body), [...faces].join(", "));
  // Dáng theo chồng phông CSS: phông chữ đều (JetBrains Mono) dự phòng Consolas, phông không chân dự phòng Arial.
  const want = (f) => (f === pre.mono ? ['020B0609020204030204" pitchFamily="49', "Consolas"] : ['020B0604020202020204" pitchFamily="34', "Arial"]);
  const bad = triples.filter((t) => !["Arial", "Consolas"].includes(t.f) && !(t.a.includes(`panose="${want(t.f)[0]}"`) && t.ea === want(t.f)[1] && t.cs === want(t.f)[1]));
  check("phông thiết kế kèm PANOSE + họ phông của phông dự phòng cùng dáng (không chân → Arial, chữ đều → Consolas), chữ Đông Á / phức hợp dùng phông đó", triples.length > 0 && !bad.length, JSON.stringify(bad.slice(0, 2)));
  const tf = (k) => new RegExp(`<a:${k}><a:latin typeface="([^"]+)" panose="([0-9A-F]{20})"`).exec(md.theme)?.slice(1) ?? [];
  check("theme của tệp: phông tiêu đề là phông tiêu đề của phong cách, phông nội dung là phông thiết kế nhiều chữ nhất, kèm PANOSE", tf("majorFont")[0] === pre.head && [pre.head, pre.body].includes(tf("minorFont")[0]) && tf("minorFont")[1] === "020B0604020202020204", `${tf("majorFont").join(" ")} · ${tf("minorFont").join(" ")}`);
  if (SHOTS) writeFileSync(path.join(SHOTS, "morph.pptx"), md.buf);
}
// Bản trình bày không có tên: tệp như cũ, không thêm chuyển cảnh hay ảnh lạ.
const PLAIN = `<html data-sx-preset="exec-navy"><body><section class="slide sx-slide"><p class="sx-eyebrow">Nhãn</p><h2 class="sx-title">Biên lợi nhuận lên 14,2%</h2></section><section class="slide sx-slide"><p class="sx-kpi">+3,1 đ.p.</p></section></body></html>`;
await open(PLAIN, { deck: true });
const pd = await buildDeck();
check("bản trình bày không có tên: không chuyển cảnh, không ảnh riêng, chữ vẫn là hộp chữ", !pd.error && pd.slides.every((x) => !x.includes("p:transition") && !x.includes("<p:pic>")) && /14,2%/.test(pd.slides[0]), pd.error ?? "");

// ---------------------------------------------------------------- 3. biểu đồ ECharts
console.log("3. Biểu đồ ECharts của bộ thiết kế (data-sx-chart): 6 loại, SVG, PowerPoint gốc");
const CH = (spec, h = 240) => `<div class="sx-chart" style="height:calc(${h}*var(--sx-u))" data-sx-chart='${JSON.stringify(spec).replace(/'/g, "&#39;")}'></div>`;
const SPECS = {
  bar: { type: "bar", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "2025", data: [120, 132, 101, 134] }, { name: "2026", data: [140, 152, 171, 190] }], highlight: "2026", unit: " tỷ" },
  line: { type: "line", labels: ["T1", "T2", "T3", "T4", "T5", "T6"], series: [{ name: "Người dùng", data: [12, 18, 25, 31, 44, 58] }] },
  doughnut: { type: "doughnut", labels: ["Miền Bắc", "Miền Trung", "Miền Nam"], series: [{ name: "Tỷ trọng", data: [42, 18, 40] }] },
  waterfall: { type: "waterfall", labels: ["Đầu kỳ", "Doanh thu", "Giá vốn", "Chi phí", "Cuối kỳ"], series: [{ name: "Dòng tiền", data: [500, 320, -180, -90, 0] }], total: true },
  sankey: { type: "sankey", nodes: [{ name: "Quảng cáo" }, { name: "Tự nhiên" }, { name: "Dùng thử" }, { name: "Trả phí" }], links: [{ source: "Quảng cáo", target: "Dùng thử", value: 60 }, { source: "Tự nhiên", target: "Dùng thử", value: 40 }, { source: "Dùng thử", target: "Trả phí", value: 30 }] },
  radar: { type: "radar", labels: ["Tốc độ", "Giá", "Hỗ trợ", "Tính năng", "Bảo mật"], series: [{ name: "Synchro", data: [9, 7, 8, 9, 9] }, { name: "Đối thủ", data: [6, 8, 6, 7, 6] }], highlight: 0 },
};
const CHART_DECK = `<html data-sx-preset="soft-bento"><body>
<section class="slide sx-slide"><p class="sx-eyebrow">Biểu đồ</p><h2 class="sx-title">Doanh thu 2026 vượt 2025 ở mọi quý</h2><div class="sx-grid-3 sx-grow">${CH(SPECS.bar)}${CH(SPECS.line)}${CH(SPECS.doughnut)}</div></section>
<section class="slide sx-slide"><h2 class="sx-title">Dòng tiền, phễu và năng lực</h2><div class="sx-grid-3 sx-grow">${CH(SPECS.waterfall)}${CH(SPECS.sankey)}${CH(SPECS.radar)}</div></section></body></html>`;
await view(1280, 720); await open(CHART_DECK, { deck: true });
const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(200); } return false; };
const ready1 = await until(`document.querySelectorAll("[data-sx-chart-ready]").length === 3`);
const lazy = await ev(`document.querySelectorAll("[data-sx-chart-ready]").length`);
check("biểu đồ ở slide chưa xem chưa vẽ (khung cỡ 0), vẽ khi slide hiện ra", ready1 && lazy === 3, String(lazy));
await ev(`window.__sxGo(1)`);
const ready = await until(`document.querySelectorAll("[data-sx-chart-ready]").length === 6`);
await ev(`window.__sxGo(0)`); await sleep(300);
const info = await ev(`[...document.querySelectorAll("[data-sx-chart]")].map((e) => ({ t: JSON.parse(e.dataset.sxChart).type, svg: !!e.querySelector("svg"), paths: e.querySelectorAll("svg path,svg rect").length, err: e.dataset.sxChartError || "" }))`);
check("6 loại biểu đồ (bar, line, doughnut bo góc, waterfall, sankey, radar) vẽ xong bằng SVG", ready && info.every((x) => x.svg && x.paths > 3 && !x.err), JSON.stringify(info));
check("ECharts chỉ nạp một lần từ /vendor (bản ghim SRI)", vendorLoads.filter((f) => f === "echarts-6.1.0.min.js").length === 1, vendorLoads.join(", "));
const col = await ev(`(() => { const e = document.querySelector("[data-sx-chart]"); const fills = [...e.querySelectorAll("svg path")].map((p) => p.getAttribute("fill")).filter((f) => f && f !== "none" && f !== "transparent"); return [...new Set(fills)]; })()`);
const sb = designpresets.PRESETS.find((p) => p.id === "soft-bento");
check("màu theo phong cách: chuỗi được nhắc tới màu nhấn, chuỗi khác màu trung tính", col.some((c) => c.toLowerCase() === sb.accent.toLowerCase()) && col.some((c) => c.toLowerCase() === sb.neutral.toLowerCase()), col.join(", "));
await shot("charts-slide1.png");
// Nhãn chữ trong mỗi biểu đồ không đè nhau: ở cỡ 1280 và ở khung xem trước hẹp (524×295, cỡ panel artifact) nơi biểu đồ vẽ theo đơn vị thiết kế rồi thu nhỏ.
const overlaps = `[...document.querySelectorAll("[data-sx-chart]")].filter((e) => e.offsetWidth).map((e) => { const r = [...e.querySelectorAll("svg text")].map((t) => t.getBoundingClientRect()).filter((b) => b.width > 0); let n = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i], b = r[j]; const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 1 && h > 1) n++; } return n; })`;
const ov1280 = await ev(overlaps);
await view(524, 295); await sleep(900);
const ovSmall = await ev(overlaps);
const fsSmall = await ev(`(() => { const t = document.querySelector("[data-sx-chart] svg text"); return t ? t.getBoundingClientRect().height : 0; })()`);
check("nhãn biểu đồ không đè nhau ở 1280 và ở khung hẹp 524 (thu theo đơn vị thiết kế)", ov1280.every((n) => n === 0) && ovSmall.every((n) => n === 0) && fsSmall > 0 && fsSmall < 9, JSON.stringify({ ov1280, ovSmall, fsSmall }));
await shot("charts-slide1-small.png");
await view(1280, 720); await sleep(900);
await ev(`window.__sxGo(1)`); await sleep(600); await shot("charts-slide2.png");
const wf = await ev(`(() => { window.__sxGo(1); const e = [...document.querySelectorAll("[data-sx-chart]")].find((x) => JSON.parse(x.dataset.sxChart).type === "waterfall"); return [...e.querySelectorAll("svg text")].map((t) => t.textContent).join("|"); })()`);
check("waterfall: nhãn tăng / giảm có dấu, cột tổng không dấu", /\+320/.test(wf) && /−180/.test(wf) && /\b500\b/.test(wf), wf);
// Giảm chuyển động: không hoạt ảnh.
await media([{ name: "prefers-reduced-motion", value: "reduce" }]);
await open(`<html data-sx-preset="soft-bento"><body><div class="sx-page">${CH(SPECS.bar)}</div></body></html>`);
await until(`!!document.querySelector("[data-sx-chart-ready]")`);
const anim = await ev(`sxChartOf(document.querySelector("[data-sx-chart]")).getOption().animation`);
check("giảm chuyển động: biểu đồ không hoạt ảnh", anim === false, String(anim));
await media();
// PowerPoint: 5 biểu đồ gốc, sankey ở lại ảnh nền.
await view(1280, 720); await open(CHART_DECK, { deck: true }); await until(`document.querySelectorAll("[data-sx-chart-ready]").length === 3`); await sleep(900);
const cd = await buildDeck();
check("PowerPoint có 5 biểu đồ gốc (bar, line, doughnut, waterfall, radar), sankey giữ trong ảnh", !cd.error && cd.charts.length === 5, cd.error ?? `${cd.charts?.length} biểu đồ`);
if (!cd.error) {
  const kinds = cd.charts.map((x) => (/<c:(barChart|lineChart|doughnutChart|radarChart|pieChart|areaChart)>/.exec(x) ?? [])[1]);
  check("đúng loại biểu đồ gốc", ["barChart", "lineChart", "doughnutChart", "barChart", "radarChart"].every((k) => kinds.includes(k)), kinds.join(", "));
  const w = cd.charts.find((x) => x.includes("__sx_base"));
  check("waterfall: chuỗi nền không màu, không nhãn; số liệu sửa được trong PowerPoint", !!w && /<c:v>__sx_base<\/c:v>[\s\S]*?<c:spPr><a:noFill\/>/.test(w) && /<c:grouping val="stacked"\/>/.test(w));
  check("dữ liệu biểu đồ đúng số (doanh thu 2026 quý 4 = 190)", cd.charts.some((x) => /<c:v>190<\/c:v>/.test(x)));
  check("chữ tiêu đề slide vẫn là hộp chữ", /Doanh thu 2026 vượt 2025/.test(cd.slides[0]));
  if (SHOTS) writeFileSync(path.join(SHOTS, "charts.pptx"), cd.buf);
}
// Thẻ có tên (Morph) chứa biểu đồ: ảnh của thẻ không được mang sẵn biểu đồ ECharts nằm dưới biểu đồ gốc (hai lớp).
const KPI_DECK = `<html data-sx-preset="soft-bento"><body><section class="slide sx-slide"><h2 class="sx-title">Thẻ KPI có biểu đồ</h2><div class="sx-card" data-sx-morph="!!kpi" style="width:calc(560*var(--sx-u))"><p class="sx-kpi">+18%</p>${CH(SPECS.bar, 200)}</div></section><section class="slide sx-slide"><h2 class="sx-title">Kết</h2></section></body></html>`;
await view(1280, 720); await open(KPI_DECK, { deck: true }); await until(`document.querySelectorAll("[data-sx-chart-ready]").length === 1`); await sleep(900);
const kd = await buildDeck();
const kpiPic = kd.m?.slides?.[0]?.pics?.find((p) => p.name === "!!kpi");
// Điểm ảnh có màu đậm (cột biểu đồ màu nhấn / trung tính đậm); nền thẻ và chữ đã trong suốt thì gần như không có.
const inked = kpiPic ? await ev(`new Promise((ok) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = 200; c.height = Math.round(200 * im.height / im.width); const x = c.getContext("2d"); x.drawImage(im, 0, 0, c.width, c.height); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (d[i + 3] > 200 && (mx - mn > 60 || mx < 150)) n++; } ok(n / (d.length / 4)); }; im.src = ${JSON.stringify(kpiPic?.data ?? "")}; })`) : null;
check("thẻ có tên chứa biểu đồ: ảnh thẻ không mang biểu đồ (chỉ biểu đồ gốc PowerPoint)", !kd.error && kd.charts.length === 1 && inked !== null && inked < 0.01, kd.error ?? `${kd.charts?.length} biểu đồ gốc, điểm màu đậm trong ảnh thẻ ${((inked ?? 1) * 100).toFixed(1)}%`);

// React: import echarts dùng được, thư viện chỉ nạp khi import.
const REACT = `import React, { useEffect, useRef } from "react";\nimport * as echarts from "echarts";\nexport default function App(){ const r = useRef(null); useEffect(() => { const c = echarts.init(r.current, null, { renderer: "svg" }); c.setOption(window.sxChartOption ? window.sxChartOption(${JSON.stringify(SPECS.radar)}, {}) : { series: [] }); }, []); return <div ref={r} id="rc" style={{ width: 480, height: 320 }} />; }`;
vendorLoads.length = 0;
await open(REACT, { type: "react" });
const rok = await until(`!!document.querySelector("#rc svg")`, 30000);
check("React: import * as echarts from \"echarts\" chạy được", rok, errs.slice(-2).join(" | "));
check("React: ECharts chỉ nạp khi có import (một lần)", vendorLoads.filter((f) => f.startsWith("echarts")).length === 1, vendorLoads.join(", "));
vendorLoads.length = 0;
await open(`import React from "react";\nexport default function App(){ return <p id="x">Không biểu đồ</p>; }`, { type: "react" });
await until(`!!document.getElementById("x")`, 30000);
check("React không import echarts: không tải ECharts", !vendorLoads.some((f) => f.startsWith("echarts")), vendorLoads.join(", "));

// ---------------------------------------------------------------- 3b. canvas 2D không bị ẩn khi xuất
console.log("3b. Canvas 2D (biểu đồ nét mảnh trên màn Retina) giữ nguyên trong PNG / PowerPoint; chỉ canvas WebGL trống mới ẩn tạm");
const C2D = `<html data-sx-preset="exec-navy"><body><div class="sx-page"><h2 class="sx-title">Biểu đồ canvas</h2><canvas id="c2" width="1600" height="800" style="width:800px;height:400px"></canvas><canvas id="gl" data-sx-gl width="400" height="200" style="width:400px;height:200px"></canvas></div>
<script>(() => { const c = document.getElementById("c2"), x = c.getContext("2d"); x.scale(2, 2); x.strokeStyle = "#999"; x.lineWidth = 0.5; for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(40, 20 + i * 45); x.lineTo(780, 20 + i * 45); x.stroke(); } x.strokeStyle = "#2563eb"; x.lineWidth = 1; x.beginPath(); [0, 60, 40, 120, 90, 200, 170, 260].forEach((v, i) => x.lineTo(40 + i * 100, 380 - v)); x.stroke(); x.font = "10px sans-serif"; x.fillStyle = "#333"; x.fillText("Q1 Q2 Q3 Q4", 40, 395);
  document.getElementById("gl").getContext("webgl", { preserveDrawingBuffer: false }); })()</script></body></html>`;
await view(1280, 900); await open(C2D);
const vis = await ev(`(() => { const thaw = sxGlFreeze(); const v = { c2: getComputedStyle(document.getElementById("c2")).visibility, gl: getComputedStyle(document.getElementById("gl")).visibility }; thaw(); v.after = getComputedStyle(document.getElementById("gl")).visibility; return v; })()`);
check("canvas 2D nét mảnh 1600×800 (Retina) không bị coi là trống; canvas WebGL trống vẫn ẩn tạm rồi trả lại", vis.c2 === "visible" && vis.gl === "hidden" && vis.after === "visible", JSON.stringify(vis));
await ev(`window.__posts = []; sxCapture("c2", "")`);
const c2p = await waitPost(`(p) => p.id === "c2"`);
const c2blue = c2p?.data ? await ev(`new Promise((ok) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d"); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 180 && d[i] < 120) n++; ok(n); }; im.src = ${JSON.stringify(c2p?.data ?? "")}; })`) : 0;
check("PNG có đường biểu đồ của canvas 2D", c2blue > 50, `${c2blue} điểm xanh`);

// ---------------------------------------------------------------- 4. nền shader 3D, kính khúc xạ
console.log("4. Nền shader 3D (bộ thông số của chủ dự án) và kính khúc xạ: tải lười, dự phòng, giảm chuyển động, xuất không trắng");
// Điểm ảnh của canvas WebGL (đọc được vì preserveDrawingBuffer): trung bình màu + độ khác nhau giữa các điểm lấy mẫu.
const glPx = `(() => { const c = document.querySelector("canvas[data-sx-gl]"); if (!c || !c.width) return null; const t = document.createElement("canvas"); t.width = 32; t.height = 18; const x = t.getContext("2d"); x.drawImage(c, 0, 0, 32, 18); const d = x.getImageData(0, 0, 32, 18).data; let r = 0, g = 0, b = 0, a = 0, sig = ""; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; if (i % 64 === 0) sig += (d[i] >> 3) + "," + (d[i + 2] >> 3) + ";"; } const n = d.length / 4; return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: Math.round(a / n), sig }; })()`;
const SHADER_DECK = `<html data-sx-preset="midnight-tech"><body>
<section class="slide sx-slide"><div class="sx-shader" data-sx-shader="silk"></div><p class="sx-eyebrow">Ra mắt 2026</p><h1 class="sx-display">Nền sóng lụa ba chiều</h1><p class="sx-kicker">Indigo, xanh trời, ngọc lục bảo</p></section>
<section class="slide sx-slide"><h2 class="sx-title">Kính khúc xạ</h2><div data-sx-shader="glass" style="height:calc(420*var(--sx-u))"></div></section></body></html>`;
vendorLoads.length = 0;
await view(1280, 720); await open(SHADER_DECK, { deck: true });
const fb = await ev(`getComputedStyle(document.querySelector(".sx-shader")).backgroundImage`);
check("lớp CSS cực quang dự phòng có ngay (trước khi WebGL vẽ)", /radial-gradient/.test(fb) && /79, 70, 229|4f46e5/i.test(fb), fb.slice(0, 120));
const gotGl = await until(`!!document.querySelector(".sx-shader canvas[data-sx-gl]")`, 30000);
await sleep(1500);
const px1 = gotGl ? await ev(glPx) : null;
check("nền shader vẽ bằng WebGL, đọc được điểm ảnh (preserveDrawingBuffer), không trắng không đen", px1 && px1.a > 200 && px1.b > px1.r && !(px1.r > 240 && px1.g > 240 && px1.b > 240) && px1.r + px1.g + px1.b > 40, JSON.stringify(px1));
check("chỉ tải React, ReactDOM, gói 3D đúng một lần khi trang có data-sx-shader", ["react-18.3.1.min.js", "react-dom-18.3.1.min.js", "synchro-3d-1.0.0.js"].every((f) => vendorLoads.filter((x) => x === f).length === 1), vendorLoads.join(", "));
await sleep(700);
const px2 = await ev(glPx);
check("chuyển động bình thường: sóng lụa chạy (hai khung khác nhau)", px1 && px2 && px1.sig !== px2.sig);
await shot("shader-slide1.png");
await ev(`window.__posts = []; sxCapture("s1", "")`);
const s1 = await waitPost(`(p) => p.id === "s1"`), s1i = s1?.data ? await pngInfo(s1.data) : null;
const s1c = s1?.data ? await ev(`new Promise((ok) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = 64; c.height = 36; const x = c.getContext("2d"); x.drawImage(im, 0, 0, 64, 36); const d = x.getImageData(40, 6, 20, 20).data; let r = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; b += d[i + 2]; } ok({ r: r / (d.length / 4), b: b / (d.length / 4) }); }; im.src = ${JSON.stringify(s1?.data ?? "")}; })`) : null;
check("PNG của slide có nền shader: không trắng, màu nền xanh chàm", s1i && s1i.colors > 8 && s1c && s1c.b > 60 && s1c.b > s1c.r, JSON.stringify({ s1i, s1c }));
if (SHOTS && s1?.data) writeFileSync(path.join(SHOTS, "shader-png.png"), Buffer.from(s1.data.split(",")[1], "base64"));
await ev(`window.__sxGo(1)`);
const gotGlass = await until(`!!document.querySelector("[data-sx-shader=glass] canvas[data-sx-gl]")`, 30000);
await sleep(2500);
await shot("glass-slide2.png");
const gpx = gotGlass ? await ev(`(() => { const c = document.querySelector("[data-sx-shader=glass] canvas"); const t = document.createElement("canvas"); t.width = 40; t.height = 40; const x = t.getContext("2d"); x.drawImage(c, 0, 0, 40, 40); const d = x.getImageData(0, 0, 40, 40).data; let a = 0, n = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] > 30) n++; a += d[i]; } return { opaque: n, total: d.length / 4 }; })()`) : null;
check("kính khúc xạ (MeshTransmissionMaterial) vẽ ra vật thể, không cần tệp môi trường qua mạng", gpx && gpx.opaque > 80 && gpx.opaque < gpx.total, JSON.stringify(gpx));
await ev(`window.__sxGo(0)`); await sleep(400);
const sd = await buildDeck();
const bg1 = !sd.error ? sd.m.slides[0].bg : "";
const bgc = bg1 ? await ev(`new Promise((ok) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = 64; c.height = 36; const x = c.getContext("2d"); x.drawImage(im, 0, 0, 64, 36); const d = x.getImageData(40, 6, 20, 20).data; let r = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; b += d[i + 2]; } ok({ r: r / (d.length / 4), b: b / (d.length / 4) }); }; im.src = ${JSON.stringify(bg1)}; })`) : null;
check("PowerPoint: ảnh nền slide có nền shader không trắng, chữ vẫn là hộp chữ", !sd.error && bgc && bgc.b > 60 && bgc.b > bgc.r && /Nền sóng lụa ba chiều/.test(sd.slides[0]), sd.error ?? JSON.stringify(bgc));
if (SHOTS && !sd.error) writeFileSync(path.join(SHOTS, "shader.pptx"), sd.buf);
const pdf3 = await P("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
const pdf3t = Buffer.from(pdf3.data, "base64").toString("latin1");
check("in PDF: canvas WebGL thành ảnh trong trang, không mất nền", (pdf3t.match(/\/Subtype\s*\/Image/g) ?? []).length >= 1 && (await ev(`document.querySelectorAll("img[data-sx-gl-print]").length`)) === 0, `${(pdf3t.match(/\/Subtype\s*\/Image/g) ?? []).length} ảnh`);
// Giảm chuyển động: đứng yên.
await media([{ name: "prefers-reduced-motion", value: "reduce" }]);
await open(SHADER_DECK, { deck: true });
await until(`!!document.querySelector(".sx-shader canvas[data-sx-gl]")`, 30000); await sleep(1500);
const r1 = await ev(glPx); await sleep(900); const r2 = await ev(glPx);
check("giảm chuyển động: nền shader đứng yên (hai khung giống hệt)", r1 && r2 && r1.sig === r2.sig, JSON.stringify([r1?.sig?.slice(0, 40), r2?.sig?.slice(0, 40)]));
await media();
// Ảnh thu nhỏ của bản trình bày: không tải gói 3D, không tốn ngữ cảnh WebGL; lớp CSS vẫn hiện.
vendorLoads.length = 0;
{ const url = `${ORIGIN}/doc/${++docN}`; pages.set(url, buildDocCore("html", SHADER_DECK, ORIGIN, "t", false, BR, { fixed: 0 }));
  const done = new Promise((r) => { const h = (e) => { const m = JSON.parse(e.data); if (m.method === "Page.loadEventFired" && m.sessionId === S) { ws.removeEventListener("message", h); r(); } }; ws.addEventListener("message", h); });
  await P("Page.navigate", { url }); await done; await sleep(1500); }
check("ảnh thu nhỏ: không tải gói 3D, chỉ lớp cực quang", !vendorLoads.some((f) => f.startsWith("synchro-3d")) && !(await ev(`!!document.querySelector("canvas")`)) && /radial-gradient/.test(await ev(`getComputedStyle(document.querySelector(".sx-shader")).backgroundImage`)), vendorLoads.join(", "));
// Máy không có WebGL: lớp CSS ở lại, không lỗi.
await P("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, o) { return /webgl/i.test(t) ? null : g.call(this, t, o); }; })()` }).then((r) => (globalThis.__noGl = r.identifier));
await open(SHADER_DECK, { deck: true }); await sleep(2500);
check("không có WebGL: không canvas, lớp CSS cực quang vẫn là nền", !(await ev(`!!document.querySelector(".sx-shader canvas")`)) && /radial-gradient/.test(await ev(`getComputedStyle(document.querySelector(".sx-shader")).backgroundImage`)));
await P("Page.removeScriptToEvaluateOnNewDocument", { identifier: globalThis.__noGl });
// React: đúng đoạn mã của chủ dự án (import từ "shadergradient").
const OWNER = `import { ShaderGradientCanvas, ShaderGradient } from "shadergradient";
export default function Master3DBackground() {
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
    <ShaderGradientCanvas style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }} preserveDrawingBuffer>
      <ShaderGradient animate="on" axesHelper="off" bgColor1="#08090E" bgColor2="#0F172A" brightness={1.15} cAzimuthAngle={180} cDistance={3.6} cPolarAngle={90} cameraZoom={1} color1="#4F46E5" color2="#0EA5E9" color3="#10B981" envPreset="city" grain="on" lightType="3d" positionX={-0.5} positionY={0} positionZ={0} reflection={0.1} rotationX={0} rotationY={10} rotationZ={50} shader="defaults" type="waterPlane" uAmplitude={1.4} uDensity={1.2} uFrequency={5.5} uSpeed={0.18} uStrength={3.2} />
    </ShaderGradientCanvas>
    <h1 id="t" style={{ position: "relative", color: "white", font: "700 48px system-ui", padding: 48 }}>Đoạn mã của chủ dự án</h1></div>
  );
}`;
vendorLoads.length = 0;
await open(OWNER, { type: "react" });
const okR = await until(`!!document.querySelector("canvas") && !!document.getElementById("t")`, 40000);
await sleep(2000);
const rpx = okR ? await ev(`(() => { const c = document.querySelector("canvas"); const t = document.createElement("canvas"); t.width = 16; t.height = 9; const x = t.getContext("2d"); x.drawImage(c, 0, 0, 16, 9); const d = x.getImageData(0, 0, 16, 9).data; let b = 0, r = 0; for (let i = 0; i < d.length; i += 4) { b += d[i + 2]; r += d[i]; } return { b: b / 144, r: r / 144 }; })()`) : null;
check("React: đúng mã của chủ dự án (import từ \"shadergradient\") chạy, có sóng lụa", okR && rpx && rpx.b > 40, JSON.stringify(rpx) + " " + errs.slice(-2).join(" | "));
check("React: không lấy mạng (không tải tệp HDR, chỉ vendor)", !stray.length && vendorLoads.filter((f) => f.startsWith("synchro-3d")).length === 1, vendorLoads.join(", "));
await shot("react-owner-shader.png");

check("không có yêu cầu mạng lạ", !stray.length, stray.slice(0, 5).join(" | "));
check("CSP không chặn gì", !cspErr.length, cspErr.slice(0, 3).join(" | "));
check("không có lỗi JavaScript", !errs.length, errs.slice(0, 3).join(" | "));
ws.close(); chrome.kill();
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exit(fails ? 1 : 0);
