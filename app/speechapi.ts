// Speech (ElevenLabs) phía máy chủ: gọi API thật bằng khóa ở Cài đặt → Providers (khóa không bao giờ rời máy chủ),
// đọc gói đăng ký để bật / tắt từng tính năng, và lưu sản phẩm (âm thanh, bản chép lời) riêng cho từng người.
// Tính năng của gói cao hơn vẫn nằm trong mã; chỉ hiện khi gói quét được cho phép.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, db, getSetting, setSetting, type UserRow } from "./authstore";
import { elevenMissing, serviceKey } from "./providers";

export class SpeechErr extends Error {
  constructor(msg: string, public status = 400, public code?: string) { super(msg); }
}

const conn = () => {
  const k = serviceKey("elevenlabs");
  if (!k) throw new SpeechErr("Chưa gắn khóa ElevenLabs. Quản trị viên vào Cài đặt → Providers để thêm khóa.", 503, "no_key");
  return k;
};
export const hasKey = () => !!serviceKey("elevenlabs");

// ---- tính năng và gói ----
export const FEATS = ["tts", "dialogue", "stt", "live", "agent", "sfx", "isolate", "changer", "align", "music", "design", "remix", "ivc", "pvc", "dub", "dubClean", "podcast", "book"] as const;
export type Feat = (typeof FEATS)[number];
// Gói thấp nhất có tính năng (bảng giá API của ElevenLabs, 10/2026). Nhân bản dùng cờ của chính gói; Studio cần được ElevenLabs duyệt riêng.
const TIERS = ["free", "starter", "creator", "pro", "scale", "business", "enterprise"];
const MIN: Record<Feat, string> = {
  tts: "free", dialogue: "free", stt: "free", live: "free", agent: "free", sfx: "free", isolate: "free", changer: "free", align: "free", music: "free",
  design: "free", remix: "free", ivc: "starter", pvc: "creator", dub: "free", dubClean: "starter", podcast: "free", book: "free",
};
const tierRank = (t: string) => {
  const s = t.toLowerCase();
  if (s.includes("enterprise")) return 6;
  if (s.includes("business")) return 5;
  const i = TIERS.indexOf(s);
  return i >= 0 ? i : 2; // gói chưa biết tên (gói mới, dùng thử…): coi như gói trả phí phổ thông, cờ của gói vẫn quyết định nhân bản
};
export const TIER_NAME: Record<string, string> = { free: "Free", starter: "Starter", creator: "Creator", pro: "Pro", scale: "Scale", business: "Business", enterprise: "Enterprise" };
// Định dạng tải xuống theo gói: MP3 192 kbps từ Creator, PCM / WAV 44,1 kHz trở lên từ Pro (theo mô tả output_format của API).
export const FORMATS: { id: string; label: string; min: string; ext: string; mime: string }[] = [
  { id: "mp3_44100_128", label: "MP3 44,1 kHz · 128 kbps", min: "free", ext: "mp3", mime: "audio/mpeg" },
  { id: "mp3_44100_192", label: "MP3 44,1 kHz · 192 kbps", min: "creator", ext: "mp3", mime: "audio/mpeg" },
  { id: "mp3_22050_32", label: "MP3 22 kHz · 32 kbps (nhẹ)", min: "free", ext: "mp3", mime: "audio/mpeg" },
  { id: "opus_48000_128", label: "Opus 48 kHz · 128 kbps", min: "free", ext: "opus", mime: "audio/ogg" },
  { id: "wav_24000", label: "WAV 24 kHz", min: "free", ext: "wav", mime: "audio/wav" },
  { id: "wav_44100", label: "WAV 44,1 kHz", min: "pro", ext: "wav", mime: "audio/wav" },
  { id: "pcm_44100", label: "PCM 44,1 kHz (thô)", min: "pro", ext: "pcm", mime: "application/octet-stream" },
  { id: "ulaw_8000", label: "μ-law 8 kHz (điện thoại)", min: "free", ext: "ulaw", mime: "application/octet-stream" },
];
export const fmtOf = (id: string) => FORMATS.find((f) => f.id === id) ?? FORMATS[0];

export type ModelOut = { id: string; name: string; desc: string; langs: { id: string; name: string }[]; max: number; rate: number; style: boolean; boost: boolean };
export type Plan = {
  connected: boolean; readPlan: boolean; tier: string; tierName: string; status: string;
  credits: { used: number; limit: number; resetAt: number | null };
  voices: { used: number; limit: number }; pro: { used: number; limit: number };
  features: Record<Feat, boolean>; locked: Partial<Record<Feat, string>>;
  formats: { id: string; label: string }[]; tts: ModelOut[]; sts: ModelOut[];
  note: string | null; checkedAt: number;
};

// Tính năng ElevenLabs từ chối vì gói (không phải vì khóa thiếu quyền hay hết credit): nhớ theo gói, đổi gói thì quét lại từ đầu.
type Locks = { tier: string; locks: Partial<Record<Feat, string>> };
const readLocks = (): Locks => { try { return JSON.parse(getSetting("speech_locks", "{}")) as Locks; } catch { return { tier: "", locks: {} }; } };
function lock(f: Feat, msg: string) {
  const p = G().plan, l = readLocks(), cur = p?.tier ?? l.tier ?? "";
  const locks = l.tier === cur ? { ...l.locks } : {};
  locks[f] = msg.slice(0, 200);
  setSetting("speech_locks", JSON.stringify({ tier: cur, locks }));
  if (p) { p.features[f] = false; p.locked[f] = locks[f]; }
}

const g = globalThis as unknown as { __speech?: { plan: Plan | null; at: number; busy: Promise<Plan> | null } };
const G = () => (g.__speech ??= { plan: null, at: 0, busy: null });

// ---- gọi API ----
type Detail = { status?: string; message?: string } | string | undefined;
const detailOf = (text: string): { status: string; message: string } => {
  try {
    const j = JSON.parse(text) as { detail?: Detail | { msg?: string }[]; message?: string; error?: string };
    const d = j.detail;
    if (Array.isArray(d)) return { status: "invalid", message: d.map((x) => x.msg).filter(Boolean).join("; ") };
    if (typeof d === "string") return { status: "", message: d };
    if (d) return { status: d.status ?? "", message: d.message ?? "" };
    return { status: "", message: j.message ?? j.error ?? "" };
  } catch { return { status: "", message: text.slice(0, 200) }; }
};
const PLAN_RE = /upgrade|subscription|subscribe|your (plan|tier)|free (tier|users?|plan)|whitelist|not available (on|for) (your|the)|requires? (a )?(paid|higher|creator|pro|starter)/i;
const QUOTA_RE = /quota|credits?|character limit|exceed(s|ed)? your/i;

/** Đổi lỗi của ElevenLabs thành câu dễ hiểu; lỗi do gói thì nhớ để ẩn tính năng. */
export function explain(status: number, text: string, feat?: Feat): SpeechErr {
  const d = detailOf(text), msg = d.message || `Lỗi ${status}`;
  const miss = elevenMissing(`${d.status} ${d.message}`);
  if (status === 401 && /invalid_api_key|invalid api key/i.test(`${d.status} ${msg}`)) return new SpeechErr("Khóa ElevenLabs không còn hợp lệ. Quản trị viên vào Cài đặt → Providers để thay khóa.", 401, "key");
  if (miss) return new SpeechErr(`Khóa ElevenLabs chưa được cấp quyền ${miss === "?" ? "cho tính năng này" : `"${miss}"`}. Vào elevenlabs.io → API keys, sửa khóa và bật quyền này (hoặc dùng khóa không giới hạn).`, 403, "perm");
  if (/quota_exceeded|insufficient_credits|exceeds_character_limit/i.test(d.status) || (status !== 404 && QUOTA_RE.test(msg) && !PLAN_RE.test(msg))) {
    const p = G().plan, at = p?.credits.resetAt ? new Date(p.credits.resetAt).toLocaleDateString("vi-VN") : "";
    return new SpeechErr(`Đã hết credit ElevenLabs của chu kỳ này${at ? ` (hồi lại ngày ${at})` : ""}. Nâng gói hoặc chờ credit hồi lại.`, 402, "quota");
  }
  if (status === 402 || /subscription_required|free_users_not_allowed|upgrade_required|payment_required|feature_not_available|can_not_use|not_allowed_for_tier/i.test(d.status) || ((status === 403 || status === 401) && PLAN_RE.test(msg))) {
    if (feat) lock(feat, msg);
    return new SpeechErr("Gói ElevenLabs hiện tại chưa có tính năng này. Synchro đã ẩn nó cho tới khi gói được nâng.", 403, "plan");
  }
  if (status === 429 || /too_many_concurrent|system_busy|rate_limit/i.test(d.status)) return new SpeechErr("ElevenLabs đang bận hoặc bạn đang chạy quá nhiều yêu cầu cùng lúc. Thử lại sau vài giây.", 429, "busy");
  if (/voice_limit_reached|voice_slots/i.test(`${d.status} ${msg}`)) return new SpeechErr("Đã dùng hết chỗ lưu giọng của gói. Xóa bớt giọng trong Giọng của tôi rồi thử lại.", 409, "slots");
  if (status === 404) return new SpeechErr(/voice/i.test(msg) ? "Không tìm thấy giọng này (có thể đã bị xóa hoặc chưa được thêm vào tài khoản)." : "ElevenLabs không tìm thấy mục này.", 404, "missing");
  return new SpeechErr(`ElevenLabs: ${msg.slice(0, 240)}`, status >= 500 ? 502 : 400, d.status || undefined);
}

export async function el(p: string, init: RequestInit & { feat?: Feat; timeout?: number } = {}): Promise<Response> {
  const k = conn();
  const headers = new Headers(init.headers);
  headers.set("xi-api-key", k.key);
  const r = await fetch(k.base + p, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(init.timeout ?? 120_000) })
    .catch((e: Error) => { throw new SpeechErr(e.name === "TimeoutError" ? "ElevenLabs phản hồi quá lâu. Thử lại sau." : `Không kết nối được tới ElevenLabs: ${e.message}`, 502, "net"); });
  if (!r.ok) throw explain(r.status, await r.text().catch(() => ""), init.feat);
  return r;
}
export const elJson = async <T = Record<string, unknown>>(p: string, init: RequestInit & { feat?: Feat; timeout?: number } = {}) => (await (await el(p, init)).json()) as T;
export const jsonBody = (b: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

// ---- quét gói ----
type ModelRaw = { model_id: string; name: string; description?: string; can_do_text_to_speech?: boolean; can_do_voice_conversion?: boolean; can_use_style?: boolean; can_use_speaker_boost?: boolean;
  requires_alpha_access?: boolean; max_characters_request_free_user?: number; max_characters_request_subscribed_user?: number; maximum_text_length_per_request?: number;
  languages?: { language_id: string; name: string }[]; model_rates?: { character_cost_multiplier?: number } };
type Sub = { tier: string; status: string; character_count: number; character_limit: number; next_character_count_reset_unix: number | null; voice_slots_used: number; voice_limit: number;
  professional_voice_slots_used: number; professional_voice_limit: number; can_use_instant_voice_cloning: boolean; can_use_professional_voice_cloning: boolean };

async function scan(): Promise<Plan> {
  const [sub, models, studio] = await Promise.all([
    elJson<Sub>("/v1/user/subscription", { timeout: 20_000 }).then((s) => ({ s, err: null as SpeechErr | null })).catch((e: SpeechErr) => ({ s: null, err: e })),
    elJson<ModelRaw[]>("/v1/models", { timeout: 20_000 }).catch(() => [] as ModelRaw[]),
    // Studio API (sách nói, podcast) chỉ mở cho tài khoản được ElevenLabs duyệt riêng.
    el("/v1/studio/projects", { timeout: 20_000 }).then(() => true).catch(() => false),
  ]);
  if (sub.err && (sub.err.code === "key" || sub.err.code === "net" || sub.err.code === "no_key")) throw sub.err;
  const s = sub.s;
  const tier = s?.tier ?? "unknown", rank = s ? tierRank(tier) : 2, paid = rank > 0;
  // Đổi gói (nâng / hạ): quên các tính năng gói cũ từ chối, quét lại từ đầu.
  const l = readLocks(), locks = l.tier === tier ? l.locks : {};
  if (s && l.tier !== tier) setSetting("speech_locks", JSON.stringify({ tier, locks: {} }));
  const features = Object.fromEntries(FEATS.map((f) => [f, rank >= tierRank(MIN[f])])) as Record<Feat, boolean>;
  if (s) { features.ivc = s.can_use_instant_voice_cloning; features.pvc = s.can_use_professional_voice_cloning; }
  features.podcast = features.book = studio;
  for (const f of Object.keys(locks) as Feat[]) features[f] = false;
  const model = (m: ModelRaw): ModelOut => ({
    id: m.model_id, name: m.name.replace(/^Eleven\s/, "Eleven "), desc: m.description ?? "", langs: (m.languages ?? []).map((x) => ({ id: x.language_id, name: x.name })),
    max: (paid ? m.max_characters_request_subscribed_user : m.max_characters_request_free_user) ?? m.maximum_text_length_per_request ?? 5000,
    rate: m.model_rates?.character_cost_multiplier ?? 1, style: !!m.can_use_style, boost: !!m.can_use_speaker_boost,
  });
  const usable = models.filter((m) => !m.requires_alpha_access);
  const plan: Plan = {
    connected: true, readPlan: !!s, tier, tierName: TIER_NAME[tier] ?? (s ? tier[0].toUpperCase() + tier.slice(1) : "Chưa rõ gói"), status: s?.status ?? "",
    credits: { used: s?.character_count ?? 0, limit: s?.character_limit ?? 0, resetAt: s?.next_character_count_reset_unix ? s.next_character_count_reset_unix * 1000 : null },
    voices: { used: s?.voice_slots_used ?? 0, limit: s?.voice_limit ?? 0 }, pro: { used: s?.professional_voice_slots_used ?? 0, limit: s?.professional_voice_limit ?? 0 },
    features, locked: locks, formats: FORMATS.filter((f) => rank >= tierRank(f.min)).map((f) => ({ id: f.id, label: f.label })),
    tts: usable.filter((m) => m.can_do_text_to_speech).map(model), sts: usable.filter((m) => m.can_do_voice_conversion).map(model),
    note: s ? null : sub.err?.code === "perm" ? "Khóa chưa bật quyền User nên Synchro chưa đọc được gói và credit. Bật quyền này cho khóa để giao diện khớp đúng gói." : sub.err?.message ?? null,
    checkedAt: Date.now(),
  };
  return plan;
}
const empty = (note: string | null): Plan => ({
  connected: false, readPlan: false, tier: "", tierName: "", status: "", credits: { used: 0, limit: 0, resetAt: null }, voices: { used: 0, limit: 0 }, pro: { used: 0, limit: 0 },
  features: Object.fromEntries(FEATS.map((f) => [f, false])) as Record<Feat, boolean>, locked: {}, formats: [], tts: [], sts: [], note, checkedAt: Date.now(),
});

/** Gói hiện tại (nhớ 3 phút; fresh để quét lại ngay, ví dụ sau khi đổi khóa hoặc nâng gói). */
export async function plan(o: { fresh?: boolean } = {}): Promise<Plan> {
  const st = G();
  if (!hasKey()) { st.plan = null; return empty(null); }
  if (!o.fresh && st.plan && Date.now() - st.at < 180_000) return st.plan;
  if (st.busy) return st.busy;
  st.busy = scan().then((p) => { st.plan = p; st.at = Date.now(); return p; })
    .catch((e: SpeechErr) => empty(e.message))
    .finally(() => { st.busy = null; });
  return st.busy;
}
/** Sau mỗi lần tạo: cộng credit đã dùng (ElevenLabs báo trong header) để thanh credit đúng ngay, không phải quét lại. */
export function spent(r: Response) {
  const n = Number(r.headers.get("character-cost") ?? r.headers.get("x-character-count") ?? 0);
  const p = G().plan;
  if (p && n > 0) p.credits.used += n;
  return n;
}
export async function need(f: Feat) {
  const p = await plan();
  if (!p.connected) throw new SpeechErr(p.note ?? "Chưa gắn khóa ElevenLabs. Quản trị viên vào Cài đặt → Providers để thêm khóa.", 503, "no_key");
  if (!p.features[f]) throw new SpeechErr(p.locked[f] ? "Gói ElevenLabs hiện tại chưa có tính năng này." : `Tính năng này cần gói ElevenLabs ${TIER_NAME[MIN[f]] ?? "cao hơn"} trở lên.`, 403, "plan");
  return p;
}

// ---- giọng nói ----
export type VoiceOut = {
  id: string; name: string; desc: string; lang: string; langCode: string; accent: string; gender: string; age: string; use: string; category: string;
  preview: string | null; mine: boolean; owner?: string; free?: boolean; uses?: number; notice?: number | null; added?: boolean;
};
const LANG_VI: Record<string, string> = { vi: "Tiếng Việt", en: "Tiếng Anh", ja: "Tiếng Nhật", ko: "Tiếng Hàn", zh: "Tiếng Trung", fr: "Tiếng Pháp", de: "Tiếng Đức", es: "Tiếng Tây Ban Nha",
  th: "Tiếng Thái", id: "Tiếng Indonesia", hi: "Tiếng Hindi", pt: "Tiếng Bồ Đào Nha", it: "Tiếng Ý", ru: "Tiếng Nga", ar: "Tiếng Ả Rập", nl: "Tiếng Hà Lan", pl: "Tiếng Ba Lan", tr: "Tiếng Thổ Nhĩ Kỳ",
  ms: "Tiếng Mã Lai", fil: "Tiếng Philippines", sv: "Tiếng Thụy Điển", uk: "Tiếng Ukraina" };
export const langName = (code: string) => {
  const c = (code || "").toLowerCase().split(/[-_]/)[0];
  if (!c) return "";
  if (LANG_VI[c]) return LANG_VI[c];
  try { return new Intl.DisplayNames(["vi"], { type: "language" }).of(c) ?? c; } catch { return c; }
};
const cap = (s?: string | null) => (s ? s.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase()) : "");
// Nhãn của ElevenLabs (tiếng Anh) → tiếng Việt để lọc và hiển thị (giao diện tiếng Anh tự dịch ngược lại).
const VI_LABEL: Record<string, string> = { female: "Nữ", male: "Nam", neutral: "Trung tính", "non-binary": "Trung tính", young: "Trẻ", middle_aged: "Trung niên", "middle aged": "Trung niên", old: "Lớn tuổi",
  narration: "Kể chuyện", narrative_story: "Kể chuyện", conversational: "Hội thoại", news: "Tin tức", social_media: "Mạng xã hội", characters: "Nhân vật", characters_animation: "Nhân vật",
  educational: "Giáo dục", informative_educational: "Giáo dục", advertisement: "Quảng cáo", entertainment_tv: "Giải trí", entertainment: "Giải trí", meditation: "Thiền", asmr: "ASMR", gaming: "Trò chơi" };
const vi = (s?: string | null) => (s ? VI_LABEL[s.toLowerCase()] ?? cap(s) : "");
type VoiceRaw = { voice_id: string; name: string; category?: string; labels?: Record<string, string>; description?: string | null; preview_url?: string | null;
  verified_languages?: { language?: string; accent?: string; preview_url?: string | null }[] | null; sharing?: { public_owner_id?: string } | null };
export const voiceOut = (v: VoiceRaw): VoiceOut => {
  const lb = v.labels ?? {}, vl = v.verified_languages?.[0];
  const code = lb.language ?? vl?.language ?? "";
  return {
    id: v.voice_id, name: v.name.split(" - ")[0].trim(), desc: cap(lb.descriptive ?? lb.description ?? v.description?.split(/[.;\n]/)[0] ?? ""), lang: langName(code), langCode: code,
    accent: cap(lb.accent ?? vl?.accent ?? ""), gender: vi(lb.gender), age: vi(lb.age), use: vi(lb.use_case), category: v.category ?? "premade",
    preview: v.preview_url ?? vl?.preview_url ?? null, mine: true, owner: v.sharing?.public_owner_id,
  };
};
type LibRaw = { public_owner_id: string; voice_id: string; name: string; accent?: string; gender?: string; age?: string; descriptive?: string; use_case?: string; category?: string;
  language?: string | null; description?: string | null; preview_url?: string | null; cloned_by_count?: number; usage_character_count_1y?: number; free_users_allowed?: boolean;
  notice_period?: number | null; is_added_by_user?: boolean | null };
export const libOut = (v: LibRaw): VoiceOut => ({
  id: v.voice_id, name: v.name.split(" - ")[0].trim(), desc: cap(v.descriptive || v.description?.split(/[.;\n]/)[0] || ""), lang: langName(v.language ?? ""), langCode: v.language ?? "",
  accent: cap(v.accent), gender: vi(v.gender), age: vi(v.age), use: vi(v.use_case), category: v.category ?? "professional", preview: v.preview_url ?? null, mine: false,
  owner: v.public_owner_id, free: v.free_users_allowed !== false, uses: v.cloned_by_count ?? 0, notice: v.notice_period ?? null, added: !!v.is_added_by_user,
});

export async function myVoices(search = ""): Promise<VoiceOut[]> {
  const out: VoiceOut[] = [];
  let token = "";
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ page_size: "100", sort: "name", sort_direction: "asc" });
    if (search) q.set("search", search);
    if (token) q.set("next_page_token", token);
    const j = await elJson<{ voices: VoiceRaw[]; has_more: boolean; next_page_token?: string | null }>(`/v2/voices?${q}`, { timeout: 30_000 });
    out.push(...j.voices.map(voiceOut));
    if (!j.has_more || !j.next_page_token) break;
    token = j.next_page_token;
  }
  // Giọng riêng (nhân bản, thiết kế, thêm từ thư viện) lên trước giọng có sẵn.
  const rank = (c: string) => (c === "premade" ? 1 : 0);
  return out.sort((a, b) => rank(a.category) - rank(b.category));
}
export async function library(o: { search?: string; language?: string; gender?: string; age?: string; use?: string; sort?: string; page?: number; free?: boolean }) {
  const q = new URLSearchParams({ page_size: "30", page: String(o.page ?? 0) });
  if (o.search) q.set("search", o.search);
  if (o.language) q.set("language", o.language);
  if (o.gender) q.set("gender", o.gender.toLowerCase());
  if (o.age) q.set("age", o.age.toLowerCase().replace(/ /g, "_"));
  if (o.use) q.set("use_cases", o.use.toLowerCase().replace(/ /g, "_"));
  if (o.sort) q.set("sort", o.sort);
  const j = await elJson<{ voices: LibRaw[]; has_more: boolean }>(`/v1/shared-voices?${q}`, { timeout: 30_000 });
  // Gói Free chỉ dùng được giọng thư viện cho phép người dùng miễn phí: ẩn những giọng còn lại.
  const voices = j.voices.map(libOut).filter((v) => !o.free || v.free);
  return { voices, more: j.has_more };
}

// ---- sản phẩm của từng người ----
export type Item = { id: string; kind: string; title: string; meta: Record<string, unknown>; mime: string | null; size: number; createdAt: number; url: string | null };
let ready = false;
const items = () => {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS speech_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}',
      file TEXT, mime TEXT, size INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS speech_items_user ON speech_items(user_id, created_at DESC);`);
    ready = true;
  }
  return d;
};
type ItemRow = { id: string; user_id: string; kind: string; title: string; meta: string; file: string | null; mime: string | null; size: number; created_at: number };
const KEEP = 300;
const dirOf = (u: UserRow) => path.join(DATA_DIR, "speech", u.id.replace(/[^\w-]/g, ""));
const rowOut = (r: ItemRow): Item => ({ id: r.id, kind: r.kind, title: r.title, meta: JSON.parse(r.meta || "{}"), mime: r.mime, size: r.size, createdAt: r.created_at, url: r.file ? `/api/speech/file?id=${r.id}` : null });

export function saveItem(u: UserRow, kind: string, title: string, meta: Record<string, unknown>, file?: { buf: Buffer; mime: string; ext: string }): Item {
  const id = crypto.randomBytes(9).toString("base64url");
  let rel: string | null = null;
  if (file) {
    fs.mkdirSync(dirOf(u), { recursive: true, mode: 0o700 });
    rel = `${id}.${file.ext}`;
    fs.writeFileSync(path.join(dirOf(u), rel), file.buf, { mode: 0o600 });
  }
  const now = Date.now();
  items().prepare("INSERT INTO speech_items (id, user_id, kind, title, meta, file, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, u.id, kind, title.slice(0, 200), JSON.stringify(meta), rel, file?.mime ?? null, file?.buf.length ?? 0, now);
  // Giữ 300 sản phẩm gần nhất của mỗi người.
  const old = items().prepare("SELECT * FROM speech_items WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?").all(u.id, KEEP) as ItemRow[];
  for (const r of old) removeRow(u, r);
  return rowOut(items().prepare("SELECT * FROM speech_items WHERE id = ?").get(id) as ItemRow);
}
export function updateItem(u: UserRow, id: string, patch: { meta?: Record<string, unknown>; file?: { buf: Buffer; mime: string; ext: string } }) {
  const r = items().prepare("SELECT * FROM speech_items WHERE id = ? AND user_id = ?").get(id, u.id) as ItemRow | undefined;
  if (!r) return null;
  let rel = r.file, mime = r.mime, size = r.size;
  if (patch.file) {
    fs.mkdirSync(dirOf(u), { recursive: true, mode: 0o700 });
    rel = `${id}.${patch.file.ext}`; mime = patch.file.mime; size = patch.file.buf.length;
    fs.writeFileSync(path.join(dirOf(u), rel), patch.file.buf, { mode: 0o600 });
  }
  const meta = { ...JSON.parse(r.meta || "{}"), ...(patch.meta ?? {}) };
  items().prepare("UPDATE speech_items SET meta = ?, file = ?, mime = ?, size = ? WHERE id = ?").run(JSON.stringify(meta), rel, mime, size, id);
  return rowOut({ ...r, meta: JSON.stringify(meta), file: rel, mime, size });
}
export const getItem = (u: UserRow, id: string) => {
  const r = items().prepare("SELECT * FROM speech_items WHERE id = ? AND user_id = ?").get(id, u.id) as ItemRow | undefined;
  return r ? rowOut(r) : null;
};
export function listItems(u: UserRow, kinds: string[] = [], lim = 50, before = Number.MAX_SAFE_INTEGER): Item[] {
  const rows = (kinds.length
    ? items().prepare(`SELECT * FROM speech_items WHERE user_id = ? AND created_at < ? AND kind IN (${kinds.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT ?`).all(u.id, before, ...kinds, lim)
    : items().prepare("SELECT * FROM speech_items WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?").all(u.id, before, lim)) as ItemRow[];
  return rows.map(rowOut);
}
export function itemFile(u: UserRow, id: string): { path: string; mime: string; name: string } | null {
  const r = items().prepare("SELECT * FROM speech_items WHERE id = ? AND user_id = ?").get(id, u.id) as ItemRow | undefined;
  if (!r?.file) return null;
  const p = path.join(dirOf(u), r.file);
  return fs.existsSync(p) ? { path: p, mime: r.mime ?? "application/octet-stream", name: `${r.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "synchro"}.${r.file.split(".").pop()}` } : null;
}
function removeRow(u: UserRow, r: ItemRow) {
  if (r.file) fs.rmSync(path.join(dirOf(u), r.file), { force: true });
  fs.rmSync(path.join(dirOf(u), `${r.id}.json`), { force: true });
  items().prepare("DELETE FROM speech_items WHERE id = ?").run(r.id);
}
export function deleteItem(u: UserRow, id: string) {
  const r = items().prepare("SELECT * FROM speech_items WHERE id = ? AND user_id = ?").get(id, u.id) as ItemRow | undefined;
  if (r) removeRow(u, r);
  return !!r;
}
// Dữ liệu lớn đi kèm sản phẩm (bản chép lời từng từ, mốc căn phụ đề) nằm trong tệp JSON riêng, không nhồi vào cơ sở dữ liệu.
const sidePath = (u: UserRow, id: string) => path.join(dirOf(u), `${id.replace(/[^\w-]/g, "")}.json`);
export function sideWrite(u: UserRow, id: string, data: unknown) {
  fs.mkdirSync(dirOf(u), { recursive: true, mode: 0o700 });
  fs.writeFileSync(sidePath(u, id), JSON.stringify(data), { mode: 0o600 });
}
export function sideRead(u: UserRow, id: string): unknown {
  try { return JSON.parse(fs.readFileSync(sidePath(u, id), "utf8")); } catch { return null; }
}

// ---- tiện ích âm thanh ----
export const extOf = (mime: string) => (/mpeg|mp3/.test(mime) ? "mp3" : /wav/.test(mime) ? "wav" : /ogg|opus/.test(mime) ? "opus" : /mp4|m4a|aac/.test(mime) ? "m4a" : /webm/.test(mime) ? "webm" : /video/.test(mime) ? "mp4" : "bin");
/** Âm thanh trả về từ ElevenLabs: lấy đúng kiểu nội dung (bản giả lập trả WAV), lưu được cả định dạng thô. */
export async function audioOf(r: Response, fmt = "mp3_44100_128") {
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = (r.headers.get("content-type") ?? "").split(";")[0];
  const f = fmtOf(fmt);
  const mime = ct && ct !== "application/octet-stream" ? ct : f.mime;
  return { buf, mime, ext: ct && /audio|video/.test(ct) ? extOf(ct) : f.ext };
}

// ---- Eleven Realtime: khóa tạm cho trình duyệt nối thẳng (khóa thật không rời máy chủ) ----
export type RtOpts = { model?: string; voice?: string; instructions: string; language?: string; eagerness?: "low" | "medium" | "high"; interrupt?: boolean; maxSeconds?: number;
  tools?: unknown[]; temperature?: number };
export async function mintRealtime(o: RtOpts): Promise<{ value: string; expiresAt: number; url: string; model: string; tools: boolean; voice: string }> {
  const k = conn();
  const model = o.model === "eleven_realtime_v1_mini" ? "eleven_realtime_v1_mini" : "eleven_realtime_v1_max";
  const body = (tools: boolean, voice?: string) => JSON.stringify({
    session: {
      type: "realtime", model, instructions: o.instructions, output_modalities: ["audio"], max_duration_seconds: Math.min(3600, Math.max(60, o.maxSeconds ?? 900)),
      ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          // Ngôn ngữ của cuộc trò chuyện: dùng cho nhận dạng, giọng đọc và ngôn ngữ trả lời (mặc định của ElevenLabs là tiếng Anh).
          ...(o.language ? { transcription: { language: o.language } } : {}),
          turn_detection: { type: "semantic_vad", eagerness: o.eagerness ?? "medium", interrupt_response: o.interrupt !== false },
        },
        output: { format: { type: "audio/pcm" }, ...(voice ? { voice } : {}) },
      },
      ...(tools && o.tools?.length ? { tools: o.tools, tool_choice: "auto" } : {}),
    },
    expires_after: { anchor: "created_at", seconds: 120 },
  });
  const mint = (tools: boolean, voice?: string) => fetch(`${k.base}/v1/convai/realtime/client_secrets`, {
    method: "POST", headers: { "xi-api-key": k.key, "content-type": "application/json" }, body: body(tools, voice), signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  // Thứ tự thử: đầy đủ → bỏ công cụ (ElevenLabs chưa nhận) → bỏ giọng đã chọn (giọng chưa dùng được cho Realtime).
  let tools = !!o.tools?.length, voice = o.voice || undefined;
  let r = await mint(tools, voice);
  const retryable = (x: Response | null) => !!x && !x.ok && x.status >= 400 && x.status < 500 && ![401, 402, 403, 429].includes(x.status);
  if (retryable(r) && tools) { console.error("realtime (tools)", r!.status, (await r!.text().catch(() => "")).slice(0, 300)); tools = false; r = await mint(false, voice); }
  if (retryable(r) && voice) { console.error("realtime (voice)", r!.status, (await r!.text().catch(() => "")).slice(0, 300)); voice = undefined; r = await mint(tools, undefined); }
  if (!r) throw new SpeechErr("Không kết nối được tới ElevenLabs.", 502, "net");
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("realtime session", r.status, t.slice(0, 300));
    throw explain(r.status, t, "agent");
  }
  const j = (await r.json()) as { value: string; expires_at: number };
  return { value: j.value, expiresAt: j.expires_at, url: `${k.base.replace(/^http/, "ws")}/v1/convai/realtime`, model, tools, voice: voice ?? "" };
}

/** Khóa dùng một lần cho chép lời trực tiếp (Scribe Realtime) từ trình duyệt. */
export async function scribeToken() {
  const k = conn();
  const j = await elJson<{ token: string }>("/v1/single-use-token/realtime_scribe", { method: "POST", feat: "live", timeout: 20_000 });
  return { token: j.token, url: `${k.base.replace(/^http/, "ws")}/v1/speech-to-text/realtime` };
}
