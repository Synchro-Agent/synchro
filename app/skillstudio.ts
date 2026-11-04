// Tự xếp skill vào ba mục tạo mới ở trang Artifacts — Tài liệu (docs), Trình bày (slides), Thiết kế (design) — chỉ chạy ở máy chủ.
// Áp cho skill của người dùng (Kho kỹ năng → Skill) và skill của plugin không gắn studio. Skill thuộc mục nào thì vào thư viện của
// mục đó: bấm Tài liệu / Trình bày / Thiết kế là model có skill ấy, như skill của studio plugin (plugins.ts → studioSkills).
// - Ngay khi lưu: bộ luật từ khóa (studiorules.ts) — luôn có kết quả, không cần model.
// - Ngay sau đó, ở nền: model của chính người dùng (gói hoặc khóa API, như mọi việc phụ) đọc skill rồi xếp lại; có kết quả thì thay bộ luật.
// - Người dùng tự chọn mục (Kho kỹ năng → skill → Mục ở Artifacts) thì giữ nguyên, không tự xếp lại.
// Nội dung skill đổi (phiên bản mới, cập nhật plugin) thì xếp lại.
import crypto from "node:crypto";
import { db, getUser, type UserRow } from "./authstore";
import { oneShot, pickModel } from "./ai/anymodel";
import { parseStudios, ruleStudios, STUDIO_KINDS, STUDIO_SYSTEM, studioAsk, type StudioKind } from "./studiorules";

export type StudioSrc = "rules" | "model" | "manual";
export type StudioTag = { studios: StudioKind[]; src: StudioSrc; why: string };
type Row = { key: string; studios: string; src: StudioSrc; sig: string; why: string | null; model_at: number | null; at: number };

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    // key: "u:<id skill>" (skill của người dùng) hoặc "p:<id plugin>:<tên skill>". model_at: lần cuối đã nhờ model (kể cả khi lỗi), để không hỏi lại mãi.
    d.exec(`CREATE TABLE IF NOT EXISTS skill_studios (key TEXT PRIMARY KEY, studios TEXT NOT NULL, src TEXT NOT NULL, sig TEXT NOT NULL, why TEXT, model_at INTEGER, at INTEGER NOT NULL)`);
    ready = true;
  }
  return d;
}
/** Máy chủ mới chưa xếp skill nào thì chưa có bảng: bên đọc thẳng bảng (plugins.ts) gọi trước, không thì lượt chat đầu lỗi "no such table". */
export const tagsTable = () => init();
// Số lần nhãn mục đổi (plugins.ts dựng lại bộ đệm skill của chat khi số này đổi). Đặt trên globalThis: mọi route dùng chung.
const G = globalThis as unknown as { __tagRev?: number };
export const tagRev = () => G.__tagRev ?? 0;
const bump = () => { G.__tagRev = tagRev() + 1; };
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
export function classify(key: string, s: { name: string; description: string; body: string }): boolean {
  const d = init();
  const sig = sigOf(s.name, s.description, s.body);
  const cur = d.prepare("SELECT * FROM skill_studios WHERE key = ?").get(key) as Row | undefined;
  if (cur && (cur.src === "manual" || cur.sig === sig)) return cur.src === "rules" && !cur.model_at;
  const g = ruleStudios(s.name, s.description, s.body);
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
export const dropPluginTags = (pluginId: string) => { bump(); return init().prepare("DELETE FROM skill_studios WHERE key LIKE ?").run(`p:${pluginId}:%`); };
/** Bỏ nhãn của skill không còn trong plugin (sau khi cập nhật gói). */
export function keepPluginTags(pluginId: string, names: string[]) {
  const keep = new Set(names.map((n) => pluginKey(pluginId, n)));
  const del = init().prepare("DELETE FROM skill_studios WHERE key = ?");
  for (const r of init().prepare("SELECT key FROM skill_studios WHERE key LIKE ?").all(`p:${pluginId}:%`) as { key: string }[]) if (!keep.has(r.key)) { del.run(r.key); bump(); }
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
  const pick = await pickModel(user, { text: "phân loại ngắn", attachments: 0, turns: 1, studio: false }).catch(() => null);
  if (!pick) return; // chưa có model: giữ bộ luật, lần lưu / mở Kho kỹ năng sau thử lại
  d.prepare("UPDATE skill_studios SET model_at = ? WHERE key = ?").run(Date.now(), key);
  const raw = await oneShot(user, pick.model, STUDIO_SYSTEM, [{ role: "user", content: studioAsk(s.name, s.description, s.body) }], { maxTokens: 300, feature: "skill-studio", signal: AbortSignal.timeout(90_000) });
  const r = parseStudios(raw);
  if (!r) return;
  // Trong lúc chờ model, người dùng có thể đã tự chọn mục hoặc lưu phiên bản mới: chỉ ghi khi vẫn là kết quả bộ luật của đúng nội dung này.
  d.prepare("UPDATE skill_studios SET studios = ?, src = 'model', why = ?, at = ? WHERE key = ? AND src = 'rules' AND sig = ?")
    .run(JSON.stringify(r.studios), r.why || `model ${pick.model}`, Date.now(), key, sig);
  bump();
}
/** id các skill của người này (đang bật) đã được xếp vào mục studio. */
export function userStudioIds(uid: string, studio: StudioKind): string[] {
  const rows = init().prepare("SELECT s.id, t.studios FROM skills s JOIN skill_studios t ON t.key = 'u:' || s.id WHERE s.user_id = ? AND s.enabled = 1 ORDER BY s.name").all(uid) as { id: string; studios: string }[];
  return rows.filter((r) => (JSON.parse(r.studios) as string[]).includes(studio)).map((r) => r.id);
}
/** Có việc đang chờ model không (kiểm thử chờ cho xong). */
export const refining = () => running || queue.length > 0;
