// Skill tự sửa lỗi (chỉ chạy ở máy chủ): script của skill chạy hỏng vì lỗi trong chính script (Traceback, SyntaxError…)
// thì Synchro nhờ model sửa và chạy lại trong sandbox, tối đa MAX_RETRIES lần. Chạy được thì lưu bản sửa vào bảng skill_patches,
// các lần sau dùng luôn (cho tới khi skill được cập nhật bản mới). Script có thể thay đổi dữ liệu bên ngoài (gửi lên mạng,
// ghi cơ sở dữ liệu, gửi thư…) thì không tự chạy bản sửa: chỉ chuẩn bị sẵn, chờ người dùng duyệt trong Kho kỹ năng.
import crypto from "node:crypto";
import { db } from "./authstore";
import { chatOnce } from "./llmcall";
import type { Target } from "./providers";

export const MAX_RETRIES = 2;
export type PatchStatus = "active" | "pending" | "rejected" | "reverted";
export type SkillPatch = { id: string; skill: string; path: string; status: PatchStatus; mutating: boolean; error: string; attempts: number; created_at: number; uses: number; stale: boolean; original?: string; content?: string };
type Row = { id: string; user_id: string; skill_id: string; skill_name: string; path: string; base_hash: string; content: string; error: string; status: PatchStatus; mutating: number; attempts: number; created_at: number; uses: number };

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS skill_patches (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, skill_id TEXT NOT NULL, skill_name TEXT NOT NULL, path TEXT NOT NULL,
      base_hash TEXT NOT NULL, content TEXT NOT NULL, error TEXT NOT NULL, status TEXT NOT NULL, mutating INTEGER NOT NULL, attempts INTEGER NOT NULL,
      created_at INTEGER NOT NULL, used_at INTEGER, uses INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS skill_patches_by ON skill_patches(user_id, skill_id, path, status)`);
    ready = true;
  }
  return d;
}
export const hashText = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);

// Dấu hiệu script gửi / ghi dữ liệu ra ngoài sandbox: không tự chạy bản sửa.
const MUTATING = /\b(requests|httpx|session|client|urllib3)\.(post|put|patch|delete)\s*\(|\bmethod\s*[:=]\s*["'](POST|PUT|PATCH|DELETE)["']|\bcurl\b[^\n]*\s(-X\s*(POST|PUT|PATCH|DELETE)|-d|--data\S*)\b|\b(smtplib|sendmail|boto3|paramiko|ftplib)\b|\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE)\b|\bgit\s+push\b/i;
export const isMutating = (src: string) => MUTATING.test(src);
// Lỗi của chính script (không phải gọi sai tham số, hết giờ hay sandbox hỏng) mới tự sửa.
const BUG = /Traceback \(most recent call last\)|\b(SyntaxError|IndentationError|NameError|TypeError|AttributeError|KeyError|IndexError|ValueError|ImportError|ModuleNotFoundError|ZeroDivisionError|UnboundLocalError|ReferenceError|RangeError)\b|line \d+: .*(syntax error|unexpected|command not found)/;
export const looksLikeBug = (stderr: string) => BUG.test(stderr) && !/^usage: /m.test(stderr);

/** Bản sửa đang dùng cho script (đúng bản gốc hiện tại của skill). */
export function activePatch(uid: string, skillId: string, path: string, baseHash: string): { id: string; content: string } | null {
  const r = init().prepare("SELECT id, content FROM skill_patches WHERE user_id = ? AND skill_id = ? AND path = ? AND base_hash = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(uid, skillId, path, baseHash) as { id: string; content: string } | undefined;
  return r ?? null;
}
export function markUsed(id: string) { init().prepare("UPDATE skill_patches SET uses = uses + 1, used_at = ? WHERE id = ?").run(Date.now(), id); }

export function savePatch(p: { uid: string; skillId: string; skill: string; path: string; base: string; content: string; error: string; status: "active" | "pending"; mutating: boolean; attempts: number }): string {
  const d = init();
  const id = "sp_" + crypto.randomBytes(8).toString("hex");
  // Bản cũ của cùng script (cùng bản gốc) thôi dùng / thôi chờ duyệt: chỉ một bản có hiệu lực.
  d.prepare("UPDATE skill_patches SET status = 'reverted' WHERE user_id = ? AND skill_id = ? AND path = ? AND status IN ('active', 'pending')").run(p.uid, p.skillId, p.path);
  d.prepare("INSERT INTO skill_patches (id, user_id, skill_id, skill_name, path, base_hash, content, error, status, mutating, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, p.uid, p.skillId, p.skill, p.path, p.base, p.content, p.error.slice(0, 2000), p.status, p.mutating ? 1 : 0, p.attempts, Date.now());
  return id;
}

/** Danh sách bản tự sửa của một skill (mới nhất trước); stale: skill đã đổi bản gốc nên bản sửa không còn áp dụng. */
export function listPatches(uid: string, skillId: string, hashes: Record<string, string>, full = false): SkillPatch[] {
  const rows = init().prepare("SELECT * FROM skill_patches WHERE user_id = ? AND skill_id = ? ORDER BY created_at DESC LIMIT 50").all(uid, skillId) as Row[];
  return rows.map((r) => ({ id: r.id, skill: r.skill_name, path: r.path, status: r.status, mutating: !!r.mutating, error: r.error, attempts: r.attempts, created_at: r.created_at, uses: r.uses,
    stale: hashes[r.path] !== r.base_hash, ...(full ? { content: r.content } : {}) }));
}
/** Duyệt / bỏ / hoàn tác. Duyệt chỉ áp cho bản đang chờ; hoàn tác chỉ cho bản đang dùng. */
export function setPatch(uid: string, id: string, action: "approve" | "reject" | "revert"): boolean {
  const d = init();
  const r = d.prepare("SELECT * FROM skill_patches WHERE id = ? AND user_id = ?").get(id, uid) as Row | undefined;
  if (!r) return false;
  if (action === "approve" && r.status === "pending") {
    d.prepare("UPDATE skill_patches SET status = 'reverted' WHERE user_id = ? AND skill_id = ? AND path = ? AND status = 'active'").run(uid, r.skill_id, r.path);
    d.prepare("UPDATE skill_patches SET status = 'active' WHERE id = ?").run(id); return true;
  }
  if (action === "reject" && r.status === "pending") { d.prepare("UPDATE skill_patches SET status = 'rejected' WHERE id = ?").run(id); return true; }
  if (action === "revert" && r.status === "active") { d.prepare("UPDATE skill_patches SET status = 'reverted' WHERE id = ?").run(id); return true; }
  return false;
}
export function dropPatches(uid: string, skillId: string) { init().prepare("DELETE FROM skill_patches WHERE user_id = ? AND skill_id = ?").run(uid, skillId); }

const HEAL = `<skill_heal>
Bạn sửa lỗi một script của skill vừa chạy hỏng trong sandbox. Đọc mã, tham số và thông báo lỗi rồi sửa tối thiểu để script chạy đúng mục đích ban đầu.
- Không thêm hành vi mới, không gọi mạng hay ghi ra ngoài thư mục làm việc, không bỏ bớt chức năng để né lỗi.
- Lỗi do người gọi truyền sai tham số hoặc thiếu dữ liệu (không phải lỗi của script) thì chỉ trả về đúng chữ: KHONG_SUA
- Còn lại: trả về TOÀN BỘ script đã sửa trong một khối \`\`\` duy nhất, không giải thích.
</skill_heal>`;

/** Nhờ model sửa script; null nếu model cho rằng không phải lỗi của script hoặc trả về không dùng được. */
export async function healScript(t: Target, input: { skill: string; path: string; source: string; error: string; args: string[] }): Promise<string | null> {
  const ask = `Skill: ${input.skill}\nScript: ${input.path}\nTham số: ${JSON.stringify(input.args)}\n\n<script>\n${input.source}\n</script>\n\n<error>\n${input.error.slice(-4000)}\n</error>`;
  const text = await chatOnce(t, HEAL, [{ role: "user", content: ask }], 8000);
  if (/KHONG_SUA/.test(text) && !/```/.test(text)) return null;
  const code = /```[\w.+-]*\n([\s\S]*?)```/.exec(text)?.[1];
  if (!code?.trim()) return null;
  // Bản sửa quá khác cỡ bản gốc (model viết lại hẳn hoặc cắt cụt) thì không dùng.
  const r = code.length / Math.max(1, input.source.length);
  return r < 0.3 || r > 3 ? null : code.replace(/\s+$/, "") + "\n";
}
