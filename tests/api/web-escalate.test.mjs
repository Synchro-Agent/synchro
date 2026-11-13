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

console.log("3. Có lời nhắc tự mở trình duyệt đọc DOM đã dựng");
ok(/browser_navigate/.test(W.RENDER_ESCALATION_HINT) && /browser_text/.test(W.RENDER_ESCALATION_HINT), "lời nhắc chỉ rõ mở trình duyệt rồi đọc lại");
ok(/chính thức/.test(W.RENDER_ESCALATION_HINT) && /không chắc/.test(W.RENDER_ESCALATION_HINT), "lời nhắc: ưu tiên nguồn chính thức, thử thêm nguồn trước khi nói \"không chắc\"");
ok(W.THIN_CHARS === 500, "ngưỡng mỏng là 500 ký tự");

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
