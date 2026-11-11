// Tạo ảnh qua Replicate bằng khóa API của chủ máy chủ (Cài đặt → Providers → Replicate). Chưa có khóa thì không có gì thay đổi: ảnh vẫn đi qua gói của từng người (imagegen.ts).
// Hai model chủ dự án chọn (MASTER_IMAGE_GEN_CONFIG, giữ nguyên từng chữ): FLUX 1.1 Pro Ultra cho ảnh mới từ chữ, IC-Light để đặt ảnh sản phẩm người dùng gửi vào ánh sáng studio.
// Hậu tố nhiếp ảnh thương mại nối vào sau yêu cầu khi là ảnh sản phẩm (đánh sáng lại, hoặc model đánh dấu product_shot); logo, tranh minh họa thì không, vì hậu tố "Hasselblad, bục studio"
// làm hỏng chúng.
// Tiền thật: FLUX Ultra khoảng 0,06 USD mỗi ảnh. Mỗi tài khoản có hạn mức ảnh mỗi ngày (chưa xác minh email thấp hơn), cả máy chủ có hạn mức chung; quản trị viên không bị chặn nhưng vẫn
// được tính vào mức chung. Hết hạn mức thì imagegen dùng gói của người đó như trước.
// API (replicate.com/docs/reference/http): model chính thức gọi POST /v1/models/{owner}/{name}/predictions, model cộng đồng (ic-light) gọi POST /v1/predictions với version.
// Prefer: wait=60 chờ tối đa 60 giây trong cùng lời gọi, chưa xong thì hỏi lại urls.get mỗi 2 giây; Cancel-After để Replicate tự hủy nếu Synchro mất dấu. Người dùng bấm Dừng thì gọi cancel.
// Tên tham số đọc từ lược đồ OpenAPI của bản mới nhất (lưu khi lưu khóa, làm mới mỗi ngày): ic-light đổi tên giữa các bản (subject_image / input_fg, light_source / bg_source).
// Ảnh kết quả ở replicate.delivery bị xóa sau 1 giờ nên tải về ngay. Không ghi khóa hay prompt vào nhật ký.
import { db, getSetting, getUser, isAdmin, setSetting } from "../authstore";
import { serviceKey } from "../providers";
import { redact } from "./errors";
import { IMAGE_MAX_MB, imageKind, type ImgFile } from "./imagefiles";

export const MASTER_IMAGE_GEN_CONFIG = {
  // 1. Model tạo ảnh mới từ chữ tốt nhất (Không lỗi chữ, ánh sáng điện ảnh)
  textToImageModel: "black-forest-labs/flux-1.1-pro-ultra",
  // 2. Model tách nền và đánh lại ánh sáng Studio cho ảnh sản phẩm
  productRelightModel: "zsxkib/ic-light",
  // 3. Hậu tố Prompt chuẩn nhiếp ảnh thương mại tự động nối vào sau yêu cầu của User
  masterStyleSuffix:
    "editorial commercial photography, shot on Hasselblad H6D-100c, 85mm f/1.4 lens, soft volumetric studio key lighting, subtle rim light, clean minimalist podium background, natural shadows, ultra-detailed texture, 8k resolution, color graded in Capture One",
} as const;
export const REPLICATE_MODELS = [MASTER_IMAGE_GEN_CONFIG.textToImageModel, MASTER_IMAGE_GEN_CONFIG.productRelightModel] as const;
/** Giá ước lượng mỗi ảnh FLUX 1.1 Pro Ultra theo trang model (USD). IC-Light tính theo giây GPU, Replicate không báo giá trong kết quả. */
export const FLUX_USD = 0.06;

export type RepKind = "auth" | "quota" | "busy" | "bad" | "refused" | "timeout" | "aborted" | "big" | "nofile" | "other";
/** status: mã HTTP Replicate trả lời (Replicate đã từ chối, không chạy gì). spent: số ảnh / tiền đã có thể bị tính trước khi lỗi (để không trả lại hạn mức). */
export class RepError extends Error {
  status = 0; spent?: { used: number; usd: number };
  constructor(public kind: RepKind, msg: string, status = 0) { super(msg); this.status = status; }
}

// ---------------------------------------------------------------- lược đồ tham số của model
type Schema = { version: string; props: string[]; enums: Record<string, string[]>; at: number };
const SCHEMA_KEY = "replicate_models";
const SCHEMA_TTL = 24 * 3600_000;
const schemas = (): Record<string, Schema> => { try { const v = JSON.parse(getSetting(SCHEMA_KEY, "{}")); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
type OpenApi = { components?: { schemas?: Record<string, { properties?: Record<string, { enum?: unknown[]; allOf?: { $ref?: string }[]; $ref?: string }>; enum?: unknown[] }> } };
/** Tên tham số và giá trị cho phép (enum, kể cả enum khai báo riêng qua $ref) của đầu vào model. */
export function parseSchema(version: string, api: OpenApi): Schema {
  const all = api?.components?.schemas ?? {}, input = all.Input?.properties ?? {};
  const enums: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(input)) {
    const ref = (v.$ref ?? v.allOf?.find((x) => x.$ref)?.$ref ?? "").split("/").pop() ?? "";
    const e = v.enum ?? (ref ? all[ref]?.enum : undefined);
    if (Array.isArray(e)) enums[k] = e.map(String);
  }
  return { version, props: Object.keys(input), enums, at: Date.now() };
}
const hdr = (key: string) => ({ Authorization: `Bearer ${key}`, "User-Agent": "Synchro" });
async function apiJson(url: string, key: string, init: RequestInit = {}, ms = 20_000) {
  const r = await fetch(url, { ...init, headers: { ...hdr(key), ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms) })
    .catch((e: Error) => { if (init.signal?.aborted) throw new RepError("aborted", "Đã dừng."); throw new RepError(e.name === "TimeoutError" ? "timeout" : "other", `Không kết nối được tới Replicate: ${redact(e.message).slice(0, 160)}`); });
  const text = await r.text();
  let j: Record<string, unknown> = {};
  try { j = text ? JSON.parse(text) : {}; } catch { if (!r.ok) j = {}; else throw new RepError("other", "Replicate trả về dữ liệu không đọc được."); }
  if (!r.ok) {
    const detail = redact(String(j.detail ?? j.title ?? text).replace(/\s+/g, " ")).slice(0, 240);
    const kind: RepKind = r.status === 401 || r.status === 403 ? "auth" : r.status === 402 ? "quota" : r.status === 429 ? "busy" : r.status === 422 || r.status === 400 ? "bad" : "other";
    throw new RepError(kind, kind === "auth" ? `Khóa Replicate không hợp lệ hoặc không có quyền (${r.status}).` : kind === "quota" ? `Tài khoản Replicate đã hết số dư (402): ${detail}` : kind === "busy" ? `Replicate đang giới hạn lượt gọi (429): ${detail}` : `Replicate báo lỗi ${r.status}: ${detail}`, r.status);
  }
  return j;
}
/** Đọc lược đồ một model (latest_version). Lưu lại để không hỏi mỗi lần tạo ảnh. */
export async function loadSchema(base: string, key: string, model: string, force = false): Promise<Schema> {
  const cur = schemas()[model];
  if (cur && !force && Date.now() - cur.at < SCHEMA_TTL) return cur;
  const j = await apiJson(`${base}/models/${model}`, key) as { latest_version?: { id?: string; openapi_schema?: OpenApi } };
  const v = j.latest_version;
  if (!v?.id) throw new RepError("other", `Replicate không trả về phiên bản của ${model}.`);
  const s = parseSchema(v.id, v.openapi_schema ?? {});
  setSetting(SCHEMA_KEY, JSON.stringify({ ...schemas(), [model]: s }));
  return s;
}
/** Kiểm tra khóa khi quản trị viên lưu (GET /v1/account) và đọc sẵn lược đồ hai model. Lược đồ lỗi không làm hỏng việc lưu khóa: lần tạo ảnh đầu sẽ đọc lại. */
export async function checkKey(base: string, key: string): Promise<{ info?: string }> {
  const a = await apiJson(`${base}/account`, key).catch((e: RepError) => { throw new Error(e.message); }) as { username?: string; type?: string };
  for (const m of REPLICATE_MODELS) await loadSchema(base, key, m, true).catch(() => {});
  return { info: a.username ? String(a.username).slice(0, 60) : undefined };
}

// ---------------------------------------------------------------- hạn mức ảnh mỗi ngày
export type RepBudget = { user: number; unverified: number; global: number };
const BUDGET_KEY = "replicate_budget";
// Mặc định: 10 ảnh mỗi ngày một tài khoản đã xác minh email (khoảng 0,6 USD), 2 ảnh khi chưa xác minh, 100 ảnh cả máy chủ (khoảng 6 USD). Quản trị viên đổi ở Cài đặt → Quản trị viên.
const BUDGET_DEF: RepBudget = { user: 10, unverified: 2, global: 100 };
const n0 = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
export function repBudget(): RepBudget {
  let j: Partial<RepBudget> = {};
  try { j = JSON.parse(getSetting(BUDGET_KEY, "{}")) as Partial<RepBudget>; } catch {}
  return { user: n0(j.user, BUDGET_DEF.user), unverified: n0(j.unverified, BUDGET_DEF.unverified), global: n0(j.global, BUDGET_DEF.global) };
}
export function setRepBudget(b: Partial<RepBudget>) {
  const c = repBudget();
  setSetting(BUDGET_KEY, JSON.stringify({ user: n0(b.user, c.user), unverified: n0(b.unverified, c.unverified), global: n0(b.global, c.global) }));
}
const day = () => new Date().toISOString().slice(0, 10);
let tableDay = "";
function bdb() {
  const d = db(), t = day();
  if (tableDay !== t) {
    d.exec("CREATE TABLE IF NOT EXISTS replicate_budget (day TEXT NOT NULL, user_id TEXT NOT NULL, images INTEGER NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, user_id))");
    d.prepare("DELETE FROM replicate_budget WHERE day < ?").run(new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10));
    tableDay = t;
  }
  return d;
}
const ALL = "*";
/** Ảnh Replicate đã tạo hôm nay (UTC) của một tài khoản, hoặc cả máy chủ. */
export const repToday = (uid = ALL) => (bdb().prepare("SELECT images, usd FROM replicate_budget WHERE day = ? AND user_id = ?").get(day(), uid) as { images: number; usd: number } | undefined) ?? { images: 0, usd: 0 };
function bump(d: string, uid: string, images: number, usd: number) {
  const st = bdb().prepare("INSERT INTO replicate_budget (day, user_id, images, usd) VALUES (?, ?, ?, ?) ON CONFLICT(day, user_id) DO UPDATE SET images = images + excluded.images, usd = usd + excluded.usd");
  st.run(d, uid, images, usd); st.run(d, ALL, images, usd);
}
export function addRepSpend(uid: string, images: number, usd: number) {
  if (!(images > 0)) return;
  bump(day(), uid, images, usd);
}
/**
 * Giữ chỗ trước khi gọi Replicate (tiền thật): trong một giao dịch, lấy tối đa want ảnh trong phần còn lại hôm nay của tài khoản và của máy chủ rồi
 * cộng ngay vào hạn mức, nên nhiều lượt chạy cùng lúc (nhiều đoạn chat, nhiều người) không cùng thấy hạn mức còn nguyên rồi cùng vượt.
 * settle(made, usd) sau khi xong: trả lại phần ảnh không tạo được, ghi số tiền; gọi nhiều lần chỉ tính lần đầu.
 */
export function reserveRep(uid: string, want: number): { n: number; settle: (made: number, usd: number) => void } {
  const d = bdb(), at = day();
  const n = d.transaction(() => {
    const k = Math.max(0, Math.min(Math.floor(want), repRoom(uid)));
    if (k > 0) bump(at, uid, k, 0);
    return k;
  })();
  let done = !n;
  return {
    n,
    settle: (made, usd) => {
      if (done) return;
      done = true;
      const back = n - Math.max(0, Math.min(n, made));
      if (back > 0 || usd > 0) d.transaction(() => bump(at, uid, -back, usd > 0 ? usd : 0))();
    },
  };
}
/** Số ảnh Replicate tài khoản này còn được tạo hôm nay (Infinity: quản trị viên, chỉ còn giới hạn chung). 0 khi chưa có khóa. */
export function repRoom(uid: string): number {
  if (!serviceKey("replicate")) return 0;
  const b = repBudget(), all = Math.max(0, b.global - repToday().images);
  const u = getUser(uid);
  if (!u) return 0;
  if (isAdmin(u)) return all;
  return Math.min(all, Math.max(0, (u.email_verified ? b.user : b.unverified) - repToday(uid).images));
}

// ---------------------------------------------------------------- một lần chạy model
type Pred = { id?: string; status?: string; output?: unknown; error?: unknown; urls?: { get?: string; cancel?: string }; metrics?: { predict_time?: number } };
// Gỡ trình nghe abort khi hết giờ chờ: hỏi lại mỗi 2 giây suốt 5 phút không chồng hàng trăm trình nghe lên tín hiệu của lượt chat.
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((ok) => {
  if (signal?.aborted) return ok();
  const done = () => { clearTimeout(t); signal?.removeEventListener("abort", done); ok(); };
  const t = setTimeout(done, ms);
  signal?.addEventListener("abort", done, { once: true });
});
const POLL_MS = () => Number(process.env.SYNCHRO_REPLICATE_POLL_MS) || 2000;
const DEADLINE_MS = () => (Number(process.env.SYNCHRO_REPLICATE_TIMEOUT_SEC) || 300) * 1000;
/** Chỉ tải ảnh từ máy chủ của Replicate (hoặc đúng máy chủ API đang cấu hình, khi đi qua proxy / bản giả lập): không để kết quả trỏ Synchro tới địa chỉ nội bộ. */
export function deliveryOk(u: string, base: string) {
  try {
    const x = new URL(u), b = new URL(base);
    if (x.protocol !== "https:" && x.host !== b.host) return false;
    return x.host === b.host || x.hostname === "replicate.delivery" || x.hostname.endsWith(".replicate.delivery") || x.hostname === "api.replicate.com";
  } catch { return false; }
}
/**
 * Một lượt chạy model. onSent: gọi đúng một lần khi lượt này có thể đã bị Replicate tính tiền: yêu cầu tạo đã gửi đi và Replicate không trả lời bằng mã lỗi HTTP,
 * kể cả khi người dùng bấm Dừng hay hết giờ chờ giữa chừng (Replicate vẫn chạy tiếp và tính tiền dù Synchro không nhận kết quả). Lượt Replicate báo "failed" thì không tính.
 */
export async function predict(base: string, key: string, target: { model: string } | { version: string }, input: Record<string, unknown>, signal?: AbortSignal, onSent?: () => void): Promise<{ urls: string[]; seconds: number }> {
  const url = "model" in target ? `${base}/models/${target.model}/predictions` : `${base}/predictions`;
  const body = "model" in target ? { input } : { version: target.version, input };
  let charged = true;
  try {
    let p: Pred;
    try { p = await apiJson(url, key, { method: "POST", body: JSON.stringify(body), headers: { Prefer: "wait=60", "Cancel-After": "5m" }, signal }, 75_000) as Pred; }
    catch (e) { if (e instanceof RepError && e.status) charged = false; throw e; }
    const t0 = Date.now();
    const cancel = () => { const c = p.urls?.cancel ?? (p.id ? `${base}/predictions/${p.id}/cancel` : ""); if (c && deliveryOk(c, base)) apiJson(c, key, { method: "POST" }, 10_000).catch(() => {}); };
    try {
      while (p.status === "starting" || p.status === "processing") {
        if (signal?.aborted) { cancel(); throw new RepError("aborted", "Đã dừng."); }
        if (Date.now() - t0 > DEADLINE_MS()) { cancel(); throw new RepError("timeout", "quá thời gian chờ mà Replicate chưa xong"); }
        await sleep(POLL_MS(), signal);
        if (signal?.aborted) continue;
        const g = p.urls?.get && deliveryOk(p.urls.get, base) ? p.urls.get : `${base}/predictions/${p.id}`;
        p = { ...p, ...(await apiJson(g, key, {}, 20_000) as Pred) };
      }
    } catch (e) { if (signal?.aborted) cancel(); throw e; }
    if (p.status === "canceled") throw new RepError(signal?.aborted ? "aborted" : "other", "Replicate đã hủy lượt chạy.");
    if (p.status !== "succeeded") {
      if (p.status === "failed") charged = false;
      const msg = redact(String(p.error ?? "không rõ lý do").replace(/\s+/g, " ")).slice(0, 240);
      throw new RepError(/nsfw|safety|flagged|sensitive/i.test(msg) ? "refused" : "other", msg);
    }
    const out = p.output, urls = (Array.isArray(out) ? out : [out]).filter((x): x is string => typeof x === "string" && /^https?:\/\//.test(x));
    if (!urls.length) throw new RepError("nofile", "Replicate báo xong nhưng không có ảnh nào.");
    return { urls, seconds: Number(p.metrics?.predict_time) || 0 };
  } finally { if (charged) onSent?.(); }
}
async function download(u: string, base: string, key: string, signal?: AbortSignal): Promise<{ data: Buffer; mime: string; ext: string }> {
  if (!deliveryOk(u, base)) throw new RepError("bad", "Replicate trả về địa chỉ ảnh lạ, Synchro không tải.");
  const max = IMAGE_MAX_MB() * 1048576;
  const r = await fetch(u, { headers: hdr(key), redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) }).catch(() => null);
  if (!r?.ok || !r.body) throw new RepError("nofile", "Không tải được ảnh từ Replicate (ảnh chỉ giữ 1 giờ).");
  const parts: Buffer[] = []; let n = 0;
  for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) { n += c.length; if (n > max) throw new RepError("big", `ảnh vượt quá ${IMAGE_MAX_MB()} MB`); parts.push(Buffer.from(c)); }
  const data = Buffer.concat(parts), k = imageKind(data);
  if (!k) throw new RepError("bad", "tệp Replicate trả về không phải ảnh PNG, JPEG hay WebP");
  return { data, ...k };
}
/** Ảnh gốc gửi cho model: nhỏ thì data: URI (Replicate khuyên dưới 1 MB), lớn thì tải lên Files API rồi xóa ngay sau lượt chạy. */
async function uploadRef(base: string, key: string, f: ImgFile, signal?: AbortSignal): Promise<{ value: string; drop: () => void }> {
  const k = imageKind(f.data);
  if (!k) throw new RepError("bad", "Ảnh gốc phải là PNG, JPEG hoặc WebP.");
  if (f.data.length <= 700 * 1024) return { value: `data:${k.mime};base64,${f.data.toString("base64")}`, drop: () => {} };
  const form = new FormData();
  form.append("content", new Blob([new Uint8Array(f.data)], { type: k.mime }), `reference.${k.ext}`);
  const j = await apiJson(`${base}/files`, key, { method: "POST", body: form, signal }, 60_000) as { id?: string; urls?: { get?: string } };
  if (!j.urls?.get) throw new RepError("other", "Replicate không nhận ảnh gốc.");
  return { value: j.urls.get, drop: () => { if (j.id) apiJson(`${base}/files/${j.id}`, key, { method: "DELETE" }, 10_000).catch(() => {}); } };
}

// ---------------------------------------------------------------- tham số từng model
const has = (s: Schema | undefined, k: string) => !s || s.props.includes(k);
const first = (s: Schema | undefined, ...names: string[]) => (s ? names.find((n) => s.props.includes(n)) : names[0]);
// Logo, biểu tượng, tranh minh họa, hình vẽ, hoạt hình, vector: không bao giờ nối hậu tố nhiếp ảnh (chủ dự án chốt), kể cả khi model lỡ đánh dấu
// product_shot (ví dụ "logo cho thương hiệu mỹ phẩm"): "Hasselblad, bục studio" biến logo phẳng thành ảnh chụp vật thể.
const NOT_PHOTO = /\b(logo|logos|logotype|wordmark|monogram|emblem|icon|icons|favicon|illustration|illustrated|drawing|drawn|sketch|cartoon|anime|manga|comic|clip ?art|vector|flat design|line art|doodle|mascot|sticker|watercolou?r painting|oil painting|pixel art)\b|biểu tượng|minh họa|minh hoạ|hình vẽ|tranh vẽ|bức vẽ|vẽ tay|phác thảo|hoạt hình|truyện tranh|nhãn dán|linh vật|tranh màu nước|tranh sơn dầu|(?:hãy|giúp|cho tôi|cho mình) vẽ/iu;
/** Yêu cầu là logo / tranh / hình vẽ chứ không phải ảnh chụp. */
export const notPhoto = (prompt: string) => NOT_PHOTO.test(prompt.normalize("NFC"));
/** Prompt cuối cùng: ảnh sản phẩm (ảnh chụp) thì nối nguyên văn hậu tố nhiếp ảnh của chủ dự án; logo, tranh, hình vẽ thì không. */
export const finalPrompt = (prompt: string, product: boolean) => (product && !notPhoto(prompt) ? `${prompt.trim().replace(/[\s,.;]+$/, "")}, ${MASTER_IMAGE_GEN_CONFIG.masterStyleSuffix}` : prompt.trim());
export function fluxInput(s: Schema | undefined, q: { prompt: string; aspect?: string; product: boolean; ref?: string }): Record<string, unknown> {
  const out: Record<string, unknown> = { prompt: finalPrompt(q.prompt, q.product) };
  if (q.aspect && has(s, "aspect_ratio") && (!s?.enums.aspect_ratio || s.enums.aspect_ratio.includes(q.aspect))) out.aspect_ratio = q.aspect;
  if (has(s, "output_format") && (!s?.enums.output_format || s.enums.output_format.includes("jpg"))) out.output_format = "jpg";
  // Ảnh mẫu (không đánh sáng lại): FLUX Ultra nhận image_prompt làm gợi ý bố cục, màu.
  if (q.ref && s?.props.includes("image_prompt")) out.image_prompt = q.ref;
  return out;
}
export function relightInput(s: Schema | undefined, q: { prompt: string; aspect?: string; count: number; ref: string }): Record<string, unknown> {
  const out: Record<string, unknown> = { [first(s, "subject_image", "input_fg", "image", "input_image")!]: q.ref, prompt: finalPrompt(q.prompt, true) };
  // Ánh sáng chính từ một bên như studio (giá trị lấy đúng từ enum của bản đang chạy), không có thì để model tự chọn.
  const lk = first(s, "light_source", "bg_source");
  const lv = lk && s?.enums[lk]?.find((v) => /left/i.test(v));
  if (lk && lv) out[lk] = lv;
  const nk = first(s, "number_of_images", "num_samples", "num_outputs");
  if (nk && s?.props.includes(nk)) out[nk] = q.count;
  if (s?.props.includes("output_format") && (!s.enums.output_format || s.enums.output_format.includes("png"))) out.output_format = "png";
  if (q.aspect && s?.props.includes("width") && s.props.includes("height")) {
    const [a, b] = q.aspect.split(":").map(Number), L = 768;
    const w = a >= b ? L : Math.round((L * a) / b / 64) * 64, h = a >= b ? Math.round((L * b) / a / 64) * 64 : L;
    out.width = w; out.height = h;
  }
  return out;
}

export type RepReq = { prompt: string; aspect?: string; count: number; reference?: ImgFile; relight: boolean; product: boolean; signal?: AbortSignal; onBegin?: () => void };
/** used: số ảnh tính vào hạn mức (gồm ảnh Replicate đã chạy mà Synchro không tải được); usd: tiền ước tính của các ảnh đó. */
export type RepOut = { files: { data: Buffer; mime: string; ext: string }[]; model: string; usd: number; seconds: number; used: number };
/** Tạo ảnh: có ảnh gốc và cần đặt sản phẩm vào studio thì IC-Light (một lượt, nhiều ảnh), còn lại FLUX Ultra (mỗi ảnh một lượt). */
export async function replicateImages(q: RepReq): Promise<RepOut> {
  const k = serviceKey("replicate");
  if (!k) throw new RepError("auth", "Chưa có khóa Replicate.");
  const { key, base } = k;
  q.onBegin?.();
  // Ảnh tính vào hạn mức từ lúc yêu cầu tạo đã gửi đi (xem predict): bấm Dừng hay tải ảnh lỗi sau đó không trả lại hạn mức của ảnh Replicate đã tính tiền.
  let used = 0, usd = 0;
  const tag = (e: unknown) => { if (e instanceof RepError) e.spent = { used, usd }; return e; };
  if (q.relight && q.reference) {
    const model = MASTER_IMAGE_GEN_CONFIG.productRelightModel;
    try {
      const s = await loadSchema(base, key, model);
      const ref = await uploadRef(base, key, q.reference, q.signal);
      try {
        const r = await predict(base, key, { version: s.version }, relightInput(s, { prompt: q.prompt, aspect: q.aspect, count: q.count, ref: ref.value }), q.signal, () => { used = q.count; });
        const files = [];
        for (const u of r.urls.slice(0, q.count)) files.push(await download(u, base, key, q.signal));
        return { files, model, usd: 0, seconds: r.seconds, used };
      } finally { ref.drop(); }
    } catch (e) { throw tag(e); }
  }
  const model = MASTER_IMAGE_GEN_CONFIG.textToImageModel;
  const s = await loadSchema(base, key, model).catch(() => undefined);
  // Có ảnh gốc mà không gửi được (lược đồ chưa tải, model không có image_prompt): không âm thầm tạo ảnh chỉ từ chữ rồi báo là xong.
  if (q.reference && !s?.props.includes("image_prompt")) throw new RepError("other", "FLUX trên Replicate không nhận được ảnh gốc lúc này.");
  const ref = q.reference ? await uploadRef(base, key, q.reference, q.signal) : null;
  try {
    const files: RepOut["files"] = []; let seconds = 0;
    for (let i = 0; i < q.count; i++) {
      try {
        const r = await predict(base, key, { model }, fluxInput(s, { prompt: q.prompt, aspect: q.aspect, product: q.product, ref: ref?.value }), q.signal, () => { used++; usd += FLUX_USD; });
        seconds += r.seconds;
        files.push(await download(r.urls[0], base, key, q.signal));
      } catch (e) { if (!files.length || (e as RepError).kind === "aborted") throw tag(e); break; }
    }
    return { files, model, usd, seconds, used };
  } finally { ref?.drop(); }
}
