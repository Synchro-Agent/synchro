// Danh mục model và tính năng dùng chung cho giao diện và máy chủ (phân quyền theo tài khoản).

export const MODEL_PROVIDERS: { id: string; name: string; models: string[] }[] = [
  { id: "claude", name: "Claude", models: ["Fable 5.1", "Opus 5.5", "Haiku 4.5"] },
  { id: "gemini", name: "Gemini", models: ["4 Argon", "3.1 Pro", "3.5 Flash"] },
  { id: "gpt", name: "ChatGPT", models: ["6 Astra", "6.1 Sol", "6 Luna"] },
];
export const ALL_MODELS = MODEL_PROVIDERS.flatMap((p) => p.models);
export const DEFAULT_MODEL = "Haiku 4.5";

// Model Claude trong danh sách → id gọi API Anthropic. Model khác dùng LLM_MODEL của máy chủ.
export const CLAUDE_API_IDS: Record<string, string> = { "Fable 5.1": "claude-fable-5-1", "Opus 5.5": "claude-opus-5-5", "Haiku 4.5": "claude-haiku-4-5" };

export const FEATURES = [
  { key: "code", label: "Synchro Code", desc: "Code workspace with file editing and previews." },
  { key: "speech", label: "Speech", desc: "Text to speech, transcription and voice tools (ElevenLabs)." },
  { key: "projects", label: "Projects", desc: "Projects with their own instructions, memory and context." },
  { key: "skills", label: "Skills", desc: "Upload skills and let the model use them." },
  { key: "files", label: "File uploads", desc: "Attach files and convert documents to text." },
  { key: "web", label: "Web search", desc: "Read web pages to answer questions." },
  { key: "sandbox", label: "Cloud sandbox", desc: "Run code on the server sandbox." },
] as const;
export type Feature = (typeof FEATURES)[number]["key"];

export type Perms = { models: string[]; features: Record<Feature, boolean> };
export const FULL_PERMS: Perms = { models: [...ALL_MODELS], features: Object.fromEntries(FEATURES.map((f) => [f.key, true])) as Record<Feature, boolean> };

// Chuẩn hóa dữ liệu quyền nhận từ client/DB: chỉ giữ model và tính năng có thật.
export function normPerms(p: unknown, base: Perms = FULL_PERMS): Perms {
  const o = (p && typeof p === "object" ? p : {}) as { models?: unknown; features?: Record<string, unknown> };
  const models = Array.isArray(o.models) ? ALL_MODELS.filter((m) => (o.models as unknown[]).includes(m)) : [...base.models];
  const features = { ...base.features };
  for (const f of FEATURES) if (typeof o.features?.[f.key] === "boolean") features[f.key] = o.features[f.key] as boolean;
  return { models, features };
}
