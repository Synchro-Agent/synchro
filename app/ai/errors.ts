// Phân loại lỗi của engine: quota (hết hạn mức thật của gói), rate (giới hạn tốc độ / quá tải ngắn hạn, chờ chút là hết),
// auth (chưa đăng nhập, phiên hết hạn, 401/403), other. Engine chuyển sang khóa API dự phòng khi gặp quota; gặp auth thì báo người dùng đăng nhập lại.
// Giới hạn tốc độ không được coi là hết gói: "rate limit" thoáng qua từng khóa cả gói 30 phút và báo sai "Gói của bạn đã hết hạn mức".

export type ErrKind = "quota" | "rate" | "auth" | "other";

const QUOTA = /usage[ _-]?limit|quota|resource[ _-]?exhausted|(hit|reached) your ([\w-]+ ){0,3}limit|weekly limit|subscription_sharing_usage_limit|credit balance (is )?too low|insufficient[ _-]?(quota|balance)|out of credits?/i;
const RATE = /rate[ _-]?limit|too many requests|overloaded|\b429\b|\b529\b|at capacity|temporarily unavailable due to (load|capacity)/i;
const LIMIT_HIT = /limit (reached|exceeded)|try again (at|after)/i;
// Chờ ngắn hơn mốc này là giới hạn tốc độ; dài hơn là hạn mức của gói ("try again in 2 hours").
const SHORT_WAIT = 10 * 60_000;
// Đăng nhập, phiên, token: câu của CLI và API nói rõ về đăng nhập.
const AUTH = /not logged in|not authenticated|run `?grok login|log ?in (again|required|expired)|please (run )?\/?login|login (expired|required)|authentication[ _-]?(failed|required|error)|invalid (api[ _-]?key|token|credentials?)|oauth (token )?(expired|revoked|invalid)|token (has )?(expired|been revoked)|credentials? (expired|missing)|account (disabled|on hold|suspended)|not_eligible|permission_error/i;
// Mã 401 / 403 trần chỉ là lỗi đăng nhập khi chính API của hãng trả về (đầu dòng, "API Error: 401", "status 401"): chữ 403 trong đầu ra của
// một trang web hay công cụ từng làm gói bị coi là hết phiên đăng nhập và biến mất khỏi bộ chọn model.
const AUTH_HTTP = /^\W*(?:error:?\s*)?(?:40[13]\b|unauthori[sz]ed\b|forbidden\b)|api[ _]error\W+(?:status\W+)?40[13]\b|\b(?:status|http)(?: code)?:?\s*40[13]\b/im;

const UNIT: [RegExp, number][] = [[/^(ms|millisec)/i, 1], [/^s/i, 1000], [/^m/i, 60_000], [/^h/i, 3_600_000], [/^d/i, 86_400_000]];
/** Thời gian hãng bảo chờ ("try again in 2 hours 14 minutes", "retry after 30s", "Retry-After: 30"), tính bằng ms; không nói thì null. */
export function retryAfterMs(message: string): number | null {
  const head = /retry-after:?\s*(\d+)\b/i.exec(message);
  if (head) return Number(head[1]) * 1000;
  const m = /(?:try again|retry(?:ing)?|wait|resets?)(?:\s+(?:after|in))?\s+(?:about\s+)?((?:\d+(?:\.\d+)?\s*(?:milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b[\s,]*(?:and\s+)?)+)/i.exec(message);
  if (!m) return null;
  let ms = 0;
  for (const [, n, u] of m[1].matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) ms += Number(n) * (UNIT.find(([re]) => re.test(u))?.[1] ?? 0);
  return ms || null;
}

export function classify(message: string, status?: number | null): ErrKind {
  if (status === 401 || status === 403) return "auth";
  const wait = retryAfterMs(message);
  if (wait !== null && wait <= SHORT_WAIT && (QUOTA.test(message) || RATE.test(message) || LIMIT_HIT.test(message) || status === 429 || status === 529)) return "rate";
  if (QUOTA.test(message)) return "quota";
  if (wait !== null && wait > SHORT_WAIT && (RATE.test(message) || LIMIT_HIT.test(message) || status === 429)) return "quota";
  if (RATE.test(message)) return "rate";
  if (LIMIT_HIT.test(message)) return "quota";
  if (status === 429 || status === 529) return "rate";
  if (AUTH.test(message) || AUTH_HTTP.test(message)) return "auth";
  return "other";
}

/** Lỗi thường gặp của CLI (tiếng Anh, thuật ngữ) → câu ngắn kèm việc người dùng làm được; không nhận ra thì null (chữ gốc vẫn nằm ở detail). */
export function friendlyError(message: string, name: string): string | null {
  if (/prompt is too long|context[ _-]?length|maximum context|too many tokens|input is too long|exceeds? [^\n]{0,40}context/i.test(message)) return "Đoạn chat đã quá dài với model này. Hãy nén đoạn chat, mở đoạn chat mới hoặc chọn model có ngữ cảnh lớn hơn.";
  if (/(unknown|invalid|unsupported) model|model[^\n]{0,40}(not found|not available|not supported|does not exist)|not_found_error/i.test(message)) return `Gói ${name} hiện không có model này. Hãy chọn model khác.`;
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network error|connection (error|reset|refused|closed)|stream disconnected/i.test(message)) return `Mất kết nối tới ${name}. Hãy thử lại sau ít phút.`;
  if (/internal server error|bad gateway|service unavailable|gateway time-?out|server_error|\bapi_error\b|\b50[0-4]\b/i.test(message)) return `${name} đang gặp sự cố phía hãng. Hãy thử lại sau ít phút hoặc chọn model khác.`;
  if (/E2BIG|argument list too long/i.test(message)) return "Tin nhắn quá dài để gửi cho model này. Hãy rút gọn hoặc mở đoạn chat mới.";
  return null;
}

// Che khóa và token trước khi ghi log hoặc gửi đoạn đầu ra của CLI về trình duyệt.
const SECRET = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,          // khóa API và token OAuth của Anthropic (sk-ant-api…, sk-ant-oat…)
  /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/g,    // khóa OpenAI
  /\bAIza[0-9A-Za-z_-]{20,}/g,          // khóa Google
  /\bxai-[A-Za-z0-9_-]{20,}/g,          // khóa xAI (Grok)
  /\bya29\.[0-9A-Za-z_-]{20,}/g,        // token OAuth của Google
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
  /((?:CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|XAI_API_KEY|DEEPSEEK_API_KEY)\s*[=:]\s*)\S+/g,
];
export function redact(s: string): string {
  let out = s;
  for (const re of SECRET) out = out.replace(re, (m, p1) => (typeof p1 === "string" && m.startsWith(p1) ? `${p1}[đã che]` : "[đã che]"));
  return out;
}
