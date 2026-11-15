// Quản trị tài khoản: số liệu, danh sách người dùng, nhật ký, thao tác trên tài khoản người khác (vai trò, email, mật khẩu, khóa, xóa).
import "server-only";
import { normPerms } from "../../shared/catalog";
import { db } from "../db/db";
import { audit } from "../db/settings";
import { DAY, reservedEmail } from "./config";
import { AuthError } from "./errors";
import { accountGone, createResetLink, dropEmailChange } from "./flows";
import { checkPassword, hashPassword, normEmail } from "./passwords";
import { clientIp } from "./request";
import type { SessionRow, UserRow } from "./types";
import { basePerms, defaultPerms, findByEmail, getUser, inGoodStanding, isOwner, OWNER_ONLY, ownerOnly, publicUser, roleLabel } from "./users";

// ---- quản trị ----
export function adminStats() {
  const now = Date.now();
  const n = (sql: string, ...a: unknown[]) => (db().prepare(sql).get(...a) as { n: number }).n;
  return {
    users: n("SELECT COUNT(*) n FROM users"),
    active7: n("SELECT COUNT(*) n FROM users WHERE last_seen_at > ?", now - 7 * DAY),
    new7: n("SELECT COUNT(*) n FROM users WHERE created_at > ?", now - 7 * DAY),
    suspended: n("SELECT COUNT(*) n FROM users WHERE status = 'suspended'"),
    sessions: n("SELECT COUNT(*) n FROM sessions WHERE expires_at > ?", now),
    failed24: n("SELECT COUNT(*) n FROM audit WHERE action = 'login_failed' AND at > ?", now - DAY),
    // Bảng runs do runs.ts tạo khi có lượt đầu tiên.
    ...(() => { try { return { runs24: n("SELECT COUNT(*) n FROM runs WHERE created_at > ?", now - DAY), runsFailed24: n("SELECT COUNT(*) n FROM runs WHERE status = 'error' AND created_at > ?", now - DAY) }; } catch { return { runs24: 0, runsFailed24: 0 }; } })(),
  };
}

/** viewer: người đang xem. protected: người xem không thao tác được trên tài khoản này (chủ sở hữu, quản trị viên trong cấu hình máy chủ;
 * quản trị viên thêm từ giao diện thì chỉ chủ sở hữu thao tác được). roleFixed: vai trò đặt ở cấu hình máy chủ, không đổi từ giao diện. */
export function adminUsers(viewer?: UserRow) {
  const rows = db().prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT 2000").all() as UserRow[];
  const sess = new Map((db().prepare("SELECT user_id, COUNT(*) n FROM sessions WHERE expires_at > ? GROUP BY user_id").all(Date.now()) as { user_id: string; n: number }[]).map((r) => [r.user_id, r.n]));
  const owner = !!viewer && isOwner(viewer);
  return rows.map((u) => ({ ...publicUser(u), perms: basePerms(u), status: u.status, verified: !!u.email_verified, lastLogin: u.last_login_at, lastSeen: u.last_seen_at, sessions: sess.get(u.id) ?? 0,
    role: roleLabel(u), roleFixed: reservedEmail(u.email), protected: reservedEmail(u.email) || (u.role === "admin" && !owner), customPerms: !!u.perms }));
}

export function adminAudit(lim = 100, before?: number) {
  return db().prepare(`SELECT * FROM audit ${before ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ?`).all(...(before ? [before, lim] : [lim]));
}

function target(admin: UserRow, id: string) {
  const t = getUser(id);
  if (!t) throw new AuthError("Không tìm thấy người dùng.", 404);
  if (t.id === admin.id || reservedEmail(t.email)) throw new AuthError("Không thể thao tác trên tài khoản quản trị viên.", 403);
  // Quản trị viên do chủ sở hữu thêm: chỉ chủ sở hữu thao tác được (quản trị viên không khóa, đổi mật khẩu hay xóa được nhau).
  if (t.role === "admin" && !isOwner(admin)) throw new AuthError(OWNER_ONLY, 403);
  return t;
}

export async function adminAct(req: Request, admin: UserRow, id: string, action: unknown, body: Record<string, unknown> = {}): Promise<{ resetUrl?: string } | void> {
  const t = target(admin, id);
  const ip = clientIp(req);
  if (action === "reset_link") return { resetUrl: createResetLink(req, admin, t) };
  // Thêm / bỏ quản trị viên: chỉ chủ sở hữu. { role: "admin" | "member" }. Ghi nhật ký kèm vai trò cũ → mới.
  if (action === "set_role") {
    ownerOnly(admin);
    const want = body.role === "admin" ? "admin" : body.role === "member" ? null : undefined;
    if (want === undefined) throw new AuthError("Vai trò không hợp lệ.");
    if (want === "admin" && !inGoodStanding(t)) throw new AuthError("Chỉ cấp quyền quản trị cho tài khoản đã xác minh email và đang hoạt động.", 400);
    const before = roleLabel(t);
    db().prepare("UPDATE users SET role = ? WHERE id = ?").run(want, t.id);
    const after = roleLabel(getUser(t.id)!);
    if (before !== after) audit(after === "admin" ? "admin_role_granted" : "admin_role_revoked", { actor: admin, target: t, ip, detail: `${before} → ${after}` });
    return;
  }
  // Người dùng mất hộp thư cũ: quản trị viên đổi hộ sau khi đã xác minh danh tính ngoài hệ thống, nên email mới coi như đã xác minh.
  // Đánh dấu chưa xác minh thì lần đặt lại mật khẩu hay đăng nhập Google kế tiếp bị coi là chủ email giành lại tài khoản: mất bộ não, ký ức, và "Không phải tôi" xóa luôn cả tài khoản. Phiên cũ vẫn bị đăng xuất.
  if (action === "set_email") {
    const email = normEmail(body.email);
    if (reservedEmail(email) || findByEmail(email)) throw new AuthError("Email này đã có tài khoản.", 409);
    db().prepare("UPDATE users SET email = ?, email_verified = 1 WHERE id = ?").run(email, t.id);
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(t.id);
    db().prepare("DELETE FROM password_resets WHERE user_id = ?").run(t.id);
    db().prepare("DELETE FROM email_verifications WHERE user_id = ?").run(t.id);
    dropEmailChange(t.id);
    audit("admin_set_email", { actor: admin, target: t, ip, detail: email });
    return;
  }
  if (action === "set_password") {
    // Quản trị đặt mật khẩu mới cho người khác, không cần mật khẩu cũ. Mặc định đăng xuất mọi phiên của họ.
    const pw = checkPassword(body.password, t.email);
    db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(pw), t.id);
    if (body.signOut !== false) db().prepare("DELETE FROM sessions WHERE user_id = ?").run(t.id);
    dropEmailChange(t.id);
    audit("admin_set_password", { actor: admin, target: t, ip });
    return;
  }
  if (action === "mark_verified") {
    // Quản trị viên đã đối chiếu người này bằng cách khác, hoặc thư không tới được họ.
    db().prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(t.id);
    db().prepare("DELETE FROM email_verifications WHERE user_id = ?").run(t.id);
    dropEmailChange(t.id);
    audit("admin_mark_verified", { actor: admin, target: t, ip });
    return;
  }
  if (action === "set_perms") {
    // null = quay về quyền mặc định
    const v = body.perms === null ? null : JSON.stringify(normPerms(body.perms, defaultPerms()));
    db().prepare("UPDATE users SET perms = ? WHERE id = ?").run(v, t.id);
    audit("admin_set_perms", { actor: admin, target: t, ip, detail: v ? "custom" : "default" });
    return;
  }
  if (action === "suspend") {
    db().prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(t.id);
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(t.id);
    dropEmailChange(t.id);
    audit("admin_suspend", { actor: admin, target: t, ip });
  } else if (action === "restore") {
    db().prepare("UPDATE users SET status = 'active' WHERE id = ?").run(t.id);
    audit("admin_restore", { actor: admin, target: t, ip });
  } else if (action === "signout") {
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(t.id);
    audit("admin_signout", { actor: admin, target: t, ip });
  } else throw new AuthError("Thao tác không hợp lệ.");
}

export function adminDelete(req: Request, admin: UserRow, id: string, confirmEmail: unknown) {
  // Xóa vĩnh viễn tài khoản và toàn bộ dữ liệu: chỉ chủ sở hữu (quản trị viên tạm khóa được).
  ownerOnly(admin);
  const t = target(admin, id);
  if (typeof confirmEmail !== "string" || confirmEmail.trim().toLowerCase() !== t.email.toLowerCase()) throw new AuthError("Email xác nhận không khớp.");
  db().prepare("DELETE FROM users WHERE id = ?").run(t.id);
  accountGone(t.id);
  audit("admin_delete", { actor: admin, target: t, ip: clientIp(req) });
}

export function adminRevokeSession(req: Request, admin: UserRow, sid: string) {
  const s = db().prepare("SELECT * FROM sessions WHERE id = ?").get(sid) as SessionRow | undefined;
  if (!s) return;
  const t = s.user_id === admin.id ? admin : target(admin, s.user_id);
  db().prepare("DELETE FROM sessions WHERE id = ?").run(sid);
  audit("admin_revoke_session", { actor: admin, target: t, ip: clientIp(req) });
}
