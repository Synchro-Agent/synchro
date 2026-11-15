// Luồng tài khoản: đăng ký, đăng nhập bằng mật khẩu / Google / GitHub / Apple, xác minh email, đổi và đặt lại mật khẩu, đổi email, tự xóa tài khoản.
import "server-only";
import crypto from "node:crypto";
import { sendMail } from "../mailer";
import { emailChangeMail, emailChangeNoticeMail, changedMail, resetMail, signupTakenMail, verifyMail, type MailLang } from "../mailtpl";
import { db } from "../db/db";
import { audit, signupOpen } from "../db/settings";
import { limit } from "../ratelimit";
import { DAY, MIN, PW_MAX, reservedEmail } from "./config";
import { AuthError } from "./errors";
import { checkPassword, hashPassword, normEmail, verifyPassword } from "./passwords";
import { appUrl, clientIp, sha256 } from "./request";
import { markReauth, mfaOn, signIn } from "./sessions";
import type { UserRow } from "./types";
import { cleanProfile, createUser, findByEmail, getUser, hasPasskeys, isAdmin, methodsOf, needsVerify, verifyLocked, writeProfile, type ProfileIn } from "./users";

// ---- đăng ký / đăng nhập bằng email ----
/** Tab mở từ bản cũ còn gọi bước kiểm tra email: không còn cho biết email có tài khoản hay không, bản cũ đi tiếp sang ô mật khẩu. */
export function lookup(req: Request, email: string) {
  limit("check:" + clientIp(req), 30, 10 * MIN);
  normEmail(email);
  return { exists: true, hasPassword: true, methods: [] as string[], reserved: false };
}

/** Một câu cho mọi lần đăng nhập không được: sai mật khẩu, không có tài khoản, tài khoản mới chưa xác minh email. */
const BAD_LOGIN = "Email hoặc mật khẩu không đúng. Nếu bạn vừa đăng ký, hãy mở đường dẫn trong thư xác minh trước. Nếu bạn đăng ký bằng Google, GitHub hoặc Apple, hãy dùng nút đó.";
export async function login(req: Request, email0: unknown, pw: unknown) {
  const ip = clientIp(req);
  const email = normEmail(email0);
  limit("login-ip:" + ip, 30, 15 * MIN);
  // Theo email + IP: người lạ thử sai liên tục không khóa được chủ tài khoản (ở IP khác); mức theo email lớn hơn nhiều để chặn dò từ nhiều IP.
  limit(`login-em:${email}:${ip}`, 10, 15 * MIN);
  limit("login-em:" + email, 100, 15 * MIN);
  const u = findByEmail(email);
  const ok = typeof pw === "string" && pw.length <= PW_MAX && (await verifyPassword(pw, u?.password_hash ?? null));
  // Blueprint F2.4: tài khoản vừa đăng ký bằng email, chưa xác minh, chưa từng đăng nhập thì mật khẩu đúng cũng trả lời y như sai mật khẩu.
  // Nếu không, đăng ký email X với mật khẩu P rồi đăng nhập bằng P sẽ cho biết X đã có tài khoản hay chưa (200 với email mới, 401 với email
  // đã có). Lần đăng nhập đầu cần bấm đường dẫn trong thư trước (hoặc đặt lại mật khẩu: cũng xác minh email). Xác minh xong vẫn đăng nhập bằng
  // mật khẩu, đường dẫn không tự đăng nhập: ai đó lập trước tài khoản bằng email của người khác thì chủ email bấm xác minh cũng không vào
  // nhầm tài khoản mà kẻ lập biết mật khẩu. Quản trị viên tắt yêu cầu xác minh (thư không gửi được) thì cho đăng nhập ngay như trước.
  const unproven = !!u && ok && u.last_login_at === null && verifyLocked(u);
  if (!u || !ok || unproven) { audit("login_failed", { target: u, targetEmail: email, ip, detail: unproven ? "email_unverified" : undefined }); throw new AuthError(BAD_LOGIN, 401); }
  if (u.status !== "active") { audit("login_blocked", { target: u, ip }); throw new AuthError("Tài khoản này đã bị khóa. Hãy liên hệ quản trị viên.", 403); }
  // Lần đăng nhập đầu của tài khoản (đăng ký bằng email không tự đăng nhập): giao diện chào và phát phim giới thiệu như vừa đăng ký.
  const firstLogin = u.last_login_at === null;
  const s = signIn(u, req, "password");
  // Chưa xong bước hai thì chưa phải đăng nhập: /api/auth/mfa ghi nhật ký khi xong.
  if (!s.mfa) audit("login", { actor: u, ip, detail: "password" });
  return { user: u, firstLogin, ...s };
}

/** Blueprint F2.4: email mới và email đã có tài khoản (hoặc được dành riêng) trả về giống hệt nhau, { pending: true } không kèm phiên.
 *  Email mới: tạo tài khoản chưa xác minh và gửi thư xác minh; lần đăng nhập đầu cần bấm đường dẫn trong thư trước (login() trả lời như sai
 *  mật khẩu cho tới lúc đó), nên đăng ký rồi đăng nhập thử cũng không dò được email nào đã đăng ký. Email đã có: chủ email nhận thư "bạn đã
 *  có tài khoản". Cả hai đường đều băm mật khẩu và gửi một thư nên tốn thời gian gần bằng nhau. Khi quản trị viên tắt yêu cầu xác minh
 *  (verifyGateOn), tài khoản mới đăng nhập ngay được và cách dò "đăng ký rồi đăng nhập" dùng lại được: đó là cái giá của việc tắt. */
export async function signup(req: Request, email0: unknown, pw0: unknown, profile: ProfileIn = {}, lang?: unknown): Promise<{ pending: true }> {
  const ip = clientIp(req);
  limit("signup:" + ip, 10, 60 * MIN);
  const email = normEmail(email0);
  const pw = checkPassword(pw0, email);
  if (!signupOpen()) throw new AuthError("Synchro hiện tạm ngừng nhận đăng ký mới.", 403);
  if (profile.fullName === undefined || profile.birthDate === undefined) throw new AuthError("Hãy điền họ tên và ngày sinh.");
  const prof = cleanProfile(profile);
  // Băm trước khi xem email có tồn tại: hai trường hợp tốn cùng thời gian.
  const hash = await hashPassword(pw);
  const taken = () => {
    // Không có giới hạn riêng cho đường này: lỗi 429 chỉ ở đây sẽ thành dấu hiệu để dò. Giới hạn chung signup:<ip> ở trên áp cho cả hai đường.
    audit("signup_email_taken", { targetEmail: email, ip });
    try { limit("signup-taken-mail:" + email, 3, 60 * MIN); sendMail(email, signupTakenMail({ base: appUrl(req), url: `${appUrl(req)}/reset`, lang: mailLang(req, lang) }), "signup_taken"); } catch { /* đủ thư rồi */ }
    return { pending: true as const };
  };
  if (reservedEmail(email) || findByEmail(email)) return taken();
  // Tạo tài khoản và hồ sơ trong cùng một transaction: lỗi giữa chừng không để lại tài khoản dở.
  let id: string;
  try {
    id = db().transaction(() => {
      const c = createUser({ email, name: email.split("@")[0], passwordHash: hash, verified: false });
      writeProfile(c.id, prof);
      return c.id;
    })();
  } catch (e) {
    // Hai yêu cầu đăng ký cùng email chạy song song: cái sau vướng ràng buộc UNIQUE.
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return taken();
    throw e;
  }
  const u = getUser(id)!;
  audit("signup", { actor: u, ip, detail: "password" });
  issueVerify(req, u, lang);
  return { pending: true as const };
}

// ---- xác minh email: mềm, không chặn đăng nhập hay chat ----
// Mã nằm sau dấu # của đường dẫn (không vào nhật ký máy chủ) và phải bấm nút trên trang /verify (trình quét liên kết của hộp thư không xác minh hộ được).
const VERIFY_TTL = 7 * DAY;
function issueVerify(req: Request, u: UserRow, lang?: unknown) {
  const token = crypto.randomBytes(32).toString("base64url"), base = appUrl(req);
  db().prepare("DELETE FROM email_verifications WHERE user_id = ?").run(u.id);
  db().prepare("INSERT INTO email_verifications (token_hash, user_id, email, expires_at) VALUES (?, ?, ?, ?)").run(sha256(token), u.id, u.email, Date.now() + VERIFY_TTL);
  audit("email_verify_sent", { target: u, ip: clientIp(req) });
  sendMail(u.email, verifyMail({ base, name: u.name, url: `${base}/verify#${token}`, days: VERIFY_TTL / DAY, lang: mailLang(req, lang) }), "verify");
}
export function resendVerify(req: Request, u: UserRow, lang?: unknown) {
  if (u.email_verified) return;
  limit("verify-mail:" + u.id, 5, 60 * MIN);
  issueVerify(req, u, lang);
}
const BAD_VERIFY = "Đường dẫn xác minh không hợp lệ hoặc đã hết hạn. Hãy đăng nhập rồi gửi lại thư xác minh.";
function verifyRow(req: Request, token: unknown) {
  limit("verify:" + clientIp(req), 30, 15 * MIN);
  const r = typeof token === "string" && token.length <= 100 ? db().prepare("SELECT * FROM email_verifications WHERE token_hash = ?").get(sha256(token)) as { user_id: string; email: string; expires_at: number } | undefined : undefined;
  const u = r && r.expires_at > Date.now() ? getUser(r.user_id) : undefined;
  if (!u || u.email !== r!.email || u.status !== "active") throw new AuthError(BAD_VERIFY, 400);
  return u;
}
/** already: email đã xác minh (người dùng mở lại thư cũ): nói đúng như vậy, không báo đường dẫn hết hạn rồi chỉ tới dải thông báo không còn nữa. */
export const checkVerifyLink = (req: Request, token: unknown) => ({ already: verifyRow(req, token).email_verified === 1 });
export function confirmVerify(req: Request, token: unknown) {
  const u = verifyRow(req, token);
  // Giữ dòng tới khi hết hạn để mở lại thư còn nhận ra. "Không phải tôi" đã tự chặn với tài khoản đã xác minh, xác nhận lần nữa không đổi gì.
  if (u.email_verified === 1) return u;
  db().prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(u.id);
  audit("email_verified", { actor: u, target: u, ip: clientIp(req) });
  return u;
}
/** "Không phải tôi đăng ký": chủ email (có đường dẫn trong thư) xóa tài khoản người khác lập bằng email của họ. Chỉ với tài khoản chưa xác minh, tạo sau khi có tính năng này. */
/** Tài khoản vừa bị xóa: các phần giữ trạng thái trong bộ nhớ theo người dùng (cầu nối sống của mcpbridge…) đăng ký dọn ở đây.
 *  Không import ngược các phần đó (chúng đã import authstore qua runs.ts). */
const goneHooks: Map<string, (uid: string) => void> = ((globalThis as { __synchroAccountGone?: Map<string, (uid: string) => void> }).__synchroAccountGone ??= new Map());
export const onAccountGone = (name: string, f: (uid: string) => void) => { goneHooks.set(name, f); };
export const accountGone = (uid: string) => { for (const f of goneHooks.values()) { try { f(uid); } catch { /* dọn bộ nhớ, không chặn việc xóa */ } } };
export function denyVerify(req: Request, token: unknown) {
  const u = verifyRow(req, token);
  if (!needsVerify(u)) throw new AuthError(BAD_VERIFY, 400);
  db().prepare("DELETE FROM users WHERE id = ?").run(u.id);
  accountGone(u.id);
  audit("email_denied", { target: u, ip: clientIp(req) });
  return u;
}

// ---- đăng nhập bằng Google / GitHub / Apple ----
export type OAuthProfile = { provider: string; subject: string; email: string | null; emailVerified: boolean; name: string; avatar: string | null };
export function oauthLogin(req: Request, p: OAuthProfile) {
  const ip = clientIp(req);
  let claimed: "" | "password" | "nopassword" = "", fresh = false, dropped = false;
  const ident = db().prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").get(p.provider, p.subject) as { user_id: string } | undefined;
  let u = ident ? getUser(ident.user_id) : undefined;
  if (!u) {
    if (!p.email || !p.emailVerified) throw new AuthError("Tài khoản này chưa có email đã xác minh, không thể dùng để đăng nhập.");
    const email = normEmail(p.email);
    u = findByEmail(email);
    if (u) {
      // Email của tài khoản cũ chưa từng được xác minh → mật khẩu có thể do người khác đặt trước.
      // Nhà cung cấp vừa xác minh chủ thật của email nên xóa mật khẩu và mọi phiên cũ; route báo cho người dùng biết (claimed), gỡ thiết bị đã ghép, tắt connector.
      if (!u.email_verified) {
        claimed = u.password_hash ? "password" : "nopassword";
        fresh = needsVerify(u);
        db().prepare("UPDATE users SET email_verified = 1, password_hash = NULL WHERE id = ?").run(u.id);
        db().prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
        dropped = dropSquatter(u.id);
      }
      audit("oauth_link", { actor: u, ip, detail: p.provider });
    } else {
      if (!signupOpen() && !reservedEmail(email)) throw new AuthError("Synchro hiện tạm ngừng nhận đăng ký mới.", 403);
      u = createUser({ email, name: p.name || email.split("@")[0], verified: true, avatar: p.avatar });
      audit("signup", { actor: u, ip, detail: p.provider });
    }
    db().prepare("INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)").run(p.provider, p.subject, u.id, email, Date.now());
    u = getUser(u.id)!;
  }
  if (u.status !== "active") { audit("login_blocked", { target: u, ip, detail: p.provider }); throw new AuthError("Tài khoản này đã bị khóa. Hãy liên hệ quản trị viên.", 403); }
  // Ảnh từ nhà cung cấp chỉ dùng khi chưa có ảnh. GitHub tự tạo ảnh hoa văn cho tài khoản chưa đặt ảnh,
  // nên ảnh Google (ảnh thật hoặc chữ cái đầu) được ưu tiên thay cho ảnh GitHub.
  const fromGithub = !!u.avatar?.includes("avatars.githubusercontent.com");
  if (p.avatar && (u.avatar === null || (p.provider === "google" && fromGithub))) db().prepare("UPDATE users SET avatar = ? WHERE id = ?").run(p.avatar, u.id);
  const s = signIn(u, req, p.provider);
  if (!s.mfa) audit("login", { actor: u, ip, detail: p.provider });
  return { user: u, claimed, fresh, dropped, ...s };
}

/** Thêm một cách đăng nhập vào tài khoản đang đăng nhập. Danh tính đã thuộc tài khoản khác thì từ chối: không gộp, không chuyển. */
export function connectIdentity(req: Request, u: UserRow, p: OAuthProfile) {
  const cur = db().prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").get(p.provider, p.subject) as { user_id: string } | undefined;
  if (cur?.user_id === u.id) return;
  if (cur) throw new AuthError("Tài khoản này đã gắn với một tài khoản Synchro khác.", 409);
  db().prepare("INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)").run(p.provider, p.subject, u.id, p.email ? normEmail(p.email) : "", Date.now());
  audit("oauth_link", { actor: u, ip: clientIp(req), detail: p.provider });
}
/** Gỡ một cách đăng nhập. Không gỡ được cách cuối cùng: tài khoản sẽ không vào lại được. */
export function disconnectIdentity(req: Request, u: UserRow, provider: unknown) {
  if (typeof provider !== "string") throw new AuthError("Thiếu cách đăng nhập.", 400);
  if (methodsOf(u).length <= 1) throw new AuthError("Đây là cách đăng nhập duy nhất của tài khoản. Hãy đặt mật khẩu hoặc thêm cách khác trước.", 400);
  if (!db().prepare("DELETE FROM identities WHERE user_id = ? AND provider = ?").run(u.id, provider).changes) throw new AuthError("Tài khoản chưa gắn với cách đăng nhập này.", 404);
  audit("oauth_unlink", { actor: u, ip: clientIp(req), detail: provider });
}

// ---- tài khoản của chính mình ----
/** Đổi mật khẩu thường là vì nghi bị lộ: đăng xuất mọi phiên khác, kẻ đang giữ phiên cũ không dùng tiếp được (phiên trượt tới 30 ngày). */
export async function changePassword(req: Request, u: UserRow, cur: unknown, next: unknown, keepSession: string) {
  limit("pw:" + u.id, 10, 15 * MIN);
  if (u.password_hash && !(typeof cur === "string" && (await verifyPassword(cur, u.password_hash)))) throw new AuthError("Mật khẩu hiện tại không đúng.", 401);
  const pw = checkPassword(next, u.email);
  db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(pw), u.id);
  const signedOut = db().prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(u.id, keepSession).changes;
  dropEmailChange(u.id);
  markReauth(keepSession); // phiên đang gọi vừa chứng minh danh tính bằng mật khẩu hiện tại (chỉ phiên này)
  audit("password_changed", { actor: u, ip: clientIp(req), detail: signedOut ? String(signedOut) : undefined });
  notifyChanged(req, u);
  return { signedOut };
}

// ---- quên mật khẩu: đường dẫn gửi qua email, hoặc do quản trị viên tạo khi người dùng mất cả hộp thư ----
// Mã nằm sau dấu # của đường dẫn: không vào nhật ký máy chủ.
const RESET_MIN = 60;
const mailLang = (req: Request, lang?: unknown): MailLang => (lang === "vi" || lang === "en" ? lang : /^vi\b/i.test(req.headers.get("accept-language") ?? "") ? "vi" : "en");
/** Không ném lỗi và không báo gì khác nhau khi email không có tài khoản: chỉ giới hạn theo IP là báo thật (ai cũng có thể chạm). */
export function requestPasswordReset(req: Request, email0: unknown, lang?: unknown) {
  const ip = clientIp(req);
  limit("forgot:" + ip, 10, 15 * MIN);
  let email = "";
  try { email = normEmail(email0); } catch { return; }
  const u = findByEmail(email);
  if (!u || u.status !== "active") return;
  // Mỗi tài khoản tối đa 3 thư mỗi giờ: không để biến Synchro thành công cụ gửi thư rác tới hộp thư của người khác.
  try { limit("forgot-mail:" + u.id, 3, 60 * MIN); } catch { return "limited" as const; }
  const token = crypto.randomBytes(32).toString("base64url");
  db().prepare("DELETE FROM password_resets WHERE user_id = ?").run(u.id);
  db().prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)").run(sha256(token), u.id, Date.now() + RESET_MIN * MIN, u.id);
  audit("password_reset_request", { target: u, ip });
  const base = appUrl(req);
  sendMail(u.email, resetMail({ base, name: u.name, url: `${base}/reset#${token}`, minutes: RESET_MIN, lang: mailLang(req, lang) }), "reset");
}
// ---- đổi email ----
const EMAIL_CHANGE_HOURS = 24;
const emailChanges = () => { const d = db(); d.exec("CREATE TABLE IF NOT EXISTS email_changes (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, new_email TEXT NOT NULL, expires_at INTEGER NOT NULL)"); return d; };
const BAD_EMAIL_CHANGE = "Đường dẫn đổi email không hợp lệ hoặc đã hết hạn. Hãy yêu cầu lại trong Cài đặt.";
/** Đường dẫn đổi email đang chờ chỉ có mật khẩu lúc xin làm bằng chứng: mật khẩu, chủ tài khoản hay trạng thái tài khoản đổi thì nó phải mất hiệu lực, không kẻ đã lấy được mật khẩu vẫn chiếm được tài khoản sau khi nạn nhân đặt lại mật khẩu. */
export const dropEmailChange = (uid: string) => { emailChanges().prepare("DELETE FROM email_changes WHERE user_id = ?").run(uid); };
/** Chủ thật của email vừa giành lại tài khoản chưa từng xác minh: mọi đường quay lại người đăng ký trước có thể đã gắn đều phải gỡ, không chủ thật bị đòi mã trong ứng dụng của kẻ khác, còn kẻ đó vẫn vào được bằng Google của họ. Trả về có gỡ gì không, để báo cho người dùng. */
function dropSquatter(uid: string) {
  dropEmailChange(uid);
  const had = mfaOn(uid), n = db().prepare("DELETE FROM identities WHERE user_id = ?").run(uid).changes;
  try { db().prepare("DELETE FROM user_mfa WHERE user_id = ?").run(uid); } catch { /* chưa có bảng */ }
  // Khóa truy cập người đăng ký trước có thể đã thêm (trước khi có cổng xác minh email ở passkeys.ts).
  let keys = 0;
  try { keys = db().prepare("DELETE FROM user_passkeys WHERE user_id = ?").run(uid).changes; } catch { /* chưa có bảng */ }
  return had || n > 0 || keys > 0;
}
/** Xin đổi email: cần mật khẩu, gửi đường dẫn xác nhận tới địa chỉ mới và báo cho địa chỉ cũ. Email đã có người dùng thì trả lời như thường, chỉ không gửi gì (không lộ email nào đã đăng ký). */
export async function requestEmailChange(req: Request, u: UserRow, password: unknown, email0: unknown, lang?: unknown) {
  limit("email-change:" + u.id, 5, 60 * MIN);
  // Quản trị viên được nhận diện bằng email: đổi là mất quyền, phải đổi ở cấu hình máy chủ.
  if (reservedEmail(u.email)) throw new AuthError("Email của quản trị viên được đặt trong cấu hình máy chủ.", 403);
  // Email chưa xác minh có thể là của người khác: người đăng ký trước không được giữ sẵn đường chuyển tài khoản sang hộp thư của họ.
  if (needsVerify(u)) throw new AuthError("Hãy xác minh email hiện tại trước khi đổi. Nếu gõ nhầm địa chỉ lúc đăng ký, hãy đăng ký lại bằng địa chỉ đúng.", 403);
  if (!u.password_hash) throw new AuthError("Tài khoản này chưa có mật khẩu. Hãy đặt mật khẩu trước rồi đổi email.", 400);
  if (!(typeof password === "string" && (await verifyPassword(password, u.password_hash)))) throw new AuthError("Mật khẩu hiện tại không đúng.", 401);
  const email = normEmail(email0);
  if (email === u.email.toLowerCase()) throw new AuthError("Đây đã là email của tài khoản.", 400);
  if (reservedEmail(email) || findByEmail(email)) return;
  const token = crypto.randomBytes(32).toString("base64url"), base = appUrl(req), l = mailLang(req, lang);
  const d = emailChanges();
  d.prepare("DELETE FROM email_changes WHERE user_id = ?").run(u.id);
  d.prepare("INSERT INTO email_changes (token_hash, user_id, new_email, expires_at) VALUES (?, ?, ?, ?)").run(sha256(token), u.id, email, Date.now() + EMAIL_CHANGE_HOURS * 60 * MIN);
  audit("email_change_request", { actor: u, ip: clientIp(req) });
  sendMail(email, emailChangeMail({ base, name: u.name, url: `${base}/verify?change=1#${token}`, hours: EMAIL_CHANGE_HOURS, lang: l }), "verify");
  sendMail(u.email, emailChangeNoticeMail({ base, name: u.name, to: email, lang: l }), "verify");
}
function emailChangeRow(req: Request, token: unknown) {
  limit("verify:" + clientIp(req), 30, 15 * MIN);
  const r = typeof token === "string" && token.length <= 100 ? emailChanges().prepare("SELECT * FROM email_changes WHERE token_hash = ?").get(sha256(token)) as { user_id: string; new_email: string; expires_at: number } | undefined : undefined;
  const u = r && r.expires_at > Date.now() ? getUser(r.user_id) : undefined;
  // needsVerify: dòng tạo từ trước khi có cổng ở requestEmailChange.
  if (!u || u.status !== "active" || needsVerify(u)) throw new AuthError(BAD_EMAIL_CHANGE, 400);
  return { u, email: r!.new_email };
}
export const checkEmailChange = (req: Request, token: unknown) => ({ email: emailChangeRow(req, token).email });
/** Bấm đường dẫn ở địa chỉ mới: có hộp thư nên email mới coi như đã xác minh. Đăng xuất mọi phiên, phòng người đổi không phải chủ tài khoản. */
export function confirmEmailChange(req: Request, token: unknown) {
  const { u, email } = emailChangeRow(req, token);
  // Trong lúc chờ có thể đã có người đăng ký bằng địa chỉ này.
  if (findByEmail(email)) throw new AuthError(BAD_EMAIL_CHANGE, 400);
  const d = emailChanges();
  d.prepare("UPDATE users SET email = ?, email_verified = 1 WHERE id = ?").run(email, u.id);
  d.prepare("DELETE FROM email_changes WHERE user_id = ?").run(u.id);
  d.prepare("DELETE FROM email_verifications WHERE user_id = ?").run(u.id);
  d.prepare("DELETE FROM password_resets WHERE user_id = ?").run(u.id);
  d.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
  audit("email_changed", { actor: u, target: u, ip: clientIp(req), detail: email });
  return email;
}
const notifyChanged = (req: Request, u: UserRow, lang?: unknown) => {
  const l = mailLang(req, lang);
  sendMail(u.email, changedMail({ base: appUrl(req), name: u.name, lang: l, when: `${new Date().toLocaleString(l === "vi" ? "vi-VN" : "en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })} (GMT+7)` }), "changed");
};
/** Tài khoản có khóa truy cập hoặc xác minh hai bước không (để trang đặt lại hỏi có muốn gỡ các cách đăng nhập cũ không). */
export const hasSecondFactors = (uid: string) => hasPasskeys(uid) || mfaOn(uid);
/** Đường dẫn còn dùng được không: trang đặt lại báo hết hạn ngay, trước khi người dùng gõ mật khẩu. Trả về có cách đăng nhập cũ (khóa / 2FA) để hỏi có gỡ không. */
export function checkResetLink(req: Request, token: unknown) {
  // Khóa riêng với lần đổi mật khẩu thật: nhiều người chung IP mở thư không làm hỏng lần đặt mật khẩu của nhau.
  limit("reset-check:" + clientIp(req), 60, 15 * MIN);
  const r = typeof token === "string" && token.length <= 100 ? db().prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(sha256(token)) as { user_id: string; expires_at: number; used_at: number | null } | undefined : undefined;
  if (!r || r.used_at || r.expires_at <= Date.now() || getUser(r.user_id)?.status !== "active") throw new AuthError(BAD_RESET, 400);
  return { factors: hasSecondFactors(r.user_id) };
}
const BAD_RESET = "Đường dẫn đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu đường dẫn mới.";
export function createResetLink(req: Request, admin: UserRow, t: UserRow) {
  const token = crypto.randomBytes(32).toString("base64url");
  db().prepare("DELETE FROM password_resets WHERE user_id = ?").run(t.id);
  db().prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)").run(sha256(token), t.id, Date.now() + DAY, admin.id);
  audit("admin_reset_link", { actor: admin, target: t, ip: clientIp(req) });
  return `${appUrl(req)}/reset#${token}`;
}
export async function redeemResetLink(req: Request, token: unknown, next: unknown, lang?: unknown, dropFactors = false) {
  const ip = clientIp(req);
  limit("reset:" + ip, 10, 15 * MIN);
  const bad = () => new AuthError(BAD_RESET, 400);
  if (typeof token !== "string" || token.length > 100) throw bad();
  const r = db().prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(sha256(token)) as { user_id: string; expires_at: number; used_at: number | null; created_by: string | null } | undefined;
  const u = r && !r.used_at && r.expires_at > Date.now() ? getUser(r.user_id) : undefined;
  if (!u || u.status !== "active") throw bad();
  const pw = checkPassword(next, u.email);
  const hash = await hashPassword(pw);
  // Đường dẫn gửi tới hộp thư là bằng chứng sở hữu email; đường dẫn quản trị viên tạo thì không. Không đánh dấu thì lần đăng nhập Google sau sẽ xóa mất mật khẩu vừa đặt.
  const proved = r!.created_by === u.id, fresh = proved && needsVerify(u), claim = proved && !u.email_verified;
  // Người dùng chọn gỡ các cách đăng nhập cũ (khóa truy cập, 2FA) khi đặt lại mật khẩu — ví dụ mất thiết bị giữ chúng.
  const wantDropFactors = dropFactors && hasSecondFactors(u.id);
  let dropped = false, droppedFactors = false;
  db().transaction(() => {
    db().prepare(`UPDATE users SET password_hash = ?${proved ? ", email_verified = 1" : ""} WHERE id = ?`).run(hash, u.id);
    db().prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ?").run(Date.now(), sha256(token));
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
    dropEmailChange(u.id);
    if (claim) dropped = dropSquatter(u.id);
    if (wantDropFactors) {
      try { db().prepare("DELETE FROM user_passkeys WHERE user_id = ?").run(u.id); } catch { /* chưa có bảng */ }
      try { db().prepare("DELETE FROM user_mfa WHERE user_id = ?").run(u.id); } catch { /* chưa có bảng */ }
      droppedFactors = true;
    }
    if (proved) db().prepare("DELETE FROM email_verifications WHERE user_id = ?").run(u.id);
  })();
  audit("password_reset", { actor: u, target: u, ip, detail: droppedFactors ? "drop_factors" : undefined });
  if (fresh) audit("account_claimed", { target: u, ip, detail: "reset" });
  notifyChanged(req, u, lang);
  return { user: u, fresh, dropped, droppedFactors };
}

export async function deleteOwnAccount(req: Request, u: UserRow, pw: unknown) {
  if (isAdmin(u)) throw new AuthError("Không thể tự xóa tài khoản quản trị viên.", 403);
  limit("del:" + u.id, 5, 15 * MIN);
  if (u.password_hash && !(typeof pw === "string" && (await verifyPassword(pw, u.password_hash)))) throw new AuthError("Mật khẩu không đúng.", 401);
  db().prepare("DELETE FROM users WHERE id = ?").run(u.id);
  accountGone(u.id);
  audit("account_deleted", { actor: u, target: u, ip: clientIp(req) });
}
