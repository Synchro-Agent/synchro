// Danh mục model và tính năng dùng chung cho giao diện và máy chủ (phân quyền theo tài khoản).
// Danh sách model thật lấy từ khóa API quản trị viên nhập ở Cài đặt → Providers (xem app/providers.ts),
// mỗi model định danh bằng khóa "nhà cung cấp/mã model", ví dụ "anthropic/claude-opus-5-5".

/** blockedUntil: riêng model này đang hết hạn mức tới lúc đó (các model khác của gói vẫn dùng được). */
export type ModelInfo = { key: string; id: string; name: string; blockedUntil?: number };
// Gói subscription của người dùng trong một nhóm hãng (bộ chọn model gộp gói và khóa API theo hãng, xem app/ai/subs.ts):
// blockedUntil: gói đang hết hạn mức tới lúc nào; usingApiUntil: người dùng đã đồng ý dùng khóa API thay gói tới lúc nào.
/** Gói tạo được ảnh bằng generate_image (ai/imagegen.ts): chip "Tạo ảnh" ở trang chủ, thẻ "chưa tạo được ảnh" trong khung chat. */
export const IMAGE_PLANS = new Set<string>(["agy", "grok", "codex"]);
export type PlanInfo = { cli: "claude" | "codex" | "agy" | "grok"; models: ModelInfo[]; blockedUntil: number | null; usingApiUntil: number | null; relogin: boolean; hasApi?: boolean };
/** source: nhóm đang hiện model của gói ("plan") hay của khóa API dùng chung ("api"). */
export type ProviderInfo = { id: string; name: string; kind: ProviderKind; models: ModelInfo[]; source?: "plan" | "api"; plan?: PlanInfo };
export type ProviderKind = "anthropic" | "openai" | "google" | "xai" | "deepseek" | "compatible" | "elevenlabs" | "mock";

// Quyền "*" = mọi model, kể cả model hãng mới ra sau này.
export const ALL = "*";
export const modelKey = (provider: string, id: string) => `${provider}/${id}`;
export const splitKey = (key: string) => { const i = key.indexOf("/"); return i < 0 ? { provider: "", id: key } : { provider: key.slice(0, i), id: key.slice(i + 1) }; };
export const allowsModel = (models: string[], key: string) => models.includes(ALL) || models.includes(key);

// Model tương đương giữa gói subscription và khóa API của cùng hãng ("sub-claude/sonnet" ↔ "anthropic/claude-sonnet-5-5",
// "sub-codex/gpt-6.1-sol" ↔ "openai/gpt-6.1-sol", "sub-agy/gemini-3-pro" ↔ "google/gemini-3-pro-preview", "sub-grok/grok-4.7" ↔ "xai/grok-4.7"):
// trùng mã, rồi mã chứa nhau, rồi cùng dòng model (opus, sonnet, pro, flash, build…). Danh sách ứng viên xếp mới nhất trước nên hòa điểm thì lấy bản mới nhất.
const FAMILY = /\b(fable|opus|sonnet|haiku|astra|sol|luna|mini|nano|pro|ultra|flash|lite|build|reasoning)\b/g;
export function equivalentModel(from: string, candidates: { key: string; id: string }[]): string | null {
  if (!candidates.length) return null;
  const id = (splitKey(from).id || from).toLowerCase();
  const fam = new Set(id.replace(/[-_.]/g, " ").match(FAMILY) ?? []);
  let best = candidates[0].key, score = 0;
  for (const c of candidates) {
    const cid = c.id.toLowerCase();
    const sc = cid === id ? 4 : id.length > 3 && (cid.startsWith(id) || cid.includes(id)) ? 3
      : [...(cid.replace(/[-_.]/g, " ").match(FAMILY) ?? [])].filter((f) => fam.has(f)).length > 0 ? 2 : 0;
    if (sc > score) { best = c.key; score = sc; }
  }
  return best;
}
/** Hãng (nhà cung cấp API tích hợp sẵn) của một khóa model: "sub-claude/…" → "anthropic", "sub-grok/…" → "xai", "openai/…" → "openai". */
export const vendorOf = (key: string) => {
  const p = splitKey(key).provider;
  return p === "sub-claude" ? "anthropic" : p === "sub-codex" ? "openai" : p === "sub-agy" ? "google" : p === "sub-grok" ? "xai" : p;
};

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
  { key: "chrome", label: "Your Chrome", desc: "Let Synchro work in the person's own Chrome, Edge or Brave through the Synchro extension, with the sites they are signed in to." },
] as const;
export type Feature = (typeof FEATURES)[number]["key"];

// Mức nỗ lực (độ sâu suy nghĩ) của model, từ thấp đến cao. Quản trị viên giới hạn mức cao nhất cho từng model trong Quyền truy cập.
export const EFFORTS = ["low", "medium", "high", "extra", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export const isEffort = (e: unknown): e is Effort => typeof e === "string" && (EFFORTS as readonly string[]).includes(e);
const rank = (e: Effort) => EFFORTS.indexOf(e);
// Gemini chỉ có thấp / trung bình / cao; Grok tới rất cao (xhigh = "extra"); DeepSeek có thấp / cao / tối đa; Claude và OpenAI có đủ năm mức.
export const effortsFor = (kind?: string): Effort[] =>
  kind === "google" ? ["low", "medium", "high"] : kind === "xai" ? ["low", "medium", "high", "extra"] : kind === "deepseek" ? ["low", "high", "max"] : [...EFFORTS];
// Mức cao nhất được phép: giới hạn riêng của model, không có thì giới hạn chung ("*"), không có nữa thì không giới hạn.
export const effortCap = (caps: Record<string, Effort> | undefined, model: string): Effort => caps?.[model] ?? caps?.[ALL] ?? "max";
// Hạ mức đã chọn xuống mức cao nhất mà giới hạn và model cho phép.
export function clampEffort(e: Effort, cap: Effort, kind?: string): Effort {
  const ok = effortsFor(kind).filter((x) => rank(x) <= rank(cap));
  return ok.includes(e) ? e : ok.filter((x) => rank(x) <= rank(e)).pop() ?? ok[0] ?? "low";
}

// Quyền connector do quản trị viên đặt: được thêm connector tùy chỉnh không, được kết nối connector nào trong danh mục ("*" là tất cả),
// được dùng công cụ có thể xóa dữ liệu không.
export type ConnPolicy = { custom: boolean; allowed: string[]; destructive: boolean };
export const FULL_CONN: ConnPolicy = { custom: true, allowed: [ALL], destructive: true };
export const connPolicy = (p: Perms): ConnPolicy => p.connectors ?? FULL_CONN;
export const allowsDir = (pol: ConnPolicy, dir: string | null) => (dir ? pol.allowed.includes(ALL) || pol.allowed.includes(dir) : pol.custom);

export type Perms = { models: string[]; features: Record<Feature, boolean>; effort?: Record<string, Effort>; connectors?: ConnPolicy };
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
  // Giới hạn mức nỗ lực: chỉ giữ khóa model hợp lệ; "max" là không giới hạn nên bỏ đi cho gọn.
  let effort = base.effort ? { ...base.effort } : undefined;
  const e = (o as { effort?: unknown }).effort;
  if (e && typeof e === "object") effort = Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([k, v]) => (k === ALL || (k.includes("/") && k.length < 200)) && isEffort(v) && v !== "max")) as Record<string, Effort>;
  let connectors = base.connectors ? { ...base.connectors } : undefined;
  const c = (o as { connectors?: unknown }).connectors as Partial<ConnPolicy> | undefined;
  if (c && typeof c === "object") {
    const cur = connectors ?? FULL_CONN;
    const allowed = Array.isArray(c.allowed) ? c.allowed.filter((x): x is string => typeof x === "string" && /^[a-z0-9*-]{1,40}$/.test(x)) : cur.allowed;
    connectors = { custom: typeof c.custom === "boolean" ? c.custom : cur.custom, allowed: allowed.includes(ALL) ? [ALL] : allowed, destructive: typeof c.destructive === "boolean" ? c.destructive : cur.destructive };
  }
  // Giữ cả {} (đã bỏ hết giới hạn) để quyền riêng của một người không rơi về giới hạn của quyền mặc định.
  return { models, features, ...(effort ? { effort } : {}), ...(connectors ? { connectors } : {}) };
}

// ---------------------------------------------------------------- Cài đặt → Khả năng (lưu trên máy chủ theo tài khoản)
// sw: không còn dùng (nút chưa từng có tác dụng nên đã gỡ), giữ khóa để dữ liệu cũ vẫn đọc được · art: Artifacts · ai: artifact gọi được model · inl: biểu đồ / sơ đồ ngay trong chat
// code: chạy code và tạo tệp (Skills cần bật) · net: khi chạy code được tải gói từ các kho thư viện bên dưới
// web: (cần net) code ra được mọi trang web công khai (tải ảnh, phông, dữ liệu, gọi API), không chỉ kho thư viện
// crit: hội đồng phản biện tự đọc lại code, trang web, ứng dụng vừa viết.
// browse: Synchro tự thao tác trên trình duyệt (mở trang, bấm, gõ, điền biểu mẫu) khi người dùng nhờ, với mọi model.
// mine: mặc định làm trên Chrome / Edge / Brave của chính người dùng (qua tiện ích Synchro) thay cho trình duyệt của Synchro.
export type Caps = { sw: boolean; art: boolean; ai: boolean; inl: boolean; code: boolean; net: boolean; web: boolean; crit: boolean; browse: boolean; mine: boolean };
export const DEFAULT_CAPS: Caps = { sw: true, art: true, ai: false, inl: true, code: true, net: true, web: true, crit: true, browse: true, mine: false };
export const CAP_KEYS = Object.keys(DEFAULT_CAPS) as (keyof Caps)[];
// Lý do một khả năng đang bị khóa: quản trị viên không cho (Cloud sandbox) hoặc máy chủ chưa có nơi chạy code.
export type CapLock = "admin" | "server";
// paired: đã ghép nối ít nhất một trình duyệt của người dùng (tiện ích Synchro).
export type CapsState = { caps: Caps; locks: Partial<Record<keyof Caps, CapLock>>; runner: "e2b" | "workspace" | "local" | null; paired?: boolean };

// Tên miền được phép khi bật "Cho phép truy cập mạng" (mọi tên miền con cũng được phép): kho thư viện, và đúng hai dịch vụ giọng đọc mà edge-tts / gTTS gọi
// (không có thì edge-tts báo SkewAdjustmentError "No server date in headers" vì proxy trả 403). Giữ giống PKG_HOSTS trong workspace/agent.mjs.
export const PKG_DOMAINS: { group: string; hosts: string[] }[] = [
  { group: "Python (pip)", hosts: ["pypi.org", "files.pythonhosted.org", "pythonhosted.org"] },
  { group: "JavaScript (npm, yarn)", hosts: ["registry.npmjs.org", "npmjs.org", "npmjs.com", "registry.yarnpkg.com", "yarnpkg.com"] },
  { group: "Rust (cargo)", hosts: ["crates.io", "index.crates.io", "static.crates.io"] },
  { group: "Go", hosts: ["proxy.golang.org", "sum.golang.org"] },
  { group: "Conda", hosts: ["conda.anaconda.org", "repo.anaconda.com"] },
  { group: "GitHub (packages, releases)", hosts: ["github.com", "codeload.github.com", "objects.githubusercontent.com"] },
  { group: "Linux (apt)", hosts: ["deb.debian.org", "security.debian.org", "archive.ubuntu.com", "security.ubuntu.com"] },
  { group: "Voice-over (edge-tts, gTTS)", hosts: ["speech.platform.bing.com", "translate.google.com"] },
];
export const PKG_HOSTS = PKG_DOMAINS.flatMap((g) => g.hosts);
export const pkgHostAllowed = (host: string) => {
  const h = host.toLowerCase().replace(/\.$/, "");
  return PKG_HOSTS.some((d) => h === d || h.endsWith("." + d));
};
