// Tìm kiếm theo nghĩa dùng chung (bộ não, tài liệu lớn của dự án): mỗi mục (ghi chú, đoạn tài liệu) có một vector embedding lưu trong SQLite
// (Float32 thô, ghi kèm số chiều và model đã dùng). Model đổi thì mục được embed lại; chỉ dùng khóa OpenAI / Gemini quản trị viên đã nhập
// (providers.embedTarget), không có khóa thì mọi hàm ở đây im lặng trả rỗng và tìm kiếm chỉ dùng từ khóa (BM25).
// - Embed ở nền theo nhịp của bộ hẹn giờ, từng lô, thử lại có giãn cách khi hãng báo bận; mỗi người có hạn mức chi phí embed mỗi ngày,
//   tính vào Mức dùng như chat (tính năng "embed").
// - Bộ nhớ: không giữ vector của mọi người trong RAM. Vector của một người (một tài liệu) nạp khi cần, giữ theo LRU có trần dung lượng,
//   bỏ khi không ai dùng 20 phút; số liệu báo ở Sức khỏe hệ thống (memstat "vectors").
import crypto from "node:crypto";
import { db, getUser } from "./authstore";
import { embedTarget, type EmbedTarget } from "./providers";
import { registerMemStat } from "./memstat";
import { onTick } from "./tasks";
import { featureCost, overLimit, priceOf, recordUsage, withUsage } from "./usage";

/** Số chiều tối đa giữ lại: OpenAI text-embedding-3 nhận tham số dimensions; Gemini embedding (Matryoshka) cắt bớt rồi chuẩn hóa lại. */
export const EMBED_DIM = 768;
const BATCH = 64, TEXT_MAX = 2000, FEATURE = "embed";
const env = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 && process.env[k] !== "" && process.env[k] !== undefined ? v : d; };
/** Hạn mức chi phí embed của một người trong 24 giờ (USD). */
const dayCap = () => env("SYNCHRO_EMBED_DAY_USD", 0.05);
const ramCap = () => env("SYNCHRO_VEC_RAM_MB", 96) * 1048576;
const IDLE_MS = 20 * 60_000;

let ready = false;
function t() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS vec_items (scope TEXT NOT NULL, owner TEXT NOT NULL, item TEXT NOT NULL, user_id TEXT NOT NULL, model TEXT NOT NULL,
        dim INTEGER NOT NULL, hash TEXT NOT NULL, src_at INTEGER NOT NULL, vec BLOB, at INTEGER NOT NULL, PRIMARY KEY (scope, item));
      DROP INDEX IF EXISTS vec_items_owner;
      CREATE INDEX IF NOT EXISTS vec_items_own ON vec_items(scope, owner, model, dim, at)`);
    ready = true;
  }
  return d;
}
const hashOf = (s: string) => crypto.createHash("sha1").update(s).digest("base64url").slice(0, 22);
const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
/** Mã băm của đúng phần chữ sẽ được embed (nguồn so với vec_items.hash để biết mục đã đổi nội dung). */
export const vecHash = (text: string, maxChars = TEXT_MAX) => hashOf(clean(text, maxChars));

// ---------------------------------------------------------------- gọi API embedding
export class EmbedErr extends Error { constructor(m: string, public status: number, public retryAfter = 0) { super(m); } }
const norm = (a: ArrayLike<number>, dim: number) => {
  const v = new Float32Array(Math.min(dim, a.length));
  let s = 0;
  for (let i = 0; i < v.length; i++) { v[i] = a[i]; s += v[i] * v[i]; }
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= s;
  return v;
};
/** Một lần gọi /embeddings (OpenAI và lối tương thích OpenAI của Gemini đều cùng định dạng). */
async function callEmbed(tg: EmbedTarget, inputs: string[], signal?: AbortSignal): Promise<{ vecs: Float32Array[]; tokens: number }> {
  const body: Record<string, unknown> = { model: tg.model, input: inputs, encoding_format: "float" };
  if (tg.kind === "openai" && /^text-embedding-3/.test(tg.model)) body.dimensions = EMBED_DIM;
  let r: Response;
  try {
    r = await fetch(`${tg.base}/embeddings`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tg.key}` }, body: JSON.stringify(body), signal });
  } catch (e) { throw new EmbedErr((e as Error).name === "AbortError" || (e as Error).name === "TimeoutError" ? "timeout" : `network: ${(e as Error).message}`, 0); }
  const j = (await r.json().catch(() => null)) as { data?: { index?: number; embedding?: number[] }[]; usage?: { prompt_tokens?: number }; error?: { message?: string } } | null;
  if (!r.ok || !Array.isArray(j?.data)) throw new EmbedErr(String(j?.error?.message ?? `HTTP ${r.status}`).slice(0, 200), r.status, Number(r.headers.get("retry-after")) || 0);
  const out: Float32Array[] = new Array(inputs.length);
  j!.data!.forEach((d, i) => { if (Array.isArray(d.embedding)) out[d.index ?? i] = norm(d.embedding, EMBED_DIM); });
  if (out.some((v) => !v) || out.length !== inputs.length) throw new EmbedErr("bad_response", 502);
  const tokens = typeof j!.usage?.prompt_tokens === "number" ? j!.usage.prompt_tokens : Math.ceil(inputs.reduce((a, s) => a + s.length, 0) / 4);
  return { vecs: out, tokens };
}
const retryable = (e: EmbedErr) => e.status === 0 || e.status === 429 || e.status >= 500;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** Lô ở nền: thử lại tối đa 3 lần, giãn cách 0,5 → 1 → 2 giây (theo retry-after nếu hãng báo, tối đa 10 giây). */
async function embedRetry(tg: EmbedTarget, inputs: string[]) {
  for (let i = 0; ; i++) {
    try { return await callEmbed(tg, inputs, AbortSignal.timeout(30_000)); } catch (e) {
      const er = e instanceof EmbedErr ? e : new EmbedErr(String(e), 0);
      if (i >= 3 || !retryable(er)) throw er;
      await sleep(Math.min(10_000, er.retryAfter ? er.retryAfter * 1000 : 500 * 2 ** i));
    }
  }
}
const g = globalThis as unknown as { __vecCache?: Map<string, Mat>; __vecQueue?: Map<string, number>; __vecSources?: Map<string, VecSource>; __vecBusy?: boolean; __vecQ?: Map<string, { v: Float32Array; at: number }>; __vecStats?: { embedded: number; calls: number; skippedCap: number; errors: number; rejected: number; queryTimeouts: number }; __vecQFly?: Map<string, Promise<Float32Array | null>> };
const stats = (g.__vecStats ??= { embedded: 0, calls: 0, skippedCap: 0, errors: 0, rejected: 0, queryTimeouts: 0 });
stats.rejected ??= 0;

/** Còn được embed bao nhiêu USD hôm nay (null: không giới hạn được vì không biết người dùng). */
function budgetLeft(uid: string) {
  const u = getUser(uid);
  if (!u || overLimit(u)) return 0;
  return dayCap() - featureCost(uid, FEATURE, Date.now() - 86_400_000);
}
const estCost = (tg: EmbedTarget, chars: number) => (Math.ceil(chars / 4) * priceOf(tg.modelKey).in) / 1e6;
// Tài khoản đã bị xóa trong lúc chờ API: không ghi dòng Mức dùng mới cho nó (bước xóa đã dọn sạch), chỉ để lại dấu ở nhật ký máy chủ.
const charge = (uid: string, tg: EmbedTarget, tokens: number) => {
  if (!getUser(uid)) { console.warn(`[vec] bỏ ghi ${tokens} token embed: tài khoản không còn`); return; }
  withUsage(uid, FEATURE, () => recordUsage(tg.modelKey, { prompt_tokens: tokens, completion_tokens: 0 }));
};

// ---------------------------------------------------------------- nguồn mục cần embed
export type VecItem = { item: string; text: string; srcAt: number };
export type VecSource = {
  /** Mục chưa có vector của model này hoặc đã sửa sau lần embed (mới sửa trước). text rỗng: không có gì để embed, chỉ đánh dấu đã xét. */
  pending: (owner: string, model: string, limit: number) => VecItem[] | Promise<VecItem[]>;
  /** Tài khoản chịu chi phí của owner. */
  userOf: (owner: string) => string | null;
  /** Số ký tự tối đa của một mục (mặc định 2000). */
  maxChars?: number;
  /** Mục dùng chung cho nhiều người (đoạn tài liệu theo mã băm): không gắn vector với người trả tiền, xóa tài khoản người đó không xóa vector. */
  shared?: boolean;
  /** Các mục trong danh sách còn tồn tại (gọi sau khi API trả về: ghi chú, tài liệu có thể bị xóa trong lúc chờ). Không khai báo: coi như còn. */
  alive?: (owner: string, items: string[]) => Set<string>;
};
const sources: Map<string, VecSource> = (g.__vecSources ??= new Map());
export const registerVecSource = (scope: string, s: VecSource) => { sources.set(scope, s); };
const queue: Map<string, number> = (g.__vecQueue ??= new Map());
/** Đưa một chủ sở hữu (người dùng, tài liệu) vào hàng embed ở nền. */
export function queueEmbed(scope: string, owner: string) { if (queue.size < 5000 || queue.has(`${scope}\u0000${owner}`)) queue.set(`${scope}\u0000${owner}`, Date.now()); }

/** Embed các mục còn thiếu của một owner (tối đa max mục). Trả số mục vừa có vector. Không có khóa, hết hạn mức: trả 0, không báo lỗi. */
export async function embedPending(scope: string, owner: string, max = 256): Promise<number> {
  const tg = embedTarget(), src = sources.get(scope);
  if (!tg || !src) return 0;
  const uid = src.userOf(owner);
  if (!uid) return 0;
  const d = t();
  const old = d.prepare("SELECT hash, model, dim FROM vec_items WHERE scope = ? AND item = ?");
  const upsert = d.prepare(`INSERT INTO vec_items (scope, owner, item, user_id, model, dim, hash, src_at, vec, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, item) DO UPDATE SET owner = excluded.owner, user_id = excluded.user_id, model = excluded.model, dim = excluded.dim, hash = excluded.hash, src_at = excluded.src_at, vec = excluded.vec, at = excluded.at`);
  const touch = d.prepare("UPDATE vec_items SET src_at = ? WHERE scope = ? AND item = ?");
  const payer = src.shared ? "" : uid, max0 = src.maxChars ?? TEXT_MAX;
  // Lưu kết quả một lô, bỏ các mục đã bị xóa (hay tài khoản đã bị xóa) trong lúc chờ API.
  const save = (part: { item: string; h: string; srcAt: number }[], vecs: (Float32Array | null)[]) => {
    if (!getUser(uid) && !src.shared) return 0;
    const live = src.alive ? src.alive(owner, part.map((x) => x.item)) : null;
    const at = Date.now();
    let n = 0;
    d.transaction(() => {
      part.forEach((x, k) => {
        if (live && !live.has(x.item)) return;
        const v = vecs[k];
        upsert.run(scope, owner, x.item, payer, tg.model, v ? v.length : 0, x.h, x.srcAt, v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : null, at);
        n++;
      });
    })();
    return n;
  };
  // Một lô; hãng từ chối vì nội dung (400 / 413 / 422, ví dụ một đoạn vượt giới hạn token) thì chia đôi để tìm đúng mục lỗi, mục đó ghi dim = 0
  // (bỏ qua cho tới khi nội dung đổi) để các mục sau không bị chặn mãi. Lỗi khóa, hết hạn mức, mạng: dừng, lần sau thử lại cả lô.
  const run = async (part: { item: string; h: string; srcAt: number; text: string }[]): Promise<number | null> => {
    if (budgetLeft(uid) < estCost(tg, part.reduce((a, x) => a + x.text.length, 0))) { stats.skippedCap++; return null; }
    let r: { vecs: Float32Array[]; tokens: number };
    try { r = await embedRetry(tg, part.map((x) => x.text)); } catch (e) {
      const er = e as EmbedErr;
      stats.errors++;
      console.warn(`[vec] embed ${scope} lỗi: ${er.message}`);
      if (![400, 413, 422].includes(er.status)) return null;
      if (part.length === 1) { stats.rejected++; save(part, [null]); return 0; }
      const h = Math.ceil(part.length / 2), a = await run(part.slice(0, h));
      if (a === null) return null;
      const b = await run(part.slice(h));
      return b === null ? a : a + b;
    }
    stats.calls++;
    charge(uid, tg, r.tokens);
    const n = save(part, r.vecs);
    stats.embedded += n;
    return n;
  };
  let done = 0;
  const seen = new Set<string>();
  for (let round = 0; round < 40 && done < max; round++) {
    const limit = Math.min(BATCH * 2, max - done);
    const list = (await src.pending(owner, tg.model, limit)).filter((x) => !seen.has(x.item));
    if (!list.length) break;
    for (const x of list) seen.add(x.item);
    const now = Date.now(), need: (VecItem & { h: string; text: string })[] = [];
    for (const it of list) {
      const text = clean(it.text, max0), h = hashOf(text);
      const o = old.get(scope, it.item) as { hash: string; model: string; dim: number } | undefined;
      // Nội dung embed không đổi (chỉ sửa thuộc tính khác) và cùng model: chỉ ghi lại mốc, không gọi API.
      if (o && o.hash === h && o.model === tg.model) { touch.run(it.srcAt, scope, it.item); continue; }
      if (!text) { upsert.run(scope, owner, it.item, payer, tg.model, 0, h, it.srcAt, null, now); continue; }
      need.push({ ...it, text, h });
    }
    for (let i = 0; i < need.length; i += BATCH) {
      const n = await run(need.slice(i, i + BATCH));
      if (n === null) return done;
      done += n;
    }
    if (list.length < limit) break;
  }
  return done;
}
/** Chạy hàng embed (theo nhịp của bộ hẹn giờ; kiểm thử gọi thẳng). Một vòng mỗi lúc cho cả máy chủ. */
export async function drainEmbedQueue(o: { maxOwners?: number } = {}) {
  if (g.__vecBusy || !queue.size || !embedTarget()) return 0;
  g.__vecBusy = true;
  let n = 0;
  try {
    const keys = [...queue.keys()].slice(0, o.maxOwners ?? 4);
    for (const k of keys) {
      queue.delete(k);
      const [scope, owner] = k.split("\u0000");
      n += await embedPending(scope, owner).catch((e) => { console.warn(`[vec] ${(e as Error).message}`); return 0; });
    }
  } finally { g.__vecBusy = false; }
  return n;
}
/** Xóa vector của các mục (ghi chú bị xóa, tài liệu bị xóa). */
export function dropVecs(scope: string, o: { owner?: string; items?: string[] }) {
  const d = t();
  if (o.owner) d.prepare("DELETE FROM vec_items WHERE scope = ? AND owner = ?").run(scope, o.owner);
  for (const it of o.items ?? []) d.prepare("DELETE FROM vec_items WHERE scope = ? AND item = ?").run(scope, it);
  if (o.owner) cache.delete(`${scope}\u0000${o.owner}`);
}
/** Dọn vector mồ côi theo một câu SQL của nguồn (ví dụ: ghi chú không còn). */
export const sweepVecs = (scope: string, liveSql: string, col: "item" | "owner" = "item") => t().prepare(`DELETE FROM vec_items WHERE scope = ? AND ${col} NOT IN (${liveSql})`).run(scope).changes;
/** Số mục đã có vector của model hiện tại (kiểm thử, Sức khỏe hệ thống). */
export function vecCount(scope: string, owner: string, model?: string) {
  const m = model ?? embedTarget()?.model;
  if (!m) return 0;
  return (t().prepare("SELECT COUNT(*) AS n FROM vec_items WHERE scope = ? AND owner = ? AND model = ? AND dim > 0").get(scope, owner, m) as { n: number }).n;
}
/** Model và số chiều đang lưu cho một mục (kiểm thử). */
export const vecInfo = (scope: string, item: string) => t().prepare("SELECT model, dim, hash FROM vec_items WHERE scope = ? AND item = ?").get(scope, item) as { model: string; dim: number; hash: string } | undefined;

// ---------------------------------------------------------------- vector trong RAM: nạp theo người, LRU + bỏ khi rảnh
type Mat = { model: string; dim: number; vecs: Map<string, Float32Array>; maxAt: number; n: number; used: number; bytes: number };
const cache: Map<string, Mat> = (g.__vecCache ??= new Map());
export function vecStats() {
  let vectors = 0, bytes = 0;
  for (const m of cache.values()) { vectors += m.vecs.size; bytes += m.bytes; }
  return { sets: cache.size, vectors, kb: Math.round(bytes / 1024), embedded: stats.embedded, calls: stats.calls, skippedCap: stats.skippedCap, errors: stats.errors, rejected: stats.rejected, queryTimeouts: stats.queryTimeouts, queued: queue.size };
}
registerMemStat("vectors", () => vecStats());
export function evictVecs(now = Date.now(), idleMs = IDLE_MS) {
  let n = 0;
  for (const [k, m] of cache) if (now - m.used > idleMs) { cache.delete(k); n++; }
  return n;
}
const fitRam = (keep: string) => {
  let total = 0;
  for (const m of cache.values()) total += m.bytes;
  for (const [k, m] of [...cache].sort((a, b) => a[1].used - b[1].used)) {
    if (total <= ramCap()) break;
    if (k === keep) continue;
    cache.delete(k); total -= m.bytes;
  }
};
const toVec = (b: Buffer) => { const c = new Float32Array(b.byteLength / 4); new Uint8Array(c.buffer).set(b); return c; };
/** Vector hiện tại của một owner: chỉ đọc phần mới sửa từ lần nạp trước; số mục lệch (có mục bị xóa) thì nạp lại cả. */
function matOf(scope: string, owner: string, model: string): Mat | null {
  const key = `${scope}\u0000${owner}`, d = t();
  const st = d.prepare("SELECT COUNT(*) AS n, MAX(at) AS m FROM vec_items WHERE scope = ? AND owner = ? AND model = ? AND dim > 0").get(scope, owner, model) as { n: number; m: number | null };
  if (!st.n) { cache.delete(key); return null; }
  let m = cache.get(key);
  if (m && m.model !== model) { cache.delete(key); m = undefined; }
  if (!m) m = { model, dim: 0, vecs: new Map(), maxAt: 0, n: 0, used: 0, bytes: 0 };
  if (m.n !== st.n || m.maxAt !== st.m) {
    const rows = d.prepare("SELECT item, vec, at FROM vec_items WHERE scope = ? AND owner = ? AND model = ? AND dim > 0 AND at >= ?").all(scope, owner, model, m.maxAt) as { item: string; vec: Buffer; at: number }[];
    for (const r of rows) { const v = toVec(r.vec); m.vecs.set(r.item, v); m.dim = v.length; m.maxAt = Math.max(m.maxAt, r.at); }
    if (m.vecs.size !== st.n) {
      m.vecs.clear(); m.maxAt = 0;
      for (const r of d.prepare("SELECT item, vec, at FROM vec_items WHERE scope = ? AND owner = ? AND model = ? AND dim > 0").all(scope, owner, model) as { item: string; vec: Buffer; at: number }[]) { const v = toVec(r.vec); m.vecs.set(r.item, v); m.dim = v.length; m.maxAt = Math.max(m.maxAt, r.at); }
    }
    m.n = st.n; m.bytes = m.vecs.size * (m.dim * 4 + 80);
  }
  m.used = Date.now();
  cache.set(key, m);
  fitRam(key);
  return m;
}

// ---------------------------------------------------------------- truy vấn
const qcache: Map<string, { v: Float32Array; at: number }> = (g.__vecQ ??= new Map());
/** Câu hỏi đang được embed: lượt chat chỉ chờ trong ngân sách, còn lệnh gọi chạy tiếp tới khi xong (hãng vẫn tính tiền phần đã gửi),
 *  nên chi phí được ghi vào Mức dùng và vector vào bộ đệm cho lượt sau; câu hỏi lặp lại trong lúc đó không gửi lần nữa. */
const qfly: Map<string, Promise<Float32Array | null>> = (g.__vecQFly ??= new Map());
const QUERY_MAX_MS = 15_000;
/** Ngưỡng cosine tối thiểu để coi là liên quan: mỗi họ model phân bố điểm khác nhau (Gemini cao hơn hẳn OpenAI). */
export const minCos = (model: string) => env("SYNCHRO_VEC_MIN_COS", /gemini/i.test(model) ? 0.6 : 0.3);
/** Ngưỡng cao hơn cho mục chỉ khớp theo nghĩa khi câu hỏi ngắn / mơ hồ ("tóm tắt giúp tôi"): vector của câu như vậy gần với rất nhiều thứ ở mức
 *  vừa phải, nên chỉ nhận mục thật sự gần (hoặc có cả từ khóa). Gemini cao hơn hẳn OpenAI như minCos. */
export const vagueCos = (model: string) => env("SYNCHRO_VEC_VAGUE_COS", /gemini/i.test(model) ? 0.75 : 0.45);
export type VecHit = { item: string; cos: number };
/**
 * Top-k mục gần câu hỏi nhất theo cosine. budgetMs: thời gian tối đa cho bước embed câu hỏi (quá hạn thì trả null, lượt chat dùng BM25).
 * Không có khóa, owner chưa có vector, hết hạn mức: null.
 */
export async function vecQuery(scope: string, owner: string, uid: string, query: string, k: number, budgetMs: number): Promise<{ hits: VecHit[]; model: string; ms: number } | null> {
  const tg = embedTarget();
  const q = query.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
  if (!tg || !q) return null;
  const m0 = matOf(scope, owner, tg.model);
  if (!m0) return null;
  const t0 = Date.now(), ck = `${tg.model}\u0000${q}`;
  let qv = qcache.get(ck)?.v;
  if (!qv) {
    let p = qfly.get(ck);
    if (!p) {
      if (budgetLeft(uid) <= 0) return null;
      p = callEmbed(tg, [q], AbortSignal.timeout(QUERY_MAX_MS)).then((r) => {
        charge(uid, tg, r.tokens);
        if (qcache.size >= 300) qcache.delete(qcache.keys().next().value!);
        qcache.set(ck, { v: r.vecs[0], at: Date.now() });
        return r.vecs[0];
      }, () => null).finally(() => { qfly.delete(ck); });
      qfly.set(ck, p);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = Symbol();
    const got = await Promise.race([p, new Promise<typeof late>((ok) => { timer = setTimeout(() => ok(late), Math.max(50, budgetMs)); })]);
    clearTimeout(timer);
    if (got === late) { stats.queryTimeouts++; return null; }
    if (!got) return null;
    qv = got;
  }
  const m = matOf(scope, owner, tg.model);
  if (!m) return null;
  const hits: VecHit[] = [];
  for (const [item, v] of m.vecs) {
    if (v.length !== qv.length) continue;
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * qv[i];
    hits.push({ item, cos: s });
  }
  hits.sort((a, b) => b.cos - a.cos);
  return { hits: hits.slice(0, k), model: tg.model, ms: Date.now() - t0 };
}
/** Hợp nhất nhiều danh sách xếp hạng (reciprocal-rank fusion, k = 60). */
export function rrf(lists: string[][], k = 60): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lists) l.forEach((id, i) => out.set(id, (out.get(id) ?? 0) + 1 / (k + i + 1)));
  return out;
}

onTick("vec-embed", () => { void drainEmbedQueue().catch((e) => console.warn("[vec]", e)); });
onTick("vec-evict", (now) => { evictVecs(now); });
