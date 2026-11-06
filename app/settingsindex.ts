// Ô tìm trong Cài đặt: tên từng dòng cài đặt theo mục, để gõ "mật khẩu" ra đúng chỗ thay vì danh sách trống. Tên dòng viết như chữ gốc trong settings.tsx
// (tests/api/settings-index.test.mjs đối chiếu); từ khóa thêm cho những việc người dùng hay gọi tên khác.
export const SETTINGS_INDEX: Record<string, { rows: string[]; also?: string[] }> = {
  General: { rows: ["Theme", "Chat font", "Transcript text size", "Motion", "Transcript width", "Language", "Voice", "Speed", "Response completions"], also: ["dark mode", "giao diện tối", "ngôn ngữ", "phông chữ", "thông báo", "giọng nói", "notifications"] },
  Account: { rows: ["Profile photo", "Full name", "What should Synchro call you?", "Date of birth", "What best describes your work?", "Email", "Sign-in methods", "Password", "Log out of all devices", "Delete your account", "Account ID"], also: ["mật khẩu", "quên mật khẩu", "forgot password", "đăng xuất", "ảnh đại diện", "xóa tài khoản", "phiên đăng nhập", "active sessions"] },
  Privacy: { rows: ["Export data", "Download everything on the server", "Shared chats", "Uploaded files", "Your feedback", "Memory preferences", "Privacy policy", "Terms of Service"], also: ["xuất dữ liệu", "chia sẻ", "tệp đã tải lên", "điều khoản"] },
  Capabilities: { rows: ["Artifacts", "AI-powered artifacts", "Inline visualizations", "Critic council", "Browser control", "Your browser", "Code execution and file creation", "Allow network egress", "Reach the whole public web"], also: ["biểu đồ", "trình duyệt", "chạy code", "hội đồng phản biện"] },
  Usage: { rows: [], also: ["mức dùng", "hạn mức", "giới hạn", "limits", "token"] },
  Brain: { rows: ["Generate memory from chats", "Include sensitive topics in memory", "Import memory from other AI providers"], also: ["bộ nhớ", "bộ não", "memory", "ký ức"] },
  "Synchro Code": { rows: ["Default mode", "Tech stack rules", "Classify session states", "Sync sessions across devices", "Allow auto mode", "Default permission mode", "Prompt suggestions", "Archive inactive sessions", "Output style", "Default transcript view", "Keep cookies", "Clear browsing data", "Ask before using new sites", "Allowed and blocked sites", "Branch prefix", "Create pull requests automatically", "Auto-fix pull requests", "Archive after merge or close", "Secret redaction", "Context window", "Editor theme", "Code font", "Code font size", "HTML and JavaScript", "Python", "Node.js", "Server runtime", "Code sessions"], also: ["terminal", "pull request", "đồng bộ phiên"] },
  Providers: { rows: [], also: ["Claude", "ChatGPT", "Gemini", "Grok", "gói", "plan", "đăng nhập gói", "khóa API", "API key", "model"] },
  "Skill Hub": { rows: [], also: ["skill", "kỹ năng", "thư viện", "plugin", "library"] },
  Connectors: { rows: [], also: ["connector", "kết nối", "MCP"] },
  Administrator: { rows: ["Sign-in", "New sign-ups", "Model picker", "Default model", "Usage limits", "AI voice credit per day", "Access", "Users", "Audit log"], also: ["quản trị", "người dùng", "users", "admin"] },
};

const folded = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Dòng cài đặt khớp từ khóa: so với chữ gốc, chữ đang hiện (lb: dịch theo ngôn ngữ giao diện) và từ khóa thêm, không cần gõ dấu. Trả về mỗi mục các dòng khớp; khớp tên mục hay từ khóa của mục thì rows rỗng. */
export function searchSettings(q: string, tabs: string[], lb: (s: string) => string): { tab: string; rows: string[] }[] {
  const w = folded(q.trim());
  if (!w) return tabs.map((tab) => ({ tab, rows: [] }));
  const hit = (s: string) => folded(s).includes(w) || folded(lb(s)).includes(w);
  return tabs.flatMap((tab) => {
    const x = SETTINGS_INDEX[tab];
    const rows = (x?.rows ?? []).filter(hit);
    return rows.length || hit(tab) || x?.also?.some(hit) ? [{ tab, rows }] : [];
  });
}
