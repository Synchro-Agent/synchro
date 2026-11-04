// Mục lục ô tìm của Cài đặt: tên từng dòng cài đặt theo tab, để gõ "tốc độ" hay "cookie" ra đúng dòng thay vì chỉ lọc tên tab.
// Tên viết đúng như trên giao diện (chữ gốc, tr dịch khi so và khi tìm dòng để cuộn tới). tests/api/settings-index.test.mjs đối chiếu với settings.tsx.
export const SETTINGS_INDEX: Record<string, string[]> = {
  General: ["Appearance", "Theme", "Chat font", "Transcript text size", "Motion", "Transcript width", "Voice", "Language", "Speed", "Notifications", "Response completions"],
  Administrator: ["Sign-in", "New sign-ups", "Model picker", "Default model", "Usage limits", "AI voice credit per day", "Access", "Users", "Audit log"],
  Account: ["Profile", "Profile photo", "Full name", "What should Synchro call you?", "Date of birth", "What best describes your work?", "Email", "Password", "Log out of all devices", "Delete your account", "Account ID", "Active sessions"],
  Privacy: ["Your data", "Export data", "Shared chats", "Uploaded files", "Your feedback", "Memory preferences", "Privacy policy", "Terms of Service"],
  Capabilities: ["Switch models when a message is flagged", "Artifacts", "AI-powered artifacts", "Inline visualizations", "Critic council", "Browser control", "Your browser", "Code execution and file creation", "Allow network egress", "Reach the whole public web", "Skills"],
  Brain: ["Long-term memory", "Generate memory from chats", "Include sensitive topics in memory", "Import memory from other AI providers"],
  "Synchro Code": ["Default mode", "Tech stack rules", "Classify session states", "Sync sessions across devices", "Allow auto mode", "Default permission mode", "Prompt suggestions", "Archive inactive sessions", "Output style", "Default transcript view", "Keep cookies", "Clear browsing data", "Ask before using new sites", "Allowed and blocked sites", "Branch prefix", "Create pull requests automatically", "Auto-fix pull requests", "Archive after merge or close", "Secret redaction", "Context window", "Editor theme", "Code font", "Code font size", "HTML and JavaScript", "Python", "Node.js", "Server runtime", "Code sessions"],
  Providers: ["How it works", "Other providers", "Test a model"],
};
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
/** Các dòng cài đặt khớp từ khóa, trong các tab người này mở được. names(x): các cách gọi của một dòng (chữ gốc và bản dịch). */
export function searchSettings(q: string, tabs: string[], names: (x: string) => string[], max = 12): { tab: string; name: string }[] {
  const k = fold(q.trim());
  if (k.length < 2) return [];
  const out: { tab: string; name: string }[] = [];
  for (const tab of tabs) for (const name of SETTINGS_INDEX[tab] ?? []) if (out.length < max && names(name).some((x) => fold(x).includes(k))) out.push({ tab, name });
  return out;
}
