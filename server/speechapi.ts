// Speech (ElevenLabs) phía máy chủ: gọi API thật bằng khóa ở Cài đặt → Providers (khóa không bao giờ rời máy chủ),
// đọc gói đăng ký để bật / tắt từng tính năng, và lưu sản phẩm (âm thanh, bản chép lời) riêng cho từng người.
// Tính năng của gói cao hơn vẫn nằm trong mã; chỉ hiện khi gói quét được cho phép.
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { audit, DATA_DIR, db, getSetting, getUser, isAdmin, setSetting, type UserRow } from "./authstore";
import { elevenMissing, serviceKey } from "./providers";
import { speechLimitMsg, type SpeechUse } from "./limitmsg";

export class SpeechErr extends Error {
  constructor(msg: string, public status = 400, public code?: string) { super(msg); }
}

// ---- nhà cung cấp Speech (sau el()) ----
// Speech không phụ thuộc vào đúng một khóa: el() đi qua danh sách nhà cung cấp, ElevenLabs là chính. Có thể cấu hình thêm MỘT nhà cung
// cấp dự phòng TƯƠNG THÍCH API ElevenLabs (TTS/STT) qua biến môi trường SPEECH_FALLBACK_BASE + SPEECH_FALLBACK_KEY (tùy chọn _ID, _LABEL, _HEADER)
// — chỉ bật khi chủ máy chủ đặt sẵn địa chỉ + khóa; KHÔNG bịa khóa. Không đặt gì thì hành vi y hệt trước đây (chỉ ElevenLabs).
// Chuyển sang dự phòng: xem el() — chỉ đọc văn bản và chép lời, gửi lại đúng một lần, ghi nhận nhà cung cấp đã phục vụ (servedBy).
export type SpeechProvider = { id: string; label: string; base: string; key: string; header: string };
function speechProviderList(): SpeechProvider[] {
  const out: SpeechProvider[] = [];
  const k = serviceKey("elevenlabs");
  if (k) out.push({ id: "elevenlabs", label: "ElevenLabs", base: k.base, key: k.key, header: "xi-api-key" });
  const base = process.env.SPEECH_FALLBACK_BASE?.trim(), key = process.env.SPEECH_FALLBACK_KEY?.trim();
  if (base && key) out.push({
    id: process.env.SPEECH_FALLBACK_ID?.trim() || "fallback",
    label: process.env.SPEECH_FALLBACK_LABEL?.trim() || "Nhà cung cấp dự phòng",
    base: base.replace(/\/+$/, ""), key, header: process.env.SPEECH_FALLBACK_HEADER?.trim() || "xi-api-key",
  });
  return out;
}
/** Danh sách nhà cung cấp Speech đang cấu hình (không lộ khóa) — để giao diện quản trị / chẩn đoán hiển thị: số lượt mỗi nhà cung cấp đã phục vụ, lần chuyển dự phòng gần nhất. */
export const speechProviders = () => {
  const st = G();
  return { providers: speechProviderList().map((p) => ({ id: p.id, label: p.label, served: st.served?.[p.id] ?? 0 })), lastFailover: st.lastFailover ?? null };
};
const conn = (): SpeechProvider => {
  const list = speechProviderList();
  if (!list.length) throw new SpeechErr("Chưa gắn khóa ElevenLabs. Quản trị viên vào Cài đặt → Providers để thêm khóa.", 503, "no_key");
  return list[0];
};
export const hasKey = () => speechProviderList().length > 0;

// ---- tính năng và gói ----
export const FEATS = ["tts", "dialogue", "stt", "live", "agent", "sfx", "isolate", "changer", "align", "music", "design", "remix", "ivc", "pvc", "dub", "dubClean", "podcast", "book", "dict", "native"] as const;
export type Feat = (typeof FEATS)[number];
// Gói thấp nhất có tính năng (bảng giá API của ElevenLabs, 10/2026). Nhân bản dùng cờ của chính gói; Studio cần được ElevenLabs duyệt riêng.
const TIERS = ["free", "starter", "creator", "pro", "scale", "business", "enterprise"];
const MIN: Record<Feat, string> = {
  tts: "free", dialogue: "free", stt: "free", live: "free", agent: "free", sfx: "free", isolate: "free", changer: "free", align: "free", music: "free",
  design: "free", remix: "free", ivc: "starter", pvc: "creator", dub: "free", dubClean: "starter", podcast: "free", book: "free", dict: "free", native: "free",
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
  /** Quyền khóa còn thiếu theo tính năng (tính năng đó bị ẩn); realtime: phiên trò chuyện Eleven Realtime dùng được (cần convai_write). */
  perms: Partial<Record<Feat, string>>; realtime: boolean;
  /** Giọng lấy từ Thư viện dùng được qua API (gói trả phí; gói Free chỉ dùng giọng có sẵn và giọng của chính mình). */
  library: boolean;
  formats: { id: string; label: string }[]; tts: ModelOut[]; sts: ModelOut[];
  note: string | null; checkedAt: number;
};

// Tính năng ElevenLabs từ chối vì gói (không phải vì khóa thiếu quyền hay hết credit): nhớ theo gói, đổi gói thì quét lại từ đầu.
type Locks = { tier: string; locks: Partial<Record<Feat, string>> };
// Khóa mới (speech_locks2): bản cũ khóa cả tính năng chỉ vì một giọng không dùng được, bỏ hết các khóa đó.
const LOCKS = "speech_locks2";
const readLocks = (): Locks => { try { return JSON.parse(getSetting(LOCKS, "{}")) as Locks; } catch { return { tier: "", locks: {} }; } };
function lock(f: Feat, msg: string) {
  const p = G().plan, l = readLocks(), cur = p?.tier ?? l.tier ?? "";
  const locks = l.tier === cur ? { ...l.locks } : {};
  locks[f] = msg.slice(0, 200);
  setSetting(LOCKS, JSON.stringify({ tier: cur, locks }));
  if (p) { p.features[f] = false; p.locked[f] = locks[f]; }
}

type Failover = { at: number; from: string; to: string; path: string; reason: string; ok: boolean };
const g = globalThis as unknown as { __speech?: { plan: Plan | null; at: number; busy: Promise<Plan> | null; fp?: string; perms?: { at: number; key: string; miss: Partial<Record<Feat | "realtime", string>> };
  served?: Record<string, number>; lastFailover?: Failover;
  /** Lần quét gói gần nhất hỏng (khóa / mạng) khi có dự phòng: gói đang dùng thay và lúc hỏng — để chờ ~30 giây rồi mới quét lại nhà cung cấp chính. */
  fail?: { at: number; plan: Plan } } };
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

// Số trong câu lỗi của ElevenLabs là tiếng Anh (dấu chấm thập phân); đổi sang kiểu Việt (dấu phẩy) khi chèn lại vào câu tiếng Việt.
const viNum = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n.toLocaleString("vi-VN", { maximumFractionDigits: 3 }) : s; };
/** Dịch các lỗi NỘI DUNG đầu vào của ElevenLabs (độ dài âm thanh, kích thước tệp…) sang tiếng Việt. Trả về null nếu không nhận ra. */
export function translateContentErr(msg: string): string | null {
  let m = /audio duration is ([\d.]+) seconds?,? which is below the minimum of ([\d.]+) seconds?/i.exec(msg);
  if (m) return `Âm thanh dài ${viNum(m[1])} giây, dưới mức tối thiểu ${viNum(m[2])} giây. Hãy chọn tệp dài hơn.`;
  m = /audio duration is ([\d.]+) seconds?,? which is above the maximum of ([\d.]+) seconds?/i.exec(msg);
  if (m) return `Âm thanh dài ${viNum(m[1])} giây, vượt mức tối đa ${viNum(m[2])} giây. Hãy cắt ngắn hoặc chia nhỏ tệp.`;
  m = /(?:audio|file) (?:is )?too short|too short.{0,20}minimum/i.exec(msg);
  if (m) return "Tệp âm thanh quá ngắn so với mức tối thiểu của ElevenLabs. Hãy chọn tệp dài hơn.";
  m = /(?:audio|file) (?:is )?too long|exceeds (?:the )?maximum (?:duration|length)/i.exec(msg);
  if (m) return "Tệp âm thanh quá dài so với mức tối đa của ElevenLabs. Hãy cắt ngắn hoặc chia nhỏ tệp.";
  m = /file size.{0,20}(?:exceeds|too large|larger than)|maximum file size/i.exec(msg);
  if (m) return "Tệp vượt quá kích thước tối đa ElevenLabs nhận. Hãy nén hoặc cắt ngắn tệp.";
  return null;
}
/** Đổi lỗi của ElevenLabs thành câu dễ hiểu; lỗi do gói thì nhớ để ẩn tính năng. */
export function explain(status: number, text: string, feat?: Feat): SpeechErr {
  const d = detailOf(text), msg = d.message || `Lỗi ${status}`;
  const miss = elevenMissing(`${d.status} ${d.message}`);
  if (status === 401 && /invalid_api_key|invalid api key/i.test(`${d.status} ${msg}`)) return new SpeechErr("Khóa ElevenLabs không còn hợp lệ. Quản trị viên vào Cài đặt → Providers để thay khóa.", 401, "key");
  if (miss) return new SpeechErr(`Khóa ElevenLabs chưa được cấp quyền ${miss === "?" ? "cho tính năng này" : `"${miss}"`}. Vào elevenlabs.io → API keys, sửa khóa và bật quyền này (hoặc dùng khóa không giới hạn).`, 403, "perm");
  // Giọng Thư viện với gói Free: lỗi của giọng, không phải của tính năng (không khóa tính năng).
  if (/library voices? via the api|cannot use library voices/i.test(msg)) return new SpeechErr("Giọng này lấy từ Thư viện ElevenLabs, gói Free không dùng được qua API. Hãy chọn một giọng khác.", 402, "voice");
  // Lỗi nội dung đầu vào (độ dài tệp, kích thước…): dịch sang tiếng Việt để người dùng hiểu và sửa ngay.
  const content = translateContentErr(msg);
  if (content) return new SpeechErr(content, status || 400, "input");
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

// ---- chuyển sang nhà cung cấp dự phòng ----
// Chỉ đọc văn bản (TTS, cả /stream và /with-timestamps) và chép lời (STT): mỗi lần gọi tạo kết quả mới, gửi lại không đổi gì ở tài khoản.
// Không bao giờ nhân bản / thiết kế / xóa giọng hay đường nào khác: giọng nằm trên tài khoản của nhà cung cấp chính, gửi lại có thể tạo trùng hoặc xóa nhầm.
const FAILOVER_RE = /^\/v1\/(text-to-speech\/[^/?]+(\/stream|\/with-timestamps|\/stream\/with-timestamps)?|speech-to-text)(\?|$)/;
/** Đường này có được gửi lại ở nhà cung cấp dự phòng không. */
export const failoverPath = (p: string, method = "GET") => method.toUpperCase() === "POST" && FAILOVER_RE.test(p);
// Thân yêu cầu gửi lại được (luồng đọc một lần thì không).
const reusableBody = (b: RequestInit["body"]) => b === undefined || b === null || typeof b === "string" || b instanceof FormData || b instanceof URLSearchParams || b instanceof Blob || b instanceof ArrayBuffer || ArrayBuffer.isView(b);
/** Lỗi đáng chuyển sang dự phòng: máy chủ hãng lỗi (5xx), quá tải / hết lượt (429), khóa không hợp lệ (401/403) hoặc hết credit. Lỗi nội dung, thiếu quyền, gói thì không: dự phòng cũng sẽ từ chối, hoặc là lỗi người dùng cần sửa. */
export function failoverWorthy(status: number, text: string) {
  if (status >= 500 || status === 429) return true;
  const d = detailOf(text);
  if ((status === 401 || status === 403) && /invalid_api_key|invalid api key/i.test(`${d.status} ${d.message}`)) return true;
  return /quota_exceeded|insufficient_credits/i.test(d.status);
}
type ElInit = RequestInit & { feat?: Feat; timeout?: number };
const served = new WeakMap<Response, string>();
/** Mã nhà cung cấp đã trả lời yêu cầu này (null nếu không phải phản hồi của el()). */
export const servedBy = (r: Response) => served.get(r) ?? null;
const tag = (r: Response, k: SpeechProvider) => {
  served.set(r, k.id);
  const st = G();
  st.served = { ...st.served, [k.id]: (st.served?.[k.id] ?? 0) + 1 };
  return r;
};
const callProvider = (k: SpeechProvider, p: string, init: ElInit) => {
  // Headers mới cho từng nhà cung cấp: khóa của nhà cung cấp chính không bao giờ đi theo sang dự phòng.
  const headers = new Headers(init.headers);
  headers.set(k.header, k.key);
  return fetch(k.base + p, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(init.timeout ?? 120_000) });
};
const netErr = (e: unknown) => {
  const x = e instanceof Error ? e : new Error(String(e));
  return new SpeechErr(x.name === "TimeoutError" ? "ElevenLabs phản hồi quá lâu. Thử lại sau." : `Không kết nối được tới ElevenLabs: ${x.message}`, 502, "net");
};

export async function el(p: string, init: ElInit = {}): Promise<Response> {
  const list = speechProviderList();
  const main = list[0] ?? conn(), spare = list[1];
  let r: Response | null = null, err: unknown = null;
  try { r = await callProvider(main, p, init); } catch (e) { err = e; }
  if (r?.ok) return tag(r, main);
  const text = r ? await r.text().catch(() => "") : "";
  const first = () => (r ? explain(r.status, text, init.feat) : netErr(err));
  // Gửi lại đúng một lần ở dự phòng: chỉ khi có cấu hình, đường cho phép, thân gửi lại được, lỗi đáng chuyển, và người gọi chưa hủy.
  if (!spare || !failoverPath(p, init.method) || !reusableBody(init.body) || init.signal?.aborted || (r && !failoverWorthy(r.status, text))) throw first();
  const reason = r ? `HTTP ${r.status}` : err instanceof Error ? err.name : "network";
  let r2: Response | null = null, err2: unknown = null;
  try { r2 = await callProvider(spare, p, init); } catch (e) { err2 = e; }
  G().lastFailover = { at: Date.now(), from: main.id, to: spare.id, path: p.split("?")[0], reason, ok: !!r2?.ok };
  if (r2?.ok) { console.warn(`[speech] ${main.label} lỗi (${reason}) ở ${p.split("?")[0]}: ${spare.label} đã phục vụ thay`); return tag(r2, spare); }
  // Dự phòng cũng lỗi: báo lỗi của nhà cung cấp chính (là chỗ quản trị viên cần sửa), ghi nhật ký lỗi của dự phòng.
  const why = r2 ? `HTTP ${r2.status} ${(await r2.text().catch(() => "")).slice(0, 200)}` : err2 instanceof Error ? err2.message : "network";
  console.error(`[speech] ${main.label} lỗi (${reason}), dự phòng ${spare.label} cũng lỗi: ${why}`);
  throw first();
}
export const elJson = async <T = Record<string, unknown>>(p: string, init: ElInit = {}) => (await (await el(p, init)).json()) as T;
export const jsonBody = (b: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

// ---- quyền của khóa ----
// Khóa API giới hạn quyền: gửi yêu cầu rỗng tới từng tính năng (không tạo gì, không tốn credit). ElevenLabs kiểm tra quyền trước
// nội dung nên thiếu quyền trả 401 "missing the permission …", đủ quyền trả lỗi nội dung (422). Nhớ 30 phút, quét mới thì dò lại;
// còn thiếu quyền thì chỉ nhớ 3 phút để người dùng bật quyền trên elevenlabs.io xong là tính năng hiện lại ngay.
const PREMADE = "JBFqnCBsd6RMkjVDRZzb";
const PROBES: [Feat | "realtime", string, "json" | "form"][] = [
  ["tts", `/v1/text-to-speech/${PREMADE}`, "json"], ["dialogue", "/v1/text-to-dialogue", "json"], ["stt", "/v1/speech-to-text", "form"],
  ["sfx", "/v1/sound-generation", "json"], ["music", "/v1/music", "json"], ["isolate", "/v1/audio-isolation", "form"],
  ["changer", `/v1/speech-to-speech/${PREMADE}`, "form"], ["align", "/v1/forced-alignment", "form"], ["design", "/v1/text-to-voice/design", "json"],
  ["remix", `/v1/text-to-voice/${PREMADE}/remix`, "json"], ["ivc", "/v1/voices/add", "form"], ["dub", "/v1/dubbing", "form"],
  ["dict", "/v1/pronunciation-dictionaries/add-from-rules", "json"], ["native", "/v1/audio-native", "form"],
  ["realtime", "/v1/convai/realtime/client_secrets", "json"],
];
async function probePerms(fresh: boolean) {
  const st = G(), k = conn(), key = k.key.slice(-6);
  const keep = st.perms && Object.keys(st.perms.miss).length ? 3 * 60_000 : 30 * 60_000;
  if (!fresh && st.perms && st.perms.key === key && Date.now() - st.perms.at < keep) return st.perms.miss;
  const miss: Partial<Record<Feat | "realtime", string>> = {};
  await Promise.all(PROBES.map(async ([f, p, kind]) => {
    const init: RequestInit = { method: "POST", headers: { [k.header]: k.key }, signal: AbortSignal.timeout(15_000) };
    if (kind === "form") init.body = new FormData();
    else { (init.headers as Record<string, string>)["content-type"] = "application/json"; init.body = "{}"; }
    const r = await fetch(k.base + p, init).catch(() => null);
    if (r?.status !== 401 && r?.status !== 403) { await r?.body?.cancel().catch(() => {}); return; }
    const m = elevenMissing(await r.text().catch(() => ""));
    if (m) miss[f] = m;
  }));
  // Lồng tiếng làm sạch và chép lời trực tiếp dùng chung quyền với lồng tiếng / chép lời.
  if (miss.dub) miss.dubClean = miss.dub;
  if (miss.stt) miss.live = miss.stt;
  st.perms = { at: Date.now(), key, miss };
  return miss;
}

// ---- hiệu ứng âm thanh (Đọc văn bản, Hội thoại) ----
// Danh mục bộ lọc, không gian vang và tiếng nền lấy từ ElevenLabs (nhớ 6 giờ); API chưa trả được thì dùng danh mục đã biết.
export type Effect = { id: string; name: string; desc: string };
export type EffectsCatalog = { filters: Effect[]; spaces: Effect[]; noises: Effect[] };
const FALLBACK_EFFECTS: EffectsCatalog = {
  filters: [["old_radio", "Old Radio"], ["robot", "Robot"], ["cheap_microphone", "Cheap Microphone"], ["phone", "Phone"], ["low_quality_phone", "Low Quality Phone"], ["bright_phone", "Bright Phone"]].map(([id, name]) => ({ id, name, desc: "" })),
  spaces: [["small_room", "Small Room"], ["big_room", "Big Room"], ["hall", "Hall"], ["tunnel", "Tunnel"], ["street", "Street"], ["valley", "Valley"], ["forest", "Forest"]].map(([id, name]) => ({ id, name, desc: "" })),
  noises: [["call_center", "Call center"], ["cafe", "Café"], ["city", "City"], ["keyboard", "Keyboard"]].map(([id, name]) => ({ id, name, desc: "" })),
};
const fx = globalThis as unknown as { __speechFx?: { at: number; v: EffectsCatalog } };
export async function effectsCatalog(): Promise<EffectsCatalog> {
  if (fx.__speechFx && Date.now() - fx.__speechFx.at < 6 * 3600_000) return fx.__speechFx.v;
  type Raw = { filter_presets?: { filter_preset_id: string; name: string; description?: string | null }[]; environments?: { environment_id: string; name: string; description?: string | null }[]; background_noises?: { background_noise_id: string; name: string; description?: string | null }[] };
  const j = await elJson<Raw>("/v1/audio-effects/catalog", { timeout: 20_000 }).catch(() => null);
  const v: EffectsCatalog = j?.filter_presets ? {
    filters: j.filter_presets.map((x) => ({ id: x.filter_preset_id, name: x.name, desc: x.description ?? "" })),
    spaces: (j.environments ?? []).map((x) => ({ id: x.environment_id, name: x.name, desc: x.description ?? "" })),
    noises: (j.background_noises ?? []).map((x) => ({ id: x.background_noise_id, name: x.name, desc: x.description ?? "" })),
  } : FALLBACK_EFFECTS;
  if (j) fx.__speechFx = { at: Date.now(), v };
  return v;
}

// ---- quét gói ----
type ModelRaw = { model_id: string; name: string; description?: string; can_do_text_to_speech?: boolean; can_do_voice_conversion?: boolean; can_use_style?: boolean; can_use_speaker_boost?: boolean;
  requires_alpha_access?: boolean; max_characters_request_free_user?: number; max_characters_request_subscribed_user?: number; maximum_text_length_per_request?: number;
  languages?: { language_id: string; name: string }[]; model_rates?: { character_cost_multiplier?: number } };
type Sub = { tier: string; status: string; character_count: number; character_limit: number; next_character_count_reset_unix: number | null; voice_slots_used: number; voice_limit: number;
  professional_voice_slots_used: number; professional_voice_limit: number; can_use_instant_voice_cloning: boolean; can_use_professional_voice_cloning: boolean };

async function scan(fresh = false): Promise<Plan> {
  const [sub, models, studio, miss] = await Promise.all([
    elJson<Sub>("/v1/user/subscription", { timeout: 20_000 }).then((s) => ({ s, err: null as SpeechErr | null })).catch((e: SpeechErr) => ({ s: null, err: e })),
    elJson<ModelRaw[]>("/v1/models", { timeout: 20_000 }).catch(() => [] as ModelRaw[]),
    // Studio API (sách nói, podcast) chỉ mở cho tài khoản được ElevenLabs duyệt riêng.
    el("/v1/studio/projects", { timeout: 20_000 }).then(() => true).catch(() => false),
    probePerms(fresh).catch(() => ({} as Partial<Record<Feat | "realtime", string>>)),
  ]);
  if (sub.err && (sub.err.code === "key" || sub.err.code === "net" || sub.err.code === "no_key")) throw sub.err;
  const s = sub.s;
  const tier = s?.tier ?? "unknown", rank = s ? tierRank(tier) : 2, paid = rank > 0;
  // Đổi gói (nâng / hạ): quên các tính năng gói cũ từ chối, quét lại từ đầu.
  const l = readLocks(), locks = l.tier === tier ? l.locks : {};
  if (s && l.tier !== tier) setSetting(LOCKS, JSON.stringify({ tier, locks: {} }));
  const features = Object.fromEntries(FEATS.map((f) => [f, rank >= tierRank(MIN[f])])) as Record<Feat, boolean>;
  if (s) { features.ivc = s.can_use_instant_voice_cloning; features.pvc = s.can_use_professional_voice_cloning; }
  features.podcast = features.book = studio;
  for (const f of Object.keys(locks) as Feat[]) features[f] = false;
  // Khóa thiếu quyền: ẩn tính năng đó. Voice Agent vẫn chạy được khi thiếu quyền Realtime (nghe bằng Scribe, đọc bằng giọng ElevenLabs).
  const perms: Partial<Record<Feat, string>> = {};
  for (const [f, m] of Object.entries(miss) as [Feat | "realtime", string][]) if (f !== "realtime") { perms[f] = m; features[f] = false; }
  if (miss.tts || miss.stt) { features.agent = false; perms.agent = miss.tts ?? miss.stt; }
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
    features, locked: locks, perms, realtime: !miss.realtime, library: paid,
    formats: FORMATS.filter((f) => rank >= tierRank(f.min)).map((f) => ({ id: f.id, label: f.label })),
    tts: usable.filter((m) => m.can_do_text_to_speech).map(model), sts: usable.filter((m) => m.can_do_voice_conversion).map(model),
    note: s ? null : sub.err?.code === "perm" ? "Khóa chưa bật quyền User nên Synchro chưa đọc được gói và credit. Bật quyền này cho khóa để giao diện khớp đúng gói." : sub.err?.message ?? null,
    checkedAt: Date.now(),
  };
  return plan;
}
const empty = (note: string | null): Plan => ({
  connected: false, readPlan: false, tier: "", tierName: "", status: "", credits: { used: 0, limit: 0, resetAt: null }, voices: { used: 0, limit: 0 }, pro: { used: 0, limit: 0 },
  features: Object.fromEntries(FEATS.map((f) => [f, false])) as Record<Feat, boolean>, locked: {}, perms: {}, realtime: false, library: false, formats: [], tts: [], sts: [], note, checkedAt: Date.now(),
});

// Nhà cung cấp chính hỏng (khóa / mạng) mà chưa quét được gói lần nào trong tiến trình này (vừa khởi động lại, khóa đã bị thu hồi) nhưng có dự phòng:
// gói tối thiểu chỉ mở Đọc văn bản và Chép lời — đúng hai đường el() gửi lại được ở dự phòng; mọi tính năng khác tắt. Model mặc định: model đọc văn
// bản phổ biến nhất của API tương thích ElevenLabs (danh sách thật chỉ đọc được từ nhà cung cấp chính).
const SPARE_TTS: ModelOut[] = [
  { id: "eleven_multilingual_v2", name: "Eleven Multilingual v2", desc: "", langs: [], max: 5000, rate: 1, style: true, boost: true },
  { id: "eleven_flash_v2_5", name: "Eleven Flash v2.5", desc: "", langs: [], max: 5000, rate: 0.5, style: false, boost: false },
];
const spareOnly = (e: SpeechErr): Plan => {
  const p = empty(e.code === "key"
    ? "Khóa ElevenLabs không còn hợp lệ. Nhà cung cấp dự phòng đang phục vụ Đọc văn bản và Chép lời; các tính năng khác tạm ẩn cho tới khi quản trị viên thay khóa ở Cài đặt → Providers."
    : "Không kết nối được tới ElevenLabs. Nhà cung cấp dự phòng đang phục vụ Đọc văn bản và Chép lời; các tính năng khác tạm ẩn cho tới khi kết nối lại.");
  p.connected = true; p.tier = "unknown"; p.tierName = "Chưa rõ gói";
  p.features.tts = p.features.stt = true;
  p.formats = FORMATS.filter((f) => f.min === "free").map((f) => ({ id: f.id, label: f.label }));
  p.tts = SPARE_TTS.map((m) => ({ ...m }));
  return p;
};

/** Chờ giữa hai lần quét lại nhà cung cấp chính đang hỏng khi dự phòng phục vụ thay. */
export const FAIL_RETRY = 30_000;

/** Gói hiện tại (nhớ 3 phút; fresh để quét lại ngay, ví dụ sau khi đổi khóa hoặc nâng gói). */
export async function plan(o: { fresh?: boolean } = {}): Promise<Plan> {
  const st = G();
  if (!hasKey()) { st.plan = null; return empty(null); }
  // Quản trị viên đổi khóa (hoặc địa chỉ API): quét lại ngay theo khóa mới.
  const k = conn(), fp = `${k.base}|${k.key.slice(-8)}`;
  const fresh = o.fresh || st.fp !== fp;
  if (fresh && st.fp !== fp) { st.fp = fp; st.busy = null; st.fail = undefined; }
  if (!fresh && st.plan && Date.now() - st.at < 180_000) return st.plan;
  // Nhà cung cấp chính vừa hỏng và dự phòng đang phục vụ: không quét lại ở mỗi yêu cầu (mỗi lần quét chờ tới 20 giây nếu chính treo), đợi FAIL_RETRY.
  if (!fresh && st.fail && Date.now() - st.fail.at < FAIL_RETRY && speechProviderList().length > 1) return st.fail.plan;
  if (st.busy) return st.busy;
  st.busy = scan(fresh).then((p) => { st.plan = p; st.at = Date.now(); st.fail = undefined; return p; })
    // Nhà cung cấp chính mất kết nối / khóa hỏng nhưng có dự phòng: giữ gói đọc được lần trước (chưa có thì gói tối thiểu chỉ Đọc văn bản + Chép lời)
    // để hai tính năng này vẫn đi qua el() sang dự phòng.
    .catch((e: SpeechErr) => {
      if (speechProviderList().length < 2 || (e.code !== "key" && e.code !== "net")) { st.fail = undefined; return empty(e.message); }
      const p = st.plan ?? spareOnly(e);
      st.fail = { at: Date.now(), plan: p };
      return p;
    })
    .finally(() => { st.busy = null; });
  return st.busy;
}
/** Sau mỗi lần tạo: cộng credit đã dùng (ElevenLabs báo trong header) để thanh credit đúng ngay, không phải quét lại; tính vào hạn mức trong ngày của người đang gọi. est: ước lượng khi hãng không báo. */
export function spent(r: Response, est = 0) {
  const n = Number(r.headers.get("character-cost") ?? r.headers.get("x-character-count") ?? 0);
  const p = G().plan, by = servedBy(r);
  // Thanh credit là của gói ElevenLabs: lượt do nhà cung cấp dự phòng phục vụ không trừ vào đó (hạn mức trong ngày của người gọi vẫn tính).
  if (p && n > 0 && (!by || by === speechProviderList()[0]?.id)) p.credits.used += n;
  const uid = spender.getStore();
  if (uid) addSpend(uid, n > 0 ? n : est);
  return n;
}

// ---- hạn mức credit trong ngày ----
// Khóa ElevenLabs là một khóa dùng chung của chủ máy chủ, trong khi đăng ký đang mở: không có hạn mức thì vài tài khoản rác có thể tiêu hết credit, giọng nói hỏng với mọi người.
// Mỗi tài khoản có hạn mức theo ngày (tài khoản chưa xác minh email thấp hơn), cả máy chủ có hạn mức chung; quản trị viên không bị chặn nhưng vẫn được tính vào mức chung.
// Hết hạn mức thì đọc to và trò chuyện giọng nói chuyển sang giọng của trình duyệt, không có đường cụt. Cuối mỗi ngày (UTC) đặt lại. Số đo theo header của hãng; thao tác hãng không báo dùng ước lượng BUDGET_EST.
export type Budget = { user: number; unverified: number; global: number | null };
const BUDGET_KEY = "speech_budget";
// Mặc định thấp: tài khoản ElevenLabs là của chủ máy chủ, đăng ký mở nên vài người không được tiêu hết credit của cả tháng trong một ngày. Quản trị viên nâng được ở Cài đặt.
const BUDGET_DEF: Budget = { user: 3_000, unverified: 500, global: null };
const num0 = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
export function speechBudget(): Budget {
  let j: Partial<Budget> = {};
  try { j = JSON.parse(getSetting(BUDGET_KEY, "{}")) as Partial<Budget>; } catch {}
  return { user: num0(j.user, BUDGET_DEF.user), unverified: num0(j.unverified, BUDGET_DEF.unverified), global: j.global === null || j.global === undefined ? null : num0(j.global, 0) };
}
export function setSpeechBudget(b: Partial<Budget>) {
  const cur = speechBudget();
  setSetting(BUDGET_KEY, JSON.stringify({ user: num0(b.user, cur.user), unverified: num0(b.unverified, cur.unverified), global: b.global === undefined ? cur.global : b.global === null ? null : num0(b.global, cur.global ?? 0) }));
}
/** Mức chung của máy chủ mỗi ngày: quản trị viên đặt, không thì 1/10 credit của gói nhưng không quá 1/3 số còn lại (hết tháng vẫn còn giọng cho mọi người). Gói chưa đọc được thì 5.000. */
const globalLimit = () => {
  const set = speechBudget().global;
  if (set !== null) return set;
  const c = G().plan?.credits;
  return c?.limit ? Math.floor(Math.min(c.limit / 10, Math.max(0, c.limit - c.used) / 3)) : 5_000;
};
const day = () => new Date().toISOString().slice(0, 10);
let budgetReady = "";
function budgetDb() {
  const d = db(), today = day();
  if (budgetReady !== today) {
    // Bảng speech_budget: db/migrations/001_baseline.sql. Mỗi ngày một lần: bỏ ngân sách của các ngày đã qua.
    d.prepare("DELETE FROM speech_budget WHERE day < ?").run(new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10));
    budgetReady = today;
  }
  return d;
}
const ALL_USERS = "*";
export const spentToday = (uid = ALL_USERS) => (budgetDb().prepare("SELECT credits FROM speech_budget WHERE day = ? AND user_id = ?").get(day(), uid) as { credits: number } | undefined)?.credits ?? 0;
const ALERT_AT = 0.8;
let alerted = "";
export function addSpend(uid: string, n: number) {
  if (!(n > 0)) return;
  const d = budgetDb(), today = day(), st = d.prepare("INSERT INTO speech_budget (day, user_id, credits) VALUES (?, ?, ?) ON CONFLICT(day, user_id) DO UPDATE SET credits = credits + excluded.credits");
  st.run(today, uid, Math.ceil(n));
  st.run(today, ALL_USERS, Math.ceil(n));
  // Báo một lần mỗi ngày trong nhật ký quản trị khi mức chung sắp hết.
  const lim = globalLimit(), now = spentToday();
  if (lim > 0 && now >= lim * ALERT_AT && alerted !== today) {
    alerted = today;
    audit("speech_budget_alert", { detail: `${now} / ${lim}` });
    console.warn(`[speech] đã dùng ${now} / ${lim} credit ElevenLabs hôm nay`);
  }
}
/** Trước một thao tác tốn credit: báo lỗi có mã budget khi đã hết hạn mức (nơi gọi chuyển sang giọng của trình duyệt).
 * use: lời báo gợi ý cách thay thế đúng với việc đang làm (đọc / trò chuyện → giọng trình duyệt; chép lời tệp → micro của trình duyệt; còn lại → chờ hồi). */
export function checkBudget(u: UserRow, use: SpeechUse = "voice") {
  if (isAdmin(u)) return;
  const b = speechBudget(), mine = u.email_verified ? b.user : b.unverified;
  if (spentToday() >= globalLimit()) throw new SpeechErr(speechLimitMsg("all", globalLimit(), use), 429, "budget");
  if (spentToday(u.id) >= mine) throw new SpeechErr(speechLimitMsg("me", mine, use), 429, "budget");
}
/** Ai đang gọi: spent() tính credit vào đúng tài khoản mà không phải truyền qua từng công cụ. */
export const spender = new AsyncLocalStorage<string>();

// Giọng nhân bản hay tự thiết kế nằm chung một tài khoản ElevenLabs của máy chủ: giọng của một người không được lộ cho người khác.
// Quyết định của chủ sở hữu (2026-11-13): giọng nhân bản / tự thiết kế chỉ người tạo thấy và dùng; các tài khoản khác dùng giọng có sẵn; quản trị viên vẫn quản lý mọi giọng.
// Giọng tạo trước khi có bảng này: suy chủ từ lịch sử (backfillVoiceOwners). Không suy được (owner = null) thì ẨN với mọi thành viên — kể cả người tạo thật — cho tới khi
// quản trị viên gán chủ hoặc đánh dấu dùng chung (danh sách giọng của quản trị viên hiện chủ "none" để gán). Không bao giờ được tự chọn làm giọng mặc định (defaultVoice).
// user_id có thể là mã đặc biệt, không trùng tài khoản nào nên purgeRows không xóa mất:
export const VOICE_SHARED = "*shared"; // quản trị viên đánh dấu cho mọi thành viên
export const VOICE_PURGE = "*purge"; // chủ đã xóa tài khoản: chờ xóa trên ElevenLabs, lỗi thì lần sau thử lại
export const VOICE_ORPHAN = "*orphan"; // chủ suy từ lịch sử đã xóa tài khoản: không chắc là giọng của họ nên không tự xóa, chỉ quản trị viên quyết
// Bảng speech_voice_owner: db/migrations/001_baseline.sql, 002_reconcile.columns.json. source = 'history': chủ suy từ lịch sử, không phải người được ghi nhận lúc tạo.
function ownersDb() {
  return db();
}
export const setVoiceOwner = (voice: string, uid: string, source: "history" | null = null) => { ownersDb().prepare("INSERT OR REPLACE INTO speech_voice_owner (voice_id, user_id, created_at, source) VALUES (?, ?, ?, ?)").run(voice, uid, Date.now(), source); };
export const voiceOwner = (voice: string) => (ownersDb().prepare("SELECT user_id FROM speech_voice_owner WHERE voice_id = ?").get(voice) as { user_id: string } | undefined)?.user_id ?? null;
export const forgetVoiceOwner = (voice: string) => { ownersDb().prepare("DELETE FROM speech_voice_owner WHERE voice_id = ?").run(voice); };
export const ownedVoices = (uid: string) => (ownersDb().prepare("SELECT COUNT(*) AS n FROM speech_voice_owner WHERE user_id = ?").get(uid) as { n: number }).n;
/** Giọng riêng của người tạo, khác với giọng có sẵn và giọng lấy từ Thư viện. */
export const isPrivateVoice = (v: { category: string; lib?: boolean }) => !v.lib && ["cloned", "generated", "professional"].includes(v.category);
/** Thành viên này được thấy và dùng giọng riêng này không. Quản trị viên kiểm tra riêng ở nơi gọi.
 *  QUYẾT ĐỊNH CỦA CHỦ SỞ HỮU: giọng riêng (nhân bản / tự thiết kế) CHƯA rõ chủ (owner = null) KHÔNG hiện cho thành viên khác —
 *  chỉ chủ của nó và quản trị viên thấy. Trước đây chưa rõ chủ thì mở cho mọi người; đổi để giọng nhân bản mang tên chủ sở hữu
 *  (tài khoản của chủ là quản trị viên nên backfill không gán chủ, owner vẫn null) không lộ ra và không thành giọng mặc định của người khác. */
export const voiceOpenTo = (voice: string, uid: string) => { const o = voiceOwner(voice); return o === VOICE_SHARED || o === uid; };

// Ngôn ngữ của văn bản theo chữ viết (đủ để chọn giọng; model đa ngôn ngữ tự đọc đúng mọi ngôn ngữ nó hỗ trợ).
function textLang(t: string) {
  if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t)) return "vi";
  if (/[\u3040-\u30ff]/.test(t)) return "ja";
  if (/[\uac00-\ud7af]/.test(t)) return "ko";
  if (/[\u4e00-\u9fff]/.test(t)) return "zh";
  if (/[\u0e00-\u0e7f]/.test(t)) return "th";
  if (/[\u0400-\u04ff]/.test(t)) return "ru";
  return "en";
}
// Giọng có sẵn nghe tự nhiên ở nhiều ngôn ngữ (model đa ngôn ngữ), dùng khi tài khoản không có giọng riêng cho ngôn ngữ đó.
const PREFER = ["Sarah", "Jessica", "Alice", "Matilda", "Laura", "George", "Brian"];
/** Không chọn giọng: giọng riêng cùng ngôn ngữ với văn bản, rồi giọng có sẵn ưu tiên. Danh sách là của cả tài khoản ElevenLabs dùng chung, nên giọng riêng chỉ tính giọng của chính người này
 *  (kể cả quản trị viên): đọc to không được phát ra bằng giọng nhân bản của người khác, và lượt đọc đã lưu không được ghi mã giọng đó. */
export function defaultVoice(all: VoiceOut[], text: string, uid: string) {
  const list = all.filter((v) => { if (!isPrivateVoice(v)) return true; const o = voiceOwner(v.id); return o === uid || o === VOICE_SHARED; });
  const lang = textLang(text);
  const byName = (n: string) => list.find((v) => v.category === "premade" && v.name.toLowerCase() === n.toLowerCase());
  return list.find((v) => v.langCode.toLowerCase().startsWith(lang) && v.category !== "premade")?.id
    ?? list.find((v) => v.langCode.toLowerCase().startsWith(lang))?.id
    ?? PREFER.map(byName).find(Boolean)?.id ?? list.find((v) => v.category === "premade")?.id ?? list[0]?.id ?? PREMADE;
}

const voiceMeta = (meta: string) => {
  try {
    const m = JSON.parse(meta || "{}") as { voice?: unknown; lines?: { voice_id?: unknown }[] };
    return [m.voice, ...(Array.isArray(m.lines) ? m.lines.map((l) => l?.voice_id) : [])].filter((x): x is string => typeof x === "string" && !!x);
  } catch { return []; }
};
/** Giọng có từ trước khi có bảng chủ: người duy nhất từng dùng là chủ, để họ vẫn thấy giọng của mình và người khác thì không. Chạy đúng một lần: sau đó giọng chưa có chủ vẫn ẩn với
 *  thành viên (chỉ quản trị viên gán được), một người lạ dùng thử không được biến thành chủ. Quản trị viên không tính: họ thấy mọi giọng nên từng dùng không nói lên là của họ, và giọng họ làm cho mọi người phải giữ nguyên cho mọi người. */
export function backfillVoiceOwners(list: VoiceOut[]) {
  if (getSetting(VOICE_BACKFILL, "")) return 0;
  const users = new Map<string, Set<string>>();
  for (const r of items().prepare("SELECT user_id, meta FROM speech_items").iterate() as Iterable<{ user_id: string; meta: string }>) {
    for (const v of voiceMeta(r.meta)) { const s = users.get(v) ?? new Set<string>(); s.add(r.user_id); users.set(v, s); }
  }
  let n = 0;
  for (const v of list) {
    if (!isPrivateVoice(v) || voiceOwner(v.id) !== null) continue;
    const who = [...(users.get(v.id) ?? [])].map(getUser).filter((u): u is UserRow => !!u && !isAdmin(u));
    if (who.length === 1) { setVoiceOwner(v.id, who[0].id, "history"); n++; }
  }
  setSetting(VOICE_BACKFILL, String(Date.now()));
  if (n) console.log(`[speech] đã gán chủ cho ${n} giọng cũ theo lịch sử`);
  return n;
}
const VOICE_BACKFILL = "speech_voice_backfill";

// Route giữ danh sách giọng 10 phút: giọng vừa xóa ở nền thì không còn dòng chủ, nên danh sách cũ phải bỏ ngay, kẻo giọng đó hiện như chưa có chủ. Trên globalThis vì mỗi route có thể có bản mô-đun riêng.
const genStore = globalThis as unknown as { __synchroVoiceGen?: number };
export const voiceGen = () => genStore.__synchroVoiceGen ?? 0;
/** Thử xóa các giọng đang chờ trên ElevenLabs. Lỗi thì giữ dòng và ghi nhật ký, bộ hẹn giờ thử lại; giọng đã không còn thì coi như xong. Trả về số giọng còn chờ. */
export async function retryVoicePurges(timeout = 15_000) {
  const rows = ownersDb().prepare("SELECT voice_id FROM speech_voice_owner WHERE user_id = ?").all(VOICE_PURGE) as { voice_id: string }[];
  let left = 0;
  for (const { voice_id: id } of rows) {
    try {
      const k = conn();
      const r = await fetch(`${k.base}/v1/voices/${encodeURIComponent(id)}`, { method: "DELETE", headers: { [k.header]: k.key }, signal: AbortSignal.timeout(timeout) });
      const gone = r.ok || r.status === 404 || (r.status === 400 && /voice_does_not_exist|voice_not_found/.test(await r.text().catch(() => "")));
      if (!gone) throw new Error(`ElevenLabs ${r.status}`);
      forgetVoiceOwner(id);
      genStore.__synchroVoiceGen = voiceGen() + 1;
    } catch (e) { left++; console.error(`[speech] chưa xóa được giọng ${id} của tài khoản đã xóa, sẽ thử lại:`, (e as Error).message); }
  }
  return left;
}
/** Xóa tài khoản: giọng người này tạo được xóa khỏi tài khoản ElevenLabs dùng chung. Đổi chủ trước khi gọi mạng: purgeRows sẽ xóa dòng theo user_id, mà dòng này vừa là bản ghi để thử lại, vừa giữ giọng ẩn trong lúc chờ.
 *  Giọng chỉ suy từ lịch sử có thể là của người khác nên không tự xóa: để quản trị viên quyết. Không còn liên kết tới tài khoản đã xóa ở cả hai trường hợp. */
export async function purgeUserVoices(uid: string) {
  const d = ownersDb();
  d.prepare("UPDATE speech_voice_owner SET user_id = ? WHERE user_id = ? AND source = 'history'").run(VOICE_ORPHAN, uid);
  d.prepare("UPDATE speech_voice_owner SET user_id = ? WHERE user_id = ?").run(VOICE_PURGE, uid);
  return retryVoicePurges();
}
/** Mỗi thành viên giữ tối đa chừng này giọng riêng: số chỗ của tài khoản ElevenLabs có hạn và dùng chung. */
export const MAX_OWN_VOICES = 3;
export async function need(f: Feat) {
  const p = await plan();
  if (!p.connected) throw new SpeechErr(p.note ?? "Chưa gắn khóa ElevenLabs. Quản trị viên vào Cài đặt → Providers để thêm khóa.", 503, "no_key");
  if (p.perms[f]) throw new SpeechErr(`Khóa ElevenLabs chưa được cấp quyền "${p.perms[f]}" nên tính năng này đang ẩn. Vào elevenlabs.io → API keys, sửa khóa và bật quyền này.`, 403, "perm");
  if (!p.features[f]) throw new SpeechErr(p.locked[f] ? "Gói ElevenLabs hiện tại chưa có tính năng này." : `Tính năng này cần gói ElevenLabs ${TIER_NAME[MIN[f]] ?? "cao hơn"} trở lên.`, 403, "plan");
  return p;
}

// ---- giọng nói ----
export type VoiceOut = {
  id: string; name: string; desc: string; lang: string; langCode: string; accent: string; gender: string; age: string; use: string; category: string;
  preview: string | null; mine: boolean; owner?: string; free?: boolean; uses?: number; notice?: number | null; added?: boolean;
  /** Giọng lấy từ Thư viện (không phải giọng có sẵn hay giọng của chính tài khoản): gói Free không dùng được qua API. */
  lib?: boolean;
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
  verified_languages?: { language?: string; accent?: string; preview_url?: string | null }[] | null; sharing?: { public_owner_id?: string } | null; is_owner?: boolean };
export const voiceOut = (v: VoiceRaw): VoiceOut => {
  const lb = v.labels ?? {}, vl = v.verified_languages?.[0];
  const code = lb.language ?? vl?.language ?? "";
  return {
    id: v.voice_id, name: v.name.split(" - ")[0].trim(), desc: cap(lb.descriptive ?? lb.description ?? v.description?.split(/[.;\n]/)[0] ?? ""), lang: langName(code), langCode: code,
    accent: cap(lb.accent ?? vl?.accent ?? ""), gender: vi(lb.gender), age: vi(lb.age), use: vi(lb.use_case), category: v.category ?? "premade",
    preview: v.preview_url ?? vl?.preview_url ?? null, mine: true, owner: v.sharing?.public_owner_id,
    lib: v.is_owner !== true && ["professional", "famous", "high_quality"].includes(v.category ?? ""),
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
// Bảng speech_items: db/migrations/001_baseline.sql.
const items = () => db();
type ItemRow = { id: string; user_id: string; kind: string; title: string; meta: string; file: string | null; mime: string | null; size: number; created_at: number };
const KEEP = 300;
const dirOf = (u: UserRow) => path.join(DATA_DIR, "speech", u.id.replace(/[^\w-]/g, ""));
const rowOut = (r: ItemRow): Item => ({ id: r.id, kind: r.kind, title: r.title, meta: JSON.parse(r.meta || "{}"), mime: r.mime, size: r.size, createdAt: r.created_at, url: r.file ? `/api/speech/file?id=${r.id}` : null });

/** Xóa tài khoản: tệp âm thanh trên đĩa (các dòng speech_items do purge.ts xóa). */
export function removeUserSpeech(uid: string) {
  const safe = uid.replace(/[^\w-]/g, "");
  if (safe) fs.rmSync(path.join(DATA_DIR, "speech", safe), { recursive: true, force: true });
}

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
