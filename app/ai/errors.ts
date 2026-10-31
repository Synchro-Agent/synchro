// Phân loại lỗi của engine: quota (hết hạn mức, bị giới hạn tốc độ), auth (chưa đăng nhập, phiên hết hạn, 401/403), other.
// Engine chuyển sang khóa API dự phòng khi gặp quota; gặp auth thì báo người dùng đăng nhập lại.

export type ErrKind = "quota" | "auth" | "other";

const QUOTA = /usage[ _-]?limit|rate[ _-]?limit|quota|resource[ _-]?exhausted|limit (reached|exceeded)|hit your (usage )?limit|too many requests|subscription_sharing_usage_limit|credit balance (is )?too low|insufficient[ _-]?(quota|balance)|out of credits?|try again (at|after|in)/i;
const AUTH = /\b40[13]\b|unauthori[sz]ed|forbidden|not logged in|not authenticated|run `?grok login|log ?in (again|required|expired)|please (run )?\/?login|login (expired|required)|authentication[ _-]?(failed|required|error)|invalid (api[ _-]?key|token|credentials?)|oauth (token )?(expired|revoked|invalid)|token (has )?(expired|been revoked)|credentials? (expired|missing)|account (disabled|on hold|suspended)|not_eligible/i;

export function classify(message: string, status?: number | null): ErrKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "quota";
  if (QUOTA.test(message)) return "quota";
  if (AUTH.test(message)) return "auth";
  return "other";
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
