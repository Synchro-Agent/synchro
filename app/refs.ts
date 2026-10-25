// Ngữ cảnh theo tham chiếu (chỉ chạy ở máy chủ): kết quả công cụ lớn (connector, chạy code, script của skill) không nhét
// thẳng vào lịch sử chat. Synchro lưu nguyên văn với mã ref_…, model chỉ nhận bản tóm tắt cấu trúc (schema + 3 dòng đầu
// + mã ref) và tự lấy đúng phần cần bằng công cụ read_ref. Mã ref còn dùng được ở các lượt sau (kể cả khi đổi model).
import crypto from "node:crypto";
import { db } from "./authstore";

/** Kết quả dài hơn ngưỡng này (ký tự, ~1.500 token) thì lưu theo tham chiếu. */
export const REF_THRESHOLD = 6000;
const KEEP_MS = 30 * 24 * 3600_000;
const MAX_REF = 4 * 1024 * 1024;
const OUT_CAP = 8000;

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS tool_refs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conv TEXT, name TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS tool_refs_user ON tool_refs(user_id, created_at)`);
    d.prepare("DELETE FROM tool_refs WHERE created_at < ?").run(Date.now() - KEEP_MS);
    ready = true;
  }
  return d;
}

export function storeRef(uid: string, conv: string | undefined, name: string, content: string): string {
  const id = "ref_" + crypto.randomBytes(9).toString("base64url");
  init().prepare("INSERT INTO tool_refs (id, user_id, conv, name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, uid, conv ?? null, name.slice(0, 200), content.slice(0, MAX_REF), Date.now());
  return id;
}
export const removeUserRefs = (uid: string) => { init().prepare("DELETE FROM tool_refs WHERE user_id = ?").run(uid); };

const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? `array(${v.length})` : typeof v);
function schemaOf(v: unknown, depth = 0): string {
  if (Array.isArray(v)) return `[${v.length ? schemaOf(v[0], depth + 1) : ""}] × ${v.length}`;
  if (v && typeof v === "object") {
    if (depth > 2) return "{…}";
    const e = Object.entries(v as Record<string, unknown>).slice(0, 24);
    return `{ ${e.map(([k, x]) => `${k}: ${x && typeof x === "object" ? schemaOf(x, depth + 1) : typeOf(x)}`).join(", ")}${Object.keys(v).length > 24 ? ", …" : ""} }`;
  }
  return typeOf(v);
}
// Mảng lớn nhất bên trong (thường là danh sách bản ghi) và đường dẫn tới nó.
function mainArray(v: unknown, path = "", depth = 0): { path: string; arr: unknown[] } | null {
  if (Array.isArray(v)) return { path, arr: v };
  if (!v || typeof v !== "object" || depth > 3) return null;
  let best: { path: string; arr: unknown[] } | null = null;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const r = mainArray(x, path ? `${path}.${k}` : k, depth + 1);
    if (r && (!best || r.arr.length > best.arr.length)) best = r;
  }
  return best;
}
const tryJson = (s: string): unknown => { const t = s.trim(); if (!/^[[{]/.test(t)) return undefined; try { return JSON.parse(t); } catch { return undefined; } };

/** Bản tóm tắt cấu trúc gửi cho model thay cho nguyên văn. */
export function summarize(content: string, ref: string): string {
  const j = tryJson(content);
  const head = `<ref id="${ref}" chars="${content.length}">`;
  const tail = `Dữ liệu đầy đủ đã lưu với mã ${ref}. Gọi read_ref để lấy đúng phần cần (path cho JSON, query để lọc, offset/limit để đọc tiếp); đừng đoán nội dung chưa đọc.\n</ref>`;
  if (j !== undefined) {
    const main = mainArray(j);
    const sample = main?.arr.slice(0, 3).map((x) => JSON.stringify(x).slice(0, 600)).join("\n") ?? "";
    return `${head}\nJSON. Cấu trúc: ${schemaOf(j).slice(0, 1500)}\n${main ? `Danh sách chính: ${main.path || "(gốc)"} có ${main.arr.length} phần tử. 3 phần tử đầu:\n${sample}\n` : `Đầu dữ liệu:\n${content.slice(0, 1200)}\n`}${tail}`;
  }
  const lines = content.split("\n");
  return `${head}\nVăn bản ${lines.length} dòng. Phần đầu:\n${lines.slice(0, 30).join("\n").slice(0, 1800)}\n${tail}`;
}

/** Kết quả công cụ → nội dung gửi cho model: ngắn thì giữ nguyên, dài thì lưu và trả bản tóm tắt. */
export function maybeRef(uid: string, conv: string | undefined, name: string, content: string): { content: string; ref?: string } {
  if (content.length <= REF_THRESHOLD) return { content };
  const ref = storeRef(uid, conv, name, content);
  return { content: summarize(content, ref), ref };
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
function walk(v: unknown, path: string): unknown {
  let cur = v;
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

export const READ_REF_TOOL = {
  name: "read_ref",
  description: "Đọc dữ liệu đầy đủ đã lưu theo mã ref_… (kết quả công cụ lớn ở lượt này hoặc các lượt trước). path: đường dẫn trong JSON (ví dụ data.items hoặc items[3].name); query: chỉ lấy phần tử / dòng có chứa từ này (không phân biệt dấu); offset, limit: phân trang theo phần tử hoặc dòng.",
  input_schema: { type: "object", properties: { ref: { type: "string" }, path: { type: "string" }, query: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } }, required: ["ref"] },
};

export function readRef(uid: string, input: Record<string, unknown>): { content: string; is_error: boolean } {
  const id = String(input.ref ?? "");
  const r = init().prepare("SELECT content FROM tool_refs WHERE id = ? AND user_id = ?").get(id, uid) as { content: string } | undefined;
  if (!r) return { content: `Không tìm thấy dữ liệu ${id} (mã sai hoặc đã quá 30 ngày).`, is_error: true };
  const off = Math.max(0, Number(input.offset) || 0), lim = Math.min(500, Math.max(1, Number(input.limit) || 50));
  const q = typeof input.query === "string" && input.query.trim() ? fold(input.query.trim()) : "";
  const j = tryJson(r.content);
  const cap = (s: string, note: string) => (s.length > OUT_CAP ? `${s.slice(0, OUT_CAP)}\n…(cắt ở ${OUT_CAP} ký tự; dùng offset/limit hoặc query để đọc tiếp)` : s) + note;
  if (j !== undefined) {
    let v = typeof input.path === "string" && input.path.trim() ? walk(j, input.path.trim()) : (mainArray(j)?.arr ?? j);
    if (v === undefined) return { content: `Không có đường dẫn ${String(input.path)} trong dữ liệu.`, is_error: true };
    if (Array.isArray(v)) {
      const all = q ? v.filter((x) => fold(JSON.stringify(x)).includes(q)) : v;
      v = all.slice(off, off + lim);
      return { content: cap(JSON.stringify(v, null, 1), `\n(${(v as unknown[]).length} / ${all.length} phần tử${q ? ` khớp "${input.query}"` : ""}, từ vị trí ${off})`), is_error: false };
    }
    return { content: cap(JSON.stringify(v, null, 1), ""), is_error: false };
  }
  const lines = r.content.split("\n");
  const pick = q ? lines.map((l, i) => [i + 1, l] as const).filter(([, l]) => fold(l).includes(q)) : lines.map((l, i) => [i + 1, l] as const);
  const page = pick.slice(off, off + lim);
  return { content: cap(page.map(([n, l]) => `${n}: ${l}`).join("\n"), `\n(${page.length} / ${pick.length} dòng${q ? ` khớp "${input.query}"` : ""}, từ vị trí ${off})`), is_error: false };
}
