// Ứng dụng nội bộ (chỉ chạy ở máy chủ): artifact được xuất bản thành ứng dụng có địa chỉ riêng /apps/<id>,
// dùng được cho riêng mình hoặc cả tổ chức, có kho dữ liệu: phần dùng chung (mọi người dùng ứng dụng thấy) và phần riêng từng người.
// Artifact chưa xuất bản (đang xem trong chat) cũng có kho dữ liệu riêng của chủ, để thử ứng dụng trước khi xuất bản.
import { db, getUser, needDisk, type UserRow } from "./authstore";
import { randomToken } from "./mcpauth";
import { ART_TYPES, type ArtType } from "./artifacts";
import { publish } from "./live";

export type Visibility = "private" | "org";
export type AppRow = { id: string; owner: string; title: string; type: ArtType; content: string; visibility: Visibility; conv: string; ident: string; created_at: number; updated_at: number; opens: number };
export type PublicApp = Omit<AppRow, "content" | "owner"> & { mine: boolean; ownerName: string };
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
      updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (ref, owner, key));
      CREATE TABLE IF NOT EXISTS app_visits (app TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (app, user_id));
      CREATE INDEX IF NOT EXISTS app_visits_user ON app_visits(user_id)`);
    ready = true;
  }
  return d;
}

const pub = (r: AppRow, uid: string): PublicApp => {
  const { content: _c, owner, ...rest } = r;
  return { ...rest, mine: owner === uid, ownerName: owner === uid ? "" : getUser(owner)?.name || "" };
};
const canSee = (r: AppRow, uid: string) => r.owner === uid || r.visibility === "org";

// "org" = ai có tài khoản và có đường dẫn đều mở được. Đăng ký đang mở cho mọi người nên đây không phải là một tổ chức thật: người lạ vừa đăng ký
// không được thấy danh sách ứng dụng của người khác; ứng dụng chỉ hiện trong danh sách của người đã mở nó (hoặc đã bình luận, được nhắc).
export function noteVisit(uid: string, app: string) {
  init().prepare("INSERT INTO app_visits (app, user_id, at) VALUES (?, ?, ?) ON CONFLICT(app, user_id) DO UPDATE SET at = excluded.at").run(app, uid, Date.now());
}
/** Những người đã tham gia ứng dụng (đã mở, đã bình luận): nhóm duy nhất được gợi ý khi @nhắc tên, kèm chủ ứng dụng. */
export function appPeople(app: string): string[] {
  const d = init();
  const owner = (d.prepare("SELECT owner FROM apps WHERE id = ?").get(app) as { owner: string } | undefined)?.owner;
  return [...new Set([...(owner ? [owner] : []), ...(d.prepare("SELECT user_id FROM app_visits WHERE app = ? ORDER BY at DESC LIMIT 500").all(app) as { user_id: string }[]).map((r) => r.user_id)])];
}

/** Ứng dụng của mình và ứng dụng dùng chung mình đã từng mở. */
export function listApps(uid: string): PublicApp[] {
  return (init().prepare("SELECT * FROM apps WHERE owner = ? OR (visibility = 'org' AND id IN (SELECT app FROM app_visits WHERE user_id = ?)) ORDER BY updated_at DESC LIMIT 300").all(uid, uid) as AppRow[]).map((r) => pub(r, uid));
}

export function getApp(uid: string, id: string, open = false): (PublicApp & { content: string }) | null {
  const r = init().prepare("SELECT * FROM apps WHERE id = ?").get(id) as AppRow | undefined;
  if (!r || !canSee(r, uid)) return null;
  if (open) { init().prepare("UPDATE apps SET opens = opens + 1 WHERE id = ?").run(id); noteVisit(uid, id); }
  return { ...pub(r, uid), content: r.content };
}

/** Xuất bản (hoặc cập nhật) artifact thành ứng dụng: cùng đoạn chat + identifier thì giữ nguyên địa chỉ. */
export function publishApp(uid: string, x: { conv: unknown; ident: unknown; title: unknown; type: unknown; content: unknown; visibility: unknown }) {
  const conv = typeof x.conv === "string" && /^[\w-]{1,64}$/.test(x.conv) ? x.conv : fail("Thiếu đoạn chat của artifact.");
  const ident = typeof x.ident === "string" && /^[\w.-]{1,80}$/.test(x.ident) ? x.ident : fail("Artifact không hợp lệ.");
  const title = typeof x.title === "string" && x.title.trim() && x.title.length <= 120 ? x.title.trim() : fail("Tên ứng dụng cần 1-120 ký tự.");
  const type = typeof x.type === "string" && (ART_TYPES as readonly string[]).includes(x.type) && ["html", "react", "svg"].includes(x.type) ? (x.type as ArtType) : fail("Chỉ trang web, ứng dụng React hoặc hình SVG mới xuất bản thành ứng dụng được.");
  const content = typeof x.content === "string" && x.content.trim() && x.content.length <= APP_LIMITS.content ? x.content : fail("Nội dung ứng dụng trống hoặc quá lớn.");
  const visibility: Visibility = x.visibility === "org" ? "org" : "private";
  const d = init(), now = Date.now();
  const cur = d.prepare("SELECT id FROM apps WHERE owner = ? AND conv = ? AND ident = ?").get(uid, conv, ident) as { id: string } | undefined;
  if (cur) {
    d.prepare("UPDATE apps SET title = ?, type = ?, content = ?, visibility = ?, updated_at = ? WHERE id = ?").run(title, type, content, visibility, now, cur.id);
    return { id: cur.id, created: false };
  }
  if ((d.prepare("SELECT COUNT(*) AS n FROM apps WHERE owner = ?").get(uid) as { n: number }).n >= APP_LIMITS.perUser) fail(`Mỗi tài khoản xuất bản tối đa ${APP_LIMITS.perUser} ứng dụng. Hãy gỡ bớt ứng dụng cũ.`);
  const id = randomToken(10);
  d.prepare("INSERT INTO apps (id, owner, title, type, content, visibility, conv, ident, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, uid, title, type, content, visibility, conv, ident, now, now);
  return { id, created: true };
}

export function updateApp(uid: string, id: string, p: { title?: unknown; visibility?: unknown }) {
  const r = init().prepare("SELECT * FROM apps WHERE id = ? AND owner = ?").get(id, uid) as AppRow | undefined;
  if (!r) fail("Không tìm thấy ứng dụng của bạn.", 404);
  const title = typeof p.title === "string" && p.title.trim() && p.title.length <= 120 ? p.title.trim() : r!.title;
  const visibility = p.visibility === "org" || p.visibility === "private" ? p.visibility : r!.visibility;
  init().prepare("UPDATE apps SET title = ?, visibility = ?, updated_at = ? WHERE id = ?").run(title, visibility, Date.now(), id);
}

/** Gỡ ứng dụng: xóa luôn dữ liệu của ứng dụng. */
// Bình luận của ứng dụng (bảng do collab.ts tạo khi có bình luận đầu tiên) bị xóa theo ứng dụng.
function dropComments(ids: string[]) { try { for (const id of ids) init().prepare("DELETE FROM app_comments WHERE app = ?").run(id); } catch { /* chưa có bảng */ } }
export function removeApp(uid: string, id: string) {
  const ok = init().prepare("DELETE FROM apps WHERE id = ? AND owner = ?").run(id, uid).changes > 0;
  if (ok) { init().prepare("DELETE FROM app_data WHERE ref = ?").run(`app:${id}`); init().prepare("DELETE FROM app_visits WHERE app = ?").run(id); dropComments([id]); }
  return ok;
}
export function removeUserApps(uid: string) {
  const d = init();
  const ids = (d.prepare("SELECT id FROM apps WHERE owner = ?").all(uid) as { id: string }[]).map((r) => r.id);
  for (const id of ids) { d.prepare("DELETE FROM app_data WHERE ref = ?").run(`app:${id}`); d.prepare("DELETE FROM app_visits WHERE app = ?").run(id); }
  dropComments(ids);
  d.prepare("DELETE FROM apps WHERE owner = ?").run(uid);
  d.prepare("DELETE FROM app_data WHERE owner = ? OR ref LIKE ?").run(uid, `art:${uid}:%`);
}

// ---------------------------------------------------------------- kho dữ liệu
// ref: { app: id } (ứng dụng đã xuất bản) hoặc { art: { conv, ident } } (artifact đang thử trong chat, chỉ chủ dùng).
// shared = true: dữ liệu chung của ứng dụng (mọi người dùng ứng dụng đọc / ghi); false: dữ liệu riêng của người đang dùng.
export type StoreRef = { app?: unknown; art?: { conv?: unknown; ident?: unknown } };
function resolve(u: UserRow, ref: StoreRef): string {
  if (typeof ref?.app === "string") {
    if (!getApp(u.id, ref.app)) fail("Không tìm thấy ứng dụng hoặc bạn không có quyền dùng.", 404);
    return `app:${ref.app}`;
  }
  const conv = ref?.art?.conv, ident = ref?.art?.ident;
  if (typeof conv === "string" && /^[\w-]{1,64}$/.test(conv) && typeof ident === "string" && /^[\w.-]{1,80}$/.test(ident)) return `art:${u.id}:${conv}:${ident}`;
  return fail("Thiếu nơi lưu dữ liệu.");
}
const keyOk = (k: unknown): string => (typeof k === "string" && k.length >= 1 && k.length <= APP_LIMITS.key && !/[\u0000-\u001f]/.test(k) ? k : fail("Khóa phải là chuỗi 1-200 ký tự."));

// client: mã của tab đang ghi, để chính tab đó bỏ qua thông báo "dữ liệu chung vừa đổi" do mình gây ra.
export function storeOp(u: UserRow, body: { ref?: StoreRef; op?: unknown; key?: unknown; value?: unknown; shared?: unknown; prefix?: unknown; client?: string }) {
  const ref = resolve(u, body.ref ?? {});
  const owner = body.shared === true ? "" : u.id;
  const d = init();
  switch (body.op) {
    case "get": {
      const key = keyOk(body.key);
      const r = d.prepare("SELECT value, updated_at FROM app_data WHERE ref = ? AND owner = ? AND key = ?").get(ref, owner, key) as { value: string; updated_at: number } | undefined;
      return r ? { key, value: r.value, shared: owner === "", updatedAt: r.updated_at } : null;
    }
    case "set": {
      needDisk();
      const key = keyOk(body.key);
      const value = typeof body.value === "string" ? body.value : fail("Giá trị phải là chuỗi (dùng JSON.stringify cho dữ liệu có cấu trúc).");
      const size = Buffer.byteLength(value) + key.length;
      if (size > APP_LIMITS.value) fail("Mỗi giá trị tối đa 100 KB.");
      const old = d.prepare("SELECT size FROM app_data WHERE ref = ? AND owner = ? AND key = ?").get(ref, owner, key) as { size: number } | undefined;
      const tot = d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM app_data WHERE ref = ?").get(ref) as { n: number; b: number };
      if (!old && tot.n >= APP_LIMITS.keys) fail("Ứng dụng đã đạt 1.000 khóa dữ liệu.");
      if (tot.b - (old?.size ?? 0) + size > APP_LIMITS.appBytes) fail("Dữ liệu của ứng dụng đã đạt 5 MB.");
      d.prepare(`INSERT INTO app_data (ref, owner, key, value, size, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ref, owner, key) DO UPDATE SET value = excluded.value, size = excluded.size, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(ref, owner, key, value, size, u.id, Date.now());
      if (owner === "" && ref.startsWith("app:")) publish(ref.slice(4), { type: "data", key, client: typeof body.client === "string" ? body.client.slice(0, 40) : undefined });
      return { key, value, shared: owner === "" };
    }
    case "delete": {
      const key = keyOk(body.key);
      const n = d.prepare("DELETE FROM app_data WHERE ref = ? AND owner = ? AND key = ?").run(ref, owner, key).changes;
      if (n && owner === "" && ref.startsWith("app:")) publish(ref.slice(4), { type: "data", key, client: typeof body.client === "string" ? body.client.slice(0, 40) : undefined });
      return { key, deleted: n > 0, shared: owner === "" };
    }
    case "list": {
      const prefix = typeof body.prefix === "string" ? body.prefix.slice(0, APP_LIMITS.key) : "";
      const rows = d.prepare("SELECT key FROM app_data WHERE ref = ? AND owner = ? AND substr(key, 1, ?) = ? ORDER BY key LIMIT 1000").all(ref, owner, prefix.length, prefix) as { key: string }[];
      return { keys: rows.map((r) => r.key), prefix, shared: owner === "" };
    }
  }
  return fail("Thao tác không hợp lệ (get, set, delete, list).");
}
