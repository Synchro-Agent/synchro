// Ứng dụng của tôi (chỉ chạy ở máy chủ): artifact được xuất bản thành ứng dụng có địa chỉ riêng /apps/<id>,
// mở như một trang độc lập, có kho dữ liệu riêng (window.storage) để lưu ghi chú, danh sách, bảng tính…
// Artifact chưa xuất bản (đang xem trong chat) cũng có kho dữ liệu, để thử ứng dụng trước khi xuất bản.
import { db, type UserRow } from "./authstore";
import { randomToken } from "./mcpauth";
import { ART_TYPES, type ArtType } from "./artifacts";

export type AppRow = { id: string; owner: string; title: string; type: ArtType; content: string; conv: string; ident: string; created_at: number; updated_at: number; opens: number };
export type PublicApp = Omit<AppRow, "content" | "owner">;
export const APP_LIMITS = { content: 400_000, perUser: 100, value: 100_000, keys: 1000, appBytes: 5 * 1024 * 1024, key: 200 };

export class AppError extends Error { constructor(m: string, public status = 400) { super(m); } }
const fail = (m: string, status = 400): never => { throw new AppError(m, status); };

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private', conv TEXT NOT NULL, ident TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      opens INTEGER NOT NULL DEFAULT 0, UNIQUE(owner, conv, ident));
      CREATE INDEX IF NOT EXISTS apps_owner ON apps(owner, updated_at);
      CREATE TABLE IF NOT EXISTS app_data (ref TEXT NOT NULL, owner TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, size INTEGER NOT NULL,
      updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (ref, owner, key))`);
    // Bản dùng nhiều người tách dữ liệu "chung" (owner rỗng) và "riêng từng người": nay gộp về một kho.
    // Khóa có ở cả hai phần thì giữ bản chung.
    d.exec("UPDATE OR IGNORE app_data SET owner = '' WHERE owner <> ''; DELETE FROM app_data WHERE owner <> ''");
    ready = true;
  }
  return d;
}

// Bỏ nội dung, chủ và cột phạm vi chia sẻ còn lại trong bảng từ bản dùng nhiều người.
const pub = (r: AppRow): PublicApp => { const { content: _c, owner: _o, visibility: _v, ...rest } = r as AppRow & { visibility?: string }; return rest; };

export function listApps(uid: string): PublicApp[] {
  return (init().prepare("SELECT * FROM apps WHERE owner = ? ORDER BY updated_at DESC LIMIT 300").all(uid) as AppRow[]).map(pub);
}

export function getApp(uid: string, id: string, open = false): (PublicApp & { content: string }) | null {
  const r = init().prepare("SELECT * FROM apps WHERE id = ? AND owner = ?").get(id, uid) as AppRow | undefined;
  if (!r) return null;
  if (open) init().prepare("UPDATE apps SET opens = opens + 1 WHERE id = ?").run(id);
  return { ...pub(r), content: r.content };
}

/** Xuất bản (hoặc cập nhật) artifact thành ứng dụng: cùng đoạn chat + identifier thì giữ nguyên địa chỉ. */
export function publishApp(uid: string, x: { conv: unknown; ident: unknown; title: unknown; type: unknown; content: unknown }) {
  const conv = typeof x.conv === "string" && /^[\w-]{1,64}$/.test(x.conv) ? x.conv : fail("Thiếu đoạn chat của artifact.");
  const ident = typeof x.ident === "string" && /^[\w.-]{1,80}$/.test(x.ident) ? x.ident : fail("Artifact không hợp lệ.");
  const title = typeof x.title === "string" && x.title.trim() && x.title.length <= 120 ? x.title.trim() : fail("Tên ứng dụng cần 1-120 ký tự.");
  const type = typeof x.type === "string" && (ART_TYPES as readonly string[]).includes(x.type) && ["html", "react", "svg"].includes(x.type) ? (x.type as ArtType) : fail("Chỉ trang web, ứng dụng React hoặc hình SVG mới xuất bản thành ứng dụng được.");
  const content = typeof x.content === "string" && x.content.trim() && x.content.length <= APP_LIMITS.content ? x.content : fail("Nội dung ứng dụng trống hoặc quá lớn.");
  const d = init(), now = Date.now();
  const cur = d.prepare("SELECT id FROM apps WHERE owner = ? AND conv = ? AND ident = ?").get(uid, conv, ident) as { id: string } | undefined;
  if (cur) {
    d.prepare("UPDATE apps SET title = ?, type = ?, content = ?, updated_at = ? WHERE id = ?").run(title, type, content, now, cur.id);
    return { id: cur.id, created: false };
  }
  if ((d.prepare("SELECT COUNT(*) AS n FROM apps WHERE owner = ?").get(uid) as { n: number }).n >= APP_LIMITS.perUser) fail(`Xuất bản được tối đa ${APP_LIMITS.perUser} ứng dụng. Hãy gỡ bớt ứng dụng cũ.`);
  const id = randomToken(10);
  d.prepare("INSERT INTO apps (id, owner, title, type, content, conv, ident, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, uid, title, type, content, conv, ident, now, now);
  return { id, created: true };
}

export function updateApp(uid: string, id: string, p: { title?: unknown }) {
  const r = init().prepare("SELECT * FROM apps WHERE id = ? AND owner = ?").get(id, uid) as AppRow | undefined;
  if (!r) fail("Không tìm thấy ứng dụng.", 404);
  const title = typeof p.title === "string" && p.title.trim() && p.title.length <= 120 ? p.title.trim() : r!.title;
  init().prepare("UPDATE apps SET title = ?, updated_at = ? WHERE id = ?").run(title, Date.now(), id);
}

/** Gỡ ứng dụng: xóa luôn dữ liệu của ứng dụng. */
export function removeApp(uid: string, id: string) {
  const ok = init().prepare("DELETE FROM apps WHERE id = ? AND owner = ?").run(id, uid).changes > 0;
  if (ok) init().prepare("DELETE FROM app_data WHERE ref = ?").run(`app:${id}`);
  return ok;
}

// ---------------------------------------------------------------- kho dữ liệu
// ref: { app: id } (ứng dụng đã xuất bản) hoặc { art: { conv, ident } } (artifact đang thử trong chat).
// Mỗi ứng dụng một kho; tham số shared của window.storage (từ bản dùng nhiều người) vẫn nhận nhưng không còn tách kho.
export type StoreRef = { app?: unknown; art?: { conv?: unknown; ident?: unknown } };
function resolve(u: UserRow, ref: StoreRef): string {
  if (typeof ref?.app === "string") {
    if (!getApp(u.id, ref.app)) fail("Không tìm thấy ứng dụng.", 404);
    return `app:${ref.app}`;
  }
  const conv = ref?.art?.conv, ident = ref?.art?.ident;
  if (typeof conv === "string" && /^[\w-]{1,64}$/.test(conv) && typeof ident === "string" && /^[\w.-]{1,80}$/.test(ident)) return `art:${u.id}:${conv}:${ident}`;
  return fail("Thiếu nơi lưu dữ liệu.");
}
const keyOk = (k: unknown): string => (typeof k === "string" && k.length >= 1 && k.length <= APP_LIMITS.key && !/[\u0000-\u001f]/.test(k) ? k : fail("Khóa phải là chuỗi 1-200 ký tự."));

export function storeOp(u: UserRow, body: { ref?: StoreRef; op?: unknown; key?: unknown; value?: unknown; prefix?: unknown }) {
  const ref = resolve(u, body.ref ?? {});
  const d = init();
  switch (body.op) {
    case "get": {
      const key = keyOk(body.key);
      const r = d.prepare("SELECT value, updated_at FROM app_data WHERE ref = ? AND owner = '' AND key = ?").get(ref, key) as { value: string; updated_at: number } | undefined;
      return r ? { key, value: r.value, updatedAt: r.updated_at } : null;
    }
    case "set": {
      const key = keyOk(body.key);
      const value = typeof body.value === "string" ? body.value : fail("Giá trị phải là chuỗi (dùng JSON.stringify cho dữ liệu có cấu trúc).");
      const size = Buffer.byteLength(value) + key.length;
      if (size > APP_LIMITS.value) fail("Mỗi giá trị tối đa 100 KB.");
      const old = d.prepare("SELECT size FROM app_data WHERE ref = ? AND owner = '' AND key = ?").get(ref, key) as { size: number } | undefined;
      const tot = d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM app_data WHERE ref = ?").get(ref) as { n: number; b: number };
      if (!old && tot.n >= APP_LIMITS.keys) fail("Ứng dụng đã đạt 1.000 khóa dữ liệu.");
      if (tot.b - (old?.size ?? 0) + size > APP_LIMITS.appBytes) fail("Dữ liệu của ứng dụng đã đạt 5 MB.");
      d.prepare(`INSERT INTO app_data (ref, owner, key, value, size, updated_by, updated_at) VALUES (?, '', ?, ?, ?, ?, ?)
        ON CONFLICT(ref, owner, key) DO UPDATE SET value = excluded.value, size = excluded.size, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(ref, key, value, size, u.id, Date.now());
      return { key, value };
    }
    case "delete": {
      const key = keyOk(body.key);
      const n = d.prepare("DELETE FROM app_data WHERE ref = ? AND owner = '' AND key = ?").run(ref, key).changes;
      return { key, deleted: n > 0 };
    }
    case "list": {
      const prefix = typeof body.prefix === "string" ? body.prefix.slice(0, APP_LIMITS.key) : "";
      const rows = d.prepare("SELECT key FROM app_data WHERE ref = ? AND owner = '' AND substr(key, 1, ?) = ? ORDER BY key LIMIT 1000").all(ref, prefix.length, prefix) as { key: string }[];
      return { keys: rows.map((r) => r.key), prefix };
    }
  }
  return fail("Thao tác không hợp lệ (get, set, delete, list).");
}
