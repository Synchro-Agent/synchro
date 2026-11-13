// Blueprint D2: tự nâng cấp khi tìm / đọc web. needsRenderEscalation nhận ra trang mỏng (< 500 ký tự) hoặc màn chưa dựng xong
// ("đang cập nhật" / "enable JavaScript" / "loading" / "just a moment"); khi đó Synchro mở lại trang trong trình duyệt và đọc DOM đã dựng.
// Mô tả (không chạy thật): truy vấn tỷ giá trả về một con số + thời điểm + liên kết nguồn nhờ lời dặn trong mô tả công cụ web.
// Hàm thuần, không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const { "ai/webescalate": W } = await loadTs(["ai/webescalate"]);

console.log("1. Nhận ra trang mỏng / chưa dựng xong → cần mở trình duyệt đọc DOM");
// Mỏng: dưới 500 ký tự.
ok(W.needsRenderEscalation(""), "trang trống");
ok(W.needsRenderEscalation("Tỷ giá đang cập nhật..."), "màn \"đang cập nhật\"");
ok(W.needsRenderEscalation("x".repeat(200)), "200 ký tự là mỏng");
ok(W.needsRenderEscalation("Please enable JavaScript to view this site." + " ".repeat(10)), "enable JavaScript");
ok(W.needsRenderEscalation("Just a moment... Checking your browser before accessing the site."), "màn chặn Cloudflare \"just a moment\"");
ok(W.needsRenderEscalation("Loading...\n" + " chi tiết ".repeat(30)), "còn \"loading\" khi chữ còn ngắn");

console.log("2. Trang bình thường, đủ chữ → không cần nâng cấp");
const article = "Tỷ giá USD/VND hôm nay tại Vietcombank: mua 25.100, bán 25.470 (cập nhật 09:15 ngày 13/11/2026). ".repeat(12);
ok(!W.needsRenderEscalation(article), "bài đủ dài có đủ số liệu");
ok(!W.needsRenderEscalation("x".repeat(600)), "600 ký tự không còn mỏng");
// Bài dài có lỡ chứa chữ "loading" ở đâu đó thì không báo nhầm.
ok(!W.needsRenderEscalation("Nội dung đầy đủ. ".repeat(200) + " lazy loading images "), "bài dài chứa \"loading\" không bị coi là chặn");

console.log("2b. Tóm tắt tìm web (có nguồn) vốn ngắn gọn → KHÔNG nâng cấp chỉ vì ngắn; chỉ nâng khi thật sự kẹt");
// Một tóm tắt tốt, ngắn, có nguồn (dưới 500 ký tự nhưng là câu trả lời grounded): không được kích hoạt mở trình duyệt.
ok(!W.searchNeedsEscalation("Tỷ giá USD/VND hôm nay tại Vietcombank: mua 25.100, bán 25.470 (cập nhật 09:15 ngày 13/11/2026).", true), "tóm tắt ngắn có nguồn: không nâng cấp");
ok(!W.searchNeedsEscalation("Khoảng 25.000 đồng.", true), "câu trả lời rất ngắn nhưng có nguồn: không nâng cấp");
// Vẫn nâng cấp khi tóm tắt thật sự kẹt: trống, không có nguồn, hoặc dính màn chưa dựng xong.
ok(W.searchNeedsEscalation("", true), "tóm tắt trống: nâng cấp");
ok(W.searchNeedsEscalation("Khoảng 25.000 đồng.", false), "trả lời chay không nguồn: nâng cấp");
ok(W.searchNeedsEscalation("Trang đang cập nhật, vui lòng chờ.", true), "dính màn \"đang cập nhật\": nâng cấp dù có nguồn");
ok(!W.searchNeedsEscalation("Nội dung đầy đủ có số liệu. ".repeat(200) + " lazy loading images ", true), "tóm tắt dài có \"loading\" rải rác: không nâng cấp nhầm");

console.log("3. Có lời nhắc tự mở trình duyệt đọc DOM đã dựng");
ok(/browser_navigate/.test(W.RENDER_ESCALATION_HINT) && /browser_text/.test(W.RENDER_ESCALATION_HINT), "lời nhắc chỉ rõ mở trình duyệt rồi đọc lại");
ok(/chính thức/.test(W.RENDER_ESCALATION_HINT) && /không chắc/.test(W.RENDER_ESCALATION_HINT), "lời nhắc: ưu tiên nguồn chính thức, thử thêm nguồn trước khi nói \"không chắc\"");
ok(W.THIN_CHARS === 500, "ngưỡng mỏng là 500 ký tự");

console.log("4. W23-6 / SEC-8 (D2.1): máy chủ tự mở trang trong trình duyệt (giả lập), có giới hạn");
{
  const RICH = "Tỷ giá USD/VND Vietcombank 13/11/2026 09:15: mua 25.100, bán 25.470. ".repeat(12);
  const mk = (pages) => { const calls = []; return { calls, read: async (u) => { calls.push(u); return pages[u] ?? null; } }; };
  // Kẹt + có trình duyệt: mở trang nguồn, gắn chữ đã dựng, không còn lời nhắc khi đã đủ chữ.
  let m = mk({ "https://a.vn/ty-gia": RICH });
  let done = new Set();
  let out = await W.escalateText("(không có kết quả)\n\nNguồn:\n[1] A — https://a.vn/ty-gia", { stalled: true, urls: ["https://a.vn/ty-gia", "https://b.vn"], browse: true, done, read: m.read });
  ok(m.calls.length === 1 && out.includes("Synchro đã tự mở trang này") && out.includes("bán 25.470") && !out.includes("browser_navigate"), "kẹt: tự mở trang đầu, gắn DOM đã dựng, dừng khi đủ chữ", out.slice(-300));
  // Mỗi địa chỉ một lần mỗi lượt.
  out = await W.escalateText("x", { stalled: true, urls: ["https://a.vn/ty-gia"], browse: true, done, read: m.read });
  ok(m.calls.length === 1 && /browser_navigate/.test(out), "cùng địa chỉ trong lượt không mở lại; còn mỏng thì kèm lời nhắc", out);
  // Trang đầu còn mỏng → thử trang thứ hai; tối đa 2 trang.
  m = mk({ "https://a.vn": "Đang cập nhật...", "https://b.vn": "Loading", "https://c.vn": RICH });
  out = await W.escalateText("x", { stalled: true, urls: ["https://a.vn", "https://b.vn", "https://c.vn"], browse: true, done: new Set(), read: m.read });
  ok(m.calls.join() === "https://a.vn,https://b.vn" && /browser_navigate/.test(out), "tối đa 2 trang, còn mỏng thì kèm lời nhắc", m.calls);
  // Không kẹt: không mở gì.
  m = mk({ "https://a.vn": RICH });
  out = await W.escalateText("Tóm tắt tốt [1]", { stalled: false, urls: ["https://a.vn"], browse: true, done: new Set(), read: m.read });
  ok(out === "Tóm tắt tốt [1]" && m.calls.length === 0, "không kẹt: giữ nguyên, không mở trình duyệt");
  // Lượt không có công cụ trình duyệt: không nhắc tên công cụ không có.
  out = await W.escalateText("x", { stalled: true, urls: ["https://a.vn"], browse: false, done: new Set(), read: m.read });
  ok(!/browser_/.test(out) && /web_search/.test(out) && m.calls.length === 0, "không có trình duyệt: chỉ nhắc thử nguồn khác, không gọi trình duyệt", out);
  // Địa chỉ bị từ chối (nội bộ / bị chặn / cần hỏi) thì bỏ qua; không phải http(s) thì bỏ qua.
  m = mk({ "https://ok.vn": RICH });
  out = await W.escalateText("x", { stalled: true, urls: ["file:///etc/passwd", "https://intranet.local", "https://ok.vn"], browse: true, done: new Set(), read: m.read, allow: async (u) => u !== "https://intranet.local" });
  ok(m.calls.join() === "https://ok.vn" && out.includes("bán 25.470"), "chỉ mở địa chỉ được phép", m.calls);
  // Hết giờ: không treo lượt.
  const t0 = Date.now();
  const pages = await W.autoRender(["https://slow.vn"], { done: new Set(), read: () => new Promise(() => {}), timeoutMs: 50 });
  ok(pages.length === 0 && Date.now() - t0 < 1000, "trang treo: hết giờ thì bỏ qua", Date.now() - t0);
  // Chữ dài bị cắt.
  const long = await W.autoRender(["https://l.vn"], { done: new Set(), read: async () => "a".repeat(9000) });
  ok(long[0].text.length <= W.RENDERED_MAX + 1, "chữ dài được cắt gọn", long[0]?.text.length);
}
{
  const fs = await import("node:fs");
  const eng = fs.readFileSync("app/chatengine.ts", "utf8");
  ok(/escalateSearch\(x, await searchWeb\(/.test(eng), "web_search đi qua escalateSearch (máy chủ tự mở trang)");
  ok(/checkUrl\(url\)/.test(eng) && /siteRule\(x\.uid/.test(eng), "trang tự mở phải qua checkUrl (chặn địa chỉ nội bộ) và quy tắc trang của người dùng");
  ok(/c\.name === "browser_text" && r\.stalled/.test(eng), "browser_text mỏng: máy chủ tự chờ rồi đọc lại");
  ok(!/\$\{RENDER_ESCALATION_HINT\}/.test(eng), "chatengine không còn tự gắn lời nhắc browser_* vào mọi kết quả tìm web");
}

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
