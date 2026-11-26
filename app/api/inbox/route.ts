// Địa chỉ cũ của Autopilot (trước đây là Hộp thư): trang đã mở từ bản trước, tiện ích và kịch bản của người dùng vẫn
// gọi được, cùng dữ liệu. runtime / dynamic khai lại ở đây vì Next.js chỉ đọc cấu hình route viết thẳng trong tệp,
// không đọc bản xuất lại.
export { GET, POST } from "../autopilot/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
