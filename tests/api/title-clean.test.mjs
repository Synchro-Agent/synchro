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
    "Dashboard chuỗi cửa hàng cà phê"],
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
  ["Tạo bộ slide 6 trang về chiến lược marketing", "Bộ slide chiến lược marketing"],
]) ok(N.topicTitle(brief) === want, `${brief.slice(0, 50)}… → ${want}`, N.topicTitle(brief));
const tt = N.topicTitle("Bạn là nhà thiết kế sản phẩm (UI/UX) cấp cao. Hãy thiết kế dashboard cho chuỗi cà phê.");
ok(!/^Bạn là/.test(tt) && tt.length <= 48, "không bao giờ mở đầu bằng câu đóng vai, tối đa 48 ký tự", tt);
ok(N.stripRole("Bạn là ai?") === "Bạn là ai?", "tin chỉ có câu hỏi \"Bạn là ai?\": giữ nguyên");
ok(N.stripRole("Bạn là chuyên gia SEO. Viết mô tả cho trang chủ") === "Viết mô tả cho trang chủ",
  "bỏ câu đóng vai, giữ yêu cầu");
ok(N.stripRole("Bạn làm ơn tóm tắt bài này") === "Bạn làm ơn tóm tắt bài này",
  "\"Bạn làm ơn …\" không phải câu đóng vai");
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
