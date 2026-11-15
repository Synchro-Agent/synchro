// Xác minh hai bước bằng ứng dụng tạo mã (TOTP, RFC 6238; chỉ chạy ở máy chủ), tự bật trong Cài đặt → Tài khoản. Không dùng dịch vụ ngoài, không thêm thư viện.
// Khóa được mã hóa như token connector. Bảng có cột user_id nên xóa tài khoản tự xóa theo (purge.ts). Đăng nhập: authstore.ts chưa tạo phiên khi tài khoản đã bật, chỉ cấp vé ngắn hạn.
import "server-only";
import crypto from "node:crypto";
import { AuthError, audit, db, dropEmailChange, limit, needsVerify, requireRecentReauth, VERIFY_FIRST, type SessionRow, type UserRow } from "./authstore";
import { openSecret, sealSecret } from "./providers";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(b: Buffer) {
  let bits = 0, val = 0, out = "";
  for (const x of b) { val = (val << 8) | x; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
const unbase32 = (s: string) => {
  let bits = 0, val = 0; const out: number[] = [];
  for (const c of s) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
};
/** Mã 6 số của một bước thời gian (30 giây). */
export function totpAt(secret: string, step: number) {
  const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", unbase32(secret)).update(m).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
const stepNow = () => Math.floor(Date.now() / 30_000);
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

type Row = { user_id: string; secret: string; enabled_at: number | null; last_step: number; recovery: string };
let ready = false;
function t() {
  const d = db();
  if (!ready) { d.exec("CREATE TABLE IF NOT EXISTS user_mfa (user_id TEXT PRIMARY KEY, secret TEXT NOT NULL, enabled_at INTEGER, last_step INTEGER NOT NULL DEFAULT 0, recovery TEXT NOT NULL DEFAULT '[]')"); ready = true; }
  return d;
}
const row = (uid: string) => t().prepare("SELECT * FROM user_mfa WHERE user_id = ?").get(uid) as Row | undefined;
export const mfaStatus = (uid: string) => { const r = row(uid); return { enabled: !!r?.enabled_at, recoveryLeft: r?.enabled_at ? (JSON.parse(r.recovery) as string[]).length : 0 }; };

/** Kiểm tra mã 6 số (lệch tối đa một bước, mỗi bước dùng một lần: mã bị nhìn trộm không dùng lại được) hoặc mã dự phòng (dùng một lần). */
function check(r: Row, code0: unknown) {
  limit("mfa:" + r.user_id, 8, 15 * 60_000);
  const code = String(code0 ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{6}$/.test(code)) {
    const secret = openSecret(r.secret), now = stepNow();
    for (const s of [now, now - 1, now + 1]) {
      if (s > r.last_step && same(totpAt(secret, s), code)) { t().prepare("UPDATE user_mfa SET last_step = ? WHERE user_id = ?").run(s, r.user_id); return true; }
    }
    return false;
  }
  const left = JSON.parse(r.recovery) as string[], i = /^[A-Z2-7]{10}$/.test(code) ? left.indexOf(sha(code)) : -1;
  if (i < 0) return false;
  left.splice(i, 1);
  t().prepare("UPDATE user_mfa SET recovery = ? WHERE user_id = ?").run(JSON.stringify(left), r.user_id);
  return true;
}
/** Đăng nhập bước hai. */
export function verifyMfa(uid: string, code: unknown) {
  const r = row(uid);
  return !!r?.enabled_at && check(r, code);
}
/** Bắt đầu bật: tạo khóa chờ xác nhận. Chưa có hiệu lực cho tới khi người dùng nhập đúng một mã (không thì khóa quét lỗi là mất tài khoản). */
export function startMfa(u: UserRow, session: SessionRow) {
  // Email chưa xác minh có thể là của người khác: mã do người đăng ký trước đặt sẽ khóa chủ thật khi họ giành lại tài khoản.
  if (needsVerify(u)) throw new AuthError(VERIFY_FIRST, 403);
  // Bật xác minh hai bước là hành động nhạy cảm: cần vừa xác minh lại (đăng nhập / mật khẩu) trong 5 phút.
  requireRecentReauth(session);
  if (row(u.id)?.enabled_at) throw new AuthError("Xác minh hai bước đang bật.", 409);
  const secret = base32(crypto.randomBytes(20));
  t().prepare("INSERT INTO user_mfa (user_id, secret) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, last_step = 0, recovery = '[]'").run(u.id, sealSecret(secret));
  return { secret, uri: `otpauth://totp/${encodeURIComponent(`Synchro:${u.email}`)}?secret=${secret}&issuer=Synchro&digits=6&period=30` };
}
export function confirmMfa(u: UserRow, code: unknown) {
  if (needsVerify(u)) throw new AuthError(VERIFY_FIRST, 403);
  const r = row(u.id);
  if (!r || r.enabled_at) throw new AuthError("Hãy bắt đầu lại từ đầu.", 409);
  if (!check(r, code)) throw new AuthError("Mã không đúng. Hãy nhập mã đang hiện trong ứng dụng.", 400);
  const codes = Array.from({ length: 8 }, () => base32(crypto.randomBytes(7)).slice(0, 10));
  t().prepare("UPDATE user_mfa SET enabled_at = ?, recovery = ? WHERE user_id = ?").run(Date.now(), JSON.stringify(codes.map(sha)), u.id);
  // Bật vì lo bị lộ: đường dẫn đổi email ai đó đã xin bằng mật khẩu cũng phải mất hiệu lực.
  dropEmailChange(u.id);
  audit("mfa_on", { actor: u, target: u });
  return { recovery: codes };
}
export function disableMfa(u: UserRow, code: unknown) {
  const r = row(u.id);
  if (!r?.enabled_at) return;
  if (!check(r, code)) throw new AuthError("Mã không đúng. Hãy nhập mã đang hiện trong ứng dụng.", 400);
  t().prepare("DELETE FROM user_mfa WHERE user_id = ?").run(u.id);
  audit("mfa_off", { actor: u, target: u });
}
