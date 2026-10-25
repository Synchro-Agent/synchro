// Danh mục model và tính năng dùng chung cho giao diện và máy chủ (phân quyền theo tài khoản).
// Danh sách model thật lấy từ khóa API nhập ở Cài đặt → API (xem app/providers.ts),
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
  { key: "connectors", label: "Connectors", desc: "Connect apps and services through MCP so the model can use their tools." },
  { key: "sandbox", label: "Cloud sandbox", desc: "Run code on the server sandbox." },
] as const;
export type Feature = (typeof FEATURES)[number]["key"];

// Mức nỗ lực (độ sâu suy nghĩ) của model, từ thấp đến cao.
export const EFFORTS = ["low", "medium", "high", "extra", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export const isEffort = (e: unknown): e is Effort => typeof e === "string" && (EFFORTS as readonly string[]).includes(e);
const rank = (e: Effort) => EFFORTS.indexOf(e);
// Gemini chỉ có thấp / trung bình / cao; Claude và OpenAI có đủ năm mức.
export const effortsFor = (kind?: string): Effort[] => (kind === "google" ? ["low", "medium", "high"] : [...EFFORTS]);
// Mức cao nhất được phép: giới hạn riêng của model, không có thì giới hạn chung ("*"), không có nữa thì không giới hạn.
export const effortCap = (caps: Record<string, Effort> | undefined, model: string): Effort => caps?.[model] ?? caps?.[ALL] ?? "max";
// Hạ mức đã chọn xuống mức cao nhất mà giới hạn và model cho phép.
export function clampEffort(e: Effort, cap: Effort, kind?: string): Effort {
  const ok = effortsFor(kind).filter((x) => rank(x) <= rank(cap));
  return ok.includes(e) ? e : ok.filter((x) => rank(x) <= rank(e)).pop() ?? ok[0] ?? "low";
}

// Web cá nhân: chủ sở hữu dùng được mọi model và mọi tính năng (giữ kiểu này để các chỗ gọi cũ không phải đổi).
export type Perms = { models: string[]; features: Record<Feature, boolean>; effort?: Record<string, Effort> };
export const FULL_PERMS: Perms = { models: [ALL], features: Object.fromEntries(FEATURES.map((f) => [f.key, true])) as Record<Feature, boolean> };

// ---------------------------------------------------------------- Cài đặt → Khả năng (lưu trên máy chủ theo tài khoản)
// sw: đổi model khi tin nhắn bị gắn cờ · art: Artifacts · ai: artifact gọi được model · inl: biểu đồ / sơ đồ ngay trong chat
// code: chạy code và tạo tệp (Skills cần bật) · net: khi chạy code được tải gói từ các kho thư viện bên dưới.
export type Caps = { sw: boolean; art: boolean; ai: boolean; inl: boolean; code: boolean; net: boolean };
export const DEFAULT_CAPS: Caps = { sw: true, art: true, ai: false, inl: true, code: true, net: false };
export const CAP_KEYS = Object.keys(DEFAULT_CAPS) as (keyof Caps)[];
// Lý do một khả năng đang bị khóa: máy chủ chưa có nơi chạy code.
export type CapLock = "server";
export type CapsState = { caps: Caps; locks: Partial<Record<keyof Caps, CapLock>>; runner: "e2b" | "workspace" | "local" | null };

// Tên miền kho thư viện được phép khi bật "Cho phép truy cập mạng" (mọi tên miền con cũng được phép).
export const PKG_DOMAINS: { group: string; hosts: string[] }[] = [
  { group: "Python (pip)", hosts: ["pypi.org", "files.pythonhosted.org", "pythonhosted.org"] },
  { group: "JavaScript (npm, yarn)", hosts: ["registry.npmjs.org", "npmjs.org", "npmjs.com", "registry.yarnpkg.com", "yarnpkg.com"] },
  { group: "Rust (cargo)", hosts: ["crates.io", "index.crates.io", "static.crates.io"] },
  { group: "Go", hosts: ["proxy.golang.org", "sum.golang.org"] },
  { group: "Conda", hosts: ["conda.anaconda.org", "repo.anaconda.com"] },
  { group: "GitHub (packages, releases)", hosts: ["github.com", "codeload.github.com", "objects.githubusercontent.com"] },
  { group: "Linux (apt)", hosts: ["deb.debian.org", "security.debian.org", "archive.ubuntu.com", "security.ubuntu.com"] },
];
export const PKG_HOSTS = PKG_DOMAINS.flatMap((g) => g.hosts);
export const pkgHostAllowed = (host: string) => {
  const h = host.toLowerCase().replace(/\.$/, "");
  return PKG_HOSTS.some((d) => h === d || h.endsWith("." + d));
};
