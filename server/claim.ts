// Chủ thật của email vừa giành lại tài khoản chưa từng được xác minh (đăng nhập Google / GitHub / Apple, hoặc đường dẫn đặt lại mật khẩu gửi tới hộp thư):
// thứ người đăng ký trước có thể đã gắn vào phải gỡ, và người dùng phải được báo. Chỉ xóa nội dung khi tài khoản tạo sau khi có xác minh email (fresh):
// tài khoản cũ không phân biệt được với chủ thật dùng lâu năm nên giữ nguyên dữ liệu như trước.
import "server-only";
import { audit, getUser } from "./authstore";
import { wipeBrain } from "./brain";
import { removeUserDevices } from "./browserext";
import { disableUserConnectors } from "./connectors";
import { addNotice } from "./tasks";

export async function afterClaim(uid: string, fresh: boolean, via: "oauth" | "reset", droppedPassword = false) {
  await removeUserDevices(uid).catch((e) => console.error("[claim]", e));
  const off = disableUserConnectors(uid);
  if (fresh) {
    // Hướng dẫn và ký ức do người khác cài sẽ ảnh hưởng mọi câu trả lời sau này.
    try { wipeBrain(uid); } catch (e) { console.error("[claim]", e); }
    if (via === "oauth") audit("account_claimed", { target: getUser(uid), detail: via });
  }
  const parts = [
    droppedPassword ? "Mật khẩu cũ đã được gỡ vì email chưa từng được xác minh, nên có thể do người khác đặt. Nếu vẫn muốn đăng nhập bằng email, hãy đặt mật khẩu mới trong Cài đặt → Tài khoản." : "",
    `Các thiết bị khác đã được đăng xuất, tiện ích Chrome đã ghép nối được gỡ${off ? ", connector đã được tắt (bật lại trong Cài đặt nếu đúng là của bạn)" : ""}.`,
    fresh ? "Hướng dẫn tùy chỉnh và ký ức trong tài khoản đã được xóa vì chúng có thể do người khác đặt." : "Hãy kiểm tra hướng dẫn tùy chỉnh trong Cài đặt.",
  ];
  addNotice(uid, "Đã xác minh email của bạn", parts.filter(Boolean).join(" "), "settings:Account");
}
/** Giành lại tài khoản mà có gỡ xác minh hai bước hoặc cách đăng nhập khác: phải báo, đó có thể là của chính họ (tài khoản cũ chưa từng xác minh email). */
export function noticeDropped(uid: string) {
  addNotice(uid, "Đã gỡ cách đăng nhập cũ", "Email này chưa từng được xác minh nên xác minh hai bước và các cách đăng nhập khác trên tài khoản có thể do người khác đặt. Chúng đã được gỡ. Nếu đúng là của bạn, hãy bật lại trong Cài đặt → Tài khoản.", "settings:Account");
}
