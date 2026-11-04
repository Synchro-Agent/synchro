// Liên kết chia sẻ đoạn chat (chỉ chạy ở máy chủ): mỗi liên kết là một bản chụp riêng (sharesnap.ts) gắn với chủ sở hữu, không trỏ vào dữ liệu sống.
// Mã trong đường dẫn là ngẫu nhiên 192 bit (không đoán được, không suy ra từ đoạn chat). Dừng chia sẻ là xóa hẳn bản chụp, nên liên kết cũ hết hiệu lực ngay.
import crypto from "node:crypto";
import { AuthError, db } from "./authstore";
import { SHARE_LIMITS, snapshotOf, type ShareSnap } from "./sharesnap";

export type ShareRow = { token: string; user_id: string; conv: string; title: string; snap: string; size: number; created_at: number; updated_at: number };
export type ShareInfo = { token: string; conv: string; title: string; size: number; createdAt: number; updatedAt: number };

let ready = false;
function t() {
  const d = db();
  if (!ready) {
    // ON DELETE CASCADE: xóa tài khoản thì mọi liên kết của tài khoản đó mất theo.
    d.exec(`CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, conv TEXT NOT NULL, title TEXT NOT NULL,
        snap TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id, conv));
      CREATE INDEX IF NOT EXISTS shares_user ON shares(user_id, updated_at)`);
    ready = true;
  }
  return d;
}
const info = (r: ShareRow): ShareInfo => ({ token: r.token, conv: r.conv, title: r.title, size: r.size, createdAt: r.created_at, updatedAt: r.updated_at });
const okConv = (conv: unknown) => { const c = String(conv ?? ""); if (!/^[\w-]{1,64}$/.test(c)) throw new AuthError("Đoạn chat không hợp lệ.", 400); return c; };

export const listShares = (uid: string): ShareInfo[] => (t().prepare("SELECT * FROM shares WHERE user_id = ? ORDER BY updated_at DESC").all(uid) as ShareRow[]).map(info);
export const shareOfConv = (uid: string, conv: string): ShareInfo | null => { const r = t().prepare("SELECT * FROM shares WHERE user_id = ? AND conv = ?").get(uid, okConv(conv)) as ShareRow | undefined; return r ? info(r) : null; };

/** Tạo liên kết, hoặc cập nhật bản chụp của liên kết đang có (giữ nguyên địa chỉ). Bản chụp luôn dựng lại ở đây: trường lạ trình duyệt gửi kèm đều bị bỏ. */
export function putShare(uid: string, convIn: unknown, title: unknown, msgs: unknown): ShareInfo {
  const conv = okConv(convIn), snap = snapshotOf(title, msgs);
  if (!snap.msgs.some((m) => m.segs.length)) throw new AuthError("Đoạn chat chưa có nội dung để chia sẻ.", 400);
  const json = JSON.stringify(snap), size = Buffer.byteLength(json);
  if (size > SHARE_LIMITS.bytes) throw new AuthError("Đoạn chat quá lớn để chia sẻ.", 413);
  const d = t(), now = Date.now();
  const cur = d.prepare("SELECT token FROM shares WHERE user_id = ? AND conv = ?").get(uid, conv) as { token: string } | undefined;
  const used = d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM shares WHERE user_id = ? AND conv != ?").get(uid, conv) as { n: number; b: number };
  if (used.n >= SHARE_LIMITS.perUser) throw new AuthError("Bạn đang chia sẻ quá nhiều đoạn chat. Hãy dừng bớt trong Cài đặt → Quyền riêng tư.", 429);
  if (used.b + size > SHARE_LIMITS.totalBytes) throw new AuthError("Các bản chia sẻ đã dùng hết dung lượng. Hãy dừng bớt trong Cài đặt → Quyền riêng tư.", 413);
  if (cur) d.prepare("UPDATE shares SET title = ?, snap = ?, size = ?, updated_at = ? WHERE token = ?").run(snap.title, json, size, now, cur.token);
  else d.prepare("INSERT INTO shares (token, user_id, conv, title, snap, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(crypto.randomBytes(24).toString("base64url"), uid, conv, snap.title, json, size, now, now);
  return shareOfConv(uid, conv)!;
}

/** Trang công khai: chỉ trả bản chụp và mốc thời gian, không có gì về chủ sở hữu. */
export function publicShare(token: string): { snap: ShareSnap; at: number } | null {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const r = t().prepare("SELECT snap, updated_at FROM shares WHERE token = ?").get(token) as { snap: string; updated_at: number } | undefined;
  if (!r) return null;
  try { return { snap: JSON.parse(r.snap) as ShareSnap, at: r.updated_at }; } catch { return null; }
}

/** Chỉ chủ sở hữu mới dừng được liên kết của mình. */
export const revokeShare = (uid: string, token: string) => t().prepare("DELETE FROM shares WHERE user_id = ? AND token = ?").run(uid, token).changes > 0;
export const revokeConvShare = (uid: string, conv: string) => t().prepare("DELETE FROM shares WHERE user_id = ? AND conv = ?").run(uid, conv).changes > 0;
export const revokeAllShares = (uid: string) => t().prepare("DELETE FROM shares WHERE user_id = ?").run(uid).changes;
