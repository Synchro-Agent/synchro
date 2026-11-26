// Khóa API của các nhà cung cấp model (chỉ chạy ở máy chủ).
// Quản trị viên nhập khóa ở Cài đặt → Providers; khóa được mã hóa AES-256-GCM rồi lưu trong SQLite, không bao giờ gửi về trình duyệt.
// Khi lưu, máy chủ gọi thử API của hãng để kiểm tra khóa và lấy danh sách model thật mà khóa đó được dùng.
import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, db, getSetting, setSetting } from "./authstore";
import { ALL, modelKey, splitKey, type ModelInfo, type ProviderInfo, type ProviderKind } from "../shared/catalog";
import { datedDuplicate, nonChat, providerPrice } from "../shared/modelrules";
import { isNewModel, regPinned, regShows, sinceOf, syncListed, untested } from "./modelreg";
import type { Listed, ModelCaps } from "./modelreg";
import { brandHost, publicHost } from "./iconproxy";
import { hostLogo } from "../shared/vendorlogo";

type Builtin = { kind: ProviderKind; name: string; vendor: string; base: string; keyUrl: string; prefix: string };
export const BUILTIN: Record<string, Builtin> = {
  anthropic: { kind: "anthropic", name: "Claude", vendor: "Anthropic", base: "https://api.anthropic.com", keyUrl: "https://platform.claude.com/settings/keys", prefix: "sk-ant-" },
  openai: { kind: "openai", name: "ChatGPT", vendor: "OpenAI", base: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", prefix: "sk-" },
  google: { kind: "google", name: "Gemini", vendor: "Google", base: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", prefix: "AIza" },
  xai: { kind: "xai", name: "Grok", vendor: "xAI", base: "https://api.x.ai/v1", keyUrl: "https://console.x.ai", prefix: "xai-" },
  deepseek: { kind: "deepseek", name: "DeepSeek", vendor: "DeepSeek", base: "https://api.deepseek.com", keyUrl: "https://platform.deepseek.com/api_keys", prefix: "sk-" },
  elevenlabs: { kind: "elevenlabs", name: "ElevenLabs", vendor: "ElevenLabs", base: "https://api.elevenlabs.io", keyUrl: "https://elevenlabs.io/app/settings/api-keys", prefix: "sk_" },
  // Tạo ảnh (FLUX 1.1 Pro Ultra, IC-Light) bằng khóa của chủ máy chủ: server/ai/replicate.ts. Chưa có khóa thì ảnh vẫn đi qua gói của từng người.
  replicate: { kind: "replicate", name: "Replicate", vendor: "Replicate", base: "https://api.replicate.com/v1", keyUrl: "https://replicate.com/account/api-tokens", prefix: "r8_" },
};
/** Dịch vụ không phải model chat (giọng nói, connector, tạo ảnh): không có model trong bộ chọn model, không tính là khóa chat dùng chung. */
export const SERVICE_KINDS: ReadonlySet<ProviderKind> = new Set<ProviderKind>(["elevenlabs", "replicate"]);
export const isService = (kind: string) => SERVICE_KINDS.has(kind as ProviderKind);

type Row = { id: string; kind: ProviderKind; name: string; base_url: string | null; workspace_id?: string | null; enc_key: string; key_hint: string; models: string; status: string; error: string | null; info: string | null; checked_at: number | null; created_at: number; updated_at: number };

let ready = false;
function table() {
  const d = db();
  if (!ready) {
    // Bảng api_providers (cột workspace_id: khóa Anthropic không gắn với workspace, mỗi lời gọi phải nêu workspace): db/migrations/001_baseline.sql, 002_reconcile.columns.json.
    // Khóa dự án Composio dùng chung đã bỏ (mỗi người tự liên kết Composio của mình): không giữ khóa cũ của quản trị viên trong cơ sở dữ liệu.
    d.prepare("DELETE FROM api_providers WHERE id = 'composio' OR kind = 'composio'").run();
    ready = true;
  }
  return d;
}

// ---- mã hóa: khóa bí mật lấy từ DATA_KEY, hoặc tự tạo một lần trong thư mục dữ liệu (quyền 600) ----
let secret: Buffer | null = null;
function master() {
  if (secret) return secret;
  let raw = process.env.DATA_KEY ?? "";
  if (!raw) {
    const f = path.join(DATA_DIR, "secret.key");
    try { raw = fs.readFileSync(f, "utf8").trim(); } catch {}
    if (!raw) { raw = crypto.randomBytes(32).toString("base64"); fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, raw, { mode: 0o600 }); }
  }
  return (secret = crypto.createHash("sha256").update(`synchro-api:${raw}`).digest());
}
const seal = (plain: string) => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", master(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
};
const open = (box: string) => {
  const [iv, tag, enc] = box.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", master(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
};
// Dùng chung để mã hóa khóa và token của connector.
export const sealSecret = seal;
export const openSecret = open;
const hint = (k: string) => (k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : "••••");

// ---- danh sách model của từng hãng ----
// Chỉ giữ model nhắn tin: bỏ model ảnh, giọng nói, realtime, embedding, kiểm duyệt, code chuyên dụng, model cần duyệt riêng và bản chụp có ngày.
const OPENAI_SKIP = /(embedding|tts|whisper|transcribe|audio|realtime|live|translate|image|dall-e|sora|moderation|search|computer-use|codex|deep-research|cyber|rosalind|daybreak|oss|instruct|davinci|babbage|-\d{4}-\d{2}-\d{2}$|-\d{4}$)/i;
const GOOGLE_SKIP = /(embedding|aqa|imagen|veo|tts|image|live|native-audio|transcribe|translate|omni|robotics|computer-use|learnlm)/i;
const COMPAT_SKIP = /(embed|tts|whisper|moderation|dall-e|image|rerank|guard)/i;
// xAI: bỏ model tạo ảnh / video (grok-imagine…), giọng nói và bản chụp có ngày (đã có tên chung trỏ tới bản mới nhất).
const XAI_SKIP = /(imagine|image|video|vision-beta|tts|voice|audio|realtime|embed|-\d{4}$|-\d{8}$)/i;
// "grok-4.7" → "Grok 4.7", "grok-4.20-0309-reasoning" → "Grok 4.20 Reasoning", "grok-build-0.1" → "Grok Build 0.1".
export const prettyGrok = (id: string) => id.replace(/-0\d{3}(?=-|$)/, "").split("-").map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
// "deepseek-flash" → "DeepSeek Flash", "deepseek-v4-pro" → "DeepSeek V4 Pro".
const prettyDeepSeek = (id: string) => id.split("-").map((w) => (w === "deepseek" ? "DeepSeek" : /^v\d/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
// "gpt-6-astra" → "GPT-6 Astra", "gpt-5.5-pro" → "GPT-5.5 Pro", "chat-latest" → "ChatGPT Latest"; dòng o giữ nguyên ("o3").
const prettyOpenAI = (id: string) => {
  if (id === "chat-latest") return "ChatGPT Latest";
  const m = /^(gpt|chatgpt)-([\d.]+o?)(?:-(.+))?$/i.exec(id);
  if (!m) return id;
  return `${m[1].toLowerCase() === "gpt" ? "GPT" : "ChatGPT"}-${m[2]}${m[3] ? " " + m[3].split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : ""}`;
};

/** Tên quyền ElevenLabs còn thiếu trong thông báo lỗi ("…missing the permission convai_write…"), không có thì null. */
export const elevenMissing = (msg: string) => /missing the permission ([\w.-]+)/i.exec(msg)?.[1] ?? (/missing_permissions/i.test(msg) ? "?" : null);

async function getJson(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) }).catch((e) => { throw new Error(`Không kết nối được tới ${new URL(url).host}: ${(e as Error).message}`); });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); msg = j.error?.message ?? j.detail?.message ?? j.message ?? msg; } catch {}
    throw new Error(r.status === 401 || r.status === 403 ? `Khóa không hợp lệ hoặc không có quyền (${r.status}): ${msg}` : `Lỗi ${r.status}: ${msg}`);
  }
  try { return JSON.parse(text); } catch { throw new Error("Máy chủ trả về dữ liệu không đọc được (có đúng địa chỉ API không?)"); }
}

// Đời cũ đã biết tới tháng 10/2026 (bảng đóng băng, không cần sửa nữa): các dòng mà hãng đã đưa về "legacy" trên web chính thức lúc đó.
// Model ra mắt sau này không khớp mẫu nào nên tự hiện; đời cũ về sau được sổ model tự ẩn (server/modelreg.ts: một dòng có bản mới thì chỉ giữ
// hai bản mới nhất, hãng gỡ model thì chuyển người đang dùng sang bản thay thế). Mẫu chỉ khớp đúng các đời đã biết: "o5", "grok-5-fast",
// "claude-6-opus" (nếu hãng đổi cách đặt tên) vẫn hiện.
const LEGACY: Partial<Record<ProviderKind, RegExp>> = {
  anthropic: /^claude-(instant|[1-3](-|\.|$)|(opus|sonnet|haiku)-[1-4]\b|(fable|opus|sonnet|haiku)-5($|-\d{8}$))/,
  openai: /^(gpt-[1-5]|o[1-4](-|$)|chatgpt|chat-latest|gpt-6-sol$)/,
  google: /^gemini-([12][.-]|3-|3\.6-|3\.1-flash|3\.5-flash$)/,
  // Grok 4.5 trở lên và Grok Build là dòng hiện tại; 2 / 3 / 4.0–4.3 / 4.1x / 4.20, "fast", "code-fast" là đời cũ.
  xai: /^grok-([1-3]\b|[1-3]-|4($|-)|4\.[0-4](\D|$)|4\.[12]\d|code|beta|vision)/,
  // deepseek-chat / deepseek-reasoner (V3) và tên cũ của V4 Flash (đã gộp vào deepseek-flash).
  deepseek: /^deepseek-(chat|reasoner|coder|v[23]|v4-flash)/,
};
const isCurrent = (kind: ProviderKind, id: string) => !LEGACY[kind]?.test(id);

// ---- khóa Anthropic không gắn với workspace (khóa cá nhân, khóa service account) ----
const NOT_SCOPED = /not scoped to a workspace/i;
const WORKSPACE_ID = /^wrkspc_[A-Za-z0-9_-]{4,64}$/;
export const WORKSPACE_HEADER = "anthropic-workspace-id";
export class WorkspaceNeeded extends Error {
  constructor(public workspaces: { id: string; name: string }[]) {
    super(workspaces.length ? "Khóa này dùng được cho nhiều workspace. Hãy chọn workspace để chạy và tính phí." : "Khóa này dùng được cho nhiều workspace nên cần biết chạy ở workspace nào. Hãy dán ID workspace ở mục Nâng cao, hoặc tạo khóa gắn với một workspace.");
  }
}
/** Các workspace khóa này vào được. Trang này chỉ dành cho vai trò quản trị của tổ chức, nên không đọc được thì trả rỗng để người dùng tự dán ID. */
async function anthropicWorkspaces(base: string, key: string): Promise<{ id: string; name: string }[]> {
  const j = await getJson(`${base.replace(/\/+$/, "")}/v1/organizations/workspaces?include_default=true&limit=100`, { "x-api-key": key, "anthropic-version": "2023-06-01" }).catch(() => null) as { data?: { id: string; name?: string; archived_at?: string | null }[] } | null;
  return (j?.data ?? []).filter((w) => WORKSPACE_ID.test(w.id) && !w.archived_at).map((w) => ({ id: w.id, name: w.name || w.id }));
}
const workspaceFailure = (e: unknown, ws: string) => /^Lỗi 404/.test((e as Error).message) && /workspace/i.test((e as Error).message) ? new Error(`Không tìm thấy workspace ${ws}, hoặc khóa này không có quyền vào workspace đó.`) : e;

/** Danh sách model chat hiện tại (bỏ đời cũ) — dùng khi lưu khóa. all: mọi model chat hãng trả về, kèm thông tin hãng tự báo (ghi vào sổ model). */
export async function listModels(kind: ProviderKind, base: string, key: string, workspace?: string | null): Promise<{ models: { id: string; name: string }[]; all: Listed[]; info?: string }> {
  const r = await listAll(kind, base, key, workspace);
  // Luật chung (shared/modelrules.ts) loại thêm model không dùng để nhắn tin và bản chụp có ngày trùng tên chung, kể cả loại hãng mới đặt ra sau này.
  const ids = new Set(r.models.map((m) => m.id.toLowerCase()));
  // Nhà cung cấp tương thích chứa model của nhiều hãng (OpenRouter…): chỉ loại loại chắc chắn không nhắn tin, như trước khi có sổ model.
  const all = r.models.filter((m) => !nonChat(m.id, { loose: kind === "compatible" }) && !datedDuplicate(m.id, ids));
  return { info: r.info, all, models: all.filter((m) => isCurrent(kind, m.id)).map((m) => ({ id: m.id, name: m.name })) };
}
const ms = (v: unknown) => { const t = typeof v === "number" ? (v < 1e11 ? v * 1000 : v) : typeof v === "string" ? Date.parse(v) : NaN; return isFinite(t) && t > 0 ? t : null; };
const posInt = (v: unknown) => (typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v) : null);
const sup = (x: unknown) => !!(x && typeof x === "object" && (x as { supported?: unknown }).supported === true);
/** Khả năng Anthropic báo trong /v1/models (capabilities: image_input, thinking.types.adaptive, effort.low…max). */
function anthropicCaps(c: unknown): ModelCaps {
  if (!c || typeof c !== "object") return {};
  const x = c as Record<string, Record<string, unknown> & { types?: Record<string, unknown> }>, out: ModelCaps = {};
  if (x.image_input) out.vision = sup(x.image_input);
  if (x.thinking) out.thinking = sup(x.thinking.types?.adaptive) ? "adaptive" : sup(x.thinking.types?.enabled) ? "budget" : "none";
  if (x.effort) out.effort = sup(x.effort) ? ["low", "medium", "high", "xhigh", "max"].filter((l) => sup(x.effort[l])) : [];
  return out;
}
async function listAll(kind: ProviderKind, base: string, key: string, workspace?: string | null): Promise<{ models: Listed[]; info?: string }> {
  const b = base.replace(/\/+$/, "");
  if (kind === "anthropic") {
    const j = await getJson(`${b}/v1/models?limit=1000`, { "x-api-key": key, "anthropic-version": "2023-06-01", ...(workspace ? { [WORKSPACE_HEADER]: workspace } : {}) });
    return { models: (j.data ?? []).map((m: { id: string; display_name?: string; created_at?: string; max_input_tokens?: number; max_tokens?: number; capabilities?: unknown }) =>
      ({ id: m.id, name: m.display_name || m.id, created: ms(m.created_at), ctx: posInt(m.max_input_tokens), maxOut: posInt(m.max_tokens), caps: anthropicCaps(m.capabilities) })) };
  }
  if (kind === "google") {
    const root = b.replace(/\/openai$/, "");
    const j = await getJson(`${root}/models?pageSize=1000&key=${encodeURIComponent(key)}`, {});
    const list = (j.models ?? []) as { name: string; displayName?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number; outputTokenLimit?: number; thinking?: boolean }[];
    return { models: list.filter((m) => m.name.includes("gemini") && (m.supportedGenerationMethods ?? []).includes("generateContent") && !GOOGLE_SKIP.test(m.name)).map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName || m.name,
      ctx: posInt(m.inputTokenLimit), maxOut: posInt(m.outputTokenLimit), caps: m.thinking === false ? { effort: [] } : {} })) };
  }
  if (kind === "elevenlabs") {
    // /v1/user chỉ để hiện tên gói. Khóa giới hạn quyền (không bật User) bị báo "missing the permission user_read" nhưng vẫn là khóa đúng
    // (khóa sai báo invalid_api_key), nên vẫn nhận; quyền còn thiếu cho giọng nói được báo đúng tên khi mở phiên.
    const j = await getJson(`${b}/v1/user`, { "xi-api-key": key }).catch((e: Error) => { if (elevenMissing(e.message)) return null; throw e; });
    const tier = j?.subscription?.tier as string | undefined;
    return { models: [], info: tier || undefined };
  }
  if (kind === "replicate") {
    // GET /v1/account kiểm tra khóa (tên tài khoản hiện ở thẻ), rồi đọc sẵn lược đồ tham số của hai model.
    const { checkKey } = await import("./ai/replicate");
    return { models: [], ...(await checkKey(b, key)) };
  }
  const j = await getJson(`${b}/models`, { Authorization: `Bearer ${key}` });
  type Raw = { id: string; created?: number; name?: string; context_length?: number; pricing?: unknown };
  const meta = (m: Raw) => ({ created: ms(m.created), ...(posInt(m.context_length) ? { ctx: posInt(m.context_length) } : {}), price: providerPrice(m) });
  const list = ((j.data ?? j.models ?? []) as Raw[]).filter((m) => typeof m.id === "string");
  if (kind === "openai") {
    return { models: list.filter((m) => /^(gpt|o\d|chatgpt|chat-latest)/i.test(m.id) && !OPENAI_SKIP.test(m.id)).sort((x, y) => (y.created ?? 0) - (x.created ?? 0)).map((m) => ({ id: m.id, name: prettyOpenAI(m.id), ...meta(m) })) };
  }
  if (kind === "xai") {
    // Mới nhất trước (grok-4.7 rồi 4.6…); xAI không trả tên hiển thị nên tự đặt.
    const ver = (id: string) => Number(/^grok-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
    return { models: list.filter((m) => /^grok/i.test(m.id) && !XAI_SKIP.test(m.id)).sort((x, y) => ver(y.id) - ver(x.id) || (y.created ?? 0) - (x.created ?? 0)).map((m) => ({ id: m.id, name: prettyGrok(m.id), ...meta(m) })) };
  }
  if (kind === "deepseek") {
    // Số dư thật của khóa (GET /user/balance) hiện cạnh tên gói, như gói của ElevenLabs.
    const bal = await getJson(`${b}/user/balance`, { Authorization: `Bearer ${key}` }).catch(() => null) as { is_available?: boolean; balance_infos?: { currency: string; total_balance: string }[] } | null;
    const info = bal?.balance_infos?.length ? `${bal.balance_infos.map((x) => `${x.total_balance} ${x.currency}`).join(" + ")}${bal.is_available === false ? " (top up needed)" : ""}` : undefined;
    return { models: list.filter((m) => /^deepseek/i.test(m.id) && !COMPAT_SKIP.test(m.id)).map((m) => ({ id: m.id, name: prettyDeepSeek(m.id), ...meta(m) })), info };
  }
  return { models: list.filter((m) => !COMPAT_SKIP.test(m.id)).map((m) => ({ id: m.id, name: m.name || m.id, ...meta(m) })) };
}

// ---- nhà cung cấp lấy từ biến môi trường (cấu hình cũ), dùng khi chưa nhập khóa đó trong Cài đặt ----
type Virtual = { id: string; kind: ProviderKind; name: string; base: string; key: string; workspace?: string };
function envProvider(): Virtual | null {
  const p = process.env.LLM_PROVIDER ?? "anthropic", key = process.env.LLM_API_KEY ?? "";
  if (p === "mock") return { id: "mock", kind: "mock", name: "Synchro (thử nghiệm)", base: "", key: "" };
  if (!key) return null;
  if (p === "anthropic") return { id: "anthropic", kind: "anthropic", name: "Claude", base: BUILTIN.anthropic.base, key, workspace: process.env.ANTHROPIC_WORKSPACE_ID || undefined };
  return { id: "env", kind: "compatible", name: "Máy chủ (biến môi trường)", base: process.env.LLM_BASE_URL ?? BUILTIN.openai.base, key };
}
// Bộ nhớ đệm giữ mọi model chat hãng trả về; lọc (đời cũ, sổ model) mỗi lần đọc như khóa đã lưu (stored), để model chưa thử đạt hay quản trị viên
// vừa ẩn không hiện suốt 6 giờ bộ nhớ đệm, và model đời cũ quản trị viên ghim vẫn hiện.
const envCache: { at: number; models: { id: string; name: string }[]; sync?: { added: string[]; gone: string[] }; error?: string } = { at: 0, models: [] };
async function envModels(v: Virtual) {
  if (v.kind === "mock") return [{ id: "synchro-mock", name: "Synchro Mock" }];
  if (!(Date.now() - envCache.at < 6 * 3600_000 && envCache.models.length)) {
    try {
      const r = await listModels(v.kind, v.base, v.key, v.workspace);
      envCache.models = r.all.map((m) => ({ id: m.id, name: m.name })); envCache.at = Date.now();
      envCache.sync = syncListed(v.id, v.kind, r.all);
    } catch (e) { envCache.at = Date.now(); envCache.error = (e as Error).message; }
  }
  return envCache.models.filter((m) => { const k = modelKey(v.id, m.id); return (isCurrent(v.kind, m.id) || regPinned(k)) && regShows(k); });
}

const rows = () => table().prepare("SELECT * FROM api_providers ORDER BY created_at").all() as Row[];
const rowById = (id: string) => table().prepare("SELECT * FROM api_providers WHERE id = ?").get(id) as Row | undefined;
const parse = (s: string) => { try { return JSON.parse(s) as { id: string; name: string }[]; } catch { return []; } };
// Danh sách đã lưu cũng lọc lại, để model vừa thành đời cũ biến mất mà không cần làm mới khóa. Sổ model quyết định thêm: model mới chưa thử đạt,
// model quản trị viên ẩn, model đã cũ thì không hiện; model quản trị viên ghim thì hiện cả khi là đời cũ.
const stored = (r: Row) => parse(r.models).filter((m) => { const k = modelKey(r.id, m.id); return (isCurrent(r.kind, m.id) || regPinned(k)) && regShows(k); });
const info = (key: string, id: string, name: string): ModelInfo => {
  const since = sinceOf(key);
  return { key, id, name, ...(isNewModel(key) ? { isNew: true } : {}), ...(since ? { since } : {}) };
};

// Logo của nhà cung cấp tương thích OpenAI theo địa chỉ API: hãng đã biết (api.groq.com → groq), tên miền công khai khác → "site" (biểu tượng trang
// tải hộ qua /api/favicon?p=<id>), địa chỉ nội bộ / máy riêng → không có (giao diện lấy logo theo dòng model hoặc chữ cái đầu).
function logoHint(base: string): string | undefined {
  let host = "";
  try { host = new URL(base).host; } catch { return undefined; }
  return hostLogo(host) ?? (providerSite(base) ? "site" : undefined);
}
/** Tên miền công khai để lấy biểu tượng trang của một nhà cung cấp (tên miền thương hiệu của địa chỉ API), null khi là địa chỉ nội bộ. */
function providerSite(base: string): string | null {
  try { const h = publicHost(new URL(base).hostname); return h ? publicHost(brandHost(h)) : null; } catch { return null; }
}
/** Biểu tượng trang của nhà cung cấp theo mã (cho /api/favicon?p=…): địa chỉ API chỉ đọc ở máy chủ. */
export function providerSiteOf(id: string): string | null {
  const r = rowById(id);
  if (r) return r.kind === "compatible" && r.base_url ? providerSite(r.base_url) : null;
  const v = envProvider();
  return v && v.id === id && v.kind === "compatible" ? providerSite(v.base) : null;
}

// Mọi nhà cung cấp chat đang dùng được, kèm danh sách model (không gồm ElevenLabs vì chỉ dùng cho giọng nói).
export async function catalog(): Promise<ProviderInfo[]> {
  const out: ProviderInfo[] = [];
  const have = new Set<string>();
  for (const r of rows()) {
    have.add(r.id);
    if (isService(r.kind)) continue;
    const logo = r.kind === "compatible" ? logoHint(r.base_url ?? "") : undefined;
    out.push({ id: r.id, name: r.name, kind: r.kind, models: stored(r).map((m) => info(modelKey(r.id, m.id), m.id, m.name)), ...(logo ? { logo } : {}) });
  }
  const v = envProvider();
  const vlogo = v?.kind === "compatible" ? logoHint(v.base) : undefined;
  if (v && !have.has(v.id)) out.unshift({ id: v.id, name: v.name, kind: v.kind, models: (await envModels(v)).map((m) => info(modelKey(v.id, m.id), m.id, m.name)), ...(vlogo ? { logo: vlogo } : {}) });
  return out.filter((p) => p.models.length);
}

/** Máy chủ có model chat qua khóa API dùng chung không. Không gọi mạng: trang đăng nhập hỏi mỗi lần tải. */
export const hasSharedChat = () => !!envProvider() || rows().some((r) => !isService(r.kind) && stored(r).length > 0);

export type Target = { provider: string; kind: ProviderKind; base: string; key: string; model: string; workspace?: string };
// Từ khóa model ("openai/gpt-5.1") → địa chỉ, khóa và mã model để gọi. Model sổ model chưa thử đạt: null (chat không chạy trên nó, kể cả khi
// ai đó gửi thẳng mã model mà bộ chọn không hiện), trừ lần thử của chính sổ model và nút "Gửi thử" của quản trị viên (untested: true).
export async function resolveModel(key: string, o: { untested?: boolean } = {}): Promise<Target | null> {
  const { provider, id } = splitKey(key);
  if (!provider || !id) return null;
  if (!o.untested && untested(key)) return null;
  const r = rowById(provider);
  if (r && !isService(r.kind)) {
    try { return { provider, kind: r.kind, base: (r.base_url || BUILTIN[r.kind]?.base || "").replace(/\/+$/, ""), key: open(r.enc_key), model: id, ...(r.workspace_id ? { workspace: r.workspace_id } : {}) }; } catch { return null; }
  }
  const v = envProvider();
  if (v && v.id === provider) return { provider, kind: v.kind, base: v.base.replace(/\/+$/, ""), key: v.key, model: id, ...(v.workspace ? { workspace: v.workspace } : {}) };
  return null;
}
// Khóa cho dịch vụ không phải chat (ElevenLabs, Replicate): khóa quản trị viên nhập ở Providers, không có thì lấy ở biến môi trường.
// Composio không còn khóa dự án chung: mỗi tài khoản tự liên kết Composio Connect của mình (server/composio.ts).
const ENV_KEY: Record<"elevenlabs" | "replicate", string> = { elevenlabs: "ELEVENLABS_API_KEY", replicate: "REPLICATE_API_TOKEN" };
const envKeyOf = (id: string) => (id in ENV_KEY ? process.env[ENV_KEY[id as keyof typeof ENV_KEY]] ?? "" : "");
export function serviceKey(id: "elevenlabs" | "replicate"): { key: string; base: string } | null {
  const r = rowById(id);
  if (r) { try { return { key: open(r.enc_key), base: (r.base_url || BUILTIN[id].base).replace(/\/+$/, "") }; } catch { return null; } }
  const k = envKeyOf(id);
  return k ? { key: k, base: BUILTIN[id].base.replace(/\/+$/, "") } : null;
}

// Model embedding cho tìm kiếm ngữ nghĩa (bộ não, tài liệu dự án): dùng lại khóa OpenAI / Gemini quản trị viên đã nhập, không thêm khóa mới.
// SYNCHRO_EMBED_MODEL="openai/text-embedding-3-large" chọn model khác; không có khóa nào thì trả null và tìm kiếm chỉ dùng từ khóa.
const EMBED_DEFAULT: Partial<Record<ProviderKind, string>> = { openai: "text-embedding-3-small", google: "gemini-embedding-001" };
export type EmbedTarget = { provider: string; kind: ProviderKind; base: string; key: string; model: string; modelKey: string };
export function embedTarget(): EmbedTarget | null {
  const want = (process.env.SYNCHRO_EMBED_MODEL ?? "").trim();
  if (want === "off") return null;
  const [wp, ...rest] = want.split("/"), wm = rest.join("/");
  const list = rows().filter((r) => (r.kind === "openai" || r.kind === "google") && r.status !== "error");
  const r = want ? list.find((x) => x.id === wp) : list.find((x) => x.kind === "openai") ?? list.find((x) => x.kind === "google");
  if (!r) return null;
  const model = (want && wm) || EMBED_DEFAULT[r.kind]!;
  try { return { provider: r.id, kind: r.kind, base: (r.base_url || BUILTIN[r.kind]?.base || "").replace(/\/+$/, ""), key: open(r.enc_key), model, modelKey: modelKey(r.id, model) }; } catch { return null; }
}

// ---- danh sách cho trang quản lý API (khóa chỉ hiện dạng che) ----
export type AdminProvider = { id: string; kind: ProviderKind; name: string; vendor: string; builtin: boolean; configured: boolean; source: "db" | "env" | null;
  baseUrl: string; workspaceId: string; defaultBase: string; keyHint: string | null; keyUrl: string | null; prefix: string | null; status: "ok" | "error" | null; error: string | null; info: string | null;
  checkedAt: number | null; models: { key: string; name: string }[] };
export async function adminList(): Promise<AdminProvider[]> {
  const list = rows();
  const v = envProvider();
  const out: AdminProvider[] = Object.entries(BUILTIN).map(([id, b]) => {
    const r = list.find((x) => x.id === id);
    // Khóa ở biến môi trường: LLM_API_KEY (Claude), ELEVENLABS_API_KEY, COMPOSIO_API_KEY hoặc REPLICATE_API_TOKEN.
    const envKey = r ? "" : v && v.id === id ? v.key : envKeyOf(id);
    return { id, kind: b.kind, name: b.name, vendor: b.vendor, builtin: true, configured: !!r || !!envKey, source: r ? "db" : envKey ? "env" : null,
      baseUrl: r?.base_url ?? "", workspaceId: r?.workspace_id ?? "", defaultBase: b.base, keyHint: r ? r.key_hint : envKey ? hint(envKey) : null, keyUrl: b.keyUrl, prefix: b.prefix,
      status: r ? (r.status as "ok" | "error") : envKey ? "ok" : null, error: r?.error ?? null, info: r?.info ?? null, checkedAt: r?.checked_at ?? null,
      models: r ? stored(r).map((m) => ({ key: modelKey(id, m.id), name: m.name })) : [] };
  });
  for (const r of list.filter((x) => !BUILTIN[x.id])) out.push({ id: r.id, kind: r.kind, name: r.name, vendor: "Tương thích OpenAI", builtin: false, configured: true, source: "db",
    baseUrl: r.base_url ?? "", workspaceId: "", defaultBase: "", keyHint: r.key_hint, keyUrl: null, prefix: null, status: r.status as "ok" | "error", error: r.error, info: r.info, checkedAt: r.checked_at,
    models: stored(r).map((m) => ({ key: modelKey(r.id, m.id), name: m.name })) });
  if (v && (v.id === "env" || v.id === "mock") && !list.some((x) => x.id === v.id)) {
    const ms = await envModels(v);
    out.push({ id: v.id, kind: v.kind, name: v.name, vendor: "Biến môi trường máy chủ", builtin: false, configured: true, source: "env", baseUrl: v.base, workspaceId: "", defaultBase: v.base, keyHint: v.key ? hint(v.key) : null,
      keyUrl: null, prefix: null, status: "ok", error: null, info: null, checkedAt: null, models: ms.map((m) => ({ key: modelKey(v.id, m.id), name: m.name })) });
  }
  // Khóa ở biến môi trường của Claude: hiện danh sách model thật để quản trị viên chọn.
  const a = out.find((p) => p.id === "anthropic" && p.source === "env");
  if (a && v) a.models = (await envModels(v)).map((m) => ({ key: modelKey("anthropic", m.id), name: m.name }));
  return out;
}

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "api";
const okUrl = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; } };

// Lưu (hoặc thay) khóa: luôn kiểm tra với API của hãng trước, khóa sai thì không lưu.
export async function saveProvider(o: { id?: string; kind?: string; name?: string; key?: string; baseUrl?: string; workspaceId?: string }) {
  const builtin = o.id && BUILTIN[o.id] ? BUILTIN[o.id] : null;
  const old = o.id ? rowById(o.id) : undefined;
  if (o.id && !builtin && !old) throw new Error("Không tìm thấy nhà cung cấp này.");
  const kind: ProviderKind = builtin?.kind ?? old?.kind ?? "compatible";
  const name = (builtin?.name ?? (o.name?.trim() || old?.name || "")).slice(0, 40);
  if (!name) throw new Error("Hãy đặt tên cho nhà cung cấp.");
  const baseUrl = (o.baseUrl ?? old?.base_url ?? "").trim().replace(/\/+$/, "");
  if (kind === "compatible" && !baseUrl) throw new Error("Hãy nhập địa chỉ API (Base URL), ví dụ https://openrouter.ai/api/v1.");
  if (baseUrl && !okUrl(baseUrl)) throw new Error("Địa chỉ API phải bắt đầu bằng https:// hoặc http://");
  const key = (o.key ?? "").trim() || (old ? open(old.enc_key) : "");
  if (!key) throw new Error("Hãy dán khóa API.");
  if (key.length > 500 || /\s/.test(key)) throw new Error("Khóa API không hợp lệ (có khoảng trắng hoặc quá dài).");
  // Đổi sang khóa mới mà không nêu workspace thì không giữ workspace của khóa cũ: khóa mới có thể đã gắn sẵn với workspace khác.
  let workspace = kind !== "anthropic" ? "" : (typeof o.workspaceId === "string" ? o.workspaceId : o.key?.trim() ? "" : old?.workspace_id ?? "").trim();
  if (workspace && !WORKSPACE_ID.test(workspace)) throw new Error("ID workspace có dạng wrkspc_…, lấy ở trang Workspaces của Claude Console.");
  const root = baseUrl || builtin?.base || "";
  const found = await listModels(kind, root, key, workspace).catch(async (e: Error) => {
    if (workspace) throw workspaceFailure(e, workspace);
    if (kind !== "anthropic" || !NOT_SCOPED.test(e.message)) throw e;
    // Khóa không gắn với workspace: tổ chức chỉ có một workspace thì dùng luôn, không bắt người dùng đi tìm ID.
    const list = await anthropicWorkspaces(root, key);
    if (list.length !== 1) throw new WorkspaceNeeded(list);
    workspace = list[0].id;
    return listModels(kind, root, key, workspace);
  });
  const { models, all, info: plan } = found;
  if (!isService(kind) && !models.length) throw new Error("Khóa hợp lệ nhưng không thấy model chat nào được phép dùng.");
  const now = Date.now();
  const newId = () => { let s = "c-" + slug(name), i = 2; while (rowById(s) || BUILTIN[s]) s = `c-${slug(name)}-${i++}`; return s; };
  const id = old?.id ?? (builtin && o.id ? o.id : newId());
  table().prepare(`INSERT INTO api_providers (id, kind, name, base_url, workspace_id, enc_key, key_hint, models, status, error, info, checked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, base_url = excluded.base_url, workspace_id = excluded.workspace_id, enc_key = excluded.enc_key, key_hint = excluded.key_hint, models = excluded.models,
      status = 'ok', error = NULL, info = excluded.info, checked_at = excluded.checked_at, updated_at = excluded.updated_at`)
    .run(id, kind, name, baseUrl || null, workspace || null, seal(key), hint(key), JSON.stringify(all.map((m) => ({ id: m.id, name: m.name }))), plan ?? null, now, old?.created_at ?? now, now);
  // Sổ model: khóa mới của một hãng thì cả danh sách là nền (dùng ngay); hãng đã có trong sổ thì model chưa thấy bao giờ sẽ được thử trước.
  // Lượt dò sau khi lưu khóa áp trần thử mỗi ngày như lượt tự động, và không chạy khi máy chủ tắt dò tự động (SYNCHRO_MODEL_CHECK=0).
  if (!isService(kind)) { syncListed(id, kind, all); if (process.env.SYNCHRO_MODEL_CHECK !== "0") void import("./modelreg").then((m) => m.discoverModels("key")).catch(() => {}); }
  return { id, models: models.length };
}

// Kiểm tra lại khóa đã lưu và cập nhật danh sách model (lỗi thì giữ danh sách cũ, ghi lại lỗi).
export async function refreshProvider(id: string) {
  const r = rowById(id);
  if (!r) { if (envProvider()?.id === id) { envCache.at = 0; return { ok: true }; } throw new Error("Chưa có khóa cho nhà cung cấp này."); }
  try {
    const { all, info } = await listModels(r.kind, r.base_url || BUILTIN[r.kind]?.base || "", open(r.enc_key), r.workspace_id).catch((e) => { throw workspaceFailure(e, r.workspace_id ?? ""); });
    table().prepare("UPDATE api_providers SET models = ?, info = ?, status = 'ok', error = NULL, checked_at = ? WHERE id = ?").run(JSON.stringify(all.map((m) => ({ id: m.id, name: m.name }))), info ?? null, Date.now(), id);
    const s = isService(r.kind) ? { added: [], gone: [] } : syncListed(id, r.kind, all);
    return { ok: true, added: s.added, gone: s.gone };
  } catch (e) {
    table().prepare("UPDATE api_providers SET status = 'error', error = ?, checked_at = ? WHERE id = ?").run((e as Error).message.slice(0, 400), Date.now(), id);
    return { ok: false, error: (e as Error).message, added: [] as string[], gone: [] as string[] };
  }
}
/** Đọc lại danh sách model của mọi khóa chat (đã lưu và ở biến môi trường), cho lượt dò model mới. Lỗi của một hãng không chặn hãng khác. */
export async function refreshAll(): Promise<{ id: string; ok: boolean; error?: string; added: string[]; gone: string[] }[]> {
  const out: { id: string; ok: boolean; error?: string; added: string[]; gone: string[] }[] = [];
  for (const r of rows()) {
    if (isService(r.kind)) continue;
    const x = await refreshProvider(r.id);
    out.push({ id: r.id, ok: x.ok, ...(x.ok ? {} : { error: (x as { error?: string }).error }), added: x.added ?? [], gone: (x as { gone?: string[] }).gone ?? [] });
  }
  const v = envProvider();
  if (v && v.kind !== "mock" && !rows().some((r) => r.id === v.id)) {
    envCache.at = 0; envCache.sync = undefined; envCache.error = undefined;
    await envModels(v);
    const c = envCache as typeof envCache;
    out.push({ id: v.id, ok: !c.error, ...(c.error ? { error: c.error } : {}), added: c.sync?.added ?? [], gone: c.sync?.gone ?? [] });
  }
  return out;
}
export const removeProvider = (id: string) => table().prepare("DELETE FROM api_providers WHERE id = ?").run(id).changes > 0;

// ---- model hiển thị ở màn hình chính và model mặc định (quản trị viên chọn) ----
export const mainModels = (): string[] => { try { const v = JSON.parse(getSetting("main_models", JSON.stringify([ALL]))); return Array.isArray(v) ? v : [ALL]; } catch { return [ALL]; } };
export const setMainModels = (v: string[]) => setSetting("main_models", JSON.stringify(v.includes(ALL) ? [ALL] : v.filter((m) => typeof m === "string" && m.includes("/")).slice(0, 500)));
export const defaultModel = () => getSetting("default_model", "");
export const setDefaultModel = (k: string) => setSetting("default_model", k);

// Model mặc định thật sự dùng: cài đặt của quản trị viên nếu còn tồn tại, không thì model đầu tiên đang hiện.
export function pickDefault(cat: ProviderInfo[], main: string[]): string | null {
  const all = cat.flatMap((p) => p.models.map((m) => m.key));
  const shown = main.includes(ALL) ? all : all.filter((k) => main.includes(k));
  const d = defaultModel();
  if (d && all.includes(d)) return d;
  return shown[0] ?? all[0] ?? null;
}
export type { ModelInfo };
