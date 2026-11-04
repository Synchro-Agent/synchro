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
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
