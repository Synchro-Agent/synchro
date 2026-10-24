// Danh mục model và tính năng dùng chung cho giao diện và máy chủ (phân quyền theo tài khoản).
// Danh sách model thật lấy từ khóa API quản trị viên nhập ở Cài đặt → API (xem app/providers.ts),
// mỗi model định danh bằng khóa "nhà cung cấp/mã model", ví dụ "anthropic/claude-opus-5-5".

export type ModelInfo = { key: string; id: string; name: string };
export type ProviderInfo = { id: string; name: string; kind: ProviderKind; models: ModelInfo[] };
export type ProviderKind = "anthropic" | "openai" | "google" | "compatible" | "elevenlabs" | "mock";

// Quyền "*" = mọi model, kể cả model hãng mới ra sau này.
export const ALL = "*";
export const modelKey = (provider: string, id: string) => `${provider}/${id}`;
export const splitKey = (key: string) => { const i = key.indexOf("/"); return i < 0 ? { provider: "", id: key } : { provider: key.slice(0, i), id: key.slice(i + 1) }; };
export const allowsModel = (models: string[], key: string) => models.includes(ALL) || models.includes(key);

// Tên model ở bản cũ (trước khi có danh sách thật) → khóa mới, để quyền đã lưu không mất hiệu lực.
const LEGACY: Record<string, string | null> = {
  "Fable 5.1": "anthropic/claude-fable-5-1", "Opus 5.5": "anthropic/claude-opus-5-5", "Haiku 4.5": "anthropic/claude-haiku-4-5",
  "4 Argon": null, "3.1 Pro": null, "3.5 Flash": null, "6 Astra": null, "6.1 Sol": null, "6 Luna": null,
};
export const legacyModel = (m: string) => (m in LEGACY ? LEGACY[m] : m);

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
export const FULL_PERMS: Perms = { models: [ALL], features: Object.fromEntries(FEATURES.map((f) => [f.key, true])) as Record<Feature, boolean> };

// Chuẩn hóa dữ liệu quyền nhận từ client/DB. Bản cũ cho phép đủ 9 model mẫu nghĩa là "tất cả" → "*".
export function normPerms(p: unknown, base: Perms = FULL_PERMS): Perms {
  const o = (p && typeof p === "object" ? p : {}) as { models?: unknown; features?: Record<string, unknown> };
  let models = [...base.models];
  if (Array.isArray(o.models)) {
    const raw = (o.models as unknown[]).filter((m): m is string => typeof m === "string" && m.length > 0 && m.length < 200);
    const legacyAll = Object.keys(LEGACY).every((m) => raw.includes(m));
    models = legacyAll || raw.includes(ALL) ? [ALL] : [...new Set(raw.map(legacyModel).filter((m): m is string => !!m && (m === ALL || m.includes("/"))))];
  }
  const features = { ...base.features };
  for (const f of FEATURES) if (typeof o.features?.[f.key] === "boolean") features[f.key] = o.features[f.key] as boolean;
  return { models, features };
}
