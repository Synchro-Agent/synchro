// Liên kết chia sẻ đoạn chat (chỉ chạy ở máy chủ): mỗi liên kết là một bản chụp riêng (sharesnap.ts) gắn với chủ sở hữu, không trỏ vào dữ liệu sống.
// Mã trong đường dẫn là ngẫu nhiên 192 bit (không đoán được, không suy ra từ đoạn chat). Dừng chia sẻ là xóa hẳn bản chụp, nên liên kết cũ hết hiệu lực ngay.
import crypto from "node:crypto";
import { ADMIN_EMAILS, AuthError, db } from "./authstore";
import { shareImageData } from "./artimg";
import { sendMail } from "./mailer";
import { inlineSnapImages, SHARE_LIMITS, snapshotOf, type ShareSnap } from "./sharesnap";

export type ShareRow = { token: string; user_id: string; conv: string; title: string; snap: string; size: number; created_at: number; updated_at: number };
export type ShareInfo = { token: string; conv: string; title: string; size: number; createdAt: number; updatedAt: number };

let ready = false;
function t() {
  const d = db();
  if (!ready) {
    // ON DELETE CASCADE: xóa tài khoản thì mọi liên kết của tài khoản đó mất theo.
    d.exec(`CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, conv TEXT NOT NULL, title TEXT NOT NULL,
        snap TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id, conv));
      CREATE INDEX IF NOT EXISTS shares_user ON shares(user_id, updated_at);
      CREATE TABLE IF NOT EXISTS share_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, title TEXT NOT NULL, owner TEXT NOT NULL, reason TEXT NOT NULL, ip TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    ready = true;
  }
  return d;
}
const info = (r: ShareRow): ShareInfo => ({ token: r.token, conv: r.conv, title: r.title, size: r.size, createdAt: r.created_at, updatedAt: r.updated_at });
const okConv = (conv: unknown) => { const c = String(conv ?? ""); if (!/^[\w-]{1,64}$/.test(c)) throw new AuthError("Đoạn chat không hợp lệ.", 400); return c; };

export const listShares = (uid: string): ShareInfo[] => (t().prepare("SELECT * FROM shares WHERE user_id = ? ORDER BY updated_at DESC").all(uid) as ShareRow[]).map(info);
export const shareOfConv = (uid: string, conv: string): ShareInfo | null => { const r = t().prepare("SELECT * FROM shares WHERE user_id = ? AND conv = ?").get(uid, okConv(conv)) as ShareRow | undefined; return r ? info(r) : null; };

/** Tạo liên kết, hoặc cập nhật bản chụp của liên kết đang có (giữ nguyên địa chỉ). Bản chụp luôn dựng lại ở đây: trường lạ trình duyệt gửi kèm đều bị bỏ. */
export async function putShare(uid: string, convIn: unknown, title: unknown, msgs: unknown): Promise<ShareInfo & { imagesSkipped: number }> {
  const conv = okConv(convIn), raw = snapshotOf(title, msgs);
  if (!raw.msgs.some((m) => m.segs.length)) throw new AuthError("Đoạn chat chưa có nội dung để chia sẻ.", 400);
  if (Buffer.byteLength(JSON.stringify(raw)) > SHARE_LIMITS.bytes) throw new AuthError("Đoạn chat quá lớn để chia sẻ.", 413);
  const { snap, skipped } = await inlineSnapImages(raw, shareImageData, SHARE_LIMITS.bytes);
  const json = JSON.stringify(snap), size = Buffer.byteLength(json);
  if (size > SHARE_LIMITS.bytes) throw new AuthError("Đoạn chat quá lớn để chia sẻ.", 413);
  const d = t(), now = Date.now();
  const cur = d.prepare("SELECT token FROM shares WHERE user_id = ? AND conv = ?").get(uid, conv) as { token: string } | undefined;
  const used = d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM shares WHERE user_id = ? AND conv != ?").get(uid, conv) as { n: number; b: number };
  if (used.n >= SHARE_LIMITS.perUser) throw new AuthError("Bạn đang chia sẻ quá nhiều đoạn chat. Hãy dừng bớt trong Cài đặt → Quyền riêng tư.", 429);
  if (used.b + size > SHARE_LIMITS.totalBytes) throw new AuthError("Các bản chia sẻ đã dùng hết dung lượng. Hãy dừng bớt trong Cài đặt → Quyền riêng tư.", 413);
  if (cur) d.prepare("UPDATE shares SET title = ?, snap = ?, size = ?, updated_at = ? WHERE token = ?").run(snap.title, json, size, now, cur.token);
  else d.prepare("INSERT INTO shares (token, user_id, conv, title, snap, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(crypto.randomBytes(24).toString("base64url"), uid, conv, snap.title, json, size, now, now);
  return { ...shareOfConv(uid, conv)!, imagesSkipped: skipped };
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

// Báo cáo nội dung xấu (giả mạo, lừa đảo): người xem không đăng nhập vẫn báo được, quản trị viên nhận thư và gỡ bằng /api/share/report.
export function reportShare(token: string, reason: string, ip: string): boolean {
  if (!/^[\w-]{20,64}$/.test(token)) return false;
  const r = t().prepare("SELECT title, user_id FROM shares WHERE token = ?").get(token) as { title: string; user_id: string } | undefined;
  if (!r) return false;
  const why = reason.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 1000) || "(không ghi lý do)";
  t().prepare("INSERT INTO share_reports (token, title, owner, reason, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(token, r.title, r.user_id, why, ip, Date.now());
  const link = `${process.env.APP_URL || "https://synchro.net.nz"}/share/${token}`;
  const text = `Liên kết: ${link}\nTiêu đề: ${r.title}\nLý do: ${why}\n\nGỡ bản chia sẻ: Cài đặt → Quản trị viên → Reported shared links.`;
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const to of ADMIN_EMAILS) sendMail(to, { subject: "Synchro: có báo cáo về một bản chia sẻ", text, html: `<pre style="white-space:pre-wrap;font:14px sans-serif">${safe}</pre>` });
  return true;
}
// live: bản chia sẻ còn đó không (đã gỡ hay chủ đã dừng). email: chủ bản chia sẻ, người báo cáo không lộ.
export const shareReports = () => t().prepare("SELECT r.id, r.token, r.title, u.email, r.reason, r.created_at AS at, EXISTS(SELECT 1 FROM shares s WHERE s.token = r.token) AS live FROM share_reports r LEFT JOIN users u ON u.id = r.owner ORDER BY r.id DESC LIMIT 200").all();
/** Quản trị viên gỡ bản chia sẻ vi phạm; báo cáo giữ lại làm nhật ký. */
export const takeDownShare = (token: string) => t().prepare("DELETE FROM shares WHERE token = ?").run(token).changes > 0;
