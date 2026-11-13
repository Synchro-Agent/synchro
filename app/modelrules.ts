// Luật chung để hiểu một mã model của bất kỳ hãng nào, không cần sửa tay mỗi khi hãng ra model mới (dùng cả ở máy chủ lẫn trình duyệt):
//  - dòng model (family) và số phiên bản so sánh theo số: "claude-opus-6" > "claude-opus-5-5", "gpt-7-sol" > "gpt-6.1-sol", "gemini-4.5-pro" > "gemini-3.1-pro-preview";
//  - bản chụp có ngày ("claude-haiku-4-5-20251001", "gpt-4o-2024-08-06"), bản -preview / -latest được nhận ra để không coi là dòng khác;
//  - model không dùng để nhắn tin (embedding, giọng nói, ảnh, video, realtime, kiểm duyệt…) bị loại theo chữ trong mã;
//  - hạng (nhanh / cân bằng / mạnh / mạnh nhất) theo chữ chỉ hạng trong mã, so khớp theo từng chữ ("gemini" không còn bị coi là "mini").
// Thông tin hãng tự báo (ngày ra mắt, khả năng, giới hạn token) luôn được ưu tiên hơn các luật này; luật chỉ là phương án dự phòng.

export type Tier = "fast" | "balanced" | "strong";

/** Phân tích một mã model. family: dòng model không kèm số phiên bản; version: các số của phiên bản để so sánh. */
export type Parsed = { id: string; family: string; version: number[]; date: string | null; preview: boolean; alias: boolean };

const DATE_TAIL = /[-@](\d{8}|\d{4}-\d{2}-\d{2})$/;
// Hậu tố 4 chữ số kiểu cũ của OpenAI ("gpt-4-0613"), xAI ("grok-2-1212"): cũng là bản chụp.
const MMDD_TAIL = /-(0\d{3}|1[0-2]\d{2})$/;
const TAGS = new Set(["preview", "exp", "experimental", "latest", "beta", "alpha"]);

export function parseId(raw: string): Parsed {
  const id = raw.toLowerCase().replace(/^models\//, "").split("/").pop()!;
  let base = id, date: string | null = null;
  const dm = DATE_TAIL.exec(base) ?? MMDD_TAIL.exec(base);
  if (dm) { date = dm[1]; base = base.slice(0, dm.index); }
  const words: string[] = [];
  let version: number[] = [], done = false, preview = false, latest = false;
  for (const tok of base.split(/[-_]/).filter(Boolean)) {
    if (TAGS.has(tok)) { if (tok === "latest") latest = true; else preview = true; continue; }
    // Số phiên bản: "5", "6.1", "4o" (GPT-4o), "v4" (DeepSeek V4), "o3" (dòng o của OpenAI).
    const num = /^v?(\d{1,3}(?:\.\d{1,3})*)(o?)$/.exec(tok);
    const oser = /^([a-z])(\d{1,2})$/.exec(tok);
    // Số sau phần tên ("gemini-2.0-flash-001", "grok-4.20-0309-…") là số bản sửa hoặc ngày, không phải phiên bản và không phải tên dòng.
    if ((num && done) || /^0\d{3}$/.test(tok)) { if (version.length) done = true; continue; }
    if (num) {
      version.push(...num[1].split(".").map(Number));
      if (num[2]) words.push(num[2]);
      continue;
    }
    if (oser && !done && !version.length && !words.length) { words.push(oser[1]); version = [Number(oser[2])]; done = true; continue; }
    if (version.length) done = true;
    words.push(tok);
  }
  return { id, family: words.join("-") || id, version, date, preview, alias: latest && !version.length };
}
/** Phiên bản dạng số thập phân (4.20 → 4.2) để so với một ngưỡng như "Grok 4.5 trở lên". */
export const versionNum = (v: number[]) => (v.length ? Number(`${v[0]}.${v.slice(1).join("") || 0}`) : 0);
/**
 * So sánh hai phiên bản: số chính theo số (grok-10 > grok-9.5), phần sau dấu chấm theo số thập phân như versionNum (grok-4.20 là 4.2,
 * cũ hơn grok-4.5), bằng nhau thì so từng phần: [6] > [5,5], [6,1] > [6], [4,5] > [4].
 */
export function versionCmp(a: number[], b: number[]): number {
  const major = (a[0] ?? 0) - (b[0] ?? 0);
  if (major) return major;
  const dec = versionNum(a) - versionNum(b);
  if (dec) return dec;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
export const versionText = (v: number[]) => v.join(".");

// ---------------------------------------------------------------- model nhắn tin hay không
// Chữ chỉ loại model không dùng để nhắn tin, so theo từng chữ trong mã (mã có "image" nhưng là model chat thì hãng vẫn báo qua phương thức, xem isChatModel).
const NON_CHAT_WORDS = new Set(["embed", "embedding", "embeddings", "tts", "whisper", "transcribe", "transcription", "audio", "realtime", "live", "translate",
  "image", "images", "imagen", "imagine", "dall", "sora", "veo", "video", "moderation", "rerank", "reranker", "guard", "robotics", "aqa", "lyria", "music",
  "speech", "voice", "native", "computer", "search", "research", "learnlm"]);
// Nhà cung cấp tương thích OpenAI (OpenRouter, Together, Ollama…): chỉ loại loại chắc chắn không nhắn tin được. Model chat có chữ "search",
// "research", "omni", "audio" ("perplexity/sonar-deep-research", "openai/gpt-4o-search-preview", "qwen/qwen2.5-omni-7b") vẫn hiện như trước.
const NON_CHAT_STRICT = new Set(["embed", "embedding", "embeddings", "tts", "whisper", "transcribe", "transcription", "moderation", "rerank", "reranker",
  "imagen", "dall", "sora", "veo", "lyria"]);
/** Mã model không dùng để nhắn tin theo luật chung (loại thêm sau bộ lọc riêng của từng hãng). loose: nhà cung cấp tương thích, chỉ loại loại chắc chắn. */
export function nonChat(id: string, o: { loose?: boolean } = {}): boolean {
  const toks = id.toLowerCase().replace(/^models\//, "").split(/[-_./]/);
  if (o.loose) return toks.some((t) => NON_CHAT_STRICT.has(t)) || /(^|[-/])omni-moderation/.test(id.toLowerCase());
  return toks.some((t) => NON_CHAT_WORDS.has(t)) || /(^|-)omni-(moderation|\d)/.test(id.toLowerCase());
}
/** Bản chụp có ngày trùng một tên chung đang có trong danh sách ("gpt-4o-2024-08-06" khi đã có "gpt-4o"): bỏ, tên chung luôn trỏ tới bản mới nhất. */
export function datedDuplicate(id: string, all: Set<string>): boolean {
  const p = parseId(id);
  if (!p.date) return false;
  const base = id.toLowerCase().replace(DATE_TAIL, "").replace(MMDD_TAIL, "");
  return base !== id.toLowerCase() && all.has(base);
}

// ---------------------------------------------------------------- hạng model
// Model mã nguồn mở chạy qua gói (GPT-OSS, Llama, Qwen, Mistral…): hạng nhanh, không mang thế mạnh của hãng lớn.
export const OPEN_WEIGHT = /(gpt-oss|llama|qwen|mistral|mixtral|gemma|phi-\d)/i;
const FAST_WORDS = new Set(["haiku", "flash", "lite", "mini", "nano", "luna", "small", "tiny", "micro", "instant", "fast"]);
const STRONG_WORDS = new Set(["opus", "fable", "mythos", "astra", "argon", "ultra", "pro", "max"]);
const FRONTIER_WORDS = new Set(["fable", "mythos", "astra", "argon", "ultra"]);
// Dòng chính không có chữ chỉ hạng nhưng từ một phiên bản trở lên là hạng mạnh nhất của hãng (so theo số, nên Grok 10 vẫn là hạng mạnh).
// Grok: cả bản -reasoning / -non-reasoning / -multi-agent ("grok-4.5-reasoning"); bản "-fast" / "-mini" là hạng nhanh (khớp chữ chỉ hạng trước).
const STRONG_FROM: { family: RegExp; from: number }[] = [{ family: /^grok(-(reasoning|non-reasoning|multi-agent))?$/, from: 4.5 }];
const words = (key: string) => key.toLowerCase().split("/").pop()!.split(/[-_./\s]/).filter(Boolean);
export function tierOf(key: string): Tier {
  const w = words(key);
  if (w.some((x) => STRONG_WORDS.has(x))) return "strong";
  if (OPEN_WEIGHT.test(key) || w.some((x) => FAST_WORDS.has(x))) return "fast";
  const p = parseId(key);
  if (STRONG_FROM.some((r) => r.family.test(p.family) && p.version.length && versionNum(p.version) >= r.from)) return "strong";
  return "balanced";
}
export const isFrontier = (key: string) => tierOf(key) === "strong" && words(key).some((x) => FRONTIER_WORDS.has(x));

// Model chỉ dùng để viết code (không hợp cho việc chung): tên dòng chứa build / codex / coder / code-. Xét phần tên model
// sau dấu "/" (như words / tierOf), nên tiền tố gói "sub-codex/" KHÔNG bị tính — đó là gói ChatGPT bao model chung (gpt-6.1-sol…).
// Thay cho regex CODE_ONLY cũ trong router chỉ bắt grok-build; giờ bắt thêm codex / coder và các dòng "…-code-…".
const CODE_ONLY_RE = /(?:^|[-_])(?:build|codex|coder)(?:[-_]|$)|(?:^|[-_])code-/;
export const codeOnly = (key: string): boolean => CODE_ONLY_RE.test(key.toLowerCase().split("/").pop() ?? "");

/**
 * Dòng model của một mã model kèm tên hãng gốc khi mã có dạng "hãng/model" (nhà cung cấp chứa model của nhiều hãng kiểu OpenRouter):
 * "deepseek/deepseek-v4-pro" → "deepseek/deepseek-pro", nên "randomuser/deepseek-v9-pro" hay "x/claude-opus-99" là dòng khác, không thay được model chính chủ.
 */
export const modelFamily = (id: string) => { const parts = id.toLowerCase().replace(/^models\//, "").split("/"); parts.pop(); return `${parts.length ? `${parts.join("/")}/` : ""}${parseId(id).family}`; };
/** Khóa dòng model để so model cùng dòng ("anthropic/claude-opus-6" và "anthropic/claude-opus-5-5" cùng dòng "anthropic/claude-opus"). */
export const familyKey = (key: string) => { const i = key.indexOf("/"); return `${i < 0 ? "" : key.slice(0, i)}/${modelFamily(i < 0 ? key : key.slice(i + 1))}`; };
/**
 * Model có bản mới hơn cùng dòng trong danh sách: chế độ Tự động ưu tiên bản mới nhất của dòng, bản cũ vẫn là dự phòng.
 * created: ngày ra mắt hãng báo (nếu có) để so khi hai model không có số phiên bản.
 */
export function supersededSet(keys: string[], created: (k: string) => number | null = () => null): Set<string> {
  const by = new Map<string, string[]>();
  for (const k of keys) { const f = familyKey(k); by.set(f, [...(by.get(f) ?? []), k]); }
  const out = new Set<string>();
  for (const ks of by.values()) {
    if (ks.length < 2) continue;
    const best = newestOf(ks, created);
    for (const k of ks) if (k !== best && compareModels(k, best, created) < 0) out.add(k);
  }
  return out;
}
/** So hai model cùng dòng: phiên bản, rồi ngày hãng báo, rồi bản chính thức hơn bản -preview. */
export function compareModels(a: string, b: string, created: (k: string) => number | null = () => null): number {
  const pa = parseId(a), pb = parseId(b);
  return versionCmp(pa.version, pb.version) || ((created(a) ?? 0) - (created(b) ?? 0)) || Number(pb.preview) - Number(pa.preview) || Number(!!pb.date) - Number(!!pa.date);
}
export const newestOf = (keys: string[], created: (k: string) => number | null = () => null) => keys.reduce((best, k) => (compareModels(k, best, created) > 0 ? k : best), keys[0]);

// ---------------------------------------------------------------- lỗi hãng báo model không nhận ảnh
const VISION_NO = /((does ?n[o']t|do ?n[o']t|not|no longer|cannot|can't) (support|accept|take|handle)s?(ed)?\b[^.]{0,40}\b(image|vision|multimodal|multi-modal)|\b(image|vision|multimodal)[\w ]{0,30}\b(input )?(is |are )?(not supported|unsupported|not enabled|not available)|\bonly supports? text|\btext[- ]only (model|input)|unsupported (input )?modalit|modalit(y|ies)[^.]{0,30}not supported|image_url[^.]{0,30}only supported by)/i;
const IMAGE_BAD = /format|size|too (large|big)|exceed|corrupt|decode|malformed|invalid (image|base64)|unable to process|could not process|failed to (fetch|download|load)|dimension|resolution|pixels/i;
/**
 * Hãng báo model không nhận ảnh ("does not support image input", "Image input modality is not enabled…"), khác với ảnh hỏng, quá lớn,
 * sai định dạng ("Unable to process input image", "Image size exceeds limit"). Chỉ lỗi này mới được ghi nhớ thành "model chỉ đọc chữ".
 */
export const visionUnsupported = (msg: string) => VISION_NO.test(msg) && !IMAGE_BAD.test(msg);

// ---------------------------------------------------------------- tham số theo dòng model
/** Công cụ tìm web của Anthropic: bản lọc động (20260209) cho Fable / Mythos và Opus / Sonnet từ 4.6 trở lên (kể cả bản ra sau này). */
export function anthropicWebSearch(id: string): "web_search_20260209" | "web_search_20250305" {
  const p = parseId(id);
  if (/(^|-)(fable|mythos)(-|$)/.test(p.family)) return "web_search_20260209";
  if (/(^|-)(opus|sonnet)(-|$)/.test(p.family) && versionCmp(p.version, [4, 6]) >= 0) return "web_search_20260209";
  return "web_search_20250305";
}
/** Giá trên mức này (USD / 1 triệu token) chắc chắn là đọc sai đơn vị: không dùng. */
const PRICE_MAX = 1000;
/**
 * Giá mà hãng tự báo trong danh sách model → USD / 1 triệu token. Hai kiểu đơn vị:
 *  - OpenRouter: pricing.prompt / pricing.completion / pricing.input_cache_read tính theo từng token (dạng chuỗi, "0.000002");
 *  - Together: pricing.input / pricing.output đã tính theo 1 triệu token (dạng số, 0.88).
 * Không có, không đọc được hoặc vô lý (quá PRICE_MAX) thì null (không bao giờ trả giá 0).
 */
export function providerPrice(m: unknown): { in: number; out: number; cache: number } | null {
  const p = (m as { pricing?: Record<string, unknown> } | null)?.pricing;
  if (!p || typeof p !== "object") return null;
  const perToken = p.prompt !== undefined || p.completion !== undefined;
  const n = (v: unknown) => {
    const x = (typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN) * (perToken ? 1e6 : 1);
    return isFinite(x) && x > 0 && x <= PRICE_MAX ? Math.round(x * 10000) / 10000 : null;
  };
  const i = n(perToken ? p.prompt : p.input), o = n(perToken ? p.completion : p.output);
  if (i === null || o === null) return null;
  return { in: i, out: o, cache: n(perToken ? p.input_cache_read : p.cached_input ?? p.cache_read) ?? Math.round(i * 1000) / 10000 };
}
