// Tên đoạn chat: model hay chép cả nhãn ("Tên đoạn chat: Theo dõi chi tiêu tháng 11"), tên đó từng hiện nguyên ở thanh bên. Không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
const { names: N } = await loadTs(["names"]);
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x)); };
for (const [raw, want] of [
  ["Tên đoạn chat: Theo dõi chi tiêu tháng 11", "Theo dõi chi tiêu tháng 11"],
  ["**Tên: Kế hoạch du lịch Đà Lạt**", "Kế hoạch du lịch Đà Lạt"],
  ['Title: "Quarterly sales report".', "Quarterly sales report"],
  ["Tiêu đề: Sửa lỗi đăng nhập\nGiải thích thêm", "Sửa lỗi đăng nhập"],
  ["Đoạn chat: Lời chào", "Lời chào"],
  ["Tên miền và DNS", "Tên miền và DNS"],
  ["Thiết kế web quán cà phê", "Thiết kế web quán cà phê"],
]) ok(N.cleanTitle(raw) === want, `${raw.split("\n")[0]} → ${want}`, N.cleanTitle(raw));

// Tên tạm (không gọi model) cho brief dài mở bằng câu đóng vai: theo sản phẩm và đối tượng, không "Bạn là nhà thiết kế
// sản".
console.log("Tên theo chủ đề, bỏ câu đóng vai");
for (const [brief, want] of [
  ["Bạn là nhà thiết kế sản phẩm (UI/UX) cấp cao. "
    + "Hãy thiết kế và dựng màn hình dashboard web (1440x900, một tệp HTML chạy được) cho chủ chuỗi 5 cửa "
    + "hàng cà phê. Gồm: thanh bên.",
    "Dashboard chuỗi 5 cửa hàng cà phê"],
  ["Bạn là giám đốc sáng tạo của một studio thiết kế trình bày hàng đầu. "
    + "Hãy thiết kế bộ slide 8 trang ra mắt thương hiệu trà thủ công \"Sương Sớm\" (trà shan tuyết Hà "
    + "Giang).",
    "Bộ slide Sương Sớm"],
  ["Bạn là nhà thiết kế đồ họa chuyên poster sự kiện âm nhạc. "
    + "Hãy thiết kế một poster khổ A3 dọc cho đêm nhạc jazz \"Hà Nội Sau Mưa\", 20:00 thứ Bảy.",
    "Poster Hà Nội Sau Mưa"],
  ["Bạn là nhà thiết kế web cấp cao. "
    + "Hãy thiết kế và dựng một landing page hoàn chỉnh (một tệp HTML) cho studio kiến trúc nội thất "
    + "\"Nếp\" ở Hà Nội.",
    "Landing page Nếp"],
  ["You are a senior engineer. Review this Go code for races.", "Review this Go code for races"],
  ["Hãy giải thích thuyết tương đối hẹp. Ngắn gọn.", "Giải thích thuyết tương đối hẹp"],
  ["Bạn là chuyên gia marketing. Tạo bộ slide 6 trang về chiến lược marketing", "Bộ slide chiến lược marketing"],
  ["Bạn là trợ lý văn phòng. Viết email xin nghỉ phép cho sếp", "Email xin nghỉ phép"],
  ["Bạn là hướng dẫn viên. Lập kế hoạch du lịch Đà Lạt cho gia đình 4 người", "Kế hoạch du lịch Đà Lạt"],
  ["You are a designer. Make a slide deck about our Q3 results", "Slide deck Q3 results"],
  ["You are a teacher. Write a report about climate change for my class", "Report climate change"],
]) ok(N.topicTitle(brief) === want, `${brief.slice(0, 50)}… → ${want}`, N.topicTitle(brief));
const tt = N.topicTitle("Bạn là nhà thiết kế sản phẩm (UI/UX) cấp cao. Hãy thiết kế dashboard cho chuỗi cà phê.");
ok(!/^Bạn là/.test(tt) && tt.length <= 48, "không bao giờ mở đầu bằng câu đóng vai, tối đa 48 ký tự", tt);
ok(N.stripRole("Bạn là ai?") === "Bạn là ai?", "tin chỉ có câu hỏi \"Bạn là ai?\": giữ nguyên");
ok(N.stripRole("Bạn là chuyên gia SEO. Viết mô tả cho trang chủ") === "Viết mô tả cho trang chủ",
  "bỏ câu đóng vai, giữ yêu cầu");
ok(N.stripRole("Bạn làm ơn tóm tắt bài này") === "Bạn làm ơn tóm tắt bài này",
  "\"Bạn làm ơn …\" không phải câu đóng vai");

// Câu nhờ thường ngày (không đóng vai, không phải brief dài): giữ câu đầu của người dùng, không ráp thành "Email sếp".
// Phần sau "cho" chỉ còn một chữ ("cho tôi") hay "ảnh" trong "ảnh hưởng" không được thành tên.
console.log("Câu nhờ thường ngày giữ câu đầu");
for (const [msg, want] of [
  ["Viết email xin nghỉ phép cho sếp", "Viết email xin nghỉ phép cho sếp"],
  ["Tóm tắt báo cáo này cho tôi", "Tóm tắt báo cáo này cho tôi"],
  ["Lập kế hoạch du lịch Đà Lạt cho gia đình 4 người", "Lập kế hoạch du lịch Đà Lạt cho gia đình 4 người"],
  ["Làm ứng dụng quản lý chi tiêu cho sinh viên", "Làm ứng dụng quản lý chi tiêu cho sinh viên"],
  ["Dịch email này sang tiếng Anh cho khách hàng Nhật", "Dịch email này sang tiếng Anh cho khách hàng…"],
  ["Phân tích ảnh hưởng của AI về việc làm", "Phân tích ảnh hưởng của AI về việc làm"],
  ["Make a slide deck about our Q3 results", "Make a slide deck about our Q3 results"],
  ["Write a report about climate change for my class", "Write a report about climate change for my class"],
  ["Build a landing page for my bakery", "Build a landing page for my bakery"],
  ["Tạo bộ slide 6 trang về chiến lược marketing", "Tạo bộ slide 6 trang về chiến lược marketing"],
  ["Bạn là trợ lý. Tóm tắt báo cáo này cho tôi", "Tóm tắt báo cáo này cho tôi"],
  ["Bạn là nhà phân tích. Phân tích ảnh hưởng của AI về việc làm", "Phân tích ảnh hưởng của AI về việc làm"],
]) ok(N.topicTitle(msg) === want, `${msg} → ${want}`, N.topicTitle(msg));
// Brief dài không đóng vai: theo sản phẩm, nhưng sản phẩm nhắc tới ở đoạn sau không phải thứ cần làm.
const longAsk = "Lập kế hoạch du lịch Đà Lạt cho gia đình 4 người, đi 3 ngày 2 đêm vào cuối tháng 12, có hai trẻ nhỏ"
  + " và ông bà, ưu tiên chỗ ở gần trung tâm, ăn đặc sản địa phương, tránh leo núi, ngân sách khoảng 15 triệu.";
ok(N.topicTitle(longAsk) === "Kế hoạch du lịch Đà Lạt", "brief dài: theo sản phẩm và chữ người dùng viết",
  N.topicTitle(longAsk));
const lateProduct = "Phân tích ảnh hưởng của AI về việc làm của nhân viên văn phòng ở Việt Nam trong năm năm tới,"
  + " dựa trên số liệu mới nhất bạn tìm được, nêu rõ ngành nào chịu tác động nhiều nhất, rồi gợi ý cho tôi"
  + " cách viết báo cáo cho công ty về chủ đề này.";
ok(N.topicTitle(lateProduct) === "Phân tích ảnh hưởng của AI về việc làm của nhân…",
  "sản phẩm nhắc ở cuối brief dài: giữ câu đầu", N.topicTitle(lateProduct));
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
