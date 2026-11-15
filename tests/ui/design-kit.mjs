// Bộ CSS trong khung artifact (shared/artkit.ts) kiểm bằng Chrome ẩn thật, không cần máy chủ Synchro, không gọi mạng: mọi yêu cầu đều do bài thử trả lời
// (trang dựng đúng bằng buildDocCore nên CSP là CSP thật; Google Fonts được đóng vai bằng tệp phông cục bộ), yêu cầu lạ bị chặn và tính là lỗi.
// Kiểm: phông có đủ dấu tiếng Việt (bảng cmap của tệp phông và phông Chrome thật sự dùng, dấu chồng không chạm dòng trên), khung slide và poster co theo cửa sổ, luật in của phong cách tối, mạng treo khi tải phông, chụp PNG lúc đang có stagger, chuyển động tôn trọng prefers-reduced-motion, không để chữ vô hình khi
// animation hỏng / lúc in / lúc chụp PowerPoint, các phép đo mới của check_artifact (chạy đúng mã PROBE trong artcheck.ts), lý do không tự thu nhỏ chữ.
// Chạy: node tests/ui/design-kit.mjs
//   SYNCHRO_FONT_DIR=<thư mục .ttf>: thư mục phông (tải theo commit ghim trong workspace/Dockerfile); không có thì bỏ phần phông, ghi rõ đã bỏ.
//   SAMPLES=<thư mục>: dựng mọi .html trong đó, chụp ảnh sáng / tối vào cùng thư mục, in PDF cho trang A4 và đo lỗi; có lỗi đo được thì bài thử không đạt.
import { createRequire } from "node:module";
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
  const src = readFileSync("server/artcheck.ts", "utf8");
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
let hangFonts = false; // đóng vai mạng treo: yêu cầu Google Fonts không bao giờ có trả lời
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
    if (hangFonts && u.startsWith("https://fonts.googleapis.com/")) return;
    if (u.startsWith("https://fonts.googleapis.com/css2")) return answer(S, requestId, fontCss(u), "text/css");
    if (u.startsWith("https://fonts.gstatic.com/local/")) { const f = decodeURIComponent(path.basename(new URL(u).pathname)); fontLoads.add(f); return answer(S, requestId, readFileSync(path.join(FONT_DIR, f)), "font/ttf"); }
    if (u.endsWith("/favicon.ico")) return send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, S);
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
  // Phông của bộ CSS nạp sau sự kiện load (kitHead): chờ tệp CSS rồi mới chờ phông.
  await ev(`new Promise((ok) => { let n = 0; const t = setInterval(() => { const l = document.querySelector("link[data-sx-font]"); if (!l || l.sheet || ++n > 40) { clearInterval(t); ok(1); } }, 25); })`);
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

if (faces.size) {
  // Dấu chồng (Ấ, Ệ) chạm chân chữ dòng trên: đo mực của hai dòng ở đúng bước dòng .sx-display của từng phong cách.
  await view(1280, 720);
  const heads = [...new Map(PRESETS.map((p) => [p.head, p])).values()];
  for (const p of heads) {
    await open(`<html data-sx-preset="${p.id}"><body><section class="slide sx-slide"><h1 class="sx-display" id="d">Hàng giày gặp</h1></section></body></html>`);
    const m = await ev(`(async () => { const el = document.getElementById("d"), cs = getComputedStyle(el), font = "800 80px " + cs.fontFamily.split(",")[0]; await document.fonts.load(font, "Ấ"); const lh = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize); const c = document.createElement("canvas"); c.width = 1200; c.height = 500; const x = c.getContext("2d", { willReadFrequently: true }); x.font = font; const ink = (t, y) => { x.clearRect(0, 0, 1200, 500); x.fillText(t, 10, y); return x.getImageData(0, 0, 1200, 500).data.slice(); }; const at = (L) => { const a = ink("Hàng giày gặp", 150), b = ink("Ấn Độ, Đồng Ệ", 150 + 80 * L); let n = 0; for (let i = 3; i < a.length; i += 4) if (a[i] > 64 && b[i] > 64) n++; return n; }; return { lh, on: at(lh), scan: Object.fromEntries([1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4].map((L) => [L, at(L)])) }; })()`);
    check(`${p.head}: dấu chồng không chạm dòng trên ở .sx-display (bước dòng ${m.lh.toFixed(2)})`, m.on === 0, JSON.stringify(m));
  }
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
  for (let i = 0; i < 240 && !last; i++) { await sleep(250); last = await ev(`(() => { const m = window.__posts.find((p) => p.t === "pptx"); return m ? { error: m.error, n: m.slides?.length, w: m.w, h: m.h, boxes: m.slides?.map((s) => s.boxes.flatMap((b) => b.runs.map((x) => [x.t, x.f, x.c, x.a]))), g: m.slides?.flatMap((s) => s.boxes.flatMap((b) => b.runs.map((x) => x.g))), bg: m.slides?.map((s) => s.bg.length) } : null; })()`); }
  check("chụp xong không lỗi", !!last && !last.error, last?.error ?? "");
  const runs = (last?.boxes ?? []).flat();
  check("mỗi slide có chữ sửa được", (last?.boxes ?? []).every((b) => b.length > 0), `${last?.n} slide, ${runs.length} đoạn chữ`);
  check("giữ dấu tiếng Việt", runs.some((x) => /[ăãơợớậưệ]/i.test(x[0])), runs[0]?.[0]);
  const fonts = new Set(runs.map((x) => x[1]));
  const preset0 = () => PRESETS.find((p) => DECK.includes(`data-sx-preset="${p.id}"`)) ?? PRESETS[0];
  // Chủ dự án chốt: giữ đúng tên phông thiết kế của bộ CSS (máy có phông thì hiện đúng), phông dự phòng ghi lúc dựng tệp (deckpptx.withFontFallback, kiểm ở tests/ui/pptx.mjs).
  const kit = new Set([preset0().head, preset0().body, preset0().mono]);
  check("hộp chữ giữ đúng tên phông thiết kế của bộ CSS, kèm dáng để chọn phông dự phòng", [...fonts].length > 0 && [...fonts].every((f) => kit.has(f)) && (last?.g ?? []).every((g) => ["sans", "serif", "mono"].includes(g)), `${[...fonts].join(", ")} · bộ: ${[...kit].join(", ")}`);
  const colors = new Set(runs.map((x) => x[2]));
  const preset = PRESETS.find((p) => DECK.includes(`data-sx-preset="${p.id}"`));
  check("màu chữ đọc được từ biến của bộ CSS", colors.has(preset.ink.slice(1)) || colors.has(preset.accent.slice(1)), [...colors].join(", "));
  check("đoạn chữ không mất vì opacity:0 của chuyển động", DECK.includes("sx-rise") ? runs.length > 0 : true);
  check("ảnh nền có dữ liệu", (last?.bg ?? []).every((n) => n > 2000), (last?.bg ?? []).join(", "));
}

// ---------------------------------------------------------------- các lỗi kiểm duyệt tìm thấy
console.log("4b. Chụp PNG, in, khung co theo cửa sổ, mạng treo, trang chỉ có phần thân");
const BR = `<script>window.__posts=[];function post(m){window.__posts.push(m)}${deckpptx.PPTX_FRAME_JS}</script><script src="${ORIGIN}/vendor/${artdoc.H2I[0]}"></script>`;
const nav = async (html) => { const url = `${ORIGIN}/doc/${++docN}`; pages.set(url, html); const done = new Promise((res) => { const h = (e) => { const m = JSON.parse(e.data); if (m.method === "Page.loadEventFired" && m.sessionId === S) { ws.removeEventListener("message", h); res(); } }; ws.addEventListener("message", h); }); await P("Page.navigate", { url }); await done; };
{
  // Mở trang rồi chụp ngay, đúng lúc phần tử cuối trong stagger còn opacity 0.
  const items = Array.from({ length: 30 }, (_, i) => `<div class="sx-card sx-rise" style="--sx-i:${i};background:#0052cc;height:40px;color:#fff">Mục ${i + 1}</div>`).join("");
  await view(800, 600);
  await nav(buildDocCore("html", `<html data-sx-preset="exec-navy"><body><div class="sx-page">${items}</div></body></html>`, ORIGIN, "t", false, BR));
  const before = await ev(`+getComputedStyle(document.querySelectorAll(".sx-rise")[29]).opacity`);
  await ev(`sxCapture("x", "")`);
  let png = null; for (let i = 0; i < 120 && !png; i++) { await sleep(100); png = await ev(`window.__posts.find((p) => p.t === "png") || null`); }
  check("chụp PNG không lỗi", !!png?.data, png?.error ?? "");
  const blue = await ev(`new Promise((ok) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d"); x.drawImage(im, 0, 0); const row = [0.25, 0.5, 0.75, 0.93].map((f) => { const d = x.getImageData(0, 0, im.width, Math.round(im.height * f)).data.slice(-im.width * 4 * 40); let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && d[i + 2] > 170) n++; return n; }); ok(row); }; im.src = window.__posts.find((p) => p.t === "png").data; })`);
  check("PNG chụp ngay sau khi mở: phần tử chưa tới lượt trong stagger vẫn có trong ảnh", before < 1 && blue.every((n) => n > 1000), `opacity lúc chụp ${before}, điểm xanh theo vùng ${blue.join(", ")}`);

  // Tương phản: chữ đang hiện dần không phải lỗi thật. Chạy ngay sau khi mở, như check_artifact sau khi đổi slide.
  await view(1280, 720);
  const rows = Array.from({ length: 12 }, (_, i) => `<p class="sx-small sx-rise" style="--sx-i:${i}">Chỉ số thứ ${i + 1}</p>`).join("");
  await nav(buildDocCore("html", `<html data-sx-preset="exec-navy"><body><section class="slide sx-slide"><h2 class="sx-title sx-fade">Tiêu đề kết luận</h2>${rows}</section></body></html>`, ORIGIN, "t", false, ""));
  let r0 = await probe(`document.querySelector("section")`, true);
  check("check_artifact: chữ đang hiện dần không bị báo tương phản thấp", !kinds(r0).includes("tương phản thấp"), JSON.stringify(r0));
  await open(`<html data-sx-preset="swiss-grid"><body><div class="sx-page"><p class="sx-fade" style="color:#bbb">Chữ xám nhạt vẫn phải bị báo dù đang chạy hiệu ứng</p><p style="opacity:.2;--sx-i:0">Chữ mờ thật sự vẫn bị báo</p></div></body></html>`);
  r0 = await probe();
  check("check_artifact: lỗi tương phản thật vẫn được báo", r0.filter((x) => x.kind === "tương phản thấp").length === 2, JSON.stringify(r0));

  // Poster co theo khung: đo ở cỡ thật, không phải cỡ đã co trên điện thoại.
  const POSTER = (extra = "") => `<html data-sx-preset="exec-navy"><body><div class="sx-poster"><p class="sx-eyebrow">Nhãn sự kiện</p><h1 class="sx-display">Đêm nhạc cuối năm</h1><p class="sx-source">Nguồn: ban tổ chức</p>${extra}</div></body></html>`;
  await view(390, 844); await open(POSTER());
  r0 = await probe();
  check("poster 390px: chữ mặc định của bộ CSS không bị báo quá nhỏ", !kinds(r0).includes("chữ quá nhỏ"), JSON.stringify(r0));
  await open(POSTER(`<p style="font-size:calc(9*var(--sx-u))">Chữ chín đơn vị trên khổ 1080</p>`));
  r0 = await probe();
  check("poster: chữ thật sự nhỏ ở cỡ thật vẫn bị báo", r0.filter((x) => x.kind === "chữ quá nhỏ").length === 1, JSON.stringify(r0));
  await view(1000, 800); await open(`<html data-sx-preset="exec-navy"><body><p style="font-size:8px">Chữ tám điểm trên trang thường</p></body></html>`);
  check("trang thường: ngưỡng cũ không đổi", kinds(await probe()).includes("chữ quá nhỏ"));

  // Khung giữ tỉ lệ ở mọi cửa sổ: không cắt đáy slide, không thanh cuộn của poster.
  const trs = Array.from({ length: 10 }, (_, i) => `<tr><td>Hàng ${i + 1}</td><td class="n">${i + 1},0</td></tr>`).join("");
  const DENSE = `<html data-sx-preset="exec-navy"><body><section class="slide sx-slide"><p class="sx-eyebrow">Nhãn</p><h2 class="sx-title">Tiêu đề kết luận của slide nhiều số</h2><table class="sx-table"><tbody>${trs}</tbody></table><p class="sx-source sx-end" id="src">Nguồn: bảng số</p></section><section class="slide sx-slide"><p>B</p></section></body></html>`;
  const fit = `(() => { const s = window.__sxCur(), b = s.getBoundingClientRect(), n = document.getElementById("src").getBoundingClientRect(), d = document.documentElement; return { w: b.width, h: b.height, l: b.left, t: b.top, srcB: n.bottom, vh: innerHeight, vw: innerWidth, sx: d.scrollWidth, sy: d.scrollHeight }; })()`;
  for (const [w, h] of [[1280, 720], [1920, 950], [1440, 790], [2560, 1080], [800, 900], [390, 844]]) {
    await view(w, h); await open(DENSE, { deck: true });
    const g = await ev(fit);
    check(`slide ở cửa sổ ${w}×${h}: đúng 16:9, nằm trọn trong khung, dòng nguồn không mất`, Math.abs(g.w / g.h - 16 / 9) < 0.01 && g.t >= -0.5 && g.l >= -0.5 && g.t + g.h <= h + 0.5 && g.l + g.w <= w + 0.5 && g.srcB <= g.t + g.h && g.sy <= h && g.sx <= w, JSON.stringify(g));
  }
  await view(1280, 720); await open(DENSE, { deck: true });
  const pdf0 = await P("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
  const pc0 = (Buffer.from(pdf0.data, "base64").toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
  check("slide canh giữa vẫn in mỗi slide một trang", pc0 === 2, `${pc0} trang`);
  // Model tự đặt lại kích thước theo ARTIFACT_RULES: không bị đẩy lệch hay cắt.
  await view(1920, 950); await open(`<html data-sx-preset="exec-navy"><head><style>section.slide{width:100vw;height:100vh}</style></head><body><section class="slide sx-slide"><p class="sx-title">A</p></section><section class="slide sx-slide"><p>B</p></section></body></html>`, { deck: true });
  const own = await ev(`(() => { const b = window.__sxCur().getBoundingClientRect(), d = document.documentElement; return [b.left, b.top, b.width, b.height, d.scrollWidth, d.scrollHeight]; })()`);
  check("model tự đặt width:100vw;height:100vh: khung vẫn phủ đúng cửa sổ", own.join() === "0,0,1920,950,1920,950", own.join());
  // Ảnh chụp không bị lệch theo phần canh giữa: cửa sổ rộng, dải nền lộ ra là lỗi.
  await view(1920, 700);
  await nav(buildDocCore("html", `<html data-sx-preset="exec-navy"><body><section class="slide sx-slide" style="background:#c00"><p>A</p></section><section class="slide sx-slide" style="background:#c00"><p>B</p></section></body></html>`, ORIGIN, "t", false, BR, { fixed: null }));
  await sleep(200);
  await ev(`sxCapture("y", "")`);
  let shot0 = null; for (let i = 0; i < 80 && !shot0; i++) { await sleep(100); shot0 = await ev(`window.__posts.find((p) => p.id === "y") || null`); }
  const edge = await ev(`new Promise((ok) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d"); x.drawImage(im, 0, 0); const px = (a, b) => [...x.getImageData(a, b, 1, 1).data].slice(0, 3).join(); ok({ w: im.width, h: im.height, tl: px(3, 3), br: px(im.width - 4, im.height - 4) }); }; im.src = window.__posts.find((p) => p.id === "y").data; })`);
  check("PNG slide ở cửa sổ rộng: đúng 16:9, phủ kín, không lệch", Math.abs(edge.w / edge.h - 16 / 9) < 0.02 && edge.tl === "204,0,0" && edge.br === "204,0,0", JSON.stringify(edge));
  for (const [w, h] of [[900, 700], [1366, 768], [390, 844], [1080, 1440]]) {
    await view(w, h); await open(POSTER());
    const g = await ev(`(() => { const s = document.querySelector(".sx-poster"), b = s.getBoundingClientRect(), d = document.documentElement; return { w: b.width, h: b.height, l: b.left, t: b.top, cw: d.clientWidth, ch: d.clientHeight, sw: d.scrollWidth, sh: d.scrollHeight }; })()`);
    check(`poster ở cửa sổ ${w}×${h}: đúng 3:4, không cuộn, nằm giữa`, Math.abs(g.w / g.h - 0.75) < 0.01 && g.sw <= g.cw && g.sh <= g.ch && Math.abs(g.l - (g.cw - g.w) / 2) < 1 && Math.abs(g.t - (g.ch - g.h) / 2) < 1, JSON.stringify(g));
  }

  // In trang đọc của phong cách vốn tối: nền trắng thì màu nhấn phải đổi theo.
  await view(1000, 1100);
  await media("print");
  for (const id of ["data-terminal", "midnight-tech"]) for (const attr of ["html", "div"]) {
    const inner = `<div class="sx-page"><p class="sx-eyebrow">Nhãn nhỏ</p><p class="sx-kpi sx-accent">12,5</p><p class="sx-up">Tăng lên</p><p class="sx-down">Giảm xuống</p><div class="sx-card sx-solid"><p>Thẻ nền đặc</p></div><span class="sx-badge">Nhãn trạng thái</span><div class="sx-callout"><p class="sx-accent">Nhấn trong ghi chú</p></div></div>`;
    await open(attr === "html" ? `<html data-sx-preset="${id}"><body>${inner}</body></html>` : `<html><body><div data-sx-preset="${id}">${inner}</div></body></html>`);
    const low = (await probe()).filter((x) => x.kind === "tương phản thấp");
    const bg = await ev(`getComputedStyle(document.body).backgroundColor`);
    check(`in ${id} (preset trên ${attr}): chữ nhấn đạt 4.5:1 trên giấy trắng`, !low.length, JSON.stringify(low));
    if (attr === "html") check(`in ${id}: nền trắng`, bg === "rgb(255, 255, 255)", bg);
  }
  await open(`<html data-sx-preset="data-terminal"><body><section class="slide sx-slide"><p class="sx-accent">Slide giữ màu</p></section></body></html>`);
  check("in slide nền tối: giữ nguyên màu của slide", (await ev(`getComputedStyle(document.querySelector(".sx-accent")).color`)) === "rgb(16, 185, 129)"); // #10B981 của bảng phong cách
  await media();

  // Mạng treo: yêu cầu phông không có trả lời, trang vẫn phải vẽ ngay.
  await view(1000, 800);
  hangFonts = true;
  const hungUrl = `${ORIGIN}/doc/${++docN}`;
  pages.set(hungUrl, buildDocCore("html", `<html data-sx-preset="exec-navy"><body><div class="sx-page"><h1 class="sx-title">Vẫn hiện khi phông treo</h1></div></body></html>`, ORIGIN, "t", false, ""));
  await P("Page.navigate", { url: hungUrl });
  await sleep(1500);
  const hung = await ev(`({ fcp: performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint")?.startTime ?? null, ready: document.readyState, })`);
  hangFonts = false;
  check("mạng treo khi tải phông: trang vẫn vẽ ngay", hung.fcp !== null && hung.fcp < 1000, JSON.stringify(hung));
  check("mạng treo khi tải phông: sự kiện load vẫn tới, khung báo được chiều cao", hung.ready === "complete", JSON.stringify(hung));
  await sleep(100);
  await open(`<html data-sx-preset="exec-navy"><body><p class="sx-title" id="t">Phông tải xong thì áp dụng</p></body></html>`);
  check("mạng bình thường: tệp phông vẫn được nạp", await ev(`!!document.querySelector("link[data-sx-font]")?.sheet`));

  // Trang chỉ viết phần thân, có <header>.
  await view(1280, 720);
  await open(`<section class="slide sx-slide"><header class="sx-stack"><p class="sx-eyebrow">Nhãn</p><h2 class="sx-title">Tiêu đề</h2></header></section>`);
  const hd = await ev(`({ mode: document.compatMode, csp: !!document.head.querySelector('meta[http-equiv="Content-Security-Policy"]'), kit: !!document.head.querySelector("style[data-sx-kit]"), inHeader: !!document.querySelector("header meta, header style, header script") })`);
  check("trang chỉ có phần thân, có <header>: không rơi vào chế độ quirks, CSP và bộ CSS trong <head>", hd.mode === "CSS1Compat" && hd.csp && hd.kit && !hd.inHeader, JSON.stringify(hd));

  // SVG dùng biến của bộ CSS.
  await view(600, 600);
  await nav(buildDocCore("svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" data-sx-preset="exec-navy"><rect id="r" width="10" height="10" fill="var(--sx-accent)"/></svg>`, ORIGIN, "t", false, ""));
  check("SVG: màu lấy từ biến của bộ CSS đúng như quy tắc", (await ev(`getComputedStyle(document.getElementById("r")).fill`)) === "rgb(0, 82, 204)", await ev(`getComputedStyle(document.getElementById("r")).fill`));
  check("SVG: khung vẫn canh giữa, không bị nền của bộ CSS đè", (await ev(`getComputedStyle(document.body).display`)) === "grid");

  // Thư viện thật: bước dòng ghi bằng điểm.
  await view(1280, 720);
  await nav(buildDocCore("html", `<html><body><script src="${ORIGIN}/vendor/pptxgen-4.0.1.bundle.js"></script></body></html>`, ORIGIN, "t", false, ""));
  const JSZip = createRequire(path.join(process.cwd(), "package.json"))("jszip");
  const opts = deckpptx.boxOptions({ x: 64, y: 100, w: 800, h: 264, al: "left", lh: 88, one: false, runs: [] }, 1280, 720);
  const b64 = await ev(`(async () => { const p = new PptxGenJS(); p.layout = "LAYOUT_WIDE"; const s = p.addSlide(); s.addText([{ text: "Dòng một", options: { fontFace: "Arial", fontSize: 60, breakLine: true } }, { text: "Dòng hai", options: { fontFace: "Arial", fontSize: 60 } }], ${JSON.stringify(opts)}); return await p.write({ outputType: "base64" }); })()`);
  const xml = await (await JSZip.loadAsync(Buffer.from(b64, "base64"))).file("ppt/slides/slide1.xml").async("string");
  check("tệp PowerPoint: bước dòng ghi bằng điểm đúng số đo của trình duyệt, không ghi bội số", /<a:spcPts val="6600"\/>/.test(xml) && !/spcPct/.test(xml), (xml.match(/<a:lnSpc>.*?<\/a:lnSpc>/) ?? [""])[0]);
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
