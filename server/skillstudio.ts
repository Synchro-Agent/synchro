// Tự xếp skill vào ba mục tạo mới ở trang Artifacts — Tài liệu (docs), Trình bày (slides), Thiết kế (design) — chỉ chạy ở máy chủ.
// Áp cho skill của người dùng (Kho kỹ năng → Skill) và skill của plugin đang ở chế độ Tự động nhận diện. Skill thuộc mục nào thì vào thư viện của
// mục đó: bấm Tài liệu / Trình bày / Thiết kế là model có skill ấy, như skill của studio plugin (plugins.ts → studioSkills).
// - Ngay khi lưu: bộ luật từ khóa (studiorules.ts) — luôn có kết quả, không cần model.
// - Ngay sau đó, ở nền: model của chính người dùng (gói hoặc khóa API, như mọi việc phụ) đọc skill rồi xếp lại; có kết quả thì thay bộ luật.
// - Người dùng tự chọn mục (Kho kỹ năng → skill → Mục ở Artifacts) thì giữ nguyên, không tự xếp lại.
// Nội dung skill đổi (phiên bản mới, cập nhật plugin) thì xếp lại.
// Thư viện của danh mục Claude (~18.000 skill): chỉ dùng bộ luật chặt, không bao giờ nhờ model (classifyCatalog).
import "server-only";
import crypto from "node:crypto";
import { db, getUser, type UserRow } from "./authstore";
import { NO_CHEAP, OneShotErr, quickCall } from "./ai/anymodel";
import { parseStudios, ruleStudios, STUDIO_KINDS, STUDIO_SYSTEM, studioAsk, type StudioKind } from "./studiorules";

export type StudioSrc = "rules" | "model" | "manual";
export type StudioTag = { studios: StudioKind[]; src: StudioSrc; why: string };
type Row = { key: string; studios: string; src: StudioSrc; sig: string; why: string | null; model_at: number | null; at: number };

// Bảng skill_studios: db/migrations/001_baseline.sql (bộ chạy migration tạo khi mở cơ sở dữ liệu).
function init() {
  return db();
}
/** Máy chủ mới chưa xếp skill nào thì chưa có bảng: bên đọc thẳng bảng (plugins.ts) gọi trước, không thì lượt chat đầu lỗi "no such table". */
export const tagsTable = () => init();
// Số lần nhãn mục đổi (plugins.ts dựng lại bộ đệm skill của chat khi số này đổi). Đặt trên globalThis: mọi route dùng chung.
const G = globalThis as unknown as { __tagRev?: number };
export const tagRev = () => G.__tagRev ?? 0;
export const bumpTags = () => { G.__tagRev = tagRev() + 1; };
// Mỗi lần báo là bộ đệm skill của chat phải dựng lại: xếp cả nghìn skill thì gộp lại, chỉ báo một lần sau cùng. fn chạy đồng bộ.
let held = 0, dirty = false;
const bump = () => { if (held) dirty = true; else bumpTags(); };
/** Chạy fn không báo đổi nhãn; trả về true nếu có nhãn đổi (người gọi tự gọi bumpTags khi xong cả đợt). */
export function holdTags(fn: () => void): boolean {
  const outer = dirty;
  held++; dirty = false;
  try { fn(); return dirty; } finally { held--; dirty = dirty || outer; if (!held) dirty = false; }
}
// Khóa của một plugin dưới dạng khoảng ("p:<id>:" … "p:<id>;"): đi theo khóa chính. LIKE không dùng được chỉ mục, thành quét cả bảng ~18.000 dòng cho mỗi plugin.
const range = (pluginId: string) => [`p:${pluginId}:`, `p:${pluginId};`] as const;
export const userKey = (skillId: string) => `u:${skillId}`;
export const pluginKey = (pluginId: string, name: string) => `p:${pluginId}:${name}`;
const sigOf = (name: string, description: string, body: string) => crypto.createHash("sha1").update(`${name}\n${description}\n${body}`).digest("hex").slice(0, 16);
const parse = (r: Row): StudioTag => ({ studios: (JSON.parse(r.studios) as StudioKind[]).filter((k) => STUDIO_KINDS.includes(k)), src: r.src, why: r.why ?? "" });

export function getTag(key: string): StudioTag | null {
  const r = init().prepare("SELECT * FROM skill_studios WHERE key = ?").get(key) as Row | undefined;
  return r ? parse(r) : null;
}
export function tagsOf(keys: string[]): Map<string, StudioTag> {
  const out = new Map<string, StudioTag>();
  if (!keys.length) return out;
  const st = init().prepare("SELECT * FROM skill_studios WHERE key = ?");
  for (const k of keys) { const r = st.get(k) as Row | undefined; if (r) out.set(k, parse(r)); }
  return out;
}

/** Xếp mục bằng bộ luật khi skill mới hoặc nội dung đã đổi (giữ nguyên lựa chọn của người dùng). Trả về true nếu cần nhờ model. */
export function classify(key: string, s: { name: string; description: string; body: string }, strict = false): boolean {
  const d = init();
  const base = sigOf(s.name, s.description, s.body), sig = strict ? `${base}:${CATALOG_RULES}` : base;
  const cur = d.prepare("SELECT * FROM skill_studios WHERE key = ?").get(key) as Row | undefined;
  // Kết quả model đã xếp vẫn giữ khi chuyển sang bộ luật chặt, miễn nội dung skill không đổi.
  if (cur && (cur.src === "manual" || cur.sig === sig || (cur.src !== "rules" && cur.sig === base))) return cur.src === "rules" && !cur.model_at;
  // strict: không có model nào xếp lại phía sau (thư viện chung, thư viện lớn) thì dùng bộ luật chặt, bộ luật rộng xếp nhầm quá nhiều.
  const g = ruleStudios(s.name, s.description, s.body, strict);
  d.prepare("INSERT INTO skill_studios (key, studios, src, sig, why, model_at, at) VALUES (?, ?, 'rules', ?, ?, NULL, ?) ON CONFLICT(key) DO UPDATE SET studios = excluded.studios, src = 'rules', sig = excluded.sig, why = excluded.why, model_at = NULL, at = excluded.at")
    .run(key, JSON.stringify(g.studios), sig, g.why, Date.now());
  bump();
  return true;
}

/** Người dùng tự chọn mục: không tự xếp lại nữa (kể cả khi có phiên bản mới). auto = true: bỏ lựa chọn tay, để Synchro tự nhận diện lại. */
export function setManual(key: string, studios: StudioKind[] | null, s: { name: string; description: string; body: string }) {
  const d = init();
  if (studios === null) { d.prepare("DELETE FROM skill_studios WHERE key = ?").run(key); classify(key, s); return getTag(key)!; }
  const clean = STUDIO_KINDS.filter((k) => studios.includes(k));
  d.prepare("INSERT INTO skill_studios (key, studios, src, sig, why, model_at, at) VALUES (?, ?, 'manual', ?, '', NULL, ?) ON CONFLICT(key) DO UPDATE SET studios = excluded.studios, src = 'manual', sig = excluded.sig, why = '', at = excluded.at")
    .run(key, JSON.stringify(clean), sigOf(s.name, s.description, s.body), Date.now());
  bump();
  return getTag(key)!;
}
export const dropTag = (key: string) => { bump(); return init().prepare("DELETE FROM skill_studios WHERE key = ?").run(key); };
export const dropPluginTags = (pluginId: string) => { bump(); return init().prepare("DELETE FROM skill_studios WHERE key >= ? AND key < ?").run(...range(pluginId)); };
/** Plugin chuyển sang Không xếp mục: bỏ nhãn của bộ luật (tính lại lúc nào cũng được), giữ mục người dùng tự chọn.
 *  Nhãn model cũng giữ, chỉ không dùng khi plugin ở Không (bộ đệm chat lọc theo auto_tag): bật lại Tự động không phải hỏi lại model từng skill. */
export function dropAutoTags(pluginId: string) {
  if (init().prepare("DELETE FROM skill_studios WHERE key >= ? AND key < ? AND src = 'rules'").run(...range(pluginId)).changes) bump();
}
/** Nhãn mục của mọi skill plugin (khác rỗng), cho bộ đệm skill của chat. */
export const pluginTagRows = () => init().prepare("SELECT key, studios, src FROM skill_studios WHERE key >= 'p:' AND key < 'p;' AND studios <> '[]'").all() as { key: string; studios: string; src: StudioSrc }[];
/** Số skill của plugin đã được xếp vào từng mục (bảng chi tiết của plugin). manualOnly: plugin ở Không xếp mục, chỉ còn mục người dùng tự chọn. */
export function pluginDetected(pluginId: string, manualOnly = false): Partial<Record<StudioKind, number>> {
  const out: Partial<Record<StudioKind, number>> = {};
  for (const r of init().prepare(`SELECT studios FROM skill_studios WHERE key >= ? AND key < ? AND studios <> '[]'${manualOnly ? " AND src = 'manual'" : ""}`).all(...range(pluginId)) as { studios: string }[])
    for (const k of JSON.parse(r.studios) as StudioKind[]) out[k] = (out[k] ?? 0) + 1;
  return out;
}
/** Bỏ nhãn của skill không còn trong plugin (sau khi cập nhật gói). */
export function keepPluginTags(pluginId: string, names: string[]) {
  const keep = new Set(names.map((n) => pluginKey(pluginId, n)));
  const del = init().prepare("DELETE FROM skill_studios WHERE key = ?");
  for (const r of init().prepare("SELECT key FROM skill_studios WHERE key >= ? AND key < ?").all(...range(pluginId)) as { key: string }[]) if (!keep.has(r.key)) { del.run(r.key); bump(); }
}

// Đổi khi sửa bộ luật chặt (studiorules.ts): sau lần deploy kế, mọi skill của danh mục được xếp lại đúng một lần.
const CATALOG_RULES = "c3";
/** Xếp một thư viện của danh mục Claude. Chỉ đọc tên và mô tả nên không cần nội dung skill.
 *  D4: ưu tiên nhãn do model xếp sẵn lúc đồng bộ (stored, theo tên skill — claudedir.dirStudios); không có thì lùi về bộ luật từ khóa chặt.
 *  Giữ mục người dùng tự chọn; chữ ký không đổi thì không làm lại. Chữ ký kèm nguồn nhãn để lần đồng bộ sau có nhãn model mới thì cập nhật. */
export function classifyCatalog(pluginId: string, rows: { name: string; description: string }[], stored?: (name: string) => string[] | null) {
  const d = init();
  const cur = new Map((d.prepare("SELECT key, studios, src, sig FROM skill_studios WHERE key >= ? AND key < ?").all(...range(pluginId)) as Pick<Row, "key" | "studios" | "src" | "sig">[]).map((r) => [r.key, r]));
  const put = d.prepare("INSERT INTO skill_studios (key, studios, src, sig, why, model_at, at) VALUES (?, ?, ?, ?, ?, NULL, ?) ON CONFLICT(key) DO UPDATE SET studios = excluded.studios, src = excluded.src, sig = excluded.sig, why = excluded.why, model_at = NULL, at = excluded.at");
  const now = Date.now();
  for (const r of rows) {
    const key = pluginKey(pluginId, r.name), c = cur.get(key);
    cur.delete(key);
    if (c && c.src === "manual") continue;
    // Nhãn model xếp sẵn lúc đồng bộ: dùng thẳng. Không có: bộ luật chặt là phương án lùi.
    const fromModel = stored?.(r.name) ?? null;
    const g = fromModel ? null : ruleStudios(r.name, r.description, "", true);
    const picked = fromModel ? STUDIO_KINDS.filter((k) => fromModel.includes(k)) : g!.studios;
    const src: StudioSrc = fromModel ? "model" : "rules";
    const studios = JSON.stringify(picked);
    // Chữ ký gồm nội dung + nguồn + chính nhãn: lần đồng bộ sau đổi nhãn (hoặc chuyển model↔rules) thì làm lại, nếu không thì bỏ qua.
    const sig = `${sigOf(r.name, r.description, "")}:${CATALOG_RULES}:${src}:${studios}`;
    if (c?.sig === sig && c.src === src) continue;
    put.run(key, studios, src, sig, fromModel ? "model (đồng bộ)" : g!.why, now);
    if ((c?.studios ?? "[]") !== studios) bump();
  }
  if (cur.size) { const del = d.prepare("DELETE FROM skill_studios WHERE key = ?"); for (const k of cur.keys()) del.run(k); bump(); }
}

// ---------------------------------------------------------------- nhờ model (ở nền, lần lượt từng skill)
const queue: { uid: string; key: string; s: { name: string; description: string; body: string } }[] = [];
let running = false;
/** Nhờ model của người dùng xếp lại (ở nền). Chưa có model / model lỗi: giữ kết quả bộ luật. */
export function refine(uid: string, key: string, s: { name: string; description: string; body: string }) {
  if (queue.some((q) => q.key === key)) return;
  queue.push({ uid, key, s });
  if (!running) void drain();
}
async function drain() {
  running = true;
  try {
    while (queue.length) {
      const q = queue.shift()!;
      await ask(q.uid, q.key, q.s).catch((e) => console.error("[skill-studio]", (e as Error).message));
    }
  } finally { running = false; }
}
async function ask(uid: string, key: string, s: { name: string; description: string; body: string }) {
  const d = init();
  const cur = d.prepare("SELECT * FROM skill_studios WHERE key = ?").get(key) as Row | undefined;
  const sig = sigOf(s.name, s.description, s.body);
  if (!cur || cur.src !== "rules" || cur.sig !== sig || cur.model_at) return;
  const user: UserRow | undefined = getUser(uid);
  if (!user) return;
  // Việc nền không ai chờ: model rẻ nhất (quickCall, như đặt tên đoạn chat), không phải model bộ định tuyến chọn; trên gói của người dùng thì chịu
  // ngân sách việc phụ của hôm nay (ai/helperquota.ts). Chưa tới lượt (NO_CHEAP) thì bỏ dấu đã hỏi để lần lưu / mở Kho kỹ năng sau thử lại.
  d.prepare("UPDATE skill_studios SET model_at = ? WHERE key = ?").run(Date.now(), key);
  let raw: string, model: string;
  try { ({ text: raw, model } = await quickCall(user, STUDIO_SYSTEM, studioAsk(s.name, s.description, s.body), { maxTokens: 300, job: "skill-studio", bg: true, signal: AbortSignal.timeout(90_000) })); }
  catch (e) {
    if (e instanceof OneShotErr && (e.message === NO_CHEAP || e.status === 503)) { d.prepare("UPDATE skill_studios SET model_at = NULL WHERE key = ?").run(key); return; }
    throw e;
  }
  const r = parseStudios(raw);
  if (!r) return;
  // Trong lúc chờ model, người dùng có thể đã tự chọn mục hoặc lưu phiên bản mới: chỉ ghi khi vẫn là kết quả bộ luật của đúng nội dung này.
  const studios = JSON.stringify(r.studios);
  const done = d.prepare("UPDATE skill_studios SET studios = ?, src = 'model', why = ?, at = ? WHERE key = ? AND src = 'rules' AND sig = ?")
    .run(studios, r.why || `model ${model}`, Date.now(), key, sig).changes;
  // Mỗi lần báo là cả máy chủ dựng lại bộ đệm skill (~70 ms với 18.000 skill): model chỉ xác nhận lại mục cũ thì không báo.
  if (done && studios !== cur.studios) bump();
}
/** id các skill của người này (đang bật) đã được xếp vào mục studio. */
export function userStudioIds(uid: string, studio: StudioKind): string[] {
  const rows = init().prepare("SELECT s.id, t.studios FROM skills s JOIN skill_studios t ON t.key = 'u:' || s.id WHERE s.user_id = ? AND s.enabled = 1 ORDER BY s.name").all(uid) as { id: string; studios: string }[];
  return rows.filter((r) => (JSON.parse(r.studios) as string[]).includes(studio)).map((r) => r.id);
}
/** Có việc đang chờ model không (kiểm thử chờ cho xong). */
export const refining = () => running || queue.length > 0;
