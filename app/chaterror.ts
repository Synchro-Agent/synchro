// Lỗi của một lượt chat: đổi lỗi thô (spawn claude ENOENT, fetch failed…) thành câu người dùng đọc được và việc nên làm tiếp.
// Câu lỗi của máy chủ viết sẵn cho người dùng thì giữ nguyên (giao diện dịch bằng tr). Hàm thuần, có kiểm thử ở tests/api/chat-error.test.mjs.
export type ChatErr = { text: string; detail?: string; act?: "providers" };

const NET = /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_\w+)\b|fetch failed|failed to fetch|load failed|networkerror|network error|socket hang up/i;
const START = /\bspawn\b|\b(ENOENT|EACCES|EPERM|E2BIG)\b/;
const DIED = /\bSIG(KILL|TERM|SEGV|ABRT)\b|exit(ed)?( with)?( code| status)? \d+|\bexit code\b|thoát với mã \d+/i;
const CODE = /\b(TypeError|ReferenceError|SyntaxError|RangeError)\b|Unexpected token|Cannot read propert|is not a function|\n\s+at .+:\d+:\d+/;
const PROVIDERS = /Providers|đăng nhập gói|đăng nhập lại|chưa được kết nối với model|Chưa kết nối model/i;

export const GENERIC_ERR = "Không thể kết nối tới model. Vui lòng thử lại.";

export function chatError(raw: string | undefined): ChatErr {
  const s = (raw ?? "").trim();
  if (!s) return { text: GENERIC_ERR };
  if (START.test(s)) return { text: "Model chưa khởi động được trên máy chủ. Hãy thử lại hoặc chọn model khác.", detail: s };
  if (NET.test(s)) return { text: "Mất kết nối tới model. Hãy kiểm tra mạng rồi thử lại.", detail: s };
  if (DIED.test(s)) return { text: "Model dừng đột ngột giữa lượt trả lời. Hãy thử lại hoặc chọn model khác.", detail: s };
  if (CODE.test(s) || s.length > 400) return { text: "Lượt này gặp lỗi ở máy chủ. Hãy thử lại hoặc chọn model khác.", detail: s };
  return { text: s, act: PROVIDERS.test(s) ? "providers" : undefined };
}
