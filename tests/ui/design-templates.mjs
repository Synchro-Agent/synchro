// Mẫu điền sẵn (app/designtemplates.ts…) dựng trong Chrome ẩn thật, không cần máy chủ Synchro: trang dựng đúng bằng buildDocCore (CSP thật, bộ CSS thật, tự vá FIT_JS thật).
// Kiểm: mọi slide / trang / poster không đo thấy lỗi bằng đúng phép đo của check_artifact (chữ tràn, đè, cắt, tương phản), tự co chữ khi tiêu đề quá dài,
// tự đổi màu chữ khi tương phản thấp, thư HTML chỉ có bảng và style nội dòng. Ảnh chụp (hai phong cách mỗi loại) ghi vào OUT để người xem bằng mắt.
// Chạy: node tests/ui/design-templates.mjs
//   OUT=<thư mục ảnh>      (mặc định thư mục tạm)
//   DESIGN_NET=1           cho Google Fonts đi mạng thật như trình duyệt người dùng (để thấy đúng phông, dấu tiếng Việt); mặc định chặn mọi mạng
//   SYNCHRO_FONT_DIR=<dir> phông cục bộ thay cho Google Fonts (như tests/ui/design-kit.mjs)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadTs } from "../lib/ts.mjs";

const { artdoc, artprobe, designtemplates: T, designpresets } = await loadTs(["artdoc", "artprobe", "designtemplates", "designpresets"]);
const { FONT_SPEC } = designpresets;
const OUT = process.env.OUT ?? path.join(os.tmpdir(), "synchro-ui", "design-templates");
const NET = process.env.DESIGN_NET === "1", FONT_DIR = process.env.SYNCHRO_FONT_DIR ?? "";
const CDP = Number(process.env.CDP_PORT ?? 9388), PROF = path.join(os.tmpdir(), `synchro-ui/chrome-prof-tpl-${CDP}`);
mkdirSync(OUT, { recursive: true });
rmSync(PROF, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails++; };
const PROBE = (() => { const m = /const PROBE = String\.raw`([\s\S]*?)`;\n/.exec(readFileSync("app/artcheck.ts", "utf8")); return m[1].replace("${DESIGN_PROBE}", artprobe.DESIGN_PROBE); })();

// Ảnh: khung artifact chỉ nhận data: (máy chủ nhúng ảnh https trước khi dựng); ở đây nhúng ảnh tự vẽ bằng sharp: ảnh phong cảnh và ảnh chủ thể nền trong suốt.
const sharp = createRequire(path.join(process.cwd(), "package.json"))("sharp");
const svgPng = async (svg) => `data:image/png;base64,${(await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64")}`;
const PHOTO = await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e3a5f"/><stop offset="1" stop-color="#e8a66b"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#s)"/><path d="M0 760 L380 520 L640 700 L980 430 L1600 780 L1600 1000 L0 1000Z" fill="#2b2f3a"/><path d="M0 860 L520 690 L900 820 L1300 640 L1600 860 L1600 1000 L0 1000Z" fill="#14161c"/></svg>`);
const CUT = await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1000"><ellipse cx="450" cy="900" rx="330" ry="70" fill="#0b0b10" opacity=".35"/><rect x="250" y="260" width="400" height="620" rx="80" fill="#f2f4f8"/><rect x="290" y="300" width="320" height="420" rx="40" fill="#5b8cff"/><circle cx="450" cy="800" r="34" fill="#c9cfdb"/></svg>`);
const imgs = (s) => s.replaceAll("https://img.test/photo.jpg", PHOTO).replaceAll("https://img.test/cutout.png", CUT);

// ---------------------------------------------------------------- Chrome
const chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROF}`, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 60 && !ver; i++) { await sleep(200); ver = await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json()).catch(() => null); }
if (!ver) throw new Error("không mở được Chrome");
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const waits = new Map(), errs = [], pages = new Map();
const ORIGIN = "https://app.test";
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const answer = (S, requestId, body, type) => send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: type }, { name: "access-control-allow-origin", value: "*" }], body: Buffer.from(body).toString("base64") }, S);
const faces = FONT_DIR && existsSync(FONT_DIR) ? readdirSync(FONT_DIR).filter((f) => f.endsWith(".ttf")) : [];
const localFonts = (u) => [...new URL(u).searchParams.getAll("family")].map((x) => x.split(":")[0].replace(/\+/g, " ")).flatMap((n) => faces.filter((f) => f.replace(/\W/g, "").toLowerCase().startsWith(n.replace(/\W/g, "").toLowerCase())).map((f) => `@font-face{font-family:"${n}";font-weight:${/Bold/.test(f) ? 700 : /Regular/.test(f) ? 400 : "100 900"};src:url(https://fonts.gstatic.com/local/${encodeURIComponent(f)}) format("truetype")}`)).join("\n");
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split("\n")[0]);
  if (m.method === "Fetch.requestPaused") {
    const { requestId, request } = m.params, S = m.sessionId, u = request.url;
    if (u.startsWith(`${ORIGIN}/doc/`)) return answer(S, requestId, pages.get(u) ?? "", "text/html; charset=utf-8");
    if (u.startsWith(`${ORIGIN}/vendor/`)) return answer(S, requestId, readFileSync(path.join("public/vendor", path.basename(new URL(u).pathname))), "application/javascript");
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) {
      if (NET) return send("Fetch.continueRequest", { requestId }, S);
      if (faces.length && u.startsWith("https://fonts.googleapis.com/css2")) return answer(S, requestId, localFonts(u), "text/css");
      if (faces.length && u.startsWith("https://fonts.gstatic.com/local/")) return answer(S, requestId, readFileSync(path.join(FONT_DIR, decodeURIComponent(path.basename(new URL(u).pathname)))), "font/ttf");
    }
    send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, S);
  }
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (method, params) => send(method, params, S);
await P("Runtime.enable"); await P("Page.enable");
await P("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
const ev = async (expr) => { const r = await P("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const view = (width, height) => P("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
let docN = 0;
const open = async (content, deck = false) => {
  const url = `${ORIGIN}/doc/${++docN}`;
  pages.set(url, artdoc.buildDocCore("html", imgs(content), ORIGIN, "t", false, "", deck ? { fixed: null } : undefined, "Mẫu"));
  const done = new Promise((r) => { const h = (e) => { const m = JSON.parse(e.data); if (m.method === "Page.loadEventFired" && m.sessionId === S) { ws.removeEventListener("message", h); r(); } }; ws.addEventListener("message", h); });
  await P("Page.navigate", { url });
  await done;
  await ev(`new Promise((ok) => { let n = 0; const t = setInterval(() => { const l = document.querySelector("link[data-sx-font]"); if (!l || l.sheet || ++n > 80) { clearInterval(t); ok(1); } }, 25); })`);
  await ev(`document.fonts.ready.then(() => 1)`);
  await sleep(NET ? 700 : 250);
};
const shot = async (file, clip) => { const r = await P("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); writeFileSync(path.join(OUT, file), Buffer.from(r.data, "base64")); };
const probe = (root = "document.body", isDeck = false) => ev(`(${PROBE})(${root}, ${isDeck})`);
const block = (spec) => `<script type="application/json" data-sx-template>${JSON.stringify(spec)}</script>`;

// ---------------------------------------------------------------- bộ slide, hai phong cách
const DECK = (style) => ({
  styleArchetype: style,
  pages: [
    { templateId: "slide-cover", props: { badge: "Báo cáo quý 3 · 2026", title: "Tự động hóa đưa doanh thu vượt kế hoạch", subtitle: "Tổng kết kết quả kinh doanh và ưu tiên quý 4 cho ban điều hành", author: "Phòng Tài chính – Kế hoạch", date: "Tháng 11/2026" } },
    { templateId: "slide-fact", props: { eyebrow: "Tăng trưởng doanh thu Q3", bigMetric: "+142%", description: "Vượt gấp đôi mục tiêu nhờ tự động hóa toàn bộ phễu chuyển đổi khách hàng.", source: "Nguồn: báo cáo nội bộ, số liệu ví dụ" }, morphId: "!!kpi" },
    { templateId: "slide-bento-3", props: { eyebrow: "Kết quả theo trụ cột", actionTitle: "Cả ba trụ cột đều tăng trưởng hai chữ số", kicker: "Quý 3/2026 so với quý 2/2026", heroCard: { title: "Doanh thu thuần", metric: "14,8 tỷ", detail: "Tăng 142% nhờ kênh trực tiếp và gói doanh nghiệp" }, sideCardTop: { title: "Khách hàng mới", metric: "+3.200", bullet: "Chi phí mỗi khách giảm 18%" }, sideCardBottom: { title: "Giữ chân 90 ngày", metric: "92%", bullet: "Cao nhất từ trước tới nay" }, source: "Số liệu ví dụ" }, morphId: "!!kpi" },
    { templateId: "slide-two-cols", props: { eyebrow: "So sánh kênh bán", title: "Kênh trực tiếp lãi gấp đôi đại lý", kicker: "Biên lợi nhuận gộp theo kênh, quý 3", left: { heading: "Trực tiếp", bullets: ["Biên gộp 32%, tăng 6 điểm", "Chi phí thu hút khách thấp nhất", "Dữ liệu khách hàng về thẳng hệ thống"] }, right: { heading: "Đại lý", body: "Biên gộp 15%, phụ thuộc chiết khấu theo mùa.\n\nPhù hợp cho thị trường tỉnh, nơi đội bán chưa phủ tới." } } },
    { templateId: "slide-image-right", props: { eyebrow: "Sản phẩm mới", title: "Dòng thiết bị thế hệ hai nhẹ hơn 20%", bullets: ["Pin dùng 18 giờ", "Sạc đầy trong 35 phút", "Vỏ nhôm tái chế"], image: "https://img.test/photo.jpg", caption: "Ảnh minh họa" } },
    { templateId: "slide-quote", props: { quote: "Khách hàng ở lại không vì giá rẻ mà vì **tốc độ** chúng ta giải quyết vấn đề của họ.", author: "Nguyễn Thị Hồng Ngọc", role: "Giám đốc Vận hành" } },
    { templateId: "slide-section", props: { number: "02", title: "Ưu tiên quý 4", subtitle: "Ba việc quyết định kết quả cả năm" } },
    { templateId: "slide-depth-hero", props: { eyebrow: "Ra mắt sản phẩm", giantBehindText: "TỐC ĐỘ", subtitle: "Thiết bị mới nhanh gấp đôi, ra mắt tháng 12", image: "https://img.test/photo.jpg", cutout: "https://img.test/cutout.png", imageQuery: "device" } },
    { templateId: "slide-depth-hero", props: { eyebrow: "Không có ảnh", giantBehindText: "ỔN ĐỊNH", subtitle: "Mẫu tự lùi về nền tối khi không có ảnh chủ thể" } },
  ],
});
const LONG = { styleArchetype: "editorial-serif", pages: [{ templateId: "slide-bento-3", props: { eyebrow: "Tiêu đề quá dài", actionTitle: "Tiêu đề này cố tình viết rất dài vượt xa giới hạn mười từ để xem Synchro có tự co chữ cho vừa khung slide hay không, kể cả khi người viết quên quy tắc. ".repeat(2), heroCard: { title: "Doanh thu", metric: "14,8 tỷ", detail: "Một đoạn mô tả dài hơn bình thường để thẻ lớn phải chứa nhiều chữ hơn so với thiết kế ban đầu của mẫu, nhiều dòng liền nhau. ".repeat(3) }, sideCardTop: { title: "Khách mới", bullet: "Đoạn chữ dài trong thẻ nhỏ phía trên bên phải, dài gấp ba lần quy định mười lăm từ của thẻ để thử tự co chữ trong thẻ" }, sideCardBottom: { title: "Giữ chân", bullet: "92%" } } }] };

console.log("1. Slide theo mẫu: hai phong cách, đo bằng phép đo của check_artifact");
await view(1280, 720);
for (const style of ["linear-dark", "editorial-serif"]) {
  const html = T.expandTemplates(`<html><body>${block(DECK(style))}</body></html>`);
  await open(html, true);
  const n = await ev(`window.__sxAll().length`);
  check(`${style}: ${n} slide`, n === 9, String(n));
  for (let i = 0; i < n; i++) {
    await ev(`window.__sxGo(${i})`); await sleep(500);
    const found = (await probe(`window.__sxCur()`, true)).filter((x) => !/ảnh hỏng/.test(x.kind));
    check(`${style} slide ${i + 1}: không đo thấy lỗi`, !found.length, JSON.stringify(found));
    await shot(`slides-${style}-${i + 1}.png`);
  }
}
{
  await open(T.expandTemplates(block(LONG)), false);
  const r = await ev(`(() => { const s = document.querySelector("section"); const t = document.querySelector('[data-node-id="p1.actionTitle"]'); return { over: s.scrollHeight > s.clientHeight + 1, fitted: t.getAttribute("data-sx-fitted"), fs: parseFloat(getComputedStyle(t).fontSize), cards: [...document.querySelectorAll(".sx-card")].map((c) => c.scrollHeight <= c.clientHeight + 1), min: Math.min(...[...document.querySelectorAll("[data-sx-fitted]")].map((e) => +e.getAttribute("data-sx-fitted"))), kpi: parseFloat(getComputedStyle(document.querySelector('[data-node-id="p1.heroCard.metric"]')).fontSize), body: parseFloat(getComputedStyle(document.querySelector('[data-node-id="p1.heroCard.detail"]')).fontSize) }; })()`);
  check("chữ quá dài: cả slide co cùng tỉ lệ cho vừa slide và vừa thẻ, không dưới 11, số KPI vẫn lớn hơn chữ thân", !r.over && r.cards.every(Boolean) && +r.fitted < 44 && r.min >= 11 && r.kpi > r.body * 2, JSON.stringify(r));
  await shot("slides-tu-co-chu.png");
}
{
  // Tự đổi màu chữ: ô chữ màu gần trùng nền (model chỉnh tay sai) thành sáng / tối theo độ chói.
  await open(`<html data-sx-preset="exec-navy"><body><section class="slide sx-slide" style="background:#0A192F"><h2 class="sx-title" data-node-id="x.t" style="color:#1E293B">Chữ tối trên nền navy</h2><table class="sx-table"><tr><td class="sx-heat n" style="--sx-v:100%">1.250</td><td class="sx-heat n" style="--sx-v:5%">80</td></tr></table></section></body></html>`, false);
  const r = await ev(`[getComputedStyle(document.querySelector("h2")).color, ...[...document.querySelectorAll(".sx-heat")].map((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor])]`);
  check("tương phản thấp: chữ tự đổi sang sáng", r[0] === "rgb(248, 250, 252)", JSON.stringify(r));
  const low = (await probe(`document.querySelector("section")`, true)).filter((x) => x.kind === "tương phản thấp");
  check("ô nhiệt: chữ tự sáng / tối theo nền, đạt 4.5:1", !low.length, JSON.stringify(low));
}

console.log("1b. Slide biểu đồ: sáu loại, hai phong cách");
const CH = [
  { kind: "bar", title: "Quý 3 có doanh thu cao nhất năm", labels: ["Quý 1", "Quý 2", "Quý 3", "Quý 4"], values: [8.2, 9.6, 14.8, 12.1], unit: " tỷ", highlight: "Quý 3", source: "Số liệu ví dụ" },
  { kind: "line", title: "Người dùng năm nay tăng nhanh gấp đôi", labels: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"], series: [{ name: "2026", data: [12, 15, 19, 24, 30, 37, 45, 52] }, { name: "2025", data: [10, 11, 13, 14, 16, 18, 19, 21] }], unit: "k" },
  { kind: "doughnut", title: "Kênh trực tiếp chiếm 61% doanh thu", labels: ["Trực tiếp", "Đại lý", "Thương mại điện tử", "Khác"], values: [61, 21, 13, 5] },
  { kind: "waterfall", title: "Lợi nhuận tăng 23 tỷ trong năm", start: { label: "Đầu năm", value: 100 }, labels: ["Bán hàng", "Dịch vụ", "Giá vốn", "Chi phí"], values: [62, 18, -45, -12], endLabel: "Cuối năm" },
  { kind: "sankey", title: "3 trên 10 người dùng thử chuyển sang trả phí", links: [{ from: "Quảng cáo", to: "Dùng thử", value: 50 }, { from: "Giới thiệu", to: "Dùng thử", value: 30 }, { from: "Tự tìm", to: "Dùng thử", value: 20 }, { from: "Dùng thử", to: "Trả phí", value: 30 }, { from: "Dùng thử", to: "Rời đi", value: 70 }], highlight: "Trả phí" },
  { kind: "radar", title: "Vượt đối thủ ở bốn trên năm tiêu chí", labels: ["Tốc độ", "Giá", "Hỗ trợ", "Tính năng", "Bảo mật"], series: [{ name: "Synchro", data: [9, 7, 8, 8, 9] }, { name: "Đối thủ A", data: [6, 8, 6, 7, 7] }], max: 10 },
];
for (const style of ["swiss-grid", "linear-dark"]) {
  const pages = CH.map((chart, i) => ({ templateId: "slide-chart", props: { eyebrow: "Biểu đồ " + (i + 1), title: chart.title, chart: { ...chart, title: "" }, ...(i % 2 ? { insight: "Kênh trực tiếp tăng nhờ đội bán mới ở hai thành phố lớn.", bullets: ["Chi phí mỗi khách giảm 18%"] } : {}), source: "Nguồn: số liệu ví dụ" } }));
  await view(1280, 720);
  await open(T.expandTemplates(block({ styleArchetype: style, pages })), true);
  for (let i = 0; i < pages.length; i++) {
    await ev(`window.__sxGo(${i})`); await sleep(1400);
    const found = (await probe(`window.__sxCur()`, true)).filter((x) => !/ảnh hỏng/.test(x.kind));
    const r = await ev(`(() => { const s = window.__sxCur(), v = s.querySelector("svg").getBoundingClientRect(), b = s.getBoundingClientRect(); return v.height > 150 && v.bottom <= b.bottom + 1; })()`);
    check(`biểu đồ ${CH[i].kind} ${style}: không đo thấy lỗi, biểu đồ đủ lớn và nằm trong slide`, !found.length && r, JSON.stringify(found));
    await shot(`chart-${CH[i].kind}-${style}.png`);
  }
}

console.log("2. Thư HTML theo mẫu: hai phong cách, máy tính và điện thoại");
const MAILS = [
  ["email-receipt", { brand: "Cửa hàng Mộc", heading: "Biên lai thanh toán", orderId: "DH-20931", date: "11/11/2026", customer: "Trần Bảo Ngọc", paymentMethod: "Thẻ Visa ••4242", currency: "VND", items: [{ name: "Gói Pro 12 tháng", detail: "Gia hạn tự động mỗi năm", price: 1990000 }, { name: "Thêm thành viên", qty: 2, price: 250000 }], tax: 249000, taxLabel: "Thuế GTGT 10%", supportUrl: "https://example.com/ho-tro", address: "12 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội" }],
  ["email-welcome", { brand: "Synchro", preview: "Ba bước để bắt đầu", heading: "Chào mừng Lan tới Synchro", intro: "Tài khoản của bạn đã sẵn sàng. Ba bước dưới đây giúp bạn có kết quả đầu tiên trong mười phút.", steps: [{ title: "Tạo dự án đầu tiên", text: "Gom tệp, chỉ dẫn và kết nối vào một chỗ." }, { title: "Mời đồng đội", text: "Cùng làm trên một đoạn chat, thấy ngay thay đổi của nhau." }, { title: "Bật kết nối", text: "Nối Gmail, Lịch, Drive để Synchro làm việc thay bạn." }], ctaLabel: "Bắt đầu ngay", ctaUrl: "https://example.com/start", signoff: "Thân mến,\nĐội ngũ Synchro" }],
  ["email-login-code", { brand: "Synchro", heading: "Mã đăng nhập của bạn", code: "482913", expires: "Mã hết hạn sau 10 phút.", details: [{ label: "Thiết bị", value: "Chrome trên macOS" }, { label: "Vị trí", value: "Hà Nội, Việt Nam" }] }],
  ["email-invite", { brand: "Synchro", inviter: "Phạm Minh Đức", inviterEmail: "duc@example.com", team: "Nhóm Tăng trưởng", role: "Thành viên", ctaLabel: "Tham gia nhóm", ctaUrl: "https://example.com/join?token=abc123" }],
];
for (const style of ["exec-navy", "neo-brutalist"]) for (const [id, props] of MAILS) for (const [w, tag] of [[680, "may-tinh"], [375, "dien-thoai"]]) {
  await view(w, 900);
  await open(T.expandTemplates(block({ styleArchetype: style, pages: [{ templateId: id, props }] })), false);
  const found = (await probe()).filter((x) => !/ảnh hỏng/.test(x.kind));
  const sx = await ev(`document.documentElement.scrollWidth <= innerWidth + 1`);
  check(`${id} ${style} ${w}px: không đo thấy lỗi, không cuộn ngang`, !found.length && sx, JSON.stringify(found));
  const h = await ev(`Math.min(document.documentElement.scrollHeight, 1400)`);
  await view(w, h);
  await shot(`email-${id}-${style}-${tag}.png`);
}

console.log("3. Tài liệu A4 theo mẫu: hai phong cách, màn hình và bản in PDF");
const SEC = [
  { heading: "Doanh thu vượt kế hoạch 18% nhờ kênh trực tiếp", kicker: "Quý 3/2026, đơn vị: tỷ đồng (số liệu ví dụ)", body: "Doanh thu thuần đạt 14,8 tỷ, tăng 142% so với cùng kỳ. Kênh trực tiếp đóng góp 61% doanh thu và có biên lợi nhuận gộp cao gấp đôi kênh đại lý.\n\nChi phí bán hàng tăng chậm hơn doanh thu, đưa biên lợi nhuận hoạt động lên 21%.", kpis: [{ label: "Doanh thu", value: "14,8 tỷ", delta: "+142%" }, { label: "Biên gộp", value: "32%", delta: "+6 đ.p." }, { label: "Khách mới", value: "3.200", delta: "+18%" }], table: { columns: ["Chỉ tiêu", "Q2", "Q3", "Thay đổi"], rows: [["Doanh thu", "6,1", "14,8", "+142%"], ["Giá vốn", "4,3", "10,1", "+135%"], ["Lợi nhuận gộp", "1,8", "4,7", "+161%"]], caption: "Nguồn: báo cáo quản trị nội bộ" } },
  { heading: "Ba ưu tiên quý 4 giữ đà tăng trưởng", body: "Tập trung nguồn lực vào ba việc có tác động lớn nhất tới kết quả cả năm.", bullets: ["Mở rộng đội bán trực tiếp ở Đà Nẵng và Cần Thơ", "Tự động hóa chăm sóc khách hàng sau bán", "Giảm 10% giá vốn nhờ đàm phán lại nhà cung cấp"], callout: "Rủi ro chính: nhu cầu cuối năm giảm nếu lãi suất tăng; kế hoạch dự phòng ở phụ lục." },
];
const DOCS = [
  ["doc-report", { org: "Công ty Cổ phần Mộc", title: "Báo cáo kết quả kinh doanh quý 3/2026", subtitle: "Tổng kết doanh thu, chi phí và ưu tiên quý 4 cho Hội đồng quản trị", author: "Phòng Tài chính – Kế hoạch", date: "Tháng 11/2026", summary: "Quý 3 doanh thu vượt kế hoạch 18%, biên lợi nhuận gộp tăng 6 điểm. Quý 4 ưu tiên mở rộng kênh trực tiếp và giảm giá vốn.", sections: SEC, sources: ["Báo cáo quản trị nội bộ quý 3/2026", "Tổng cục Thống kê, chỉ số giá tiêu dùng tháng 9/2026"] }],
  ["doc-proposal", { client: "Tập đoàn Hưng Thịnh", title: "Chuyển đổi số chuỗi bán lẻ", subtitle: "Đề xuất triển khai trong 6 tháng", author: "Đội Tư vấn Synchro", date: "11/2026", chapters: [{ heading: "Bối cảnh và mục tiêu", body: "Chuỗi 120 cửa hàng đang vận hành trên ba hệ thống rời nhau.", pullQuote: "Mỗi cửa hàng mất trung bình 6 giờ mỗi tuần để đối soát tồn kho." }, { heading: "Giải pháp", bullets: ["Một nền tảng bán hàng chung", "Bảng điều khiển tồn kho theo thời gian thực", "Đào tạo 300 nhân viên"] }], pricing: { items: [{ name: "Khảo sát và thiết kế", detail: "4 tuần", price: 180000000 }, { name: "Triển khai", detail: "16 tuần, 120 cửa hàng", price: 920000000 }, { name: "Đào tạo", price: 1500000, qty: 60 }], note: "Giá chưa gồm thuế GTGT 10%." }, closing: "Chúng tôi sẵn sàng bắt đầu từ tháng 12.", contact: "Nguyễn Thu Trang · trang@example.com · 0901 234 567" }],
  ["doc-paper", { title: "Dự báo nhu cầu tồn kho bằng mô hình học sâu cho chuỗi bán lẻ Việt Nam", authors: [{ name: "Lê Minh Anh", affiliation: "Đại học Bách khoa Hà Nội", email: "anh.lm@example.edu" }, { name: "Trần Quốc Bảo", affiliation: "Viện Khoa học Dữ liệu" }], abstract: "Bài báo đề xuất mô hình dự báo nhu cầu kết hợp chuỗi thời gian và đặc trưng lễ hội Việt Nam, giảm sai số dự báo 23% so với phương pháp cơ sở trên dữ liệu 120 cửa hàng.", keywords: ["dự báo nhu cầu", "học sâu", "bán lẻ"], sections: [{ heading: "Giới thiệu", body: "Dự báo nhu cầu chính xác giúp giảm tồn kho và hết hàng. Các mùa lễ như Tết Nguyên đán làm phân phối nhu cầu lệch mạnh.\n\nNghiên cứu này đóng góp ba điểm chính.", bullets: ["Bộ dữ liệu 120 cửa hàng trong 3 năm", "Mô hình có đặc trưng âm lịch", "Đánh giá trên 4 ngành hàng"] }, { heading: "Phương pháp", body: "Chúng tôi dùng mô hình mã hóa thời gian với cơ chế chú ý.", subsections: [{ heading: "Dữ liệu", body: "Dữ liệu bán hàng theo ngày, đã làm sạch ngoại lai." }, { heading: "Mô hình", body: "Hai tầng mã hóa và một tầng dự báo." }], table: { columns: ["Mô hình", "MAPE", "RMSE"], rows: [["Cơ sở", "18,4%", "212"], ["Đề xuất", "14,1%", "163"]], caption: "Bảng I. Sai số trên tập kiểm tra" } }, { heading: "Kết luận", body: "Mô hình đề xuất giảm sai số đáng kể, đặc biệt trong mùa lễ." }], references: ["A. Nguyễn, “Dự báo bán lẻ,” Tạp chí Tin học, tập 12, 2024.", "B. Trần và C. Lê, “Học sâu cho chuỗi thời gian,” Hội nghị FAIR, 2025."] }],
  ["doc-invoice", { kind: "invoice", number: "HD-2026-0042", date: "11/11/2026", due: "25/11/2026", from: { name: "Công ty TNHH Thiết kế Mộc", address: "12 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội", email: "ketoan@moc.vn", taxId: "0101234567" }, to: { name: "Công ty Cổ phần Hưng Thịnh", address: "45 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh", taxId: "0309876543" }, currency: "VND", items: [{ description: "Thiết kế nhận diện thương hiệu", detail: "Logo, bảng màu, phông chữ", qty: 1, price: 25000000 }, { description: "Thiết kế bao bì", qty: 4, unit: "mẫu", price: 6500000 }, { description: "Chụp ảnh sản phẩm", qty: 30, unit: "ảnh", price: 350000 }], discount: 2000000, taxRate: 10, payment: { bank: "Vietcombank – CN Hà Nội", account: "0011 0045 6789", name: "CONG TY TNHH THIET KE MOC" }, notes: "Vui lòng ghi số hóa đơn trong nội dung chuyển khoản.", thanks: "Cảm ơn quý khách đã tin tưởng!" }],
];
for (const style of [null, "midnight-tech"]) for (const [id, props] of DOCS) {
  const html = T.expandTemplates(block({ ...(style ? { styleArchetype: style } : {}), pages: [{ templateId: id, props }] }));
  const tag = `${id}-${style ?? "mac-dinh"}`;
  for (const [w, dev] of [[1000, "may-tinh"], [390, "dien-thoai"]]) {
    await view(w, 900);
    await open(html, false);
    const found = (await probe()).filter((x) => !/ảnh hỏng/.test(x.kind));
    const sx = await ev(`document.documentElement.scrollWidth <= innerWidth + 1`);
    check(`${tag} ${w}px: không đo thấy lỗi, không cuộn ngang`, !found.length && sx, JSON.stringify(found).slice(0, 600));
    const h = await ev(`Math.min(document.documentElement.scrollHeight, ${w > 500 ? 3200 : 2400})`);
    await view(w, h); await sleep(150);
    await shot(`doc-${tag}-${dev}.png`);
  }
  await P("Emulation.setEmulatedMedia", { media: "print" });
  const pdf = await P("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
  await P("Emulation.setEmulatedMedia", { media: "" });
  const buf = Buffer.from(pdf.data, "base64"), pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  writeFileSync(path.join(OUT, `doc-${tag}.pdf`), buf);
  check(`${tag}: in ra PDF ${pages} trang A4`, pages >= 1 && (id === "doc-invoice" || id === "doc-paper" || pages >= 2), String(pages));
}

console.log("4. Poster theo mẫu: các khổ mạng xã hội, hai phong cách");
for (const style of ["linear-dark", "neo-brutalist"]) for (const [size, vw, vh] of [["og", 1200, 630], ["square", 1080, 1080], ["story", 1080, 1920]]) {
  await view(vw, vh);
  await open(T.expandTemplates(block({ styleArchetype: style, pages: [{ templateId: "poster-og", props: { size, tag: "Ra mắt 2026", title: "Trợ lý AI viết báo cáo tài chính trong hai phút", metricValue: "+142%", metricLabel: "năng suất đội kế toán", author: "Synchro · Hà Nội" } }] })), false);
  const found = (await probe(`document.querySelector(".sx-poster")`, true)).filter((x) => !/ảnh hỏng/.test(x.kind));
  const box = await ev(`(() => { const r = document.querySelector(".sx-poster").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()`);
  check(`poster ${size} ${style}: đúng khung ${box.join("×")}, không đo thấy lỗi`, Math.abs(box[0] / box[1] - vw / vh) < 0.01 && !found.length, JSON.stringify(found));
  await shot(`poster-${size}-${style}.png`);
}

ws.close(); chrome.kill();
console.log(`\nẢnh: ${OUT}`);
console.log(fails ? `${fails} lỗi` : "Tất cả đạt");
process.exit(fails ? 1 : 0);
