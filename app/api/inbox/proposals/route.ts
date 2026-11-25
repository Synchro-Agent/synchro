// Địa chỉ cũ của mục Cần duyệt (trước đây nằm trong Hộp thư): tab mở từ bản trước vẫn duyệt được đề xuất.
// runtime / dynamic khai lại ở đây vì Next.js chỉ đọc cấu hình route viết thẳng trong tệp, không đọc bản xuất lại.
export { GET, POST } from "../../autopilot/proposals/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
