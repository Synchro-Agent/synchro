// Bộ quy tắc thiết kế theo lượt (app/designkit.ts), phong cách (designpresets.ts), bộ CSS trong khung artifact (artkit.ts), quy tắc bảng tính và phông của sandbox.
// Phần 1-6 không cần máy chủ. Phần 7 chạy trên npm run dev:mock (đổi địa chỉ bằng SYNCHRO_URL, MOCK_LLM_URL): khối đi cạnh tin nhắn, phần đầu prompt giữ nguyên, trò chuyện thường không đổi.
// Trình duyệt thật (phông, chuyển động, phép đo, xuất PowerPoint): tests/ui/design-kit.mjs.
import { readFileSync } from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const { designkit: K, designpresets: DP, artkit: A, artdoc: D, router: R } = await loadTs(["designkit", "designpresets", "artkit", "artdoc", "router"]);
const { designTurn, DESIGN_BUDGET, designBytes, priorDesign, formatOf, domainOf } = K, { PRESETS, FONT_SPEC } = DP;
const full = { art: true, code: true };
const turn = (typed, o = {}) => designTurn({ typed, ...full, seed: "c1", ...o });

console.log("1. Chọn khối đúng việc");
for (const q of ["xin chào", "Thủ đô của Pháp là gì?", "slide là gì?", "cách làm slide đẹp?", "Tại sao poster này đẹp?", "Dịch sang tiếng Anh: báo cáo tài chính", "tóm tắt pdf này", "Viết email xin nghỉ phép", "viết code python tính fibonacci", "giải thích công thức Excel này", "1+1 bằng mấy"])
  ok(turn(q) === null, `không có khối: "${q}"`, JSON.stringify(turn(q)?.format));
for (const [q, f] of [["Làm bộ slide báo cáo tài chính Q3", "slide"], ["make a pitch deck for my saas startup", "slide"], ["lam bo slide gioi thieu cong ty", "slide"], ["làm slide từ file excel này", "slide"], ["Tạo file Excel theo dõi ngân sách", "sheet"], ["Viết báo cáo một trang về thị trường cà phê", "doc"], ["Thiết kế poster sự kiện âm nhạc", "graphic"], ["Làm landing page cho quán cà phê", "graphic"]])
  ok(turn(q)?.format === f, `"${q}" → ${f}`, turn(q)?.format);
ok(formatOf("tóm tắt từ file excel") === null, "tệp đầu vào không phải đầu ra");
ok(domainOf("báo cáo doanh thu quý 3") === "finance" && domainOf("poster hội nghị") === "event" && domainOf("trang giới thiệu nhà hàng") === "editorial" && domainOf("AI cho kho vận") === "tech", "nhận đúng lĩnh vực");
ok(turn("Soạn công văn gửi UBND") === null && turn("Viết tờ trình xin kinh phí") === null, "văn bản hành chính có kiểu vbhc riêng: không áp khối");
ok(turn("Tạo file Excel ngân sách", { code: false }) === null, "không có run_code thì không có quy tắc Excel");
ok(turn("Làm bộ slide", { art: false, code: false }) === null, "không có khả năng nào: không có khối");
ok(turn("về thị trường xe điện", { studio: "slides" })?.format === "slide" && turn("kế hoạch tuần này", { studio: "docs" })?.format === "doc" && turn("một tấm banner", { studio: "design" })?.format === "graphic", "studio quyết định định dạng khi câu không nói rõ");
for (const q of ["ok", "cảm ơn", "được rồi"]) ok(turn(q, { studio: "slides", ack: R.isAck(q) }) === null, `trong studio, câu xác nhận "${q}": không có khối`);
ok(turn("Làm bộ slide doanh thu #nodesign") === null, "#nodesign tắt khối để so sánh với model thật");
process.env.SYNCHRO_DESIGNKIT = "0"; ok(turn("Làm bộ slide doanh thu") === null, "SYNCHRO_DESIGNKIT=0 tắt cả máy chủ"); delete process.env.SYNCHRO_DESIGNKIT;
const paste = "Viết lại đoạn sau: " + "x".repeat(400) + " làm slide báo cáo tài chính";
ok(turn(paste) === null, "từ khóa trong văn bản dán vào không kích hoạt");

console.log("2. Trần 6 KB, đo bằng byte");
let biggest = 0;
for (const typed of ["làm slide", "viết báo cáo", "tạo file excel", "làm poster"]) for (const dom of ["", " tài chính", " sự kiện", " tạp chí", " công nghệ", " marketing", " sản phẩm", " giao dịch"]) for (const caps of [{ art: true, code: true }, { art: true, code: false }, { art: false, code: true }]) for (const s of ["a", "b", "c", "d", "e", "f"]) {
  const d = designTurn({ typed: typed + dom, ...caps, seed: s });
  if (!d) continue;
  biggest = Math.max(biggest, d.bytes);
  if (d.bytes > DESIGN_BUDGET || designBytes(d.block) !== d.bytes) ok(false, "vượt trần", `${typed}${dom} ${d.bytes}`);
}
ok(biggest > 0 && biggest <= 6144, `khối lớn nhất ${biggest} byte, trần ${DESIGN_BUDGET}`);
const slide = turn("Làm bộ slide doanh thu");
ok(/Bộ CSS sẵn/.test(slide.block) && /Chữ: chỉ dùng thang/.test(slide.block) && /Mỗi slide 3 tầng/.test(slide.block) && /Phong cách gợi ý/.test(slide.block), "khối đầy đủ không phần nào bị cắt vì trần", slide.bytes);
ok(!turn("tạo file excel", full).block.includes("Bộ CSS sẵn") && turn("tạo file excel", full).bytes < 2000, "Excel: chỉ quy tắc bảng tính", turn("tạo file excel", full).bytes);
ok(!turn("làm poster", { art: false }).block.includes("Bộ CSS sẵn"), "không có artifact: không nhắc bộ CSS");

console.log("3. Đều số đo, không tính từ");
for (const s of ["12·14·16·21·28·38·56", "-0.02", "8·16·24·32·48·64", "60-30-10", "tabular-nums", "text-wrap:balance", "R ngoài = R trong + padding", "4.5:1"]) ok(slide.block.includes(s), `có số đo: ${s}`);
ok(/tiêu đề kết luận/.test(slide.block) && /không viết "Doanh thu quý 3"/.test(slide.block), "tiêu đề 3 tầng, nêu phát hiện");
ok(/chỉ chuỗi mà tiêu đề nhắc tới dùng màu nhấn/.test(slide.block), "biểu đồ: một chuỗi nhấn");
const doc = turn("viết báo cáo thị trường").block;
ok(/break-inside:avoid/.test(doc) && /orphans:3/.test(doc) && /A4/.test(doc), "tài liệu có luật in");
ok(/không đặt cho mọi p, li/.test(doc), "không ép 65ch cho mọi p, li như cẩm nang");
const sheet = turn("tạo file excel ngân sách").block;
for (const s of ["=SUM(", "0000FF", 'style="double"', 'style="thin"', "DataBarRule", "ColorScaleRule", "0.0%"]) ok(sheet.includes(s), `bảng tính: ${s}`);
const coderun = readFileSync("app/coderun.ts", "utf8");
for (const s of ["0000FF", "viền dưới double", "DataBarRule", "ColorScaleRule", "conditional_format"]) ok(coderun.includes(s), `CODE_RULES: ${s}`);
const g = turn("làm poster").block;
ok(/không chữ chuyển màu/.test(g), "không chữ chuyển màu ở nội dung phải đọc");
ok(/SVG tự viết thoải mái/.test(g), "không cấm model viết SVG");
ok(!/Sonnet|Haiku|Gemini|GPT/i.test([slide.block, doc, sheet, g].join("")), "không nêu tên model để định tuyến");

console.log("4. Phong cách có sẵn");
ok(PRESETS.length === 8 && new Set(PRESETS.map((p) => p.id)).size === 8, "8 phong cách, mã không trùng");
const BRANDS = /apple|linear|mckinsey|kinfolk|stripe|notion|google|microsoft/i;
ok(!PRESETS.some((p) => BRANDS.test(p.id + p.label)), "không mượn tên công ty", PRESETS.map((p) => p.id).join());
ok(!BRANDS.test(slide.block.replace(/Google Fonts/g, "")), "khối gửi model không nhắc thương hiệu");
ok(PRESETS.every((p) => FONT_SPEC[p.head] && FONT_SPEC[p.body] && FONT_SPEC[p.mono]), "phông nào cũng có trong FONT_SPEC");
const lum = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const bad = [];
for (const p of PRESETS) for (const [name, c] of [["sáng", p], ["tối", p.dark]].filter((x) => x[1])) {
  for (const on of ["bg", "surface", "raised"]) for (const t of ["ink", "muted", "accent"]) if (cr(c[t], c[on]) < 4.5) bad.push(`${p.id} ${name}: ${t} trên ${on} ${cr(c[t], c[on]).toFixed(2)}`);
  for (const t of ["pos", "neg"]) if (cr(c[t], c.surface) < 4.5) bad.push(`${p.id} ${name}: ${t} ${cr(c[t], c.surface).toFixed(2)}`);
  if (cr(c.bg, c.accent) < 4.5) bad.push(`${p.id} ${name}: .sx-solid ${cr(c.bg, c.accent).toFixed(2)}`);
}
ok(!bad.length, "mọi cặp chữ / nền đạt WCAG 4.5:1, cả sáng và tối", bad.join(" | "));
const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => designTurn({ typed: "làm bộ slide giới thiệu", ...full, seed: s }).preset));
ok(seen.size >= 2, `cùng yêu cầu, đoạn chat khác nhau không cùng một kiểu (${[...seen].join(", ")})`);
ok(designTurn({ typed: "làm bộ slide giới thiệu", ...full, seed: "x" }).preset === designTurn({ typed: "bộ slide khác hẳn", ...full, seed: "x", studio: "slides" }).preset, "cùng đoạn chat giữ một kiểu");
ok(turn("Làm poster phong cách brutalist").preset === "neo-brutalist" && turn("Làm slide kiểu tạp chí").preset === "editorial-serif", "người dùng nói rõ phong cách thì theo");
const own = turn("Làm slide theo màu thương hiệu của công ty");
ok(own.own && !/preset=/.test(own.block.split("\n")[0]) && /theo đúng bản sắc đó/.test(own.block), "có bản sắc riêng: giữ số đo, không áp bảng màu", own.block.slice(0, 200));

console.log("5. Sửa tiếp thì gọn, sản phẩm mới thì đủ");
const deckMsg = `Đây là bộ slide.\n<artifact identifier="d" type="text/html" title="D"><html data-sx-preset="exec-navy"><body><section class="slide sx-slide">A</section><section class="slide sx-slide">B</section></body></html></artifact>`;
ok(priorDesign([deckMsg])?.format === "slide" && priorDesign([deckMsg]).preset === "exec-navy", "đọc được định dạng và phong cách của sản phẩm trước");
const edit = turn("Sửa màu slide 2 đậm hơn", { prior: [deckMsg] });
ok(edit?.compact && edit.bytes < 600 && edit.block.includes("exec-navy"), `sửa tiếp: khối gọn ${edit?.bytes} byte, giữ phong cách`, edit?.block);
ok(turn("Làm bộ slide khác về nhân sự", { prior: [deckMsg] })?.compact === false, "sản phẩm mới trong đoạn chat cũ: khối đầy đủ");
ok(turn("Thêm một slide mới về nhân sự", { prior: [deckMsg] })?.compact === true, "thêm slide vào bộ cũ là sửa tiếp");
ok(turn("Cảm ơn bạn nhé", { prior: [deckMsg], ack: true }) === null && turn("slide 2 nói gì vậy?", { prior: [deckMsg] }) === null, "hỏi lại về sản phẩm: không có khối");
ok(K.historyTexts([{ role: "assistant", content: deckMsg }, { role: "user", content: "x" }]).length === 1 && K.historyTexts([], [{ ident: "a", type: "html", content: "<p>" }]).length === 1, "lấy lịch sử cả từ tin nhắn lẫn artBase");

console.log("6. Bộ CSS trong khung artifact");
const css = A.KIT_CSS;
const named = new Set([...slide.block.matchAll(/\.sx-[a-z0-9-]+/g)].map((m) => m[0]));
const missing = [...named].filter((c) => !css.includes(c));
ok(named.size > 30 && !missing.length, `mọi lớp nhắc trong khối (${named.size}) đều có trong bộ CSS`, missing.join(" "));
for (const n of [8, 16, 24, 32, 48, 64]) ok(css.includes(`.sx-gap-${n}{`) && css.includes(`.sx-p-${n}{`), `lưới 8pt: gap / padding ${n}`);
for (const n of ["hero", "4060", "6040", "bento4", "dash", "3"]) ok(css.includes(`.sx-grid-${n}{`), `lưới .sx-grid-${n}`);
const reduced = /@media \(prefers-reduced-motion:reduce\)\{([^}]*\})\}/.exec(css)?.[1] ?? "";
const moving = [...new Set([...css.matchAll(/\.(sx-[a-z]+)\{animation/g)].map((m) => m[1]))];
ok(moving.length >= 2 && ["sx-rise", "sx-fade", "sx-pop", "sx-draw"].every((c) => reduced.includes(`.${c}`)) && /animation:none/.test(reduced), "mọi lớp chuyển động tắt khi prefers-reduced-motion", reduced);
ok(!/\.sx-[\w-]+\{[^}]*\bopacity:0/.test(css) && /backwards/.test(css), "chữ không bao giờ phụ thuộc animation để hiện (backwards, không forwards + opacity:0)");
ok(!/background-clip:text/.test(css), "không có lớp chữ chuyển màu");
ok(!/stroke-dasharray:1000/.test(css) && /pathLength|stroke-dasharray:1/.test(css), "vẽ nét theo pathLength, không dùng số 1000 cố định");
ok(/@media print/.test(css) && /break-after:avoid-page/.test(css) && /orphans:3/.test(css) && /thead\{display:table-header-group\}/.test(css), "có luật in");
ok(!/\bli\b[^{}]*\{[^}]*max-width/.test(css) && !/\bp\b[^{}]*\{[^}]*max-width/.test(css), "không đặt max-width cho mọi p, li");
ok(!A.usesKit(`<html><body data-sx-loc="1-2"><div class="slide" data-sx-on>Chữ</div></body></html>`), "trang không dùng: không nạp, kể cả có thuộc tính nội bộ data-sx-…");
for (const s of [`<p class="sx-title">a</p>`, `<div class='a sx-card'>`, `<i style="width:calc(8*var(--sx-u))">`, `<html data-sx-preset="exec-navy">`, `<div className="grid sx-grid-3">`]) ok(A.usesKit(s), `nhận ra trang dùng: ${s}`);
const plain = `<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>`;
ok(!D.buildDocCore("html", plain, "https://o", "c", false, "").includes("data-sx-kit"), "artifact cũ: khung dựng ra không có bộ CSS");
ok(D.htmlExport(plain) === plain, "artifact cũ: tệp tải về giữ nguyên từng byte");
const kitPage = `<html data-sx-preset="editorial-serif"><head><style>.sx-title{color:red}</style></head><body><h1 class="sx-title">a</h1></body></html>`;
const built = D.buildDocCore("html", kitPage, "https://o", "c", false, "");
ok(built.indexOf("data-sx-kit") > 0 && built.indexOf("data-sx-kit") < built.indexOf(".sx-title{color:red}"), "bộ CSS đứng trước CSS của model nên model sửa được");
ok(built.indexOf("Content-Security-Policy") < built.indexOf("fonts.googleapis.com/css2"), "CSP đặt trước khi nạp phông");
ok(/font-src https:\/\/fonts\.gstatic\.com/.test(built) && /style-src 'unsafe-inline' https:\/\/fonts\.googleapis\.com/.test(built), "CSP của khung cho phép đúng hai địa chỉ phông");
const url = A.kitFontUrl(kitPage);
ok(url.includes("Playfair+Display") && url.includes("Be+Vietnam+Pro") && url.includes("JetBrains+Mono") && !url.includes("Inter"), "chỉ tải phông của phong cách trang dùng", url);
ok(D.htmlExport(kitPage).includes("data-sx-kit") && D.deckExport(kitPage).includes("data-sx-kit"), "tệp HTML tải về kèm bộ CSS, mở một mình vẫn đúng");
ok(A.withKitFontLink(kitPage).includes("fonts.googleapis.com") && A.withKitFontLink(plain) === plain, "xuất PNG / PowerPoint tìm thấy phông của bộ CSS");
const dock = readFileSync("workspace/Dockerfile", "utf8");
for (const n of Object.keys(FONT_SPEC)) ok(dock.includes(`'${n}'`), `sandbox có phông ${n}`);
const shas = [...dock.matchAll(/'([0-9a-f]{64}) ofl\//g)].map((m) => m[1]);
ok(shas.length === 9 && /google\/fonts\/[0-9a-f]{40}\//.test(dock) && /sha256sum -c/.test(dock) && /fc-cache/.test(dock), `phông ghim commit và mã băm (${shas.length} tệp)`);
ok(/DM Mono/.test(JSON.stringify(FONT_SPEC)) === false, "không dùng phông thiếu dấu tiếng Việt (DM Mono)");
const probe = readFileSync("app/artcheck.ts", "utf8");
ok(probe.includes("${DESIGN_PROBE}") && !/tự thu nhỏ/.test(probe), "check_artifact có phép đo mới, chỉ báo chứ không tự sửa");

console.log("7. Lượt chat thật trên máy chủ giả lập");
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", LLM = process.env.MOCK_LLM_URL ?? "http://127.0.0.1:4010";
const up = await fetch(`${B}/api/models`, { signal: AbortSignal.timeout(4000) }).then((r) => r.status < 500, () => false);
if (!up) console.log("  (bỏ qua: máy chủ giả lập không chạy)");
else {
  let cookie = process.env.SYNCHRO_ADMIN_COOKIE ?? "";
  const api = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  if (!cookie) await api("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
  await api("PATCH", "/api/caps", { art: true, code: true });
  const M = "anthropic/claude-sonnet-5-5";
  const send = async (content, extra = {}) => {
    const r = await api("POST", "/api/llm", { system: "", max_tokens: 800, skills: true, model: M, noFast: true, messages: [{ role: "user", content }], ...extra });
    const last = (await fetch(`${LLM}/_debug/last`).then((x) => x.json())).anthropic;
    return { s: r.s, sys: JSON.stringify(last?.system ?? ""), msgs: JSON.stringify(last?.messages ?? "") };
  };
  const chat = await send("Hôm nay trời đẹp nhỉ");
  const deck = await send("Làm bộ slide báo cáo doanh thu quý 3");
  const sheetT = await send("Tạo file Excel theo dõi ngân sách");
  ok(chat.s === 200 && deck.s === 200, "các lượt chạy được", `${chat.s} ${deck.s}`);
  ok(!chat.msgs.includes("<design_kit") && !chat.sys.includes("<design_kit"), "trò chuyện thường: không có khối nào");
  ok(deck.msgs.includes('<design_kit format=\\"slide\\"') || deck.msgs.includes('<design_kit format="slide"'), "lượt làm slide: có khối, cạnh tin nhắn mới nhất", deck.msgs.slice(-400));
  ok(!deck.sys.includes("<design_kit"), "khối không vào phần đầu prompt");
  ok(chat.sys === deck.sys && deck.sys === sheetT.sys, "phần đầu prompt giống hệt giữa trò chuyện, slide, Excel: vẫn đọc từ bộ đệm", `${chat.sys.length} / ${deck.sys.length} / ${sheetT.sys.length}`);
  ok(sheetT.msgs.includes("DataBarRule") && !sheetT.msgs.includes("Bộ CSS sẵn"), "lượt Excel chỉ có quy tắc Excel");
  const none = await send("Làm bộ slide báo cáo doanh thu #nodesign");
  ok(!none.msgs.includes("<design_kit"), "#nodesign: không có khối, để so sánh trước / sau");
  const code = await send("Làm bộ slide báo cáo doanh thu quý 3", { feature: "code" });
  ok(!code.msgs.includes("<design_kit"), "Synchro Code: không có khối");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
