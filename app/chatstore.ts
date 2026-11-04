// Đoạn chat và dự án theo tài khoản (chỉ chạy ở máy chủ): trình duyệt vẫn giữ một bản, nơi đây giữ bản đi theo tài khoản, để đổi máy, xóa dữ liệu trình duyệt
// hay hết bộ nhớ trình duyệt không làm mất gì. Mỗi mục lưu nguyên một chuỗi JSON của trình duyệt. Xung đột đơn giản: theo từng mục, mốc sửa mới nhất thắng.
// Đoạn chat ẩn danh không bao giờ gửi lên đây (chatsync.ts). rev tăng dần theo từng tài khoản, để thiết bị chỉ lấy những gì đổi từ lần trước.
// Xóa: giữ dòng đánh dấu đã xóa (không còn nội dung) để thiết bị khác cũng xóa và bản cũ không sống lại.
import { db } from "./authstore";

export const SYNC_LIMITS = { item: 12_000_000, total: 1_000_000_000, items: 100_000, page: 4_000_000, batch: 40 };
export type SyncKind = "chat" | "project";
export type ItemRow = { kind: string; id: string; upd: number; rev: number; deleted: number; data: string | null; size: number };
export type PushItem = { kind: SyncKind; id: string; upd: number; data?: string; deleted?: boolean };
export type PushResult = { kind: string; id: string; ok: boolean; upd: number; rev: number; deleted?: boolean; error?: "too_big" | "quota" | "bad"; removed?: boolean };

let ready = false;
function t() {
  const d = db();
  if (!ready) {
    // ON DELETE CASCADE: xóa tài khoản thì mọi đoạn chat và dự án trên máy chủ mất theo.
    d.exec(`CREATE TABLE IF NOT EXISTS user_items (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, id TEXT NOT NULL, upd INTEGER NOT NULL, rev INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0, data TEXT, size INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, kind, id));
      CREATE INDEX IF NOT EXISTS user_items_rev ON user_items(user_id, rev)`);
    ready = true;
  }
  return d;
}
const nextRev = (uid: string) => (t().prepare("SELECT COALESCE(MAX(rev), 0) + 1 AS r FROM user_items WHERE user_id = ?").get(uid) as { r: number }).r;
const KINDS = new Set(["chat", "project"]);
const okId = (s: unknown): s is string => typeof s === "string" && /^[\w.-]{1,64}$/.test(s);
const WIPE_ID = "all";

/** Những gì đổi sau mốc since, theo từng trang (tối đa SYNC_LIMITS.page byte, luôn có ít nhất một mục). */
export function changesSince(uid: string, since: number): { items: ItemRow[]; next: number; more: boolean } {
  const rows = t().prepare("SELECT kind, id, upd, rev, deleted, size FROM user_items WHERE user_id = ? AND rev > ? ORDER BY rev LIMIT 2000").all(uid, since) as Omit<ItemRow, "data">[];
  let n = 0, take = 0;
  for (const r of rows) { if (take && n + r.size > SYNC_LIMITS.page) break; n += r.size; take++; }
  const pick = rows.slice(0, take);
  const one = t().prepare("SELECT data FROM user_items WHERE user_id = ? AND kind = ? AND id = ?");
  const items = pick.map((r) => ({ ...r, data: r.deleted ? null : (one.get(uid, r.kind, r.id) as { data: string | null } | undefined)?.data ?? null }));
  return { items, next: pick.length ? pick[pick.length - 1].rev : since, more: take < rows.length || rows.length === 2000 };
}
/** Lấy đúng các mục theo khóa "chat:123" (mục đã rút gọn trong trình duyệt, mục thua xung đột). */
export function itemsByKey(uid: string, keys: string[]): ItemRow[] {
  const q = t().prepare("SELECT kind, id, upd, rev, deleted, data, size FROM user_items WHERE user_id = ? AND kind = ? AND id = ?");
  return keys.slice(0, 200).flatMap((k) => { const i = k.indexOf(":"); const r = q.get(uid, k.slice(0, i), k.slice(i + 1)) as ItemRow | undefined; return r ? [r] : []; });
}

const wipedAt = (uid: string) => (t().prepare("SELECT upd FROM user_items WHERE user_id = ? AND kind = 'wipe' AND id = ?").get(uid, WIPE_ID) as { upd: number } | undefined)?.upd ?? 0;

/** Nhận một đợt từ thiết bị. Theo từng mục: mốc sửa mới hơn (hoặc bằng) mới được ghi; thua thì báo để thiết bị lấy bản trên máy chủ về. */
export function pushItems(uid: string, input: PushItem[]): PushResult[] {
  const d = t(), now = Date.now();
  const get = d.prepare("SELECT upd, rev, deleted, size FROM user_items WHERE user_id = ? AND kind = ? AND id = ?");
  const put = d.prepare(`INSERT INTO user_items (user_id, kind, id, upd, rev, deleted, data, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, kind, id) DO UPDATE SET upd = excluded.upd, rev = excluded.rev, deleted = excluded.deleted, data = excluded.data, size = excluded.size`);
  return d.transaction(() => {
    const wiped = wipedAt(uid);
    let used = d.prepare("SELECT COALESCE(SUM(size), 0) AS b, COUNT(*) AS n FROM user_items WHERE user_id = ?").get(uid) as { b: number; n: number };
    return input.slice(0, SYNC_LIMITS.batch).map((x): PushResult => {
      const base = { kind: String(x?.kind), id: String(x?.id) };
      if (!x || !KINDS.has(x.kind) || !okId(x.id)) return { ...base, ok: false, upd: 0, rev: 0, error: "bad" };
      // Đồng hồ thiết bị chạy nhanh không được đè mọi bản khác mãi mãi.
      const upd = Math.min(Math.max(0, Math.floor(Number(x.upd) || 0)), now);
      const cur = get.get(uid, x.kind, x.id) as { upd: number; rev: number; deleted: number; size: number } | undefined;
      if (cur && cur.upd > upd) return { ...base, ok: false, upd: cur.upd, rev: cur.rev, deleted: !!cur.deleted };
      // Đã "xóa tất cả" sau lần sửa này (bản nằm ở thiết bị chưa đồng bộ): không cho sống lại.
      if (upd <= wiped) return { ...base, ok: false, upd: wiped, rev: 0, deleted: true };
      if (x.deleted) {
        put.run(uid, x.kind, x.id, upd, nextRev(uid), 1, null, 0);
        used = { b: used.b - (cur?.size ?? 0), n: used.n + (cur ? 0 : 1) };
        return { ...base, ok: true, upd, rev: nextRev(uid) - 1, deleted: true, removed: !!cur && !cur.deleted };
      }
      if (typeof x.data !== "string") return { ...base, ok: false, upd: 0, rev: 0, error: "bad" };
      const size = Buffer.byteLength(x.data);
      if (size > SYNC_LIMITS.item) return { ...base, ok: false, upd: 0, rev: 0, error: "too_big" };
      if (used.b - (cur?.size ?? 0) + size > SYNC_LIMITS.total || (!cur && used.n >= SYNC_LIMITS.items)) return { ...base, ok: false, upd: 0, rev: 0, error: "quota" };
      try { if (typeof JSON.parse(x.data) !== "object") throw 0; } catch { return { ...base, ok: false, upd: 0, rev: 0, error: "bad" }; }
      const rev = nextRev(uid);
      put.run(uid, x.kind, x.id, upd, rev, 0, x.data, size);
      used = { b: used.b - (cur?.size ?? 0) + size, n: used.n + (cur ? 0 : 1) };
      return { ...base, ok: true, upd, rev };
    });
  })();
}

/** Mọi thiết bị: mọi đoạn chat và dự án có mốc sửa trước thời điểm này đều coi như đã xóa. Trả về mã đoạn chat vừa xóa để dọn phần liên quan. */
export function wipeItems(uid: string, at: number): string[] {
  const d = t(), upd = Math.min(Math.max(0, Math.floor(Number(at) || 0)), Date.now());
  return d.transaction(() => {
    const rows = d.prepare("SELECT kind, id FROM user_items WHERE user_id = ? AND deleted = 0 AND kind != 'wipe' AND upd <= ?").all(uid, upd) as { kind: string; id: string }[];
    let rev = nextRev(uid);
    const up = d.prepare("UPDATE user_items SET upd = ?, rev = ?, deleted = 1, data = NULL, size = 0 WHERE user_id = ? AND kind = ? AND id = ?");
    for (const r of rows) up.run(upd, rev++, uid, r.kind, r.id);
    d.prepare(`INSERT INTO user_items (user_id, kind, id, upd, rev, deleted, data, size) VALUES (?, 'wipe', ?, ?, ?, 1, NULL, 0)
      ON CONFLICT(user_id, kind, id) DO UPDATE SET upd = MAX(upd, excluded.upd), rev = excluded.rev`).run(uid, WIPE_ID, upd, rev);
    return rows.filter((r) => r.kind === "chat").map((r) => r.id);
  })();
}

/** Đoạn chat đã bị xóa (hoặc nằm trong lần "xóa tất cả"): bộ não không học lại từ nó nữa. */
export function chatGone(uid: string, conv: string, upd = 0) {
  const r = t().prepare("SELECT deleted, upd FROM user_items WHERE user_id = ? AND kind = 'chat' AND id = ?").get(uid, conv) as { deleted: number; upd: number } | undefined;
  return !!r?.deleted && r.upd >= upd;
}
export const syncStats = (uid: string) => t().prepare("SELECT kind, COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM user_items WHERE user_id = ? AND deleted = 0 GROUP BY kind").all(uid) as { kind: string; n: number; bytes: number }[];
