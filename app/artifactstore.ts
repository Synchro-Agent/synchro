// Artifact của từng tài khoản (chỉ chạy ở máy chủ): mỗi artifact (theo cuộc trò chuyện + identifier) giữ mọi phiên bản
// model đã viết, để trang Artifacts liệt kê và mở lại được trên mọi thiết bị. Chỉ chủ tài khoản xem được.
import { AuthError, db, needDisk } from "./authstore";
import { randomToken } from "./mcpauth";
import { ART_TYPES, type ArtType } from "./artifacts";

export type ArtVersion = { content: string; at: number };
export type ArtRow = { id: string; conv: string; ident: string; title: string; type: ArtType; lang: string | null; versions: ArtVersion[]; created_at: number; updated_at: number };
// preview: phần đầu của bản mới nhất (cho danh sách nhẹ); full = false: bị cắt, ảnh thu nhỏ của trang web tự tải bản đầy đủ (?latest=1).
export type ArtSummary = Omit<ArtRow, "versions"> & { count: number; preview: string; full: boolean };
// totalBytes / lockedBytes: tổng dung lượng một tài khoản (chưa xác minh email thì ít hơn): 500 artifact x 50 bản x 400 KB là tới 10 GB mỗi tài khoản.
export const ART_LIMITS = { content: 400_000, versions: 50, perUser: 500, totalBytes: 500_000_000, lockedBytes: 100_000_000 };

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conv TEXT NOT NULL, ident TEXT NOT NULL, title TEXT NOT NULL,
      type TEXT NOT NULL, lang TEXT, versions TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id, conv, ident));
      CREATE INDEX IF NOT EXISTS artifacts_user ON artifacts(user_id, updated_at)`);
    ready = true;
  }
  return d;
}

type Raw = Omit<ArtRow, "versions"> & { versions: string };
const parse = (r: Raw): ArtRow => ({ ...r, versions: JSON.parse(r.versions) as ArtVersion[] });

// Chỉ lấy phiên bản mới nhất ngay trong SQL: giải mã mọi phiên bản bằng JS (tới 50 bản, 400 KB mỗi bản) từng chặn luồng chính mỗi lần mở danh sách.
export function listArtifacts(uid: string): ArtSummary[] {
  const rows = init().prepare(`SELECT id, conv, ident, title, type, lang, created_at, updated_at, json_array_length(versions) AS count,
    substr(json_extract(versions, '$[#-1].content'), 1, 6000) AS preview, length(json_extract(versions, '$[#-1].content')) AS size
    FROM artifacts WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`).all(uid, ART_LIMITS.perUser) as (Omit<ArtSummary, "full"> & { size: number | null; preview: string | null })[];
  return rows.map(({ size, ...r }) => ({ ...r, preview: r.preview ?? "", full: (size ?? 0) <= 6000 }));
}
/** Chỉ tên, cho bảng lệnh (Ctrl+K): mở bảng từng tải về gần 1 MB bản xem trước trong khi nó chỉ tìm theo tên. */
export const artifactTitles = (uid: string) => init().prepare("SELECT conv, title, type FROM artifacts WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?").all(uid, ART_LIMITS.perUser) as { conv: string; title: string; type: string }[];

export function getArtifact(uid: string, id: string): ArtRow | null {
  const r = init().prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?").get(id, uid) as Raw | undefined;
  return r ? parse(r) : null;
}

/** Artifact theo đoạn chat + identifier (model đọc lại / kiểm tra bản đã lưu khi lịch sử gửi lên không còn chứa nó). */
export function getArtifactByIdent(uid: string, conv: string, ident: string): ArtRow | null {
  const r = init().prepare("SELECT * FROM artifacts WHERE user_id = ? AND conv = ? AND ident = ?").get(uid, conv, ident) as Raw | undefined;
  return r ? parse(r) : null;
}

/** Người dùng chọn xóa cả artifact khi xóa đoạn chat. */
export const removeConvArtifacts = (uid: string, conv: string) => init().prepare("DELETE FROM artifacts WHERE user_id = ? AND conv = ?").run(uid, conv).changes;

export type ArtInput = { ident: string; title: string; type: ArtType; lang?: string | null; content: string };
export function validArt(x: unknown): ArtInput | null {
  const o = x as Partial<ArtInput>;
  if (!o || typeof o !== "object") return null;
  if (typeof o.ident !== "string" || !/^[\w.-]{1,80}$/.test(o.ident)) return null;
  if (typeof o.title !== "string" || !o.title.trim() || o.title.length > 200) return null;
  if (typeof o.type !== "string" || !(ART_TYPES as readonly string[]).includes(o.type)) return null;
  if (typeof o.content !== "string" || !o.content.trim() || o.content.length > ART_LIMITS.content) return null;
  const lang = typeof o.lang === "string" && /^[\w+#.-]{1,30}$/.test(o.lang) ? o.lang : null;
  return { ident: o.ident, title: o.title.trim(), type: o.type as ArtType, lang, content: o.content };
}

// Đọc tổng dung lượng phải giải nén cả cột: chỉ đo lại mỗi phút, giữa các lần cộng dồn phần vừa ghi (ghi đè bản cũ thì đếm dư một chút, không sao).
const usedCache = new Map<string, { b: number; at: number }>();
function artBytes(uid: string): { b: number; at: number } {
  const c = usedCache.get(uid), now = Date.now();
  if (c && now - c.at < 60_000) return c;
  if (usedCache.size > 5000) usedCache.clear();
  const n = { b: (init().prepare("SELECT COALESCE(SUM(length(CAST(versions AS BLOB))), 0) AS b FROM artifacts WHERE user_id = ?").get(uid) as { b: number }).b, at: now };
  usedCache.set(uid, n);
  return n;
}
// Thêm phiên bản mới (bỏ qua nếu giống hệt phiên bản cuối). Trả về id artifact.
export function saveArtifact(uid: string, conv: string, a: ArtInput, opts?: { maxBytes?: number }): string {
  const d = init();
  const now = Date.now();
  needDisk();
  const used = artBytes(uid);
  if (used.b + a.content.length > (opts?.maxBytes ?? ART_LIMITS.totalBytes)) throw new AuthError("Artifact của bạn đã dùng hết dung lượng. Hãy xóa bớt ở trang Artifacts rồi thử lại.", 413);
  used.b += a.content.length;
  const r = d.prepare("SELECT * FROM artifacts WHERE user_id = ? AND conv = ? AND ident = ?").get(uid, conv, a.ident) as Raw | undefined;
  if (r) {
    const cur = parse(r);
    if (cur.versions[cur.versions.length - 1]?.content !== a.content) cur.versions.push({ content: a.content, at: now });
    const versions = cur.versions.slice(-ART_LIMITS.versions);
    d.prepare("UPDATE artifacts SET title = ?, type = ?, lang = ?, versions = ?, updated_at = ? WHERE id = ?").run(a.title, a.type, a.lang ?? null, JSON.stringify(versions), now, cur.id);
    return cur.id;
  }
  const n = (d.prepare("SELECT COUNT(*) AS n FROM artifacts WHERE user_id = ?").get(uid) as { n: number }).n;
  if (n >= ART_LIMITS.perUser) {
    const old = d.prepare("SELECT id FROM artifacts WHERE user_id = ? ORDER BY updated_at ASC LIMIT 1").get(uid) as { id: string } | undefined;
    if (old) d.prepare("DELETE FROM artifacts WHERE id = ?").run(old.id);
  }
  const id = randomToken(12);
  d.prepare("INSERT INTO artifacts (id, user_id, conv, ident, title, type, lang, versions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, uid, conv, a.ident, a.title, a.type, a.lang ?? null, JSON.stringify([{ content: a.content, at: now }]), now, now);
  return id;
}

export function deleteArtifact(uid: string, id: string) {
  return init().prepare("DELETE FROM artifacts WHERE id = ? AND user_id = ?").run(id, uid).changes > 0;
}
export function removeUserArtifacts(uid: string) {
  init().prepare("DELETE FROM artifacts WHERE user_id = ?").run(uid);
}
