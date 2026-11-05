// Bộ CSS trong khung artifact (app/artkit.ts) kiểm bằng Chrome ẩn thật, không cần máy chủ Synchro, không gọi mạng: mọi yêu cầu đều do bài thử trả lời
// (trang dựng đúng bằng buildDocCore nên CSP là CSP thật; Google Fonts được đóng vai bằng tệp phông cục bộ), yêu cầu lạ bị chặn và tính là lỗi.
// Kiểm: phông có đủ dấu tiếng Việt (bảng cmap của tệp phông và phông Chrome thật sự dùng), chuyển động tôn trọng prefers-reduced-motion, không để chữ vô hình khi
// animation hỏng / lúc in / lúc chụp PowerPoint, các phép đo mới của check_artifact (chạy đúng mã PROBE trong artcheck.ts), lý do không tự thu nhỏ chữ.
// Chạy: node tests/ui/design-kit.mjs
//   SYNCHRO_FONT_DIR=<thư mục .ttf>: thư mục phông (tải theo commit ghim trong workspace/Dockerfile); không có thì bỏ phần phông, ghi rõ đã bỏ.
//   SAMPLES=<thư mục>: dựng mọi .html trong đó, chụp ảnh sáng / tối vào cùng thư mục, in PDF cho trang A4 và đo lỗi; có lỗi đo được thì bài thử không đạt.
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

const { artdoc, artkit, artprobe, designpresets, deckpptx } = await loadTs(["artdoc", "artkit", "artprobe", "designpresets", "deckpptx"]);
const { buildDocCore } = artdoc, { FONT_SPEC, PRESETS } = designpresets;
const FONT_DIR = process.env.SYNCHRO_FONT_DIR ?? "", SAMPLES = process.env.SAMPLES ?? "";
const CDP = Number(process.env.CDP_PORT ?? 9377), PROF = path.join(os.tmpdir(), `synchro-ui/chrome-prof-design-${CDP}`);
rmSync(PROF, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails++; };

// Mã PROBE thật của check_artifact: đọc từ artcheck.ts (tệp đó phụ thuộc cơ sở dữ liệu nên không nạp được ở đây).
const PROBE = (() => {
  const src = readFileSync("app/artcheck.ts", "utf8");
  const m = /const PROBE = String\.raw`([\s\S]*?)`;\n/.exec(src);
  if (!m) throw new Error("không thấy PROBE trong artcheck.ts");
  return m[1].replace("${DESIGN_PROBE}", artprobe.DESIGN_PROBE);
})();

// Tệp phông: tên họ phông → tệp, đọc đúng tên trong tệp (bảng name), không đoán từ tên tệp.
const VN = "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ";
const VN_ALL = [...new Set([...VN, ...VN.toUpperCase()])].join("");
function ttf(file) {
  const b = readFileSync(file), u16 = (o) => b.readUInt16BE(o), u32 = (o) => b.readUInt32BE(o), tables = {};
  for (let i = 0; i < u16(4); i++) { const o = 12 + i * 16; tables[b.toString("latin1", o, o + 4)] = u32(o + 8); }
  const chars = new Set(), cm = tables.cmap;
  for (let i = 0; i < u16(cm + 2); i++) {
    const s = cm + u32(cm + 4 + i * 8 + 4), fmt = u16(s);
    if (fmt === 4) {
      const n = u16(s + 6) / 2, end = s + 14, start = end + n * 2 + 2, delta = start + n * 2, range = delta + n * 2;
      for (let k = 0; k < n; k++) for (let c = u16(start + k * 2); c <= u16(end + k * 2) && c < 0xffff; c++) {
        const ro = u16(range + k * 2);
        const g = ro ? u16(range + k * 2 + ro + (c - u16(start + k * 2)) * 2) : (c + u16(delta + k * 2)) & 0xffff;
        if (g) chars.add(c);
      }
    } else if (fmt === 12) for (let k = 0; k < u32(s + 12); k++) { const o = s + 16 + k * 12; for (let c = u32(o); c <= u32(o + 4); c++) chars.add(c); }
  }
  const nm = tables.name; let family = "";
  for (let i = 0; i < u16(nm + 2); i++) { const o = nm + 6 + i * 12; if (u16(o) === 3 && u16(o + 6) === 1) { const raw = b.subarray(nm + u16(nm + 4) + u16(o + 10), nm + u16(nm + 4) + u16(o + 10) + u16(o + 8)).swap16().toString("utf16le"); b.subarray(nm + u16(nm + 4) + u16(o + 10), nm + u16(nm + 4) + u16(o + 10) + u16(o + 8)).swap16(); if (raw) { family = u16(o + 6) === 16 ? raw : family || raw; } } }
  return { chars, family };
}
const faces = new Map(); // họ phông → [{ file, weight }]
if (FONT_DIR && existsSync(FONT_DIR)) for (const f of readdirSync(FONT_DIR).filter((x) => x.endsWith(".ttf"))) {
  const fam = Object.keys(FONT_SPEC).find((n) => f.replace(/\W/g, "").toLowerCase().startsWith(n.replace(/\W/g, "").toLowerCase()));
  if (!fam) continue;
  const w = /Bold/.test(f) ? "700" : /SemiBold/.test(f) ? "600" : /Medium/.test(f) ? "500" : /Regular/.test(f) ? "400" : "100 900";
  (faces.get(fam) ?? faces.set(fam, []).get(fam)).push({ file: f, weight: /SemiBold/.test(f) ? "600" : w });
}
const fontCss = (url) => {
  const fams = [...new URL(url).searchParams.getAll("family")].map((x) => x.split(":")[0].replace(/\+/g, " "));
  return fams.flatMap((n) => (faces.get(n) ?? []).map((x) => `@font-face{font-family:"${n}";font-weight:${x.weight};font-display:swap;src:url(https://fonts.gstatic.com/local/${encodeURIComponent(x.file)}) format("truetype")}`)).join("\n");
};

const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 60 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null); }
if (!ver) throw new Error("không mở được Chrome");
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const waits = new Map(), errs = [], stray = [], cspErr = [], pages = new Map(), fontLoads = new Set();
const ORIGIN = "https://app.test";
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const answer = (S, requestId, body, type, extra = []) => send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: type }, { name: "access-control-allow-origin", value: "*" }, ...extra], body: Buffer.from(body).toString("base64") }, S);
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0]);
  if (m.method === "Log.entryAdded" && /Content Security Policy/i.test(m.params.entry.text)) cspErr.push(m.params.entry.text.slice(0, 200));
  if (m.method === "Fetch.requestPaused") {
    const { requestId, request } = m.params, S = m.sessionId, u = request.url;
    if (u.startsWith(`${ORIGIN}/doc/`)) return answer(S, requestId, pages.get(u) ?? "", "text/html; charset=utf-8");
    if (u.startsWith(`${ORIGIN}/vendor/`)) return answer(S, requestId, readFileSync(path.join("public/vendor", path.basename(new URL(u).pathname))), "application/javascript");
    if (u.startsWith("https://fonts.googleapis.com/css2")) return answer(S, requestId, fontCss(u), "text/css");
    if (u.startsWith("https://fonts.gstatic.com/local/")) { const f = decodeURIComponent(path.basename(new URL(u).pathname)); fontLoads.add(f); return answer(S, requestId, readFileSync(path.join(FONT_DIR, f)), "font/ttf"); }
    stray.push(u.slice(0, 120));
    send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, S);
  }
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable"); await P("Log.enable"); await P("DOM.enable"); await P("CSS.enable");
await P("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const view = (width, height) => P("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
const media = (m = "", features = []) => P("Emulation.setEmulatedMedia", { media: m, features });
let docN = 0;
const open = async (content, { deck = false, title = "" } = {}) => {
  const url = `${ORIGIN}/doc/${++docN}`;
  pages.set(url, buildDocCore("html", content, ORIGIN, "t", false, "", deck ? { fixed: null } : undefined, title));
  const done = new Promise((r) => { const h = (e) => { const m = JSON.parse(e.data); if (m.method === "Page.loadEventFired" && m.sessionId === S) { ws.removeEventListener("message", h); r(); } }; ws.addEventListener("message", h); });
  await P("Page.navigate", { url });
  await done;
  await ev(`document.fonts.ready.then(() => 1)`);
  await sleep(120);
};
const shot = async (file) => { const r = await P("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(file, Buffer.from(r.data, "base64")); };
const probe = (root = "document.body", isDeck = false) => ev(`(${PROBE})(${root}, ${isDeck})`);

// ---------------------------------------------------------------- phông
console.log("1. Phông: đủ dấu tiếng Việt, đúng phông thật sự được dùng");
if (!faces.size) console.log("  (bỏ qua: không có SYNCHRO_FONT_DIR)");
else {
  const specimen = [];
  for (const name of Object.keys(FONT_SPEC)) {
    const list = faces.get(name) ?? [];
    check(`có tệp phông ${name}`, list.length > 0);
    for (const x of list) {
      const { chars, family } = ttf(path.join(FONT_DIR, x.file));
      const miss = [...VN_ALL].filter((c) => !chars.has(c.codePointAt(0)));
      check(`${x.file}: bảng cmap đủ ${[...VN_ALL].length} chữ cái tiếng Việt, họ phông "${family}"`, !miss.length && family.startsWith(name), miss.join(""));
    }
    specimen.push(`<small style="font:13px monospace;display:block">${name}</small><p style="font-family:'${name}';font-size:28px;line-height:1.3;margin:0 0 16px" id="f${specimen.length}">Ư ơ ệ ẫ ặ ữ ỡ ộ ổ ặ Đ đ: Nguyễn Thị Hường, thưởng Tết, Quảng Ngãi 14,2%</p>`);
  }
  await view(1280, 800);
  await open(`<html data-sx-preset="swiss-grid"><head>${Object.keys(FONT_SPEC).map((n) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${FONT_SPEC[n].css}">`).join("")}</head><body class="sx-p-32">${specimen.join("")}</body></html>`);
  await sleep(300);
  await P("DOM.getDocument", { depth: -1 });
  const root = (await P("DOM.getDocument", { depth: 0 })).root.nodeId;
  for (const [i, name] of Object.keys(FONT_SPEC).entries()) {
    const { nodeId } = await P("DOM.querySelector", { nodeId: root, selector: `#f${i}` });
    const { fonts } = await P("CSS.getPlatformFontsForNode", { nodeId });
    check(`${name}: Chrome vẽ toàn bộ dấu bằng đúng phông, không rơi về phông khác`, fonts.length === 1 && fonts[0].familyName.startsWith(name) && fonts[0].isCustomFont, JSON.stringify(fonts.map((f) => [f.familyName, f.glyphCount])));
  }
  if (SAMPLES) await shot(path.join(SAMPLES, "phong-tieng-viet.png"));
}

// ---------------------------------------------------------------- chuyển động
console.log("2. Chuyển động: giảm chuyển động, in, animation hỏng đều không để chữ vô hình");
const MOTION = `<html data-sx-preset="swiss-grid"><body><div class="sx-page">
<h1 class="sx-title sx-rise" id="a">Tiêu đề</h1><p class="sx-text sx-fade" id="b" style="--sx-i:3">Đoạn văn</p><div class="sx-card sx-pop" id="c" style="--sx-i:5">Thẻ</div>
<svg viewBox="0 0 100 20" width="300"><path class="sx-draw" id="d" pathLength="1" d="M0 10H100" stroke="#000" fill="none"/></svg></div></body></html>`;
const opac = `["a","b","c"].map((i) => { const e = document.getElementById(i), s = getComputedStyle(e); return [+s.opacity, s.visibility, s.transform]; })`;
const anims = `document.getAnimations().length`;
await view(1280, 800);
await media();
await open(MOTION);
check("bình thường: có chuyển động", (await ev(anims)) > 0, `${await ev(anims)} animation`);
await sleep(1900);
check("chạy xong: mọi phần tử hiện đủ", (await ev(opac)).every((x) => x[0] === 1 && x[2] === "none"), JSON.stringify(await ev(opac)));
await open(MOTION);
await ev(`document.getAnimations().forEach((a) => a.cancel())`);
check("animation bị hủy (hỏng): vẫn hiện đủ, không kẹt opacity:0 như cách của cẩm nang gốc", (await ev(opac)).every((x) => x[0] === 1), JSON.stringify(await ev(opac)));
await media("", [{ name: "prefers-reduced-motion", value: "reduce" }]);
await open(MOTION);
check("prefers-reduced-motion: không còn animation nào", (await ev(anims)) === 0, String(await ev(anims)));
check("prefers-reduced-motion: hiện đủ ngay", (await ev(opac)).every((x) => x[0] === 1 && x[2] === "none"), JSON.stringify(await ev(opac)));
await media("print");
await open(MOTION);
check("khi in: không có animation, hiện đủ", (await ev(anims)) === 0 && (await ev(opac)).every((x) => x[0] === 1), JSON.stringify(await ev(opac)));
await media();
check("bộ CSS không có opacity:0 ở trạng thái thường", !/\.sx-[\w-]+\{[^}]*opacity:0/.test(artkit.KIT_CSS));

// ---------------------------------------------------------------- phép đo của check_artifact
console.log("3. check_artifact: đo đúng, không báo nhầm");
const kinds = (r) => r.map((x) => x.kind);
await view(1280, 720);
await open(`<html data-sx-preset="swiss-grid"><body><div class="sx-page">
<p style="color:#bbb;background:#fff">Chữ xám nhạt trên nền trắng khó đọc</p></div></body></html>`);
let r = await probe();
check("tương phản thấp: chữ #bbb trên trắng", kinds(r).includes("tương phản thấp"), JSON.stringify(r));
await open(`<html><body style="margin:0"><div style="position:relative;height:200px"><div style="position:absolute;inset:0;background:#111"></div><p style="position:relative;color:#eee;margin:0;padding:20px">Chữ sáng nằm trên hình đặt tuyệt đối</p></div>
<p style="margin:0;padding:8px;background:color(srgb 0.1 0.1 0.2);color:oklch(0.95 0.01 90)">Màu hiện đại đọc đúng</p>
<p style="margin:0;padding:8px;background:linear-gradient(#000,#111);color:#222">Trên gradient không đo được nên không báo</p>
<p style="margin:0;font-size:32px;font-weight:700;color:#888">Chữ lớn đủ 3:1</p></body></html>`);
r = await probe();
check("không báo nhầm: nền hình tuyệt đối, màu oklch / color(), gradient, chữ lớn 3:1", !kinds(r).includes("tương phản thấp"), JSON.stringify(r));
await open(`<html data-sx-preset="swiss-grid"><body><div style="width:520px;padding:24px"><h1 id="o" style="font-size:40px;margin:0;line-height:1.2;text-wrap:wrap;font-family:serif">Tiêu đề này dài vừa đủ để rớt chữ cuối cùng ngang</h1>
<h2 style="font-size:24px;margin:16px 0 0;text-wrap:balance;font-family:serif">Tiêu đề cân bằng chia hai dòng khá đều nhau không lẻ chữ nào cả nhé</h2></div></body></html>`);
{
  // Chỉnh bề rộng tới khi tiêu đề thật sự rớt một chữ: khỏi phụ thuộc phông của máy chạy thử.
  const w = await ev(`(() => { const e = document.getElementById("o"), box = e.parentElement; for (let w = 700; w > 200; w -= 4) { box.style.width = w + "px"; const t = e.firstChild, rg = document.createRange(), s = t.nodeValue, i = s.lastIndexOf(" "); rg.setStart(t, i + 1); rg.setEnd(t, s.length); const last = rg.getClientRects()[0]; rg.setStart(t, 0); rg.setEnd(t, i); const prev = [...rg.getClientRects()].pop(); if (last.top > prev.top + 10) return w; } return 0; })()`);
  r = await probe();
  check("tiêu đề rớt một chữ", w > 0 && kinds(r).includes("tiêu đề rớt một chữ"), `rộng ${w}px · ${JSON.stringify(r)}`);
  check("tiêu đề balance: không báo", r.filter((x) => x.kind === "tiêu đề rớt một chữ").length === 1, JSON.stringify(r));
}
const OVER = `<html data-sx-preset="swiss-grid"><body><section class="slide sx-slide"><h2 class="sx-title">Slide</h2><div class="sx-grid-3" style="height:calc(180*var(--sx-u))"><div class="sx-card" id="c" style="height:100%"><p class="sx-text" id="t">${"Đoạn văn rất dài trong một thẻ thấp sẽ thò ra ngoài khung chứa. ".repeat(6)}</p></div><div class="sx-card">B</div><div class="sx-card">C</div></div></section></body></html>`;
await open(OVER);
r = await probe(`document.querySelector("section")`, true);
check("chữ tràn khỏi thẻ, dù vẫn nằm trong slide", kinds(r).includes("chữ tràn khỏi thẻ"), JSON.stringify(r));
// Vì sao không làm vòng tự thu nhỏ của cẩm nang: chạy đúng vòng đó trên cùng trang.
{
  const h = await ev(`(() => { const box = document.getElementById("t"), card = document.getElementById("c"); let fs = parseFloat(getComputedStyle(box).fontSize), n = 0; box.style.height = (card.clientHeight - 48) + "px"; box.style.overflow = "hidden"; while ((box.scrollHeight > box.clientHeight + 2 || box.scrollWidth > box.clientWidth + 2) && fs > 11 && n < 8) { fs -= 1; box.style.fontSize = fs + "px"; n++; } return { fs, n, still: box.scrollHeight > box.clientHeight + 2 }; })()`);
  const after = await probe(`document.querySelector("section")`, true);
  console.log(`  thử vòng tự thu nhỏ: chữ ${h.fs}px sau ${h.n} bước, ${h.still ? "vẫn tràn nhưng bị cắt" : "vừa khung"}; đo lại: ${[...new Set(kinds(after))].join(", ") || "không còn lỗi"}`);
  check("tự thu nhỏ không giải quyết được: chữ còn ≤ 12px hoặc vẫn tràn", h.fs <= 12 || h.still, JSON.stringify(h));
}

// Bề mặt nhuộm màu trộn bằng color-mix nên không kiểm được bằng bảng số: đo trên trang thật, mọi phong cách, sáng và tối.
{
  const page = (id) => `<html data-sx-preset="${id}" data-sx-theme="auto"><body><div class="sx-page"><h1 class="sx-title">Tiêu đề</h1><p class="sx-eyebrow">Nhãn nhỏ</p><p class="sx-kicker">Kicker phụ</p><p class="sx-source">Nguồn số liệu</p>
<div class="sx-card"><p class="sx-small">Chữ phụ</p><p class="sx-accent">Chữ nhấn</p><p class="sx-up">Tăng lên</p><p class="sx-down">Giảm xuống</p><span class="sx-badge">Nhãn trạng thái</span></div>
<div class="sx-card sx-tint"><p class="sx-small">Trên bề mặt nhuộm</p><p class="sx-accent">Nhấn trên nhuộm</p></div><div class="sx-callout"><p class="sx-small">Ghi chú</p><p class="sx-accent">Nhấn trong ghi chú</p></div><div class="sx-card sx-solid"><p>Nền đặc</p></div>
<table class="sx-table"><thead><tr><th>Cột</th></tr></thead><tbody><tr><td class="n sx-bar" style="--sx-v:90%">12,5</td></tr><tr class="sx-total"><td>Tổng</td></tr></tbody></table></div></body></html>`;
  const bad = [];
  await view(900, 900);
  for (const p of PRESETS) for (const scheme of p.dark ? ["light", "dark"] : ["light"]) {
    await media("", [{ name: "prefers-color-scheme", value: scheme }]);
    await open(page(p.id));
    for (const x of await probe()) if (x.kind === "tương phản thấp") bad.push(`${p.id} ${scheme}: ${x.detail}`);
  }
  await media();
  check("mọi phong cách, sáng và tối: chữ trên thẻ, nhãn, hộp ghi chú, bề mặt nhuộm đạt WCAG", !bad.length, bad.join(" | "));
}

// ---------------------------------------------------------------- PowerPoint
console.log("4. Xuất PowerPoint: bộ đo chạy được trên slide dùng bộ CSS");
const DECK = (SAMPLES && existsSync(path.join(SAMPLES, "1-slide-tai-chinh.html"))) ? readFileSync(path.join(SAMPLES, "1-slide-tai-chinh.html"), "utf8") : `<html data-sx-preset="exec-navy"><body><section class="slide sx-slide"><p class="sx-eyebrow">Nhãn</p><h2 class="sx-title sx-rise">Biên lợi nhuận lên 14,2%</h2><p class="sx-badge">Mới</p></section><section class="slide sx-slide"><p class="sx-kpi sx-accent sx-fade">+3,1 đ.p.</p></section></body></html>`;
{
  const BR = `<script>window.__posts=[];function post(m){window.__posts.push(m)}${deckpptx.PPTX_FRAME_JS}</script><script src="${ORIGIN}/vendor/${artdoc.H2I[0]}"></script>`;
  const url = `${ORIGIN}/doc/${++docN}`;
  pages.set(url, buildDocCore("html", DECK, ORIGIN, "t", false, BR, { fixed: null }));
  await view(1280, 720);
  const done = new Promise((res) => { const h = (e) => { const m = JSON.parse(e.data); if (m.method === "Page.loadEventFired" && m.sessionId === S) { ws.removeEventListener("message", h); res(); } }; ws.addEventListener("message", h); });
  await P("Page.navigate", { url }); await done; await ev(`document.fonts.ready.then(() => 1)`); await sleep(400);
  await ev(`sxPptx("x", "")`);
  let last = null;
  for (let i = 0; i < 240 && !last; i++) { await sleep(250); last = await ev(`(() => { const m = window.__posts.find((p) => p.t === "pptx"); return m ? { error: m.error, n: m.slides?.length, w: m.w, h: m.h, boxes: m.slides?.map((s) => s.boxes.flatMap((b) => b.runs.map((x) => [x.t, x.f, x.c, x.a]))), bg: m.slides?.map((s) => s.bg.length) } : null; })()`); }
  check("chụp xong không lỗi", !!last && !last.error, last?.error ?? "");
  const runs = (last?.boxes ?? []).flat();
  check("mỗi slide có chữ sửa được", (last?.boxes ?? []).every((b) => b.length > 0), `${last?.n} slide, ${runs.length} đoạn chữ`);
  check("giữ dấu tiếng Việt", runs.some((x) => /[ăơưệ]/i.test(x[0])), runs[0]?.[0]);
  const fonts = new Set(runs.map((x) => x[1]));
  check("đúng tên phông của phong cách (không phải Arial)", [...fonts].every((f) => Object.keys(FONT_SPEC).includes(f)), [...fonts].join(", "));
  const colors = new Set(runs.map((x) => x[2]));
  const preset = PRESETS.find((p) => DECK.includes(`data-sx-preset="${p.id}"`));
  check("màu chữ đọc được từ biến của bộ CSS", colors.has(preset.ink.slice(1)) || colors.has(preset.accent.slice(1)), [...colors].join(", "));
  check("đoạn chữ không mất vì opacity:0 của chuyển động", DECK.includes("sx-rise") ? runs.length > 0 : true);
  check("ảnh nền có dữ liệu", (last?.bg ?? []).every((n) => n > 2000), (last?.bg ?? []).join(", "));
}

// ---------------------------------------------------------------- React, in bản trình bày
console.log("5. Artifact React dùng bộ CSS; bản trình bày in mỗi slide một trang");
{
  const url = `${ORIGIN}/doc/${++docN}`;
  const jsx = `import React from "react";\nexport default function App(){return <div data-sx-preset="midnight-tech"><main className="sx-page"><h1 className="sx-title sx-rise" id="rt">Doanh thu quý tăng 12%</h1><p className="flex sx-muted">Tailwind vẫn chạy</p></main></div>}`;
  pages.set(url, buildDocCore("react", jsx, ORIGIN, "t", false, "", undefined, "React"));
  await view(1000, 700);
  await P("Page.navigate", { url });
  let ok = false; for (let i = 0; i < 120 && !ok; i++) { await sleep(250); ok = await ev(`!!document.getElementById("rt")`).catch(() => false); }
  await sleep(400);
  const g = ok ? await ev(`(() => { const t = getComputedStyle(document.getElementById("rt")), w = getComputedStyle(document.querySelector("[data-sx-preset]")); return { fs: t.fontSize, ff: t.fontFamily, ink: t.color, bg: w.backgroundColor, flex: getComputedStyle(document.querySelector(".sx-muted")).display }; })()`) : null;
  check("React: lớp sx-… có tác dụng dù Tailwind nạp sau", g?.fs === "28px" && /Plus Jakarta Sans/.test(g.ff), JSON.stringify(g));
  check("React: data-sx-preset trên div ngoài cùng đổi được màu và nền", g?.bg === "rgb(8, 9, 14)" && g.ink === "rgb(248, 250, 252)", JSON.stringify(g));
  check("React: lớp Tailwind vẫn dùng được cạnh bộ CSS", g?.flex === "flex", g?.flex);
  await view(1280, 720);
  await open(DECK, { deck: true });
  const n = await ev(`window.__sxAll().length`);
  const pdf = await P("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
  const pc = (Buffer.from(pdf.data, "base64").toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
  check("bản trình bày dùng bộ CSS: in mỗi slide một trang", pc === n, `${pc} trang / ${n} slide`);
}

// ---------------------------------------------------------------- bản mẫu
if (SAMPLES) {
  console.log("6. Bản mẫu: dựng, chụp sáng / tối, đo lỗi");
  for (const f of readdirSync(SAMPLES).filter((x) => x.endsWith(".html")).sort()) {
    const base = path.join(SAMPLES, f.replace(/\.html$/, "")), src = readFileSync(path.join(SAMPLES, f), "utf8");
    const deck = artdoc.isDeck({ type: "html", content: src }), poster = /sx-poster/.test(src), page = /sx-page/.test(src), auto = /data-sx-theme="auto"/.test(src);
    for (const scheme of auto ? ["light", "dark"] : ["light"]) {
      await media("", [{ name: "prefers-color-scheme", value: scheme }]);
      if (deck) {
        await view(1280, 720); await open(src, { deck: true });
        const n = await ev(`window.__sxAll().length`);
        for (let i = 0; i < n; i++) {
          await ev(`window.__sxGo(${i})`); await sleep(900);
          const found = await probe(`window.__sxCur()`, true);
          check(`${f} slide ${i + 1}: không đo thấy lỗi`, !found.length, JSON.stringify(found));
          await shot(`${base}-slide${i + 1}.png`);
        }
        // Slide giữ cố định dù máy ở chế độ tối.
        await media("", [{ name: "prefers-color-scheme", value: "dark" }]);
        const dark = await ev(`getComputedStyle(window.__sxCur()).backgroundColor`);
        await media();
        check(`${f}: slide giữ màu khi máy ở chế độ tối`, dark === (await ev(`getComputedStyle(window.__sxCur()).backgroundColor`)), dark);
        await view(640, 360); await sleep(200);
        const small = await probe(`window.__sxCur()`, true);
        check(`${f}: khung xem hẹp 640 (khung cạnh chat) vẫn vừa, chữ co theo`, !small.filter((x) => /tràn|cắt|đè/.test(x.kind)).length, JSON.stringify(small));
      } else {
        await view(poster ? 1080 : 1000, poster ? 1440 : 1100); await open(src);
        const found = await probe();
        check(`${f} ${scheme}: không đo thấy lỗi`, !found.length, JSON.stringify(found));
        await P("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }).then((x) => writeFileSync(`${base}-${scheme}.png`, Buffer.from(x.data, "base64")));
        if (page) {
          await view(390, 844); await sleep(150);
          const ph = await probe();
          check(`${f} ${scheme}: điện thoại 390 không tràn`, !ph.filter((x) => /tràn|cắt|đè/.test(x.kind)).length, JSON.stringify(ph));
          await P("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }).then((x) => writeFileSync(`${base}-${scheme}-phone.png`, Buffer.from(x.data, "base64")));
        }
      }
    }
    await media();
    if (page || poster) {
      await view(1000, 1100); await open(src);
      const pdf = await P("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
      const buf = Buffer.from(pdf.data, "base64"), out = `${base}.pdf`;
      writeFileSync(out, buf);
      const n = (buf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
      check(`${f}: in ra ${page ? "một trang A4" : "một trang"}`, n === 1, `${n} trang`);
      if (process.platform === "darwin") { spawnSync("qlmanage", ["-t", "-s", "1400", "-o", SAMPLES, out], { stdio: "ignore" }); }
    }
  }
}

check("không có yêu cầu mạng lạ", !stray.length, stray.slice(0, 5).join(" | "));
check("CSP không chặn gì (phông, thư viện)", !cspErr.length, cspErr.slice(0, 3).join(" | "));
check("không có lỗi JavaScript", !errs.length, errs.slice(0, 3).join(" | "));
if (faces.size) check("đã thật sự tải tệp phông qua đường Google Fonts", fontLoads.size > 0, `${fontLoads.size} tệp`);
ws.close(); chrome.kill();
console.log(fails ? `\n${fails} lỗi` : "\nTất cả đạt");
process.exit(fails ? 1 : 0);
