// Sổ model (chỉ chạy ở máy chủ): Synchro tự cập nhật model mới khi hãng ra mắt, không cần ai sửa code.
//  1) Dò: lúc khởi động và mỗi 6 giờ (lệch ngẫu nhiên vài phút), hoặc khi quản trị viên bấm "Kiểm tra ngay", đọc danh sách model chính thức
//     của mọi hãng có khóa API dùng chung, và danh sách model của các gói (CLI) quản trị viên đã đăng nhập.
//  2) Ghi sổ: mỗi model một dòng (tên, dòng model, ngày ra mắt, lần đầu thấy, trạng thái, khả năng, giới hạn token, nguồn của từng thông tin).
//     Lần đầu thấy một hãng thì cả danh sách là "nền" (không thử, không báo, không gắn nhãn Mới), để bản đang chạy không đổi gì.
//  3) Nhận dùng an toàn: model mới được thử tự động (một câu ngắn, một lần gọi công cụ, một ảnh nếu model nhận ảnh; nỗ lực thấp, có trần số lần
//     gọi mỗi ngày) bằng khóa của quản trị viên. Đạt thì hiện ở bộ chọn model kèm nhãn "Mới" 14 ngày và chế độ Tự động ưu tiên nó trong dòng của nó
//     (bản trước vẫn là dự phòng). Không đạt thì ở trạng thái "đang thử", thử lại sau; chat không bao giờ chạy trên model chưa đạt.
//     Tham số hãng từ chối khi thử (mức nỗ lực, ảnh, chế độ suy nghĩ) được ghi lại để lần gọi thật gửi đúng.
//  4) Hãng gỡ model: model chuyển sang "đã ngừng" và được thay bằng bản mới nhất cùng dòng; người đã chọn tay model đó được chuyển và báo một lần.
//     Một dòng có bản mới (không phải nền) thì chỉ giữ hai bản mới nhất ở bộ chọn, bản cũ hơn chuyển sang "đã cũ".
//  5) Báo quản trị viên vào Autopilot: "Synchro đã thêm model mới: …" kèm kết quả thử.
import "server-only";
import { ADMIN_EMAILS, db, getSetting, setSetting } from "./authstore";
import type { ProviderKind } from "../shared/catalog";
import { compareModels, isFrontier, modelFamily, parseId, tierOf, versionText, visionUnsupported } from "../shared/modelrules";

export type ModelCaps = { vision?: boolean; tools?: boolean; thinking?: "adaptive" | "budget" | "none"; effort?: string[] | null };
export type Price = { in: number; out: number; cache: number };
/** Một model trong danh sách hãng trả về, kèm thông tin hãng tự báo (nếu có). */
export type Listed = { id: string; name: string; created?: number | null; ctx?: number | null; maxOut?: number | null; caps?: ModelCaps; price?: Price | null };
export type RegStatus = "new" | "testing" | "active" | "deprecated" | "retired";
export type TestStep = { name: "text" | "tool" | "image"; ok: boolean; note?: string };
export type TestResult = { at: number; ok: boolean; ms: number; steps: TestStep[]; error?: string };
type Src = "provider" | "rule" | "family" | "test";
type Row = {
  key: string; provider: string; kind: string; model_id: string; name: string; family: string; version: string; tier: string; created: number | null;
  first_seen: number; last_seen: number; status: RegStatus; baseline: number; caps: string; learned: string; ctx: number | null; max_out: number | null; price: string | null;
  sources: string; test: string | null; attempts: number; next_test: number; pinned: number; hidden: number; gone_at: number | null; replaced_by: string | null; notified: number;
};

export const NEW_DAYS = 14;
const DAY = 86_400_000;
/** Lần thử thất bại: thử lại sau 1 giờ, 6 giờ, rồi mỗi ngày. */
const BACKOFF = [3_600_000, 6 * 3_600_000, DAY];
/** Trần chi phí thử: tối đa chừng này model mỗi lượt dò, chừng này lần gọi mỗi ngày. */
const PER_RUN = Number(process.env.SYNCHRO_MODEL_TEST_PER_RUN) || 8;
const PER_DAY = Number(process.env.SYNCHRO_MODEL_TEST_PER_DAY) || 60;

// Bảng model_registry: db/migrations/001_baseline.sql (bộ chạy migration tạo khi mở cơ sở dữ liệu).
function table() {
  return db();
}

// ---- bộ nhớ đệm dùng chung cho mọi route trong cùng tiến trình (mỗi route của Next được đóng gói riêng)
const g = globalThis as unknown as { __synchroModelReg?: { ver: number; loaded: number; rows: Map<string, Row> }; __synchroModelJob?: Promise<CheckReport> | null };
const state = (g.__synchroModelReg ??= { ver: 1, loaded: 0, rows: new Map() });
const bump = () => { state.ver++; };
function rows(): Map<string, Row> {
  if (state.loaded !== state.ver) {
    state.rows = new Map((table().prepare("SELECT * FROM model_registry").all() as Row[]).map((r) => [r.key, r]));
    state.loaded = state.ver;
  }
  return state.rows;
}
const json = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

// ---- cài đặt của quản trị viên: tự nhận model mới (mặc định bật), tắt riêng từng hãng
export type AutoSettings = { auto: boolean; off: string[]; lastCheck: number | null; lastError: string | null };
export function autoSettings(): AutoSettings {
  const j = json<Partial<AutoSettings>>(getSetting("models_auto", "{}"), {});
  return { auto: j.auto !== false, off: Array.isArray(j.off) ? j.off.filter((x) => typeof x === "string") : [], lastCheck: typeof j.lastCheck === "number" ? j.lastCheck : null, lastError: typeof j.lastError === "string" ? j.lastError : null };
}
export function setAutoSettings(p: Partial<AutoSettings>) {
  const s = { ...autoSettings(), ...p };
  setSetting("models_auto", JSON.stringify({ ...s, off: [...new Set(s.off)].filter((x) => /^[a-z0-9-]{1,40}$/.test(x)) }));
  return autoSettings();
}
const autoFor = (provider: string, s = autoSettings()) => s.auto && !s.off.includes(provider);

// ---------------------------------------------------------------- ghi sổ sau mỗi lần đọc danh sách của hãng
/**
 * Ghi danh sách model một nhà cung cấp vừa trả về. plan: danh sách của gói (CLI chính chủ chạy model nên không cần thử).
 * Trả về các model mới thấy và các model vừa bị hãng gỡ.
 */
// Nhà cung cấp đã từng ghi sổ: nhớ riêng (không suy từ số dòng trong sổ), để quản trị viên xóa hết model đã gỡ của một hãng rồi hãng ra model mới
// thì model đó vẫn được thử trước, không bị coi là nền.
const knownProviders = () => new Set(json<string[]>(getSetting("models_known", "[]"), []).filter((x) => typeof x === "string"));
export function syncListed(provider: string, kind: string, list: Listed[], o: { plan?: boolean } = {}) {
  const d = table(), now = Date.now(), all = rows();
  const have = [...all.values()].filter((r) => r.provider === provider);
  const known = knownProviders();
  const baseline = have.length === 0 && !known.has(provider);
  if (!known.has(provider)) setSetting("models_known", JSON.stringify([...known, provider]));
  const added: string[] = [], gone: string[] = [];
  const seen = new Set<string>();
  const tx = d.transaction(() => {
    for (const m of list) {
      const key = `${provider}/${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = parseId(m.id), fam = modelFamily(m.id), old = all.get(key);
      const caps = m.caps ?? {};
      const src: Record<string, Src> = { name: m.name && m.name !== m.id ? "provider" : "rule", family: "rule", tier: "rule", ...(m.created ? { created: "provider" } : {}),
        ...(Object.keys(caps).length ? { caps: "provider" } : {}), ...(m.ctx ? { ctx: "provider" } : {}), ...(m.maxOut ? { maxOut: "provider" } : {}), ...(m.price ? { price: "provider" } : {}) };
      if (!old) {
        const status: RegStatus = baseline || o.plan ? "active" : "new";
        d.prepare(`INSERT INTO model_registry (key, provider, kind, model_id, name, family, version, tier, created, first_seen, last_seen, status, baseline, caps, ctx, max_out, price, sources)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key, provider, kind, m.id, m.name || m.id, fam, versionText(p.version), isFrontier(key) ? "frontier" : tierOf(key),
          m.created ?? null, now, now, status, baseline ? 1 : 0, JSON.stringify(caps), m.ctx ?? null, m.maxOut ?? null, m.price ? JSON.stringify(m.price) : null, JSON.stringify(src));
        if (!baseline) added.push(key);
        continue;
      }
      // Model từng bị gỡ nay hãng đưa lại: dùng lại như trước (đã đạt thử hoặc là nền), không thì thử lại từ đầu.
      const back = old.status === "retired" ? (old.baseline || json<TestResult | null>(old.test, null)?.ok || o.plan ? "active" : "new") : old.status;
      d.prepare(`UPDATE model_registry SET name = ?, kind = ?, family = ?, created = COALESCE(?, created), caps = ?, ctx = COALESCE(?, ctx), max_out = COALESCE(?, max_out), price = COALESCE(?, price),
        sources = ?, last_seen = ?, status = ?, gone_at = NULL, replaced_by = CASE WHEN ? = 'retired' THEN NULL ELSE replaced_by END WHERE key = ?`)
        .run(m.name || old.name, kind, fam, m.created ?? null, Object.keys(caps).length ? JSON.stringify(caps) : old.caps, m.ctx ?? null, m.maxOut ?? null, m.price ? JSON.stringify(m.price) : null,
          JSON.stringify({ ...json<Record<string, Src>>(old.sources, {}), ...src }), now, back, old.status, key);
    }
    // Hãng gỡ model: đã ngừng (vẫn giữ trong sổ để chuyển người đang chọn nó sang bản thay thế).
    for (const r of have) if (!seen.has(r.key) && r.status !== "retired") {
      d.prepare("UPDATE model_registry SET status = 'retired', gone_at = ? WHERE key = ?").run(now, r.key);
      gone.push(r.key);
    }
  });
  tx();
  bump();
  retirePolicy(provider);
  return { added, gone, baseline };
}

/**
 * Dòng có bản mới (không phải nền) đã dùng được: giữ hai bản mới nhất ở bộ chọn, bản cũ hơn chuyển sang "đã cũ". Tính lại mỗi lần sổ đổi:
 * bản mới bị gỡ hoặc bị ẩn thì các bản cũ trở lại dùng được. Rồi tính bản thay thế.
 */
function retirePolicy(provider: string) {
  const d = table(), list = [...rows().values()].filter((r) => r.provider === provider);
  const created = (k: string) => rows().get(k)?.created ?? null;
  const fams = new Map<string, Row[]>();
  for (const r of list) if (r.status === "active" || r.status === "deprecated") fams.set(r.family, [...(fams.get(r.family) ?? []), r]);
  let changed = false;
  const set = (r: Row, st: RegStatus) => { if (r.status !== st || (st === "active" && r.replaced_by)) { d.prepare("UPDATE model_registry SET status = ?, replaced_by = CASE WHEN ? = 'active' THEN NULL ELSE replaced_by END WHERE key = ?").run(st, st, r.key); changed = true; } };
  // Gói: danh sách khác nhau theo tài khoản, bản cũ vẫn chạy được bằng CLI chính chủ nên không chuyển sang "đã cũ".
  for (const ms of fams.values()) {
    const sorted = [...ms].filter((r) => !r.hidden).sort((a, b) => compareModels(b.key, a.key, created));
    const top = sorted.find((r) => r.status === "active");
    const cut = !provider.startsWith("sub-") && top && !top.baseline && sorted[0] === top;
    sorted.forEach((r, i) => set(r, cut && i >= 2 && !r.pinned ? "deprecated" : "active"));
    for (const r of ms.filter((x) => x.hidden && x.status === "deprecated")) set(r, "active");
  }
  if (changed) bump();
  // Bản thay thế: bản mới nhất cùng dòng đang dùng được (khác chính nó).
  for (const r of [...rows().values()].filter((x) => x.provider === provider && (x.status === "retired" || x.status === "deprecated"))) {
    const sib = [...rows().values()].filter((x) => x.provider === provider && x.family === r.family && x.key !== r.key && x.status === "active" && !x.hidden);
    const best = sib.sort((a, b) => compareModels(b.key, a.key, created))[0]?.key ?? null;
    if (best !== r.replaced_by) { d.prepare("UPDATE model_registry SET replaced_by = ? WHERE key = ?").run(best, r.key); changed = true; }
  }
  if (changed) bump();
}

// ---------------------------------------------------------------- đọc sổ
/** Model API có hiện ở bộ chọn không theo sổ (chưa có trong sổ thì có: sổ chỉ ẩn, không tự thêm). */
export function regShows(key: string): boolean {
  const r = rows().get(key);
  if (!r) return true;
  if (r.hidden) return false;
  if (r.pinned) return r.status !== "retired";
  return r.status === "active";
}
/** Quản trị viên ghim: hiện cả khi luật đời cũ ẩn nó. */
export const regPinned = (key: string) => !!rows().get(key)?.pinned && rows().get(key)?.status !== "retired";
/**
 * Model mới (không phải nền) dùng được, ra mắt trong 14 ngày qua: hiện nhãn "Mới" ở bộ chọn model.
 * Tính từ ngày hãng báo ra mắt nếu sớm hơn lúc sổ thấy lần đầu: gói vừa nối, sổ làm lại hay model hãng đưa lại
 * sau khi bị xóa khỏi sổ đều làm sổ "thấy lần đầu" model đã bán từ lâu, và nhãn Mới khi đó là sai.
 */
export function isNewModel(key: string, now = Date.now()): boolean {
  const r = rows().get(key);
  if (!r || r.baseline || r.status !== "active" || r.hidden) return false;
  return now - Math.min(r.first_seen, r.created ?? r.first_seen) < NEW_DAYS * DAY;
}
/**
 * Model đã ngừng hoặc đã cũ → bản thay thế cùng dòng, để chuyển người đã chọn tay nó (kèm tên cũ để báo).
 * why: "gone" hãng đã gỡ (không còn chạy được), "old" dòng đã có hai bản mới hơn (vẫn chạy được nhưng không còn ở bộ chọn).
 */
export type Replacement = { to: string; name: string; why: "gone" | "old" };
export function replacements(): Record<string, Replacement> {
  const out: Record<string, Replacement> = {};
  for (const r of rows().values()) if ((r.status === "retired" || r.status === "deprecated") && r.replaced_by && !r.pinned) out[r.key] = { to: r.replaced_by, name: r.name, why: r.status === "retired" ? "gone" : "old" };
  return out;
}
/** Bản thay thế cuối cùng của một model (đi theo chuỗi: bản thay thế cũng có thể đã cũ), không có thì null. */
export function replacementOf(key: string, rep = replacements()): string | null {
  let k = key, n = 0;
  while (rep[k] && n++ < 8) k = rep[k].to;
  return k === key ? null : k;
}
/**
 * Danh sách model quản trị viên chọn (model ở màn hình chính, model một tài khoản được dùng) kèm bản thay thế của từng model: model đã cũ
 * hoặc bị hãng gỡ nhường chỗ cho bản mới nhất cùng dòng, để bộ chọn model không trống dần và người chỉ được dùng một model vẫn chat được.
 */
export function withReplacements(keys: string[]): string[] {
  const rep = replacements(), out = new Set(keys);
  for (const k of keys) { const to = replacementOf(k, rep); if (to) out.add(to); }
  return [...out];
}
(globalThis as { __synchroModelAllow?: (a: string[], k: string) => boolean }).__synchroModelAllow = (allowed, key) => !allowed.includes("*") && !allowed.includes(key) && withReplacements(allowed).includes(key);
/** Model chưa thử đạt (đang chờ thử hoặc thử chưa đạt) và quản trị viên chưa ghim: máy chủ không chạy chat trên nó. */
export function untested(key: string): boolean {
  const r = rows().get(key);
  return !!r && (r.status === "new" || r.status === "testing") && !r.pinned;
}
/**
 * Ngày hãng báo ra mắt, không có thì lúc sổ thấy lần đầu: đội hình ở bộ chọn model (shared/modellineup.ts)
 * so hai model cùng số phiên bản (Gemini 4 Neon thay Gemini 4 Argon). Model chưa có trong sổ: undefined.
 */
export function sinceOf(key: string): number | undefined {
  const r = rows().get(key);
  return r ? r.created ?? r.first_seen : undefined;
}
/** Thời điểm ra mắt hãng báo (để so hai model cùng dòng không có số phiên bản). */
export const createdOf = (key: string) => rows().get(key)?.created ?? null;
/** Giá hãng tự báo cho model này (USD / 1 triệu token), không có thì null. */
export const providerPriceOf = (key: string): Price | null => json<Price | null>(rows().get(key)?.price, null);

export type ModelParams = { thinking?: "adaptive" | "budget" | "none"; effort?: string[] | null; vision?: boolean; tools?: boolean; maxOut?: number | null; ctx?: number | null; from?: Record<string, Src> };
/**
 * Tham số gọi model: khả năng hãng báo, rồi điều học được khi thử (hãng từ chối tham số nào), thiếu thì kế thừa từ bản mới nhất cùng dòng
 * của cùng nhà cung cấp. Model chưa có trong sổ: undefined (gọi như trước giờ).
 */
export function modelParams(provider: string | undefined, id: string | undefined): ModelParams | undefined {
  if (!provider || !id) return undefined;
  const all = rows(), r = all.get(`${provider}/${id}`);
  if (!r) return undefined;
  const own = { ...json<ModelCaps>(r.caps, {}), ...json<ModelCaps>(r.learned, {}) } as ModelCaps;
  const out: ModelParams = { ...own, maxOut: r.max_out, ctx: r.ctx, from: {} };
  for (const k of Object.keys(own)) out.from![k] = k in json<ModelCaps>(r.learned, {}) ? "test" : "provider";
  const sibs = [...all.values()].filter((x) => x.provider === provider && x.family === r.family && x.key !== r.key && x.status !== "retired")
    .sort((a, b) => compareModels(b.key, a.key));
  for (const s of sibs) {
    const c = json<ModelCaps>(s.caps, {});
    for (const k of ["thinking", "effort", "vision", "tools"] as const) if (out[k] === undefined && c[k] !== undefined) { (out as Record<string, unknown>)[k] = c[k]; out.from![k] = "family"; }
    if (out.maxOut == null && s.max_out) { out.maxOut = s.max_out; out.from!.maxOut = "family"; }
    if (out.ctx == null && s.ctx) { out.ctx = s.ctx; out.from!.ctx = "family"; }
  }
  return out;
}

// ---------------------------------------------------------------- việc của quản trị viên
export type RegModel = { key: string; provider: string; id: string; name: string; family: string; version: string; tier: string; created: number | null; firstSeen: number; lastSeen: number;
  status: RegStatus; baseline: boolean; isNew: boolean; shown: boolean; pinned: boolean; hidden: boolean; plan: boolean; test: TestResult | null; attempts: number; nextTest: number | null;
  goneAt: number | null; replacedBy: string | null; ctx: number | null; maxOut: number | null; caps: ModelParams; sources: Record<string, Src> };
export function listRegistry(): RegModel[] {
  return [...rows().values()].map((r) => ({
    key: r.key, provider: r.provider, id: r.model_id, name: r.name, family: r.family, version: r.version, tier: r.tier, created: r.created, firstSeen: r.first_seen, lastSeen: r.last_seen,
    status: r.status, baseline: !!r.baseline, isNew: isNewModel(r.key), shown: regShows(r.key), pinned: !!r.pinned, hidden: !!r.hidden, plan: r.provider.startsWith("sub-"),
    test: json<TestResult | null>(r.test, null), attempts: r.attempts, nextTest: r.status === "testing" || r.status === "new" ? r.next_test || null : null,
    goneAt: r.gone_at, replacedBy: r.replaced_by, ctx: r.ctx, maxOut: r.max_out, caps: modelParams(r.provider, r.model_id) ?? {}, sources: json<Record<string, Src>>(r.sources, {}),
  })).sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.firstSeen - a.firstSeen || a.provider.localeCompare(b.provider) || compareModels(b.key, a.key));
}
function setFlag(key: string, col: "pinned" | "hidden", v: boolean) {
  const n = table().prepare(`UPDATE model_registry SET ${col} = ? WHERE key = ?`).run(v ? 1 : 0, key).changes;
  if (!n) throw new Error("Không tìm thấy model này trong sổ.");
  bump();
  const r = rows().get(key);
  if (r) retirePolicy(r.provider);
}
export const setPinned = (key: string, v: boolean) => setFlag(key, "pinned", v);
export const setHidden = (key: string, v: boolean) => setFlag(key, "hidden", v);
/** Quản trị viên cho dùng ngay, không chờ thử (ví dụ đã tắt tự nhận model mới cho hãng này). */
export function activate(key: string) {
  // Model đã cũ: ghim để giữ ở bộ chọn (luật "giữ hai bản mới nhất" không ẩn lại nó).
  const n = table().prepare("UPDATE model_registry SET pinned = CASE WHEN status = 'deprecated' THEN 1 ELSE pinned END, status = 'active', hidden = 0 WHERE key = ? AND status IN ('new', 'testing', 'deprecated')").run(key).changes;
  if (!n) throw new Error("Model này không ở trạng thái chờ.");
  bump();
  const r = rows().get(key);
  if (r) retirePolicy(r.provider);
}
/** Xóa khỏi sổ một model hãng đã gỡ (nếu hãng đưa lại, nó được coi là model mới và thử lại từ đầu). */
export function forget(key: string) {
  const n = table().prepare("DELETE FROM model_registry WHERE key = ? AND status = 'retired'").run(key).changes;
  if (!n) throw new Error("Chỉ xóa được model hãng đã gỡ.");
  bump();
  retirePolicy(key.slice(0, key.indexOf("/")));
}
/** Thử lại ngay ở lượt dò kế tiếp (hoặc lượt quản trị viên bấm). Điều đã học (tham số hãng từ chối) được xóa để lần thử học lại từ đầu. */
export function queueRetest(key: string) {
  const n = table().prepare("UPDATE model_registry SET status = CASE WHEN status IN ('new', 'testing') THEN 'testing' ELSE status END, next_test = 0, learned = '{}' WHERE key = ?").run(key).changes;
  if (!n) throw new Error("Không tìm thấy model này trong sổ.");
  bump();
}

// ---------------------------------------------------------------- thử model mới
const PROBE_TOOL = { name: "synchro_probe", description: "Health check tool. Call it when you are asked to.", input_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } };
const PROBE_TEXT = "Automated health check. Reply with just the word OK.";
const PROBE_TOOL_TEXT = "Automated health check: call the synchro_probe tool once with ok set to true.";
// Ảnh PNG 8×8 màu đỏ.
const PROBE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC";
const PROBE_IMAGE_TEXT = "Automated health check: what color is this image? Answer in one word.";

const testsToday = () => { const j = json<{ day: string; n: number }>(getSetting("models_test_budget", "{}"), { day: "", n: 0 }); const day = new Date().toISOString().slice(0, 10); return j.day === day ? j.n : 0; };
const spendTest = (n: number) => { const day = new Date().toISOString().slice(0, 10); setSetting("models_test_budget", JSON.stringify({ day, n: testsToday() + n })); };

const isParamErr = (msg: string, re: RegExp) => re.test(msg) && /\b(400|invalid|unsupported|not support|does not support|unknown|extra inputs)/i.test(msg);
/** Thử một model: trả về kết quả, và những điều học được (tham số hãng không nhận). */
export async function smokeTest(key: string): Promise<{ result: TestResult; learned: ModelCaps }> {
  const t0 = Date.now(), steps: TestStep[] = [], learned: ModelCaps = {};
  const { resolveModel } = await import("./providers");
  const L = await import("./llmcall");
  const t = await resolveModel(key, { untested: true });
  if (!t) return { result: { at: t0, ok: false, ms: 0, steps, error: "Không có khóa API cho nhà cung cấp này." }, learned };
  // Mỗi lần thử học lại từ đầu: điều học được ở lần trước (ví dụ "chỉ đọc chữ" làm ảnh thử bị thay bằng ghi chú) không che kết quả lần này.
  table().prepare("UPDATE model_registry SET learned = '{}' WHERE key = ?").run(key);
  bump();
  const r = rows().get(key);
  const claims = { ...json<ModelCaps>(r?.caps, {}) };
  const sig = () => AbortSignal.timeout(90_000);
  let calls = 0;
  // Câu chữ ngắn, gửi đúng tham số như lượt chat thật; hãng từ chối tham số nào thì ghi nhớ rồi thử lại không có nó.
  const effort = (): "low" | undefined => (learned.effort && !learned.effort.length ? undefined : "low");
  const text = async (): Promise<string> => {
    for (let i = 0; i < 3; i++) {
      try { calls++; return await L.chatOnce(t, "", [{ role: "user", content: PROBE_TEXT }], 64, sig(), effort()); }
      catch (e) {
        const m = (e as Error).message;
        if (isParamErr(m, /effort|reasoning/i) && !learned.effort) { learned.effort = []; continue; }
        if (isParamErr(m, /thinking/i) && learned.thinking !== "none") { learned.thinking = "none"; saveLearned(key, learned); continue; }
        throw e;
      }
    }
    throw new Error("Hãng từ chối mọi cách gọi thử.");
  };
  try {
    // Lưu trước điều đã học được để lần gọi thử sau (và lượt chat thật) gửi đúng.
    const answer = await text();
    saveLearned(key, learned);
    steps.push({ name: "text", ok: !!answer.trim(), ...(answer.trim() ? {} : { note: "Model trả lời rỗng." }) });
    if (claims.tools !== false) {
      // Nhà cung cấp tương thích (OpenRouter, Ollama…) có nhiều model chỉ nhắn tin, không gọi công cụ: vẫn cho dùng như trước giờ,
      // kết quả bước công cụ chỉ để quản trị viên biết.
      const optional = t.kind === "compatible";
      try {
        calls++;
        const ok = await toolProbe(t, L, sig(), effort());
        steps.push({ name: "tool", ok: ok || optional, ...(ok ? {} : { note: "Model không gọi công cụ khi được yêu cầu." }) });
      } catch (e) { steps.push({ name: "tool", ok: optional, note: (e as Error).message.slice(0, 300) }); }
    }
    if (claims.vision !== false && t.kind !== "deepseek") {
      try {
        calls++;
        const a = await L.chatOnce(t, "", [{ role: "user", content: [{ type: "image", media_type: "image/png", data: PROBE_PNG }, { type: "text", text: PROBE_IMAGE_TEXT }] }], 64, sig(), effort());
        steps.push({ name: "image", ok: !!a.trim() });
      } catch (e) {
        const m = (e as Error).message;
        // Model chỉ đọc chữ (hãng nói rõ không nhận ảnh): không phải lỗi, chỉ ghi nhớ để lượt chat thật thay ảnh bằng ghi chú.
        // Lỗi ảnh khác (tạm thời, quá lớn…) là thử chưa đạt và sẽ thử lại, không ghi nhớ gì.
        if (visionUnsupported(m)) { learned.vision = false; steps.push({ name: "image", ok: true, note: "Model chỉ đọc chữ, ảnh sẽ được thay bằng ghi chú." }); }
        else steps.push({ name: "image", ok: false, note: m.slice(0, 300) });
      }
    }
  } catch (e) {
    steps.push({ name: "text", ok: false, note: (e as Error).message.slice(0, 300) });
  } finally { spendTest(calls); }
  saveLearned(key, learned);
  const ok = steps.length > 0 && steps.every((s) => s.ok);
  return { result: { at: t0, ok, ms: Date.now() - t0, steps, ...(ok ? {} : { error: steps.find((s) => !s.ok)?.note ?? "Không đạt." }) }, learned };
}
/** Lượt gọi thật bị hãng từ chối một tham số rồi chạy được khi bỏ nó (llmcall compatRetry): ghi nhớ để lần sau gửi đúng ngay. */
export function learnFromRetry(provider: string | undefined, model: string | undefined, learned: ModelCaps) {
  if (!provider || !model || !rows().has(`${provider}/${model}`)) return;
  const cur = json<ModelCaps>(rows().get(`${provider}/${model}`)!.learned, {});
  if (Object.entries(learned).every(([k, v]) => JSON.stringify((cur as Record<string, unknown>)[k]) === JSON.stringify(v))) return;
  saveLearned(`${provider}/${model}`, learned);
}
function saveLearned(key: string, learned: ModelCaps) {
  if (!Object.keys(learned).length) return;
  const r = rows().get(key);
  table().prepare("UPDATE model_registry SET learned = ? WHERE key = ?").run(JSON.stringify({ ...json<ModelCaps>(r?.learned, {}), ...learned }), key);
  bump();
}
type LL = typeof import("./llmcall");
type Tgt = NonNullable<Awaited<ReturnType<typeof import("./providers").resolveModel>>>;
async function toolProbe(t: Tgt, L: LL, signal: AbortSignal, effort?: "low"): Promise<boolean> {
  if (t.kind === "anthropic") {
    const j = await L.anthropicCall(t, { max_tokens: L.outCap(t, 1024), ...L.effortParams(t, effort), tools: [PROBE_TOOL], messages: [{ role: "user", content: PROBE_TOOL_TEXT }] }, signal);
    return (j.content ?? []).some((b: { type: string; name?: string }) => b.type === "tool_use" && b.name === PROBE_TOOL.name);
  }
  if (t.kind === "openai") {
    const j = await L.responsesCall(t, { max_output_tokens: L.outCap(t, 1024), ...L.effortParams(t, effort), input: L.respInput([{ role: "user", content: PROBE_TOOL_TEXT }]), tools: L.respTools([PROBE_TOOL]) }, signal);
    return L.respParse(j).calls.some((c) => c.name === PROBE_TOOL.name);
  }
  const j = await L.openaiCall(t, { max_tokens: L.outCap(t, 1024), ...L.effortParams(t, effort), messages: [{ role: "user", content: PROBE_TOOL_TEXT }],
    tools: [{ type: "function", function: { name: PROBE_TOOL.name, description: PROBE_TOOL.description, parameters: PROBE_TOOL.input_schema } }] }, signal);
  return (j.choices?.[0]?.message?.tool_calls ?? []).some((c: { function?: { name?: string } }) => c.function?.name === PROBE_TOOL.name);
}

/** Thử các model đang chờ tới hạn (trong trần chi phí); trả về các model vừa đạt và vừa không đạt. */
/** byAdmin: quản trị viên bấm "Kiểm tra ngay" / "Thử lại" — chính họ đồng ý tốn vài lần gọi, nên không áp trần mỗi ngày (vẫn áp trần mỗi lượt). */
async function adoptPending(o: { force?: string[]; byAdmin?: boolean } = {}) {
  const s = autoSettings(), now = Date.now();
  const due = [...rows().values()].filter((r) => (r.status === "new" || r.status === "testing") && !r.hidden && !r.provider.startsWith("sub-")
    && (o.force?.includes(r.key) || (autoFor(r.provider, s) && r.next_test <= now)));
  const passed: string[] = [], failed: string[] = [];
  const admin = adminIds()[0];
  const { withUsage } = await import("./usage");
  for (const r of due.slice(0, PER_RUN)) {
    if (testsToday() + 3 > PER_DAY && !o.byAdmin && !o.force?.includes(r.key)) break;
    const { result } = admin ? await withUsage(admin, "test", () => smokeTest(r.key)) : await smokeTest(r.key);
    const attempts = r.attempts + 1, done = Date.now();
    // Lần thử có thể kéo dài vài phút: trong lúc đó quản trị viên có thể đã bấm "Dùng ngay", hoặc hãng đã gỡ model. Chỉ đổi trạng thái khi model
    // vẫn đang chờ thử; kết quả thử vẫn được ghi để quản trị viên xem.
    table().prepare(`UPDATE model_registry SET test = ?, attempts = ?, status = CASE WHEN status IN ('new', 'testing') THEN ? ELSE status END,
      next_test = ?, notified = CASE WHEN ? AND status IN ('new', 'testing') THEN 0 ELSE notified END WHERE key = ?`)
      .run(JSON.stringify(result), attempts, result.ok ? "active" : "testing", result.ok ? 0 : done + BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)], result.ok ? 1 : 0, r.key);
    bump();
    (result.ok ? passed : failed).push(r.key);
    retirePolicy(r.provider);
  }
  return { passed, failed };
}

const adminIds = () => (ADMIN_EMAILS.size ? db().prepare(`SELECT id FROM users WHERE email_verified = 1 AND status = 'active' AND email IN (${[...ADMIN_EMAILS].map(() => "?").join(",")})`).all(...ADMIN_EMAILS) as { id: string }[] : []).map((x) => x.id);

// ---------------------------------------------------------------- báo quản trị viên
const stepText = (s: TestStep) => `${s.name === "text" ? "chữ" : s.name === "tool" ? "công cụ" : "ảnh"} ${s.ok ? "✓" : "✗"}`;
async function notifyAdmins() {
  const list = [...rows().values()].filter((r) => !r.notified && !r.baseline && (r.status === "active" || (r.status === "testing" && r.attempts > 0)));
  if (!list.length) return;
  const ok = list.filter((r) => r.status === "active"), bad = list.filter((r) => r.status === "testing");
  const { addNotice } = await import("./tasks");
  const line = (r: Row) => { const t = json<TestResult | null>(r.test, null); return `${r.name} (${r.key}): ${t ? t.steps.map(stepText).join(", ") : "model của gói, CLI chính chủ chạy"}`; };
  for (const id of adminIds()) {
    if (ok.length) addNotice(id, `Synchro đã thêm model mới: ${ok.map((r) => r.name).join(", ")}`, `${ok.map(line).join("\n")}\nModel mới đã hiện ở bộ chọn model với nhãn Mới, chế độ Tự động ưu tiên bản mới nhất của mỗi dòng.`, "settings:Providers");
    if (bad.length) addNotice(id, `Model mới chưa dùng được: ${bad.map((r) => r.name).join(", ")}`, `${bad.map((r) => `${line(r)} — ${json<TestResult | null>(r.test, null)?.error ?? ""}`).join("\n")}\nSynchro sẽ tự thử lại sau; chat không dùng các model này cho tới khi đạt.`, "settings:Providers");
  }
  table().prepare(`UPDATE model_registry SET notified = 1 WHERE key IN (${list.map(() => "?").join(",")})`).run(...list.map((r) => r.key));
  bump();
}

// ---------------------------------------------------------------- dò
export type CheckReport = { at: number; providers: { id: string; ok: boolean; error?: string; added: string[]; gone: string[] }[]; passed: string[]; failed: string[] };
/**
 * Dò model mới của mọi hãng rồi thử các model đang chờ. Lời gọi tự động (khởi động, hẹn giờ, lưu khóa) gặp một lượt đang chạy thì dùng chung lượt đó;
 * quản trị viên bấm "Kiểm tra ngay" / "Thử lại" lúc đang có lượt chạy thì chạy lượt riêng ngay sau đó, để giữ đúng model được thử ngay và
 * không áp trần mỗi ngày như họ đã yêu cầu. key: lưu khóa API (áp trần mỗi ngày như lượt tự động).
 */
export function discoverModels(reason: "boot" | "timer" | "admin" | "key" = "timer", o: { force?: string[] } = {}): Promise<CheckReport> {
  if (g.__synchroModelJob) {
    if (reason !== "admin") return g.__synchroModelJob;
    return g.__synchroModelJob.catch(() => null).then(() => discoverModels(reason, o));
  }
  const job = (async (): Promise<CheckReport> => {
    const at = Date.now(), report: CheckReport = { at, providers: [], passed: [], failed: [] };
    try {
      const P = await import("./providers");
      for (const r of await P.refreshAll()) report.providers.push(r);
      // Model của gói: đọc bằng chính đăng nhập CLI của quản trị viên (gói không chạy qua khóa API nên không cần thử).
      try {
        const subs = await import("./ai/subs");
        const { getUser } = await import("./authstore");
        // Mỗi gói đọc bằng quản trị viên đầu tiên đã đăng nhập gói đó. Danh sách dự phòng ("default" khi CLI chưa đọc được danh sách thật)
        // không ghi sổ: nó từng thành nền rồi mọi model thật của gói bị báo là model mới.
        for (const cli of ["claude", "codex", "agy", "grok"] as const) {
          for (const uid of adminIds()) {
            const u = getUser(uid);
            if (!u) continue;
            const ms = ((await subs.planModelsFor(cli, u).catch(() => null)) ?? []).filter((m) => m.id !== "default");
            if (!ms.length) continue;
            const r = syncPlan(`sub-${cli}`, ms.map((m) => ({ id: m.id, name: m.name })));
            report.providers.push({ id: `sub-${cli}`, ok: true, added: r.added, gone: [] });
            break;
          }
        }
      } catch (e) { console.error("[models] gói:", (e as Error).message); }
      const a = await adoptPending({ ...o, byAdmin: reason === "admin" });
      report.passed = a.passed; report.failed = a.failed;
      await notifyAdmins();
      setAutoSettings({ lastCheck: at, lastError: report.providers.find((p) => !p.ok)?.error ?? null });
      const n = report.providers.reduce((x, p) => x + p.added.length, 0);
      if (n || report.passed.length || report.failed.length) console.log(`[models] ${reason}: ${n} model mới, ${report.passed.length} đạt thử, ${report.failed.length} chưa đạt`);
    } catch (e) {
      console.error("[models]", e);
      setAutoSettings({ lastCheck: at, lastError: (e as Error).message.slice(0, 300) });
    }
    return report;
  })().finally(() => { g.__synchroModelJob = null; });
  g.__synchroModelJob = job;
  return job;
}
const PLAN_KIND: Record<string, string> = { "sub-claude": "anthropic", "sub-codex": "openai", "sub-agy": "google", "sub-grok": "xai" };
/**
 * Model của gói: chỉ ghi sổ để có nhãn Mới và báo quản trị viên. Danh sách của gói khác nhau theo từng tài khoản nên không đánh dấu "đã ngừng"
 * khi một model vắng mặt.
 */
function syncPlan(provider: string, list: Listed[]) {
  const have = new Set([...rows().values()].filter((r) => r.provider === provider).map((r) => r.model_id));
  const keep = [...have].filter((id) => !list.some((m) => m.id === id)).map((id) => ({ id, name: rows().get(`${provider}/${id}`)?.name ?? id }));
  return syncListed(provider, PLAN_KIND[provider] ?? "compatible", [...list, ...keep], { plan: true });
}

/** Bộ hẹn giờ: lần đầu sau khi khởi động 1-3 phút, rồi mỗi 6 giờ (lệch ngẫu nhiên tới 20 phút để nhiều máy không cùng gọi một lúc). */
export function scheduleDiscovery(onTick: (name: string, f: (now: number) => void) => void) {
  if (process.env.SYNCHRO_MODEL_CHECK === "0") return;
  const every = Number(process.env.SYNCHRO_MODEL_CHECK_MS) || 6 * 3_600_000;
  let next = Date.now() + 60_000 + Math.random() * 120_000, first = true;
  onTick("models", (now) => {
    if (now < next) return;
    next = now + every + Math.random() * Math.min(every / 6, 20 * 60_000);
    void discoverModels(first ? "boot" : "timer").catch((e) => console.error("[models]", e));
    first = false;
  });
}
export type { ProviderKind };
