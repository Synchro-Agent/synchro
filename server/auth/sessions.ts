// Phiên đăng nhập: tạo / đọc / gia hạn phiên, vé xác minh hai bước, xác minh lại trước hành động nhạy cảm, cổng đăng nhập cho API.
import "server-only";
import crypto from "node:crypto";
import type { Feature } from "../../shared/catalog";
import { db, stmt } from "../db/db";
import { audit } from "../db/settings";
import { limit } from "../ratelimit";
import { timeAuth } from "../servertiming";
import { COOKIE, MAX_SESSIONS, MIN, PW_MAX, SESSION_TTL } from "./config";
import { AuthError } from "./errors";
import { verifyPassword } from "./passwords";
import { clientIp, cookie, readCookie, sha256 } from "./request";
import type { SessionRow, UserRow } from "./types";
import { can, getUser, isAdmin, ownerOnly, VERIFY_FIRST, verifyLocked } from "./users";

// ---- phiên ----
// ---- xác minh hai bước: mật khẩu hoặc Google đúng rồi mà tài khoản đã bật thì chưa tạo phiên, chỉ cấp vé 10 phút để nhập mã (mfa.ts). Vé ở bộ nhớ: khởi động lại thì đăng nhập lại. ----
const MFA_COOKIE = "synchro_mfa";
const mfaTickets = ((globalThis as { __synchroMfaTickets?: Map<string, { uid: string; method: string; exp: number }> }).__synchroMfaTickets ??= new Map());
export const mfaOn = (uid: string) => { try { return !!stmt("SELECT 1 FROM user_mfa WHERE user_id = ? AND enabled_at IS NOT NULL").get(uid); } catch { return false; } };
/** Tạo phiên, hoặc vé bước hai nếu tài khoản đã bật. */
export function signIn(u: UserRow, req: Request, method: string): { cookie: string; mfa: boolean } {
  if (!mfaOn(u.id)) return { cookie: createSession(u, req, method), mfa: false };
  const now = Date.now();
  for (const [k, v] of mfaTickets) if (v.exp < now) mfaTickets.delete(k);
  const token = crypto.randomBytes(32).toString("base64url");
  mfaTickets.set(sha256(token), { uid: u.id, method, exp: now + 10 * MIN });
  return { cookie: cookie(req, MFA_COOKIE, token, 600), mfa: true };
}
/** Vé bước hai của yêu cầu này còn hiệu lực, cùng tài khoản còn hoạt động. */
/** Đăng nhập bằng khóa truy cập (passkeys.ts). Có xác minh người dùng (vân tay, khuôn mặt, mã PIN của thiết bị) thì khóa đã đủ hai yếu tố, không hỏi mã nữa;
 *  không có thì tài khoản bật xác minh hai bước vẫn phải nhập mã như sau mật khẩu. */
export function passkeySignIn(u: UserRow, req: Request, userVerified: boolean) {
  const s = userVerified ? { cookie: createSession(u, req, "passkey"), mfa: false } : signIn(u, req, "passkey");
  if (!s.mfa) audit("login", { actor: u, ip: clientIp(req), detail: userVerified ? "passkey" : "passkey (no UV)" });
  return s;
}
export function mfaTicketUser(req: Request): { user: UserRow; method: string } | null {
  const raw = readCookie(req, MFA_COOKIE);
  const t = raw ? mfaTickets.get(sha256(raw)) : undefined;
  if (!raw || !t || t.exp < Date.now()) return null;
  const user = getUser(t.uid);
  if (!user || user.status !== "active") return null;
  return { user, method: t.method };
}
export const clearMfaCookie = (req: Request) => { const raw = readCookie(req, MFA_COOKIE); if (raw) mfaTickets.delete(sha256(raw)); return cookie(req, MFA_COOKIE, "", 0); };

export function createSession(u: UserRow, req: Request, method: string) {
  const token = crypto.randomBytes(32).toString("base64url"), sid = sha256(token);
  const now = Date.now();
  db().prepare("INSERT INTO sessions (id, user_id, method, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(sid, u.id, method, now, now, now + SESSION_TTL, clientIp(req), (req.headers.get("user-agent") ?? "").slice(0, 300));
  db().prepare("UPDATE users SET last_login_at = ?, last_seen_at = ? WHERE id = ?").run(now, now, u.id);
  db().prepare("DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT ?)").run(u.id, u.id, MAX_SESSIONS);
  // Vừa đăng nhập = vừa chứng minh danh tính: CHÍNH phiên mới này được thêm khóa truy cập / xác minh hai bước trong 5 phút mà không phải
  // xác minh lại. Các phiên khác của tài khoản không được tính theo (xem markReauth).
  markReauth(sid);
  return cookie(req, COOKIE, token, SESSION_TTL / 1000);
}
export const clearSessionCookie = (req: Request) => cookie(req, COOKIE, "", 0);

// ---- xác minh lại trước hành động nhạy cảm (step-up) ----
// Thêm một cách đăng nhập (khóa truy cập, xác minh hai bước) cần vừa chứng minh danh tính trong 5 phút: phiên cũ bị chiếm không lặng lẽ
// cài thêm đường vào. Mốc giữ trong bộ nhớ (app một tiến trình); khởi động lại thì xác minh lại — an toàn hơn chứ không kém.
// Mốc gắn với TỪNG PHIÊN (khóa là mã phiên = sha256 của cookie, SessionRow.id), không gắn với tài khoản: chủ thật đăng nhập hay xác minh lại
// ở thiết bị khác không làm phiên cũ bị chiếm được tính là "vừa xác minh".
const REAUTH_TTL = 5 * MIN;
const reauthAt = ((globalThis as { __synchroReauth?: Map<string, number> }).__synchroReauth ??= new Map<string, number>());
type SessionRef = Pick<SessionRow, "id">;
export function markReauth(sid: string) {
  const now = Date.now();
  if (reauthAt.size > 50_000) for (const [k, v] of reauthAt) if (now - v > REAUTH_TTL) reauthAt.delete(k);
  reauthAt.set(sid, now);
}
export const recentlyReauthed = (sid: string) => { const t = reauthAt.get(sid); return !!t && Date.now() - t < REAUTH_TTL; };
/** Chặn hành động nhạy cảm khi phiên này chưa xác minh lại gần đây; { reauth: true } để giao diện hỏi mật khẩu / khóa rồi thử lại. */
export function requireRecentReauth(session: SessionRef) {
  if (!recentlyReauthed(session.id)) throw new AuthError("Hãy xác minh lại bằng mật khẩu hoặc khóa truy cập trước khi thêm cách đăng nhập mới.", 403, { reauth: true });
}
/** Xác minh lại tại chỗ bằng mật khẩu (nếu đúng thì ghi mốc re-auth cho đúng phiên đang gọi). Dùng cho hành động nhạy cảm của tài khoản đang đăng nhập. */
export async function reauthPassword(u: UserRow, session: SessionRef, password: unknown) {
  if (u.password_hash && typeof password === "string" && password.length <= PW_MAX && (await verifyPassword(password, u.password_hash))) { markReauth(session.id); return true; }
  return false;
}
/** Bước xác minh lại của giao diện (hộp hỏi mật khẩu sau lỗi { reauth: true }): không gửi mật khẩu thì bỏ qua (cổng requireRecentReauth quyết định);
 *  gửi mà sai thì báo sai ngay (400, có giới hạn số lần) thay vì hỏi lại không lý do. */
export async function stepUp(u: UserRow, session: SessionRef, password: unknown) {
  if (password === undefined || password === null) return;
  limit("reauth:" + u.id, 10, 15 * MIN);
  if (!u.password_hash) throw new AuthError("Tài khoản này chưa có mật khẩu. Hãy xác minh bằng khóa truy cập, hoặc đăng xuất rồi đăng nhập lại.", 400, { reauth: true });
  if (!(await reauthPassword(u, session, password))) {
    audit("reauth_failed", { actor: u, target: u, detail: "password" });
    // { reauth: true }: hộp xác minh lại giữ nguyên, báo sai ngay dưới ô mật khẩu.
    throw new AuthError("Mật khẩu không đúng.", 400, { reauth: true });
  }
}
/** Tác vụ nền hằng đêm: xóa các phiên đã hết hạn còn nằm lại (phiên trượt phần lớn tự hết, nhưng phiên bỏ không vẫn đọng). Trả về số dòng đã xóa. */
export function sweepSessions() {
  return db().prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now()).changes;
}

// Thời gian kiểm tra đăng nhập được tính vào phần auth của header Server-Timing (server/servertiming.ts).
export function current(req: Request): { user: UserRow; session: SessionRow } | null { return timeAuth(() => sessionOf(req)); }
function sessionOf(req: Request): { user: UserRow; session: SessionRow } | null {
  const t = readCookie(req, COOKIE);
  if (!t || t.length > 100) return null;
  const s = stmt("SELECT * FROM sessions WHERE id = ?").get(sha256(t)) as SessionRow | undefined;
  if (!s) return null;
  const now = Date.now();
  if (s.expires_at < now) { stmt("DELETE FROM sessions WHERE id = ?").run(s.id); return null; }
  const user = getUser(s.user_id);
  if (!user || user.status !== "active") return null;
  // gia hạn trượt, ghi tối đa 10 phút một lần
  if (now - s.last_seen_at > 10 * MIN) {
    stmt("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(now, now + SESSION_TTL, s.id);
    stmt("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now, user.id);
  }
  return { user, session: s };
}
/** Tài khoản của một phiên còn hiệu lực, khi không có cookie phiên trong yêu cầu (oauth.ts: Apple gửi kết quả bằng POST từ trang khác). */
export function sessionUser(sid: string) {
  const s = stmt("SELECT * FROM sessions WHERE id = ?").get(sid) as SessionRow | undefined;
  const user = s && s.expires_at >= Date.now() ? getUser(s.user_id) : undefined;
  return user?.status === "active" ? user : null;
}
export function requireUser(req: Request) {
  const c = current(req);
  if (!c) throw new AuthError("Bạn cần đăng nhập.", 401);
  return c;
}
export function requireAdmin(req: Request) {
  const c = requireUser(req);
  if (!isAdmin(c.user)) throw new AuthError("Chỉ quản trị viên mới có quyền này.", 403);
  return c;
}
export function requireOwner(req: Request) {
  const c = requireAdmin(req);
  ownerOnly(c.user);
  return c;
}

export function device(ua: string | null) {
  const s = ua ?? "";
  const b = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "macOS" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "";
  return os ? `${b} · ${os}` : b;
}
export const publicSession = (s: SessionRow, cur?: string) => ({ id: s.id, current: s.id === cur, method: s.method, device: device(s.user_agent), ip: s.ip, createdAt: s.created_at, lastSeen: s.last_seen_at });
export const sessionsOf = (userId: string) => stmt("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC").all(userId, Date.now()) as SessionRow[];

// Cổng cho API nội bộ: phải đăng nhập và được quản trị cho phép dùng tính năng này.
export function featureGate(req: Request, f: Feature) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  if (!can(c.user, f)) return verifyLocked(c.user) ? Response.json({ error: VERIFY_FIRST, verify: true }, { status: 403 }) : Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng tính năng này." }, { status: 403 });
  return null;
}

// Chặn API nội bộ (LLM, skills, file…) với người chưa đăng nhập.
export const authGate = (req: Request) => (current(req) ? null : Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 }));
