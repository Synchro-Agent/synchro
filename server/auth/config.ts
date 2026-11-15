// Cấu hình tài khoản đọc một lần khi nạp: tên cookie, thời hạn phiên, độ dài mật khẩu, email chủ sở hữu / quản trị viên.
// Tệp lá (không import gì trong ứng dụng): các phần khác của tài khoản đọc giá trị ở đây ngay khi nạp.
import "server-only";

export const COOKIE = "synchro_session";
export const MIN = 60_000, DAY = 86_400_000;
export const SESSION_TTL = 30 * DAY;
export const PW_MIN = 8;
export const PW_MAX = 200;
export const MAX_SESSIONS = 20;
// Quản trị viên: email nằm trong danh sách này VÀ đã được xác minh (OAuth hoặc tạo bằng ops/create-admin.mjs).
const emailList = (v: string) => v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const ADMIN_LIST = emailList(process.env.ADMIN_EMAILS ?? "nguyenhuulamtung@gmail.com");
export const ADMIN_EMAILS = new Set(ADMIN_LIST);
// Ba vai trò: Chủ sở hữu (Owner) · Quản trị viên (Admin) · Thành viên. Chủ sở hữu = email trong OWNER_EMAILS; chưa đặt thì là email đầu tiên
// của ADMIN_EMAILS (máy chủ đang chạy giữ nguyên người đứng đầu mà không cần cấu hình thêm). Chỉ chủ sở hữu đổi được khóa API / dịch vụ có
// bí mật, giá và hạn mức áp cho quản trị viên, thêm / bỏ quản trị viên và xóa vĩnh viễn dữ liệu; quản trị viên làm mọi việc quản trị còn lại.
// Quản trị viên thêm từ giao diện lưu ở cột users.role = 'admin'; quản trị viên trong ADMIN_EMAILS và chủ sở hữu đặt ở cấu hình máy chủ.
export const OWNER_EMAILS = new Set(process.env.OWNER_EMAILS?.trim() ? emailList(process.env.OWNER_EMAILS) : ADMIN_LIST.slice(0, 1));
/** Email dành cho tài khoản chủ sở hữu / quản trị viên trong cấu hình máy chủ (không đăng ký mới, không đổi sang được). */
export const reservedEmail = (email: string) => ADMIN_EMAILS.has(email.toLowerCase()) || OWNER_EMAILS.has(email.toLowerCase());
/** Ai nhận cảnh báo vận hành và báo cáo lạm dụng: chủ sở hữu và quản trị viên đặt ở cấu hình máy chủ (OWNER_EMAILS có thể không nằm trong ADMIN_EMAILS). */
export const ALERT_EMAILS = [...new Set([...OWNER_EMAILS, ...ADMIN_LIST])];
