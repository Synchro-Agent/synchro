// Lỗi đăng nhập trên URL chỉ là mã: chữ tùy ý trên URL không hiện được trên trang đăng nhập thật. Không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
const { autherrors: { authErrorCode, authErrorText } } = await loadTs(["autherrors"]);
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
for (const m of ["Bạn đã hủy đăng nhập.", "Phiên đăng nhập đã hết hạn. Vui lòng thử lại.", "Tài khoản này đã bị khóa. Hãy liên hệ quản trị viên.", "Synchro hiện tạm ngừng nhận đăng ký mới."]) {
  ok(authErrorText(authErrorCode(m)) === m, `đi một vòng giữ nguyên câu: ${m}`, authErrorCode(m));
  ok(/^[a-z]+$/.test(authErrorCode(m)), "trên URL chỉ là mã", authErrorCode(m));
}
ok(authErrorCode("Đăng nhập bằng Apple chưa được cấu hình trên máy chủ.") === "setup", "chưa cấu hình có mã riêng");
ok(authErrorCode("câu lạ") === "failed", "câu lạ thành lỗi chung");
const generic = authErrorText("failed");
for (const bad of ["Tài khoản bị khóa, hãy gọi 1900 0000", "constructor", "__proto__", "<script>"]) ok(authErrorText(bad) === generic, `không hiện chữ lạ: ${bad}`, authErrorText(bad));
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
