// Bộ quy tắc thiết kế theo lượt (server/designkit.ts), phong cách (designpresets.ts), bộ CSS trong khung artifact (artkit.ts), quy tắc bảng tính và phông của sandbox.
// Phần 1-6 không cần máy chủ. Phần 7 chạy trên npm run dev:mock (đổi địa chỉ bằng SYNCHRO_URL, MOCK_LLM_URL): khối đi cạnh tin nhắn, phần đầu prompt giữ nguyên, trò chuyện thường không đổi.
// Trình duyệt thật (phông, chuyển động, phép đo, xuất PowerPoint): tests/ui/design-kit.mjs.
import { readFileSync } from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const { designkit: K, designpresets: DP, artkit: A, artdoc: D, router: R, artfonts: F, deckpptx: X } = await loadTs(["designkit", "designpresets", "artkit", "artdoc", "router", "artfonts", "deckpptx"]);
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

// Một từ nhiều nghĩa đi cùng "giúp, cần, sửa" từng làm trò chuyện thường tốn thêm 5,5 KB mỗi lượt.
for (const q of ["Giúp mình đề xuất món ăn tối nay", "Viết email gửi sếp nói báo cáo sẽ trễ", "Mình cần lời khuyên về hồ sơ du học", "Giúp mình tóm tắt tài liệu này", "Sửa lỗi trên trang web của tôi: nút đăng nhập không bấm được", "Sửa bug dashboard React này", "Cần đổi file pdf sang word", "Viết script python xuất báo cáo pdf", "Tôi đã làm slide hôm qua", "làm slide thế nào cho đẹp", "How do I make a slide deck?", "slide là gì", "Viết báo cáo có khó không?", "make sure the report is ready", "write a 500 word essay", "Convert this PDF to Word", "Giúp mình báo cáo tiến độ với sếp"])
  ok(turn(q) === null, `trò chuyện, không có khối: "${q}"`, JSON.stringify(turn(q)?.format));
// Từ hỏi và "quyết định" nằm trong chủ đề của sản phẩm thì vẫn là làm sản phẩm.
for (const [q, f] of [["Làm slide giải thích vì sao khách hàng rời bỏ", "slide"], ["Viết báo cáo phân tích tại sao doanh thu giảm", "doc"], ["Soạn tài liệu hướng dẫn cách dùng phần mềm", "doc"], ["Làm infographic: AI là gì", "graphic"], ["Làm infographic: AI là gì?", "graphic"], ["Create a slide deck explaining why churn increased", "slide"], ["Make a poster about how to recycle", "graphic"], ["Soạn báo cáo để ban giám đốc ra quyết định đầu tư", "doc"], ["Sếp gấp nên tôi cần làm báo cáo tài chính", "doc"], ["Giúp mình viết đề xuất dự án", "doc"], ["Cần một bản báo cáo thị trường", "doc"], ["Mình cần bộ slide về AI", "slide"], ["Chuyển báo cáo này thành slide", "slide"], ["Tóm tắt tài liệu này thành bộ slide", "slide"], ["make me a beautiful pitch deck", "slide"], ["Thiết kế cho công ty tôi một poster", "graphic"], ["Can you write a report on churn?", "doc"], ["Làm báo cáo từ bộ slide này", "doc"]])
  ok(turn(q)?.format === f && !turn(q)?.compact, `làm sản phẩm: "${q}" → ${f}`, turn(q)?.format);
for (const q of ["Làm slide giới thiệu công ty", "Tạo poster sự kiện", "Viết báo cáo thị trường"]) ok(turn(q.normalize("NFD"))?.format === turn(q)?.format && turn(q) !== null, `chuỗi tổ hợp (NFD, dán từ macOS) như chuỗi thường: "${q}"`);
ok(turn("Soạn quyết định bổ nhiệm", { studio: "docs" }) === null && turn("Công văn gửi UBND", { studio: "docs" }) === null, "trong studio Tài liệu, văn bản hành chính vẫn không áp khối");
// Bỏ dấu không làm lẫn từ: "nên tôi" và "nền tối" đều thành "nen toi".
ok(turn("Sếp gấp nên tôi cần làm báo cáo tài chính").preset !== "midnight-tech" && turn("Khách hỏi nên tôi muốn làm slide doanh thu").preset !== "midnight-tech" && turn("Làm báo cáo tài chính nền tối").preset === "midnight-tech" && turn("lam slide nen toi").preset === "midnight-tech", "\"nên tôi\" không phải \"nền tối\"; gõ không dấu vẫn nhận");
for (const s of ["c1", "c2", "c3", "c4"]) ok(turn("Sếp gấp nên tôi cần làm báo cáo tài chính", { seed: s }).preset !== "midnight-tech", `báo cáo tài chính không ra nền đen (đoạn chat ${s})`);

console.log("2. Trần 9 KB, đo bằng byte");
let biggest = 0;
for (const typed of ["làm slide", "viết báo cáo", "tạo file excel", "làm poster"]) for (const dom of ["", " tài chính", " sự kiện", " tạp chí", " công nghệ", " marketing", " sản phẩm", " giao dịch"]) for (const caps of [{ art: true, code: true }, { art: true, code: false }, { art: false, code: true }]) for (const s of ["a", "b", "c", "d", "e", "f"]) {
  const d = designTurn({ typed: typed + dom, ...caps, seed: s });
  if (!d) continue;
  biggest = Math.max(biggest, d.bytes);
  if (d.bytes > DESIGN_BUDGET || designBytes(d.block) !== d.bytes) ok(false, "vượt trần", `${typed}${dom} ${d.bytes}`);
}
ok(biggest > 0 && biggest <= 9216 && DESIGN_BUDGET === 9216, `khối lớn nhất ${biggest} byte, trần ${DESIGN_BUDGET}`);
const slide = turn("Làm bộ slide doanh thu");
ok(/Bộ CSS sẵn/.test(slide.block) && /Chữ: chỉ dùng thang/.test(slide.block) && /Mỗi slide 3 tầng/.test(slide.block) && /Phong cách gợi ý/.test(slide.block), "khối đầy đủ không phần nào bị cắt vì trần", slide.bytes);
ok(!turn("tạo file excel", full).block.includes("Bộ CSS sẵn") && turn("tạo file excel", full).bytes < 2600, "Excel: chỉ quy tắc bảng tính", turn("tạo file excel", full).bytes);
ok(!turn("làm poster", { art: false }).block.includes("Bộ CSS sẵn"), "không có artifact: không nhắc bộ CSS");

console.log("3. Đều số đo, không tính từ");
for (const s of ["-0.02", "8·16·24·32·48·64", "60-30-10", "tabular-nums", "text-wrap:balance", "R ngoài = R trong + padding", "4.5:1"]) ok(slide.block.includes(s), `có số đo: ${s}`);
ok(/tiêu đề kết luận/.test(slide.block) && /không viết "Doanh thu quý 3"/.test(slide.block), "tiêu đề 3 tầng, nêu phát hiện");
ok(/chỉ chuỗi mà tiêu đề nhắc tới dùng màu nhấn/.test(slide.block), "biểu đồ: một chuỗi nhấn");
const doc = turn("viết báo cáo thị trường").block;
ok(/break-inside:avoid/.test(doc) && /orphans:3/.test(doc) && /A4/.test(doc), "tài liệu có luật in");
ok(/không đặt cho mọi p, li/.test(doc), "không ép 65ch cho mọi p, li như cẩm nang");
const sheet = turn("tạo file excel ngân sách").block;
for (const s of ["=SUM(", "0052CC", "0F172A", "0A192F", "showGridLines = False", "freeze_panes", '$#,##0;($#,##0);"-"', '#,##0 "₫";(#,##0 "₫");"-"', 'style="double"', 'style="thin"', "DataBarRule", "ColorScaleRule", "0.0%", "excel_totals"]) ok(sheet.includes(s), `bảng tính chuẩn tài chính: ${s}`);
const coderun = readFileSync("server/coderun.ts", "utf8");
for (const s of ["0052CC", "0A192F", "showGridLines = False", "viền dưới double", "excel_totals", "DataBarRule", "ColorScaleRule", "conditional_format"]) ok(coderun.includes(s), `CODE_RULES: ${s}`);
const g = turn("làm poster").block;
ok(/không chữ chuyển màu/.test(g), "không chữ chuyển màu ở nội dung phải đọc");
ok(/SVG tự viết thoải mái/.test(g), "không cấm model viết SVG");
ok(/không tự vẽ minh họa người, vật, cảnh/.test(g) && /icon Lucide/.test(g), "chốt icon và ảnh: icon từ bộ có sẵn, không tự vẽ minh họa");
ok(/backdrop-filter, radial-gradient/.test(turn("Làm bộ slide doanh thu").block) && /PNG 2x/.test(turn("Làm bộ slide doanh thu").block), "chốt Office: hiệu ứng CSS thành ảnh nền, chữ là đối tượng gốc");
ok(!/Sonnet|Haiku|Gemini|GPT/i.test([slide.block, doc, sheet, g].join("")), "không nêu tên model để định tuyến");

// Mỗi định dạng một thang, đúng các cỡ của bộ CSS: trước đây slide nhận cả "chỉ dùng 12·14·16…" lẫn "thân 18-22" cùng lúc.
const scaleOf = (sel) => { const m = new RegExp(`${sel}\\{([^}]*)\\}`).exec(A.KIT_CSS)?.[1] ?? ""; return [...new Set([...m.matchAll(/--sx-fs-[a-z0-9]+:([\d.]+)/g)].map((x) => +x[1]))].sort((a, b) => a - b); };
for (const [name, block, sel] of [["slide", slide.block, "\\.sx-slide,:where\\(section\\.slide,\\[data-slide\\]\\)"], ["poster", g, "\\.sx-poster"]]) {
  const sizes = scaleOf(sel);
  ok(sizes.length >= 7 && sizes.every((n) => new RegExp(`(?<![\\d.])${n}(?![\\d])`).test(block.split("\n").filter((l) => /Thang/.test(l)).join(" "))), `${name}: thang trong khối đúng các cỡ của bộ CSS (${sizes.join(" ")})`, block.slice(0, 300));
}
ok(!/chỉ dùng thang 12/.test(slide.block) && !/18-22/.test(slide.block) && !/dưới 18/.test(slide.block), "slide không còn hai bộ số trái nhau");
ok(/thang 12·14·16·21·28·38/.test(doc), "tài liệu: thang của trang đọc");
ok(/Thang: trang web 12·14·16·21·28·38·56; poster/.test(g), "đồ họa: thang riêng cho trang web và poster");
const lhOf = (c) => /var\(--sx-lh,([\d.]+)\)|line-height:([\d.]+)/.exec(new RegExp(`\\.${c}(?:,\\.[\\w-]+)*\\{[^}]*\\}`).exec(A.KIT_CSS)?.[0] ?? "");
for (const c of ["sx-display", "sx-title", "sx-kpi"]) { const m = lhOf(c); ok(+(m?.[1] ?? m?.[2] ?? 0) >= 1.15, `${c}: bước dòng đúng quy tắc, không dưới 1.15`, m?.[0]); }

console.log("4. Phong cách có sẵn");
ok(PRESETS.length === 8 && new Set(PRESETS.map((p) => p.id)).size === 8, "8 phong cách, mã không trùng");
const BRANDS = /apple|linear|mckinsey|kinfolk|stripe|notion|google|microsoft/i;
ok(!PRESETS.some((p) => BRANDS.test(p.id + p.looks)), "không mượn tên công ty", PRESETS.map((p) => p.id).join());
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
// Phong cách vốn tối (không có bảng sáng): in trang đọc trên giấy trắng phải có màu nhấn riêng.
const badPrint = [];
for (const p of PRESETS.filter((x) => cr(x.bg, "#FFFFFF") > 8)) {
  if (!p.print) { badPrint.push(`${p.id}: không có bảng in`); continue; }
  for (const k of ["accent", "accent2", "pos", "neg"]) for (const on of ["#FFFFFF", "#F5F5F4"]) if (cr(p.print[k], on) < 4.5) badPrint.push(`${p.id} ${k} trên ${on}: ${cr(p.print[k], on).toFixed(2)}`);
  const printRule = new RegExp(`[^{}]*\\{--sx-accent:${p.print.accent}`).exec(A.KIT_CSS)?.[0] ?? "";
  ok(printRule.includes(`[data-sx-preset=${p.id}]`), `${p.id}: bộ CSS có bảng in`, printRule.slice(0, 200));
}
ok(!badPrint.length, "in trên giấy trắng: màu nhấn của phong cách tối đạt 4.5:1", badPrint.join(" | "));
// Chủ dự án chốt màu của từng phong cách (nền #F5F5F7, nhấn #0066CC cho soft-bento): giữ đúng mã màu, nhưng tên và mô tả trung tính, chữ không dùng #1D1D1F của bảng gốc.
ok(!PRESETS.some((p) => [p.bg, p.ink, p.accent].filter((c) => ["#F5F5F7", "#1D1D1F", "#0066CC"].includes(c)).length >= 3), "soft-bento không chép trọn bộ màu của bảng gốc mang tên hãng");
const OWNER = { "swiss-grid": ["#F4F4F0", "#FFFFFF", 0, 0, "#FF3B00"], "midnight-tech": ["#08090E", "#0F1015", 16, 8, "#6366F1"], "soft-bento": ["#F5F5F7", "#FFFFFF", 24, 12, "#0066CC"], "editorial-serif": ["#FAF7F2", "#FFFFFF", 2, 0, "#9A3412"], "exec-navy": ["#FFFFFF", "#F8FAFC", 4, 2, "#0052CC"], "neo-brutalist": ["#FFFDF5", "#FFFFFF", 8, 4, "#7C3AED"], "aurora-glass": ["#EEF2FF", "#FFFFFF", 20, 12, "#4F46E5"], "data-terminal": ["#0B0E14", "#111622", 4, 2, "#10B981"] };
const off = Object.entries(OWNER).filter(([id, [bg, sf, r, ri, ac]]) => { const p = DP.presetOf(id); return !p || p.bg !== bg || p.surface !== sf || p.r !== r || p.ri !== ri || (p.vivid ?? p.accent) !== ac; }).map(([id]) => id);
ok(!off.length, "8 phong cách theo đúng bảng của chủ dự án: nền, bề mặt, bo ngoài / trong, màu nhấn gốc", off.join());
for (const [alias, id] of Object.entries(DP.PRESET_ALIASES)) ok(DP.presetOf(alias)?.id === id && A.KIT_CSS.includes(`[data-sx-preset=${alias}]`) && turn(`Làm slide phong cách ${alias}`).preset === id, `mã ${alias} của chủ dự án nhận như ${id}`);
ok(A.kitFontUrl(`<html data-sx-preset="linear-dark">`).includes("Plus+Jakarta+Sans"), "mã cũ vẫn tải đúng phông");
ok(PRESETS.every((p) => p.name && p.best && !BRANDS.test(p.name + p.best)), "tên hiện trên giao diện và \"dùng cho gì\" trung tính");
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
// Lần sửa thứ hai trở đi: ARTIFACT_RULES bắt sửa bằng mode="patch", tin gần nhất không có kiểu, không có <section>.
const patchMsg = `Đã sửa.\n<artifact identifier="d" mode="patch">\n<<<<<<< SEARCH\nA\n=======\nB\n>>>>>>> REPLACE\n</artifact>`;
const markMsg = `Bản cũ: <artifact identifier="d" title="D" version="2" />`;
ok(priorDesign([deckMsg, patchMsg])?.preset === "exec-navy" && priorDesign([deckMsg, patchMsg, patchMsg])?.format === "slide", "bản sửa không che bản đầy đủ phía trước");
ok(priorDesign([deckMsg, markMsg])?.format === "slide", "thẻ đánh dấu phiên bản tự đóng cũng vậy");
ok(priorDesign([deckMsg, `<artifact identifier="d" mode="patch">\n<<<<<<< SEARCH\ndata-sx-preset="exec-navy"\n=======\ndata-sx-preset="swiss-grid"\n>>>>>>> REPLACE\n</artifact>`])?.preset === "swiss-grid", "bản sửa đổi phong cách: lấy phong cách mới");
ok(priorDesign([deckMsg, `<artifact identifier="other" type="text/html">x</artifact>`, `<artifact identifier="d" mode="patch">a</artifact>`])?.format === "slide", "bản sửa trỏ đúng artifact của nó, không lấy artifact khác mới hơn");
ok(priorDesign(K.historyTexts([{ role: "assistant", content: patchMsg }], [{ ident: "d", type: "html", content: `<html data-sx-preset="exec-navy"><section class="slide">A</section></html>` }]))?.preset === "exec-navy", "bản đầy đủ chỉ còn trong artBase");
ok(priorDesign([`<artifact identifier="c" type="application/vnd.ant.code">x</artifact>`]) === null, "artifact mã: không phải sản phẩm thiết kế");
const edit2 = turn("Sửa slide 3 cho đậm hơn", { prior: [deckMsg, patchMsg] });
ok(edit2?.compact && edit2.preset === "exec-navy", "lần sửa thứ hai vẫn khối gọn, giữ phong cách", `${edit2?.bytes} ${edit2?.preset}`);
for (const o of [{ studio: "slides" }, {}]) { const e = turn("đổi màu tiêu đề", { prior: [deckMsg, patchMsg], ...o }); ok(e?.compact && e.preset === "exec-navy", `"đổi màu tiêu đề" sau bản sửa ${o.studio ? "trong studio" : "ngoài studio"}: khối gọn`, e?.bytes); }
ok(turn("viết tiếp đi", { prior: [deckMsg], studio: "slides" })?.compact === true, "trong studio đã có sản phẩm: câu không nêu định dạng là nói về sản phẩm đó");
ok(turn("một chủ đề khác về nhân sự", { prior: [deckMsg], studio: "slides" })?.compact === false, "trong studio, nói rõ cái khác: khối đầy đủ");
// Sản phẩm mới cùng định dạng: khối gọn bảo model "chỉ đổi đúng chỗ" sẽ làm đè lên sản phẩm cũ, gọi bằng khóa API không còn số đo nào.
const pageMsg = `<artifact identifier="p" type="text/html"><html data-sx-preset="soft-bento"><body>x</body></html></artifact>`;
const reportMsg = `<artifact identifier="r" type="text/markdown"># x</artifact>`;
for (const [q, prior] of [["Làm bộ slide về chủ đề marketing Q4 cho công ty B", deckMsg], ["Làm poster sự kiện âm nhạc cuối năm", pageMsg], ["Viết báo cáo tài chính năm nay", reportMsg], ["Make a deck about hiring", deckMsg], ["Làm poster về việc thay đổi khí hậu", pageMsg]])
  ok(turn(q, { prior: [prior] })?.compact === false, `sản phẩm mới: "${q}" có đủ số đo`, turn(q, { prior: [prior] })?.bytes);
for (const [q, prior] of [["Làm slide 3 đậm hơn", deckMsg], ["Làm báo cáo này gọn hơn", reportMsg], ["make this deck shorter", deckMsg], ["Làm lại slide 2", deckMsg], ["Cập nhật báo cáo", reportMsg], ["Làm bộ slide đẹp hơn", deckMsg]])
  ok(turn(q, { prior: [prior] })?.compact === true, `sửa tiếp: "${q}"`, turn(q, { prior: [prior] })?.bytes);
ok(turn("Sửa lỗi Python này", { prior: [deckMsg] }) === null, "việc lập trình trong đoạn chat có slide: không có khối");
ok(K.historyTexts([{ role: "assistant", content: deckMsg }, { role: "user", content: "x" }]).length === 1 && K.historyTexts([], [{ ident: "a", type: "html", content: "<p>" }]).length === 1, "lấy lịch sử cả từ tin nhắn lẫn artBase");

console.log("6. Bộ CSS trong khung artifact");
const css = A.KIT_CSS;
const named = new Set([...slide.block.matchAll(/\.sx-[a-z0-9-]+/g)].map((m) => m[0]));
const missing = [...named].filter((c) => !css.includes(c));
ok(named.size > 30 && !missing.length, `mọi lớp nhắc trong khối (${named.size}) đều có trong bộ CSS`, missing.join(" "));
for (const n of [8, 16, 24, 32, 48, 64]) ok(css.includes(`.sx-gap-${n}{`) && css.includes(`.sx-p-${n}{`), `lưới 8pt: gap / padding ${n}`);
for (const n of ["hero", "4060", "6040", "bento4", "dash", "3"]) ok(new RegExp(`\\.sx-grid-${n}(?:,\\.[\\w-]+)*\\{grid-template`).test(css), `lưới .sx-grid-${n}`);
const reduced = /@media \(prefers-reduced-motion:reduce\)\{([^}]*\})\}/.exec(css)?.[1] ?? "";
const moving = [...new Set([...css.matchAll(/\.(sx-[a-z]+)\{animation/g)].map((m) => m[1]))];
ok(moving.length >= 2 && ["sx-rise", "sx-fade", "sx-pop", "sx-draw"].every((c) => reduced.includes(`.${c}`)) && /animation:none/.test(reduced), "mọi lớp chuyển động tắt khi prefers-reduced-motion", reduced);
ok(!/\.sx-[\w-]+\{[^}]*\bopacity:0/.test(css) && /backwards/.test(css), "chữ không bao giờ phụ thuộc animation để hiện (backwards, không forwards + opacity:0)");
// Chữ chuyển màu chỉ có ở một lớp dành cho số KPI (bảng visual-fx của chủ dự án), có màu chữ dự phòng và tắt khi in; không lớp nào khác.
ok([...css.matchAll(/([^{}]*)\{[^}]*background-clip:text/g)].every((m) => /^\.sx-gradient-text,\.fx-gradient-text$/.test(m[1].trim())) && /\.sx-gradient-text,\.fx-gradient-text\{color:var\(--sx-ink\)/.test(css) && /\.sx-gradient-text,\.fx-gradient-text\{background:none;-webkit-text-fill-color:currentColor\}/.test(css), "chữ chuyển màu chỉ ở .sx-gradient-text, có màu dự phòng, tắt khi in");
// master-microcraft.css và visual-fx.css của chủ dự án: tên lớp và tên biến của bảng đó chạy được, trỏ về biến của bộ thiết kế.
for (const c of ["typo-hero-kpi", "typo-action-title", "typo-eyebrow", "concentric-outer", "concentric-inner", "surface-tinted-badge", "bento-grid-hero-left", "fx-ambient-shadow", "fx-specular-rim", "fx-frosted-glass", "fx-aurora-bg", "fx-film-grain", "fx-gradient-text", "anim-stagger-card"]) ok(css.includes(`.${c}`) && A.usesKit(`<div class="${c}">`), `lớp ${c} của bảng vi mô có trong bộ CSS và kích hoạt bộ CSS`);
for (const v of ["--text-kpi", "--bg-canvas", "--bg-surface", "--text-primary", "--text-secondary", "--accent-primary", "--accent-secondary", "--border-color", "--font-heading", "--radius-inner", "--ease-out-expo", "--ease-spring"]) ok(css.includes(`${v}:`), `biến ${v}`);
ok(/--sx-fs-kpi:60/.test(css) && /letter-spacing:\.1em/.test(css), "thang 1.333 của trang đọc tới KPI 60px, nhãn in hoa giãn 0.1em");
ok(/\.sx-heat\{/.test(css) && /\.anim-stagger-card\{animation|anim-stagger-card\{animation/.test(css.replace(/\.sx-rise,\.sx-fade,\.sx-pop,/, "")) && /var\(--stagger-index,0\)/.test(css), "ô nhiệt, thẻ xuất hiện lệch nhịp theo --stagger-index");
ok(/\.sx-draw,\.anim-stagger-card\{animation:none!important\}/.test(reduced + "}") || /anim-stagger-card\{animation:none/.test(css), "thẻ lệch nhịp cũng tắt khi prefers-reduced-motion");
ok(A.kitHead(`<div class="sx-card" data-sx-fit>x</div>`).includes("__sxFit") && /4\.5/.test(A.FIT_JS)
  && /F8FAFC/.test(A.FIT_JS) && /0F172A/.test(A.FIT_JS) && !/`|<\/script/i.test(A.FIT_JS),
"tự vá sau khi vẽ: đổi màu chữ dưới 4.5:1, chạy được trong thẻ script (cỡ chữ khi co: tests/ui/deck-fit.mjs)");
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
ok(!/<head>[^]*?<link rel="stylesheet" href="https:\/\/fonts\.googleapis/.test(built.replace(/<noscript>.*?<\/noscript>/g, "")), "phông không chặn lần vẽ đầu: không có <link> phông trong <head>");
const bodyOnly = `<section class="slide sx-slide"><header class="sx-stack"><p class="sx-title">a</p></header></section>`;
const bo = D.buildDocCore("html", bodyOnly, "https://o", "c", false, "");
ok(bo.startsWith("<!doctype html><html><head>") && bo.indexOf("Content-Security-Policy") < bo.indexOf("</head>") && bo.indexOf("data-sx-kit") < bo.indexOf("</head>") && bo.includes(`<header class="sx-stack"><p`), "trang chỉ có phần thân, có <header>: không bị chèn vào thẻ header");
ok(D.htmlExport(bodyOnly).startsWith("<!doctype") && D.deckExport(bodyOnly).startsWith("<!doctype"), "tệp tải về cũng vậy");
ok(D.withHead(`<html><head lang="vi"><title>t</title></head></html>`, "X").includes(`<head lang="vi">X<title>`), "<head> có thuộc tính vẫn nhận ra");
const svgKit = `<svg xmlns="http://www.w3.org/2000/svg" data-sx-preset="exec-navy"><rect fill="var(--sx-accent)"/></svg>`, svgPlain = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#000"/></svg>`;
const svgDoc = D.buildDocCore("svg", svgKit, "https://o", "c", false, "");
ok(svgDoc.includes("data-sx-kit") && svgDoc.indexOf("data-sx-kit") < svgDoc.indexOf("place-items:center"), "SVG dùng biến: khung có bộ CSS, nền của khung SVG vẫn thắng");
ok(!D.buildDocCore("svg", svgPlain, "https://o", "c", false, "").includes("data-sx-kit") && D.svgExport(svgPlain) === svgPlain, "SVG cũ: không đổi một byte, khung và tệp tải về");
ok(/<!\[CDATA\[[^]*--sx-accent:#0052CC[^]*\]\]>/.test(D.svgExport(svgKit)), "tệp SVG tải về mang bộ CSS theo, đúng XML");
{
  const face = (fam, w, sub) => `/* ${sub} */\n@font-face {\n  font-family: '${fam}';\n  font-weight: ${w};\n  src: url(https://fonts.gstatic.com/s/${fam.replace(/ /g, "")}/${w}-${sub}.woff2) format('woff2');\n  unicode-range: U+0-FFFF;\n}`;
  const css = [["Inter", [400, 500, 600, 700, 800]], ["JetBrains Mono", [500, 600]], ["Plus Jakarta Sans", [500, 600, 700, 800]]].flatMap(([f, ws]) => ws.flatMap((w) => ["vietnamese", "latin-ext", "latin"].map((s) => face(f, w, s)))).join("\n");
  const got = await F.fontEmbedCss(`<!-- https://fonts.googleapis.com/css2?family=Inter --> chữ`, async (u) => (String(u).includes("googleapis") ? { ok: true, text: async () => css } : { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
  ok((got.match(/@font-face/g) ?? []).length === 33 && /Plus Jakarta Sans[^}]*font-weight: 800/.test(got), "xuất PNG giữ đủ 33 mặt phông, gồm Plus Jakarta Sans 800 của tiêu đề", (got.match(/@font-face/g) ?? []).length);
}
{
  const o = X.boxOptions({ x: 64, y: 100, w: 800, h: 264, al: "left", lh: 88, one: false, runs: [] }, 1280, 720);
  ok(o.lineSpacing === 66 && !("lineSpacingMultiple" in o), "PowerPoint: bước dòng bằng điểm (88px ở khổ 1280 là 66pt), không ghi bội số của line-height", JSON.stringify(o));
}
{
  const fontSrc = /font-src https:\/\/o\/kitfonts\/ https:\/\/fonts\.gstatic\.com/.test(built);
  const styleSrc = /style-src 'unsafe-inline' https:\/\/o\/kitfonts\/ https:\/\/fonts\.googleapis\.com/.test(built);
  ok(fontSrc && styleSrc, "CSP của khung cho phép bộ phông của Synchro, Google Fonts chỉ còn cho artifact cũ");
  const bare = D.buildDocCore("html", kitPage, "", "c", false, "");
  ok(/style-src 'unsafe-inline' https:\/\/fonts\.googleapis\.com/.test(bare),
    "không có địa chỉ Synchro: CSP như trước");
}
const url = A.kitFontUrl(kitPage);
ok(url.includes("Playfair+Display") && url.includes("Be+Vietnam+Pro") && url.includes("JetBrains+Mono") && !url.includes("Inter"), "chỉ tải phông của phong cách trang dùng", url);
ok(D.htmlExport(kitPage).includes("data-sx-kit") && D.deckExport(kitPage).includes("data-sx-kit"), "tệp HTML tải về kèm bộ CSS, mở một mình vẫn đúng");
ok(A.withKitFontLink(kitPage).includes("fonts.googleapis.com") && A.withKitFontLink(plain) === plain, "xuất PNG / PowerPoint tìm thấy phông của bộ CSS");
const dock = readFileSync("workspace/Dockerfile", "utf8");
for (const n of Object.keys(FONT_SPEC)) ok(dock.includes(`'${n}'`), `sandbox có phông ${n}`);
const shas = [...dock.matchAll(/'([0-9a-f]{64}) ofl\//g)].map((m) => m[1]);
// 9 phông của bộ thiết kế + Be Vietnam Pro ExtraBold / Black cho phụ đề video (Remotion).
ok(shas.length === 11 && /google\/fonts\/[0-9a-f]{40}\//.test(dock) && /sha256sum -c/.test(dock) && /fc-cache/.test(dock), `phông ghim commit và mã băm (${shas.length} tệp)`);
ok(/DM Mono/.test(JSON.stringify(FONT_SPEC)) === false, "không dùng phông thiếu dấu tiếng Việt (DM Mono)");
const probe = readFileSync("server/artcheck.ts", "utf8");
ok(probe.includes("${DESIGN_PROBE}") && !/tự thu nhỏ/.test(probe), "check_artifact có phép đo mới, chỉ báo chứ không tự sửa");

console.log("6b. Mẫu tham chiếu, bộ phông, hình chủ đạo");
{
  const RF = (await loadTs(["shared/designrefs"]))["shared/designrefs"];
  const briefs = readFileSync("tests/fixtures/design-briefs.txt", "utf8").split(/^## /m).slice(1).map((b) => {
    const [name, ...rest] = b.split("\n");
    return { name, text: rest.join(" ").replace(/\s+/g, " ").trim() };
  });
  const noAi = briefs.filter((b) => K.forbidsAiImage(b.text)).map((b) => b.name);
  ok(noAi.join() === "Slide,Landing page,Poster", "đúng 3 brief của chủ dự án ghi \"không ảnh AI\"", noAi);
  const asks = ["không dùng ảnh AI", "Không ảnh do AI tạo nhé", "no AI images please", "without AI-generated images"];
  for (const t of asks) ok(K.forbidsAiImage(t), `nhận "${t}"`);
  ok(!K.forbidsAiImage("Tạo ảnh AI cho bìa") && !K.forbidsAiImage("làm poster có ảnh"),
    "xin ảnh AI không bị coi là cấm");
  const hero = Object.fromEntries(briefs.map((b) => [b.name, K.heroDomain(K.formatOf(b.text) ?? "doc", b.text)]));
  ok(hero.Slide === "slide" && hero["Landing page"] === "web" && hero.Poster === "poster",
    "slide, trang web, poster cần hình chủ đạo", hero);
  ok(!hero.Dashboard && !hero["Bộ nhận diện"] && !hero["Báo cáo A4"],
    "dashboard, bộ nhận diện, báo cáo không bắt buộc", hero);
  ok(K.heroAspect("poster") === "2:3" && K.heroAspect("web") === "16:9",
    "tỉ lệ ảnh hero: poster 2:3, web và slide 16:9");
  const words = ["#0e0f0c", "#d9a441", "#2f6b3a"].map(K.colourWord);
  ok(words[0] === "near-black" && /amber|orange/.test(words[1]) && words[2].includes("green"),
    "tên màu tiếng Anh cho câu lệnh ảnh", words);
  const tokens = {
    theme: "dark",
    colors: [{ hex: "#0e0f0c", role: "bg", share: 0.6 }, { hex: "#1a1c17", role: "surface", share: 0.2 },
      { hex: "#f4efe6", role: "ink", share: 0.15 }, { hex: "#d9a441", role: "accent", share: 0.05 }],
    fonts: { head: { kit: "fraunces", seen: "Proprietary Serif", seenLicence: "proprietary", weight: 600 },
      body: { kit: "inter", seen: "Inter", seenLicence: "open", weight: 400 }, mono: null },
    type: { basePx: 18, ratio: 1.333, sizes: [18, 24, 32, 42, 56, 96], headLine: 1.1, bodyLine: 1.55,
      headCase: "none" },
    tracking: { display: -0.03, heading: -0.01, body: 0, label: 0.08 }, radius: { outer: 12, inner: 6, pill: false },
    shadow: { level: 1, css: "0 1px 2px rgba(0,0,0,.3)" },
    spacing: { unit: 8, section: 96, gutter: 24, density: "airy" },
    layout: { columns: 12, maxWidth: 1200, align: "left", emptyShare: 0.3 },
    imagery: { kind: "photo", share: 0.5, light: "low raking window light from left", lens: "85mm, f/4, eye level",
      grade: "warm amber highlights, deep green shadows", subject: "tea leaves on dark stone" },
  };
  const ref = (i, roles) => ({ id: `web-00${i}`, source: "catalog", label: `Mẫu ${i}`, roles, domain: "web",
    title: `Trang đêm tối số ${i}`, why: "Tiêu đề 96 px siết −0,03em đặt lệch trái. ".repeat(6), tokens });
  const css = `<style data-sx-mix="m-3f9a01c2" data-sx-fonts="fraunces,inter,jetbrains-mono">`
    + `[data-sx-preset="midnight-tech"][data-sx-mix="m-3f9a01c2"]{--sx-bg:#0e0f0c}</style>`;
  const facets = { domain: "web", industries: ["food-beverage"], moods: ["dark-cinematic"], audience: ["consumer"],
    theme: "dark", brand: null };
  const st = { mix: { id: "m-3f9a01c2", preset: "midnight-tech", domain: "web", tokens, css, brand: null },
    refs: [ref(1, ["palette", "layout"]), ref(2, ["type"]), ref(3, ["shape"])], facets, note: null };
  const prompt = K.heroPrompt(st.mix, "A glass jar of wild honey");
  const want = ["low raking window light from left", "85mm", "warm amber highlights", "near-black", "left third",
    "Low-key"];
  ok(prompt.startsWith("A glass jar of wild honey.") && want.every((w) => prompt.includes(w))
    && prompt.endsWith("No text, no letters, no logos, no watermark."),
  "câu lệnh ảnh theo ánh sáng, ống kính, màu của mẫu", prompt);
  const rule = K.heroRule({ image: true, forbid: false, domain: "web", mix: st.mix });
  const template = prompt.replace("A glass jar of wild honey", "<subject from the brief>");
  ok(["generate_image", "16:9", "data-sx-hero", template].every((w) => rule.includes(w)),
    "có công cụ ảnh, đề không cấm: hero bằng generate_image với câu lệnh mẫu", rule);
  const noAiRule = K.heroRule({ image: true, forbid: true, domain: "poster", mix: st.mix });
  ok(!noAiRule.includes("Tạo bằng generate_image") && noAiRule.includes("images.unsplash.com")
    && noAiRule.includes("data-sx-shader"), "đề cấm ảnh AI: ảnh thật, nền shader, SVG", noAiRule);
  ok(K.heroRule({ image: true, forbid: false, domain: null, mix: null }) === "",
    "định dạng không cần hình: không có luật");
  for (const [sees, agy] of [[true, false], [true, true], [false, false]]) {
    const b = K.designRefsBlock(st, { sees, agy, hero: rule });
    const tag = `${sees ? "có mắt" : "chỉ đọc chữ"}${agy ? ", Antigravity" : ""}`;
    const framed = b.startsWith('<design_refs mix="m-3f9a01c2"') && b.endsWith("</design_refs>");
    ok(K.designBytes(b) <= K.REFS_BUDGET && framed,
      `${tag}: khối mẫu ≤ 3 KB`, K.designBytes(b));
    ok([css, 'data-sx-mix="m-3f9a01c2"', "Mẫu 1 (bảng màu, bố cục)", "Mẫu 3 (hình khối)"].every((w) => b.includes(w)),
      `${tag}: dán khối CSS trộn, nêu vai từng mẫu`);
    ok(["2 câu định hướng mỹ thuật", "không chép", "Fraunces"].every((w) => b.includes(w))
      && !b.includes("Proprietary Serif"),
    `${tag}: luật dùng mẫu, phông trong bộ, không lộ phông độc quyền của trang nguồn`);
    ok(sees === b.includes('nhãn "Mẫu tham chiếu k"') && agy === b.includes("Mở và xem cả 3 ảnh mẫu"),
      `${tag}: lời về ảnh mẫu đúng loại model`);
  }
  const mail = { ...st, mix: { ...st.mix, domain: "email" } };
  const email = K.designRefsBlock(mail, { sees: false, agy: false, hero: "" });
  ok(!email.includes("<style data-sx-mix") && email.includes("bg #0e0f0c"), "email: mã màu thẳng thay cho biến CSS");
  ok(RF.KIT_FONTS.every((f) => K.KIT_FONT_RULE.includes(f.family) && FONT_SPEC[f.family]?.stack === RF.fontStack(f.id)),
    "luật phông nêu đủ 17 phông của bộ; FONT_SPEC có đủ, cùng chuỗi dự phòng");
  const mixed = `<artifact identifier="nep" type="text/html"><html data-sx-preset="midnight-tech"`
    + ` data-sx-mix="m-3f9a01c2">${css}<body>x</body></html></artifact>`;
  ok(priorDesign([mixed])?.mix === "m-3f9a01c2", "lượt sau đọc được khối token trộn của bản trước");
  const follow = turn("Làm tiêu đề to hơn", { prior: [mixed] });
  ok(follow?.compact && ['mix="m-3f9a01c2"', '<style data-sx-mix="m-3f9a01c2">'].every((w) => follow.block.includes(w)),
    "sửa tiếp: khối rút gọn giữ khối token trộn", follow?.block);
  ok(!turn("Làm tiêu đề to hơn", { prior: [deckMsg] }).block.includes("data-sx-mix"),
    "bản trước không có token trộn: khối như trước");
  const link = A.kitHead(`<html data-sx-preset="midnight-tech" data-sx-mix="m-1" data-sx-fonts="fraunces,inter">`,
    "https://o");
  const faces = ["https://o/kitfonts/v1/fraunces/face.css", "https://o/kitfonts/v1/plus-jakarta-sans/face.css"];
  ok(faces.every((w) => link.includes(w)) && link.includes("fonts.googleapis.com/css2?"),
    "khung nạp face.css của Synchro cho phông preset và data-sx-fonts, Google chỉ là đường dự phòng");
  ok(!A.kitHead(`<div class="sx-card">x</div>`, "").includes("/kitfonts/"),
    "không có địa chỉ Synchro: chỉ Google Fonts");
}

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
  // Việc phụ không được đè lên "lời gọi gần nhất" của máy giả lập: chạy bằng khóa API giả lập, như mixer.test.
  for (const cli of ["claude", "codex", "agy"]) await api("POST", `/api/engines/${cli}/logout`);
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
