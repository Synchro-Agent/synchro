// Liên kết chia sẻ đoạn chat (chỉ chạy ở máy chủ): mỗi liên kết là một bản chụp riêng (sharesnap.ts) gắn với chủ sở hữu, không trỏ vào dữ liệu sống.
// Mã trong đường dẫn là ngẫu nhiên 192 bit (không đoán được, không suy ra từ đoạn chat). Dừng chia sẻ là xóa hẳn bản chụp, nên liên kết cũ hết hiệu lực ngay.
import "server-only";
import crypto from "node:crypto";
import { ALERT_EMAILS, AuthError, db } from "./authstore";
import { shareImageData } from "./artimg";
import { sendMail } from "./mailer";
import { inlineSnapImages, SHARE_LIMITS, snapshotOf, type ShareSnap } from "./sharesnap";

export type ShareRow = { token: string; user_id: string; conv: string; title: string; snap: string; size: number; created_at: number; updated_at: number };
export type ShareInfo = { token: string; conv: string; title: string; size: number; createdAt: number; updatedAt: number };

// Bảng shares, share_reports: db/migrations/001_baseline.sql (bộ chạy migration tạo khi mở cơ sở dữ liệu).
function t() {
  return db();
}
const info = (r: ShareRow): ShareInfo => ({ token: r.token, conv: r.conv, title: r.title, size: r.size, createdAt: r.created_at, updatedAt: r.updated_at });
const okConv = (conv: unknown) => { const c = String(conv ?? ""); if (!/^[\w-]{1,64}$/.test(c)) throw new AuthError("Đoạn chat không hợp lệ.", 400); return c; };

export const listShares = (uid: string): ShareInfo[] => (t().prepare("SELECT * FROM shares WHERE user_id = ? ORDER BY updated_at DESC").all(uid) as ShareRow[]).map(info);
export const shareOfConv = (uid: string, conv: string): ShareInfo | null => { const r = t().prepare("SELECT * FROM shares WHERE user_id = ? AND conv = ?").get(uid, okConv(conv)) as ShareRow | undefined; return r ? info(r) : null; };

// Người xem bản chia sẻ chưa đăng nhập nên không đi qua /api/artimg được, và khung artifact chỉ cho ảnh nhúng (CSP chặn đường gửi dữ liệu ra ngoài):
// nhúng ảnh ngoài vào bản chụp ngay ở máy chủ. Người xem cũng không phải gọi tới trang ảnh của bên thứ ba, ảnh gốc bị xóa thì bản chia sẻ vẫn còn.
const IMG_ONE = 2.8 * 1048576; // data: của ảnh sau khi thu nhỏ, khoảng 2 MB ảnh gốc: SVG, GIF không thu nhỏ được không được chiếm hết phần ảnh của bản chụp.
async function withImages(snap: ShareSnap, ms?: number, uid?: string): Promise<ShareSnap> {
  const r = await inlineSnapImages(snap, (u) => shareImageData(u, uid).then((d) => (d && d.length > IMG_ONE ? null : d)), SHARE_LIMITS.withImages, { ms });
  return { ...r.snap, imgs: { missing: r.skipped } };
}

function storeShare(uid: string, conv: string, snap: ShareSnap): ShareInfo {
  if (!snap.msgs.some((m) => m.segs.length)) throw new AuthError("Đoạn chat chưa có nội dung để chia sẻ.", 400);
  const json = JSON.stringify(snap), size = Buffer.byteLength(json);
  if (size > SHARE_LIMITS.withImages) throw new AuthError("Đoạn chat quá lớn để chia sẻ.", 413);
  const d = t(), now = Date.now();
  const cur = d.prepare("SELECT token FROM shares WHERE user_id = ? AND conv = ?").get(uid, conv) as { token: string } | undefined;
  const used = d.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM shares WHERE user_id = ? AND conv != ?").get(uid, conv) as { n: number; b: number };
  if (used.n >= SHARE_LIMITS.perUser) throw new AuthError("Bạn đang chia sẻ quá nhiều đoạn chat. Hãy dừng bớt trong Cài đặt → Quyền riêng tư.", 429);
  if (used.b + size > SHARE_LIMITS.totalBytes) throw new AuthError("Các bản chia sẻ đã dùng hết dung lượng. Hãy dừng bớt trong Cài đặt → Quyền riêng tư.", 413);
  if (cur) d.prepare("UPDATE shares SET title = ?, snap = ?, size = ?, updated_at = ? WHERE token = ?").run(snap.title, json, size, now, cur.token);
  else d.prepare("INSERT INTO shares (token, user_id, conv, title, snap, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(crypto.randomBytes(24).toString("base64url"), uid, conv, snap.title, json, size, now, now);
  return shareOfConv(uid, conv)!;
}

/** Tạo liên kết, hoặc cập nhật bản chụp của liên kết đang có (giữ nguyên địa chỉ). Bản chụp luôn dựng lại ở đây: trường lạ trình duyệt gửi kèm đều bị bỏ. */
export async function putShare(uid: string, convIn: unknown, title: unknown, msgs: unknown): Promise<ShareInfo & { missingImages: number }> {
  const conv = okConv(convIn), snap = snapshotOf(title, msgs);
  // Kiểm tra trước khi tải ảnh: giới hạn chữ giữ nguyên, ảnh nhúng có trần riêng.
  if (Buffer.byteLength(JSON.stringify(snap)) > SHARE_LIMITS.bytes) throw new AuthError("Đoạn chat quá lớn để chia sẻ.", 413);
  const full = await withImages(snap, undefined, uid);
  return { ...storeShare(uid, conv, full), missingImages: full.imgs?.missing ?? 0 };
}

/** Bản chụp tạo trước khi có việc nhúng ảnh: nhúng một lần khi có người mở, giữ nguyên mốc thời gian của bản chụp. Lỗi thì vẫn trả bản cũ. */
export async function shareForView(token: string) {
  const s = publicShare(token);
  if (!s || s.snap.imgs) return s;
  try {
    // Người xem đang đợi trang: chờ ảnh ngắn hơn lúc tạo.
    const snap = await withImages(s.snap, 12_000), json = JSON.stringify(snap), size = Buffer.byteLength(json);
    if (size <= SHARE_LIMITS.withImages) { t().prepare("UPDATE shares SET snap = ?, size = ? WHERE token = ?").run(json, size, token); return { snap, at: s.at }; }
  } catch (e) { console.error("[share] nhúng ảnh", e); }
  return s;
}

/** Trang công khai: chỉ trả bản chụp và mốc thời gian, không có gì về chủ sở hữu. */
export function publicShare(token: string): { snap: ShareSnap; at: number } | null {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const r = t().prepare("SELECT snap, updated_at FROM shares WHERE token = ?").get(token) as { snap: string; updated_at: number } | undefined;
  if (!r) return null;
  try { return { snap: JSON.parse(r.snap) as ShareSnap, at: r.updated_at }; } catch { return null; }
}

/** Chủ của liên kết khi bản chụp thật sự chứa đoạn mã sơ đồ này (artifact D2 hoặc khối ```d2 trong câu trả lời), không thì null.
 *  Trang chia sẻ dùng để vẽ sơ đồ chưa có trong bộ nhớ đệm cho người xem chưa đăng nhập, chỉ với nội dung chủ liên kết đã chia sẻ. */
export function shareOwnerWithCode(token: string, code: string): string | null {
  if (!/^[\w-]{20,64}$/.test(token) || !code.trim()) return null;
  const r = t().prepare("SELECT user_id, snap FROM shares WHERE token = ?").get(token) as { user_id: string; snap: string } | undefined;
  if (!r) return null;
  try {
    const snap = JSON.parse(r.snap) as ShareSnap;
    const has = snap.msgs.some((m) => m.segs.some((g) => (g.k === "art" && g.type === "d2" && g.content === code) || (g.k === "art" && g.type === "markdown" && g.content.includes(code)) || (g.k === "text" && g.t.includes(code))));
    return has ? r.user_id : null;
  } catch { return null; }
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
  for (const to of ALERT_EMAILS) sendMail(to, { subject: "Synchro: có báo cáo về một bản chia sẻ", text, html: `<pre style="white-space:pre-wrap;font:14px sans-serif">${safe}</pre>` });
  return true;
}
// live: bản chia sẻ còn đó không (đã gỡ hay chủ đã dừng). email: chủ bản chia sẻ, người báo cáo không lộ.
export const shareReports = () => t().prepare("SELECT r.id, r.token, r.title, u.email, r.reason, r.created_at AS at, EXISTS(SELECT 1 FROM shares s WHERE s.token = r.token) AS live FROM share_reports r LEFT JOIN users u ON u.id = r.owner ORDER BY r.id DESC LIMIT 200").all();
/** Quản trị viên gỡ bản chia sẻ vi phạm; báo cáo giữ lại làm nhật ký. */
export const takeDownShare = (token: string) => t().prepare("DELETE FROM shares WHERE token = ?").run(token).changes > 0;
