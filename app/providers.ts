// Khóa API của các nhà cung cấp model (chỉ chạy ở máy chủ).
// Quản trị viên nhập khóa ở Cài đặt → Providers; khóa được mã hóa AES-256-GCM rồi lưu trong SQLite, không bao giờ gửi về trình duyệt.
// Khi lưu, máy chủ gọi thử API của hãng để kiểm tra khóa và lấy danh sách model thật mà khóa đó được dùng.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, db, getSetting, setSetting } from "./authstore";
import { ALL, modelKey, splitKey, type ModelInfo, type ProviderInfo, type ProviderKind } from "./catalog";

type Builtin = { kind: ProviderKind; name: string; vendor: string; base: string; keyUrl: string; prefix: string };
export const BUILTIN: Record<string, Builtin> = {
  anthropic: { kind: "anthropic", name: "Claude", vendor: "Anthropic", base: "https://api.anthropic.com", keyUrl: "https://console.anthropic.com/settings/keys", prefix: "sk-ant-" },
  openai: { kind: "openai", name: "ChatGPT", vendor: "OpenAI", base: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", prefix: "sk-" },
  google: { kind: "google", name: "Gemini", vendor: "Google", base: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", prefix: "AIza" },
  xai: { kind: "xai", name: "Grok", vendor: "xAI", base: "https://api.x.ai/v1", keyUrl: "https://console.x.ai", prefix: "xai-" },
  deepseek: { kind: "deepseek", name: "DeepSeek", vendor: "DeepSeek", base: "https://api.deepseek.com", keyUrl: "https://platform.deepseek.com/api_keys", prefix: "sk-" },
  elevenlabs: { kind: "elevenlabs", name: "ElevenLabs", vendor: "ElevenLabs", base: "https://api.elevenlabs.io", keyUrl: "https://elevenlabs.io/app/settings/api-keys", prefix: "sk_" },
};

type Row = { id: string; kind: ProviderKind; name: string; base_url: string | null; enc_key: string; key_hint: string; models: string; status: string; error: string | null; info: string | null; checked_at: number | null; created_at: number; updated_at: number };

let ready = false;
function table() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS api_providers (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, base_url TEXT, enc_key TEXT NOT NULL, key_hint TEXT NOT NULL,
      models TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'ok', error TEXT, info TEXT, checked_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
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

// Chỉ hiện dòng model hiện tại mà các hãng đang đưa lên web chính thức (claude.ai, ChatGPT, Gemini — tháng 10/2026); đời cũ bị ẩn.
// Model ra mắt sau này không khớp mẫu nào nên tự hiện. Khi hãng đưa một dòng về "legacy", thêm nó vào đây.
const LEGACY: Partial<Record<ProviderKind, RegExp>> = {
  anthropic: /^claude-(instant|\d|(opus|sonnet|haiku)-[1-4]\b|(fable|opus|sonnet|haiku)-5($|-\d{8}$))/,
  openai: /^(gpt-[1-5]|o\d|chatgpt|chat-latest|gpt-6-sol$)/,
  google: /^gemini-([12][.-]|3-|3\.6-|3\.1-flash|3\.5-flash$)/,
  // Grok 4.5 trở lên và Grok Build là dòng hiện tại; 2 / 3 / 4.0–4.3 / 4.1x / 4.20, "fast", "code-fast" là đời cũ.
  xai: /^grok-([1-3]\b|[1-3]-|4($|-)|4\.[0-4](\D|$)|4\.[12]\d|code|beta|vision)|fast/,
  // deepseek-chat / deepseek-reasoner (V3) và tên cũ của V4 Flash (đã gộp vào deepseek-flash).
  deepseek: /^deepseek-(chat|reasoner|coder|v[23]|v4-flash)/,
};
const isCurrent = (kind: ProviderKind, id: string) => !LEGACY[kind]?.test(id);

export async function listModels(kind: ProviderKind, base: string, key: string): Promise<{ models: { id: string; name: string }[]; info?: string }> {
  const r = await listAll(kind, base, key);
  return { ...r, models: r.models.filter((m) => isCurrent(kind, m.id)) };
}
async function listAll(kind: ProviderKind, base: string, key: string): Promise<{ models: { id: string; name: string }[]; info?: string }> {
  const b = base.replace(/\/+$/, "");
  if (kind === "anthropic") {
    const j = await getJson(`${b}/v1/models?limit=1000`, { "x-api-key": key, "anthropic-version": "2023-06-01" });
    return { models: (j.data ?? []).map((m: { id: string; display_name?: string }) => ({ id: m.id, name: m.display_name || m.id })) };
  }
  if (kind === "google") {
    const root = b.replace(/\/openai$/, "");
    const j = await getJson(`${root}/models?pageSize=1000&key=${encodeURIComponent(key)}`, {});
    const list = (j.models ?? []) as { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    return { models: list.filter((m) => m.name.includes("gemini") && (m.supportedGenerationMethods ?? []).includes("generateContent") && !GOOGLE_SKIP.test(m.name)).map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName || m.name })) };
  }
  if (kind === "elevenlabs") {
    // /v1/user chỉ để hiện tên gói. Khóa giới hạn quyền (không bật User) bị báo "missing the permission user_read" nhưng vẫn là khóa đúng
    // (khóa sai báo invalid_api_key), nên vẫn nhận; quyền còn thiếu cho giọng nói được báo đúng tên khi mở phiên.
    const j = await getJson(`${b}/v1/user`, { "xi-api-key": key }).catch((e: Error) => { if (elevenMissing(e.message)) return null; throw e; });
    const tier = j?.subscription?.tier as string | undefined;
    return { models: [], info: tier || undefined };
  }
  const j = await getJson(`${b}/models`, { Authorization: `Bearer ${key}` });
  const list = ((j.data ?? j.models ?? []) as { id: string; created?: number; name?: string }[]).filter((m) => typeof m.id === "string");
  if (kind === "openai") {
    return { models: list.filter((m) => /^(gpt|o\d|chatgpt|chat-latest)/i.test(m.id) && !OPENAI_SKIP.test(m.id)).sort((x, y) => (y.created ?? 0) - (x.created ?? 0)).map((m) => ({ id: m.id, name: prettyOpenAI(m.id) })) };
  }
  if (kind === "xai") {
    // Mới nhất trước (grok-4.7 rồi 4.6…); xAI không trả tên hiển thị nên tự đặt.
    const ver = (id: string) => Number(/^grok-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
    return { models: list.filter((m) => /^grok/i.test(m.id) && !XAI_SKIP.test(m.id)).sort((x, y) => ver(y.id) - ver(x.id) || (y.created ?? 0) - (x.created ?? 0)).map((m) => ({ id: m.id, name: prettyGrok(m.id) })) };
  }
  if (kind === "deepseek") {
    // Số dư thật của khóa (GET /user/balance) hiện cạnh tên gói, như gói của ElevenLabs.
    const bal = await getJson(`${b}/user/balance`, { Authorization: `Bearer ${key}` }).catch(() => null) as { is_available?: boolean; balance_infos?: { currency: string; total_balance: string }[] } | null;
    const info = bal?.balance_infos?.length ? `${bal.balance_infos.map((x) => `${x.total_balance} ${x.currency}`).join(" + ")}${bal.is_available === false ? " (top up needed)" : ""}` : undefined;
    return { models: list.filter((m) => /^deepseek/i.test(m.id) && !COMPAT_SKIP.test(m.id)).map((m) => ({ id: m.id, name: prettyDeepSeek(m.id) })), info };
  }
  return { models: list.filter((m) => !COMPAT_SKIP.test(m.id)).map((m) => ({ id: m.id, name: m.name || m.id })) };
}

// ---- nhà cung cấp lấy từ biến môi trường (cấu hình cũ), dùng khi chưa nhập khóa đó trong Cài đặt ----
type Virtual = { id: string; kind: ProviderKind; name: string; base: string; key: string };
function envProvider(): Virtual | null {
  const p = process.env.LLM_PROVIDER ?? "anthropic", key = process.env.LLM_API_KEY ?? "";
  if (p === "mock") return { id: "mock", kind: "mock", name: "Synchro (thử nghiệm)", base: "", key: "" };
  if (!key) return null;
  if (p === "anthropic") return { id: "anthropic", kind: "anthropic", name: "Claude", base: BUILTIN.anthropic.base, key };
  return { id: "env", kind: "compatible", name: "Máy chủ (biến môi trường)", base: process.env.LLM_BASE_URL ?? BUILTIN.openai.base, key };
}
const envCache: { at: number; models: { id: string; name: string }[] } = { at: 0, models: [] };
async function envModels(v: Virtual) {
  if (v.kind === "mock") return [{ id: "synchro-mock", name: "Synchro Mock" }];
  if (Date.now() - envCache.at < 6 * 3600_000 && envCache.models.length) return envCache.models;
  try { envCache.models = (await listModels(v.kind, v.base, v.key)).models; envCache.at = Date.now(); } catch { envCache.at = Date.now(); }
  return envCache.models;
}

const rows = () => table().prepare("SELECT * FROM api_providers ORDER BY created_at").all() as Row[];
const rowById = (id: string) => table().prepare("SELECT * FROM api_providers WHERE id = ?").get(id) as Row | undefined;
const parse = (s: string) => { try { return JSON.parse(s) as { id: string; name: string }[]; } catch { return []; } };
// Danh sách đã lưu cũng lọc lại, để model vừa thành đời cũ biến mất mà không cần làm mới khóa.
const stored = (r: Row) => parse(r.models).filter((m) => isCurrent(r.kind, m.id));

// Mọi nhà cung cấp chat đang dùng được, kèm danh sách model (không gồm ElevenLabs vì chỉ dùng cho giọng nói).
export async function catalog(): Promise<ProviderInfo[]> {
  const out: ProviderInfo[] = [];
  const have = new Set<string>();
  for (const r of rows()) {
    have.add(r.id);
    if (r.kind === "elevenlabs") continue;
    out.push({ id: r.id, name: r.name, kind: r.kind, models: stored(r).map((m) => ({ key: modelKey(r.id, m.id), id: m.id, name: m.name })) });
  }
  const v = envProvider();
  if (v && !have.has(v.id)) out.unshift({ id: v.id, name: v.name, kind: v.kind, models: (await envModels(v)).map((m) => ({ key: modelKey(v.id, m.id), id: m.id, name: m.name })) });
  return out.filter((p) => p.models.length);
}

export type Target = { provider: string; kind: ProviderKind; base: string; key: string; model: string };
// Từ khóa model ("openai/gpt-5.1") → địa chỉ, khóa và mã model để gọi.
export async function resolveModel(key: string): Promise<Target | null> {
  const { provider, id } = splitKey(key);
  if (!provider || !id) return null;
  const r = rowById(provider);
  if (r && r.kind !== "elevenlabs") {
    try { return { provider, kind: r.kind, base: (r.base_url || BUILTIN[r.kind]?.base || "").replace(/\/+$/, ""), key: open(r.enc_key), model: id }; } catch { return null; }
  }
  const v = envProvider();
  if (v && v.id === provider) return { provider, kind: v.kind, base: v.base.replace(/\/+$/, ""), key: v.key, model: id };
  return null;
}
// Khóa cho dịch vụ không phải chat (ElevenLabs).
export function serviceKey(id: "elevenlabs"): { key: string; base: string } | null {
  const r = rowById(id);
  if (r) { try { return { key: open(r.enc_key), base: (r.base_url || BUILTIN[id].base).replace(/\/+$/, "") }; } catch { return null; } }
  const k = id === "elevenlabs" ? process.env.ELEVENLABS_API_KEY : "";
  return k ? { key: k, base: BUILTIN[id].base } : null;
}

// ---- danh sách cho trang quản lý API (khóa chỉ hiện dạng che) ----
export type AdminProvider = { id: string; kind: ProviderKind; name: string; vendor: string; builtin: boolean; configured: boolean; source: "db" | "env" | null;
  baseUrl: string; defaultBase: string; keyHint: string | null; keyUrl: string | null; prefix: string | null; status: "ok" | "error" | null; error: string | null; info: string | null;
  checkedAt: number | null; models: { key: string; name: string }[] };
export async function adminList(): Promise<AdminProvider[]> {
  const list = rows();
  const v = envProvider();
  const out: AdminProvider[] = Object.entries(BUILTIN).map(([id, b]) => {
    const r = list.find((x) => x.id === id);
    // Khóa ở biến môi trường: LLM_API_KEY (Claude) hoặc ELEVENLABS_API_KEY.
    const envKey = r ? "" : v && v.id === id ? v.key : id === "elevenlabs" ? process.env.ELEVENLABS_API_KEY ?? "" : "";
    return { id, kind: b.kind, name: b.name, vendor: b.vendor, builtin: true, configured: !!r || !!envKey, source: r ? "db" : envKey ? "env" : null,
      baseUrl: r?.base_url ?? "", defaultBase: b.base, keyHint: r ? r.key_hint : envKey ? hint(envKey) : null, keyUrl: b.keyUrl, prefix: b.prefix,
      status: r ? (r.status as "ok" | "error") : envKey ? "ok" : null, error: r?.error ?? null, info: r?.info ?? null, checkedAt: r?.checked_at ?? null,
      models: r ? stored(r).map((m) => ({ key: modelKey(id, m.id), name: m.name })) : [] };
  });
  for (const r of list.filter((x) => !BUILTIN[x.id])) out.push({ id: r.id, kind: r.kind, name: r.name, vendor: "Tương thích OpenAI", builtin: false, configured: true, source: "db",
    baseUrl: r.base_url ?? "", defaultBase: "", keyHint: r.key_hint, keyUrl: null, prefix: null, status: r.status as "ok" | "error", error: r.error, info: r.info, checkedAt: r.checked_at,
    models: stored(r).map((m) => ({ key: modelKey(r.id, m.id), name: m.name })) });
  if (v && (v.id === "env" || v.id === "mock") && !list.some((x) => x.id === v.id)) {
    const ms = await envModels(v);
    out.push({ id: v.id, kind: v.kind, name: v.name, vendor: "Biến môi trường máy chủ", builtin: false, configured: true, source: "env", baseUrl: v.base, defaultBase: v.base, keyHint: v.key ? hint(v.key) : null,
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
export async function saveProvider(o: { id?: string; kind?: string; name?: string; key?: string; baseUrl?: string }) {
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
  const { models, info } = await listModels(kind, baseUrl || builtin?.base || "", key);
  if (kind !== "elevenlabs" && !models.length) throw new Error("Khóa hợp lệ nhưng không thấy model chat nào được phép dùng.");
  const now = Date.now();
  const newId = () => { let s = "c-" + slug(name), i = 2; while (rowById(s) || BUILTIN[s]) s = `c-${slug(name)}-${i++}`; return s; };
  const id = old?.id ?? (builtin && o.id ? o.id : newId());
  table().prepare(`INSERT INTO api_providers (id, kind, name, base_url, enc_key, key_hint, models, status, error, info, checked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', NULL, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, base_url = excluded.base_url, enc_key = excluded.enc_key, key_hint = excluded.key_hint, models = excluded.models,
      status = 'ok', error = NULL, info = excluded.info, checked_at = excluded.checked_at, updated_at = excluded.updated_at`)
    .run(id, kind, name, baseUrl || null, seal(key), hint(key), JSON.stringify(models), info ?? null, now, old?.created_at ?? now, now);
  return { id, models: models.length };
}

// Kiểm tra lại khóa đã lưu và cập nhật danh sách model (lỗi thì giữ danh sách cũ, ghi lại lỗi).
export async function refreshProvider(id: string) {
  const r = rowById(id);
  if (!r) { if (envProvider()?.id === id) { envCache.at = 0; return { ok: true }; } throw new Error("Chưa có khóa cho nhà cung cấp này."); }
  try {
    const { models, info } = await listModels(r.kind, r.base_url || BUILTIN[r.kind]?.base || "", open(r.enc_key));
    table().prepare("UPDATE api_providers SET models = ?, info = ?, status = 'ok', error = NULL, checked_at = ? WHERE id = ?").run(JSON.stringify(models), info ?? null, Date.now(), id);
    return { ok: true };
  } catch (e) {
    table().prepare("UPDATE api_providers SET status = 'error', error = ?, checked_at = ? WHERE id = ?").run((e as Error).message.slice(0, 400), Date.now(), id);
    return { ok: false, error: (e as Error).message };
  }
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
