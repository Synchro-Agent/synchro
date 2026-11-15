import "server-only";
// Bộ xử lý chat (chỉ chạy ở máy chủ), dùng chung cho /api/llm (chờ kết quả) và lượt chạy nền (runs.ts).
// Model nào gọi tới nhà cung cấp nào do khóa API quản trị viên nhập ở Cài đặt → Providers quyết định.
// Mặt tiền (H3 bước 6a): phần xử lý nằm ở server/chat/ — routing.ts (điểm vào, chọn model và skill), tools.ts (vòng lặp và các công cụ),
// approvals.ts (duyệt công cụ), prompt.ts (lời nhắc và khối ngữ cảnh). Nơi gọi vẫn nhập từ đây như trước.
export { withCacheMark, answerRules } from "./chat/prompt";
export { pendingApprovals } from "./chat/approvals";
export { prewarmChat, rewarmAfterMemory, chatPost, chatExec } from "./chat/routing";
export type { WarmPick } from "./chat/routing";
export { crisisHelp } from "./crisishelp";
export { clearStall, noteStall, stalledModels } from "./ai/anymodel";
