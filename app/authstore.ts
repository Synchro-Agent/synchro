// Tài khoản, mật khẩu, phiên đăng nhập, nhật ký (chỉ chạy ở server).
// Dữ liệu nằm trong data/synchro.db (SQLite); thư mục data/ không vào git và không bị rsync ghi đè khi deploy.
import { sendMail } from "./mailer";
import { DISK_FULL, diskLow } from "./diskfloor";
import { emailChangeMail, emailChangeNoticeMail, changedMail, resetMail, signupTakenMail, verifyMail, type MailLang } from "./mailtpl";
import Database from "better-sqlite3";
import { allowsModel, FULL_PERMS, normPerms, type Feature, type Perms } from "./catalog";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
export const COOKIE = "synchro_session";
const MIN = 60_000, DAY = 86_400_000;
export const SESSION_TTL = 30 * DAY;
export const PW_MIN = 8;
const PW_MAX = 200;
const MAX_SESSIONS = 20;
// Quản trị viên: email nằm trong danh sách này VÀ đã được xác minh (OAuth hoặc tạo bằng scripts/create-admin.mjs).
const emailList = (v: string) => v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const ADMIN_LIST = emailList(process.env.ADMIN_EMAILS ?? "nguyenhuulamtung@gmail.com");
export const ADMIN_EMAILS = new Set(ADMIN_LIST);
// Ba vai trò: Chủ sở hữu (Owner) · Quản trị viên (Admin) · Thành viên. Chủ sở hữu = email trong OWNER_EMAILS; chưa đặt thì là email đầu tiên
// của ADMIN_EMAILS (máy chủ đang chạy giữ nguyên người đứng đầu mà không cần cấu hình thêm). Chỉ chủ sở hữu đổi được khóa API / dịch vụ có
// bí mật, giá và hạn mức áp cho quản trị viên, thêm / bỏ quản trị viên và xóa vĩnh viễn dữ liệu; quản trị viên làm mọi việc quản trị còn lại.
// Quản trị viên thêm từ giao diện lưu ở cột users.role = 'admin'; quản trị viên trong ADMIN_EMAILS và chủ sở hữu đặt ở cấu hình máy chủ.
export const OWNER_EMAILS = new Set(process.env.OWNER_EMAILS?.trim() ? emailList(process.env.OWNER_EMAILS) : ADMIN_LIST.slice(0, 1));
/** Email dành cho tài khoản chủ sở hữu / quản trị viên trong cấu hình máy chủ (không đăng ký mới, không đổi sang được). */
export const reservedEmail = (email: string) => ADMIN_EMAILS.has(email.toLowerCase()) || OWNER_EMAILS.has(email.toLowerCase());
/** Ai nhận cảnh báo vận hành và báo cáo lạm dụng: chủ sở hữu và quản trị viên đặt ở cấu hình máy chủ (OWNER_EMAILS có thể không nằm trong ADMIN_EMAILS). */
export const ALERT_EMAILS = [...new Set([...OWNER_EMAILS, ...ADMIN_LIST])];

export class AuthError extends Error {
  /** extra: thêm vào JSON lỗi cho trang (vd. { captcha: true }: hiện ô kiểm tra Turnstile rồi gửi lại). */
  constructor(msg: string, public status = 400, public extra?: Record<string, unknown>) { super(msg); }
}

export type UserRow = {
  id: string; email: string; name: string; avatar: string | null; password_hash: string | null; email_verified: number;
  status: "active" | "suspended"; created_at: number; last_login_at: number | null; last_seen_at: number | null;
  full_name: string | null; nickname: string | null; birth_date: string | null; occupation: string | null; perms: string | null;
  /** Hướng dẫn cho Synchro (Cài đặt → Tài khoản): áp dụng cho mọi lượt chat và Synchro Code của người này. */
  instructions: string | null;
  /** 'admin': quản trị viên do chủ sở hữu thêm từ giao diện; null: theo cấu hình máy chủ (ADMIN_EMAILS / OWNER_EMAILS) hoặc thành viên. */
  role?: string | null;
};
export type SessionRow = { id: string; user_id: string; method: string; created_at: number; last_seen_at: number; expires_at: number; ip: string | null; user_agent: string | null };

const g = globalThis as unknown as { __synchroDb?: Database.Database };
export function db() {
  if (g.__synchroDb) return g.__synchroDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(path.join(DATA_DIR, "synchro.db"));
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.pragma("busy_timeout = 5000");
  d.exec(fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
  // Bảng tạo từ bản cũ chưa có các cột hồ sơ: thêm vào (CREATE IF NOT EXISTS không tự làm việc này).
  const cols = new Set((d.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name));
  for (const c of ["full_name", "nickname", "birth_date", "occupation", "perms", "instructions", "role"]) if (!cols.has(c)) d.exec(`ALTER TABLE users ADD COLUMN ${c} TEXT`);
  const sk = new Set((d.prepare("PRAGMA table_info(skills)").all() as { name: string }[]).map((c) => c.name));
  if (!sk.has("use_count")) d.exec("ALTER TABLE skills ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0");
  if (!sk.has("last_used_at")) d.exec("ALTER TABLE skills ADD COLUMN last_used_at INTEGER");
  // Link repo đã dùng để thêm skill (khóa so trùng của plugins.linkKey): không cho thêm lại cùng một link.
  if (!sk.has("source")) d.exec("ALTER TABLE skills ADD COLUMN source TEXT");
  // Mốc bật xác minh email: tài khoản tạo trước mốc này giữ nguyên quyền như cũ, không phải làm gì thêm.
  d.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('verify_since', ?)").run(String(Date.now()));
  healAdminEmails(d);
  return (g.__synchroDb = d);
}
/** Bản cũ đánh dấu chưa xác minh khi quản trị viên đổi email hộ, nên tài khoản lâu năm bị coi như vừa đăng ký. Sửa một lần: chỉ đúng tài khoản còn giữ địa chỉ quản trị viên đã đặt. */
export function healAdminEmails(d: Database.Database) {
  if (d.prepare("SELECT 1 FROM settings WHERE key = 'admin_email_healed'").get()) return;
  d.prepare("UPDATE users SET email_verified = 1 WHERE email_verified = 0 AND EXISTS (SELECT 1 FROM audit a WHERE a.action = 'admin_set_email' AND a.target_id = users.id AND lower(a.detail) = lower(users.email))").run();
  d.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_email_healed', ?)").run(String(Date.now()));
}

// ---- mật khẩu: scrypt, muối ngẫu nhiên, so sánh thời gian hằng ----
const SCRYPT = { N: 16384, r: 8, p: 1 };
const scrypt = (pw: string, salt: Buffer, len: number, o: crypto.ScryptOptions) =>
  new Promise<Buffer>((ok, no) => crypto.scrypt(pw.normalize("NFKC"), salt, len, o, (e, k) => (e ? no(e) : ok(k))));
const DUMMY = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(64).toString("base64")}`;

export async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const k = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${k.toString("base64")}`;
}

// Luôn chạy scrypt kể cả khi không có tài khoản để không lộ qua thời gian phản hồi.
async function verifyPassword(pw: string, stored: string | null) {
  const [, n, r, p, salt, hash] = (stored ?? DUMMY).split("$");
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length, { N: +n, r: +r, p: +p });
  return !!stored && crypto.timingSafeEqual(got, want);
}

const COMMON = new Set(["12345678", "123456789", "1234567890", "password", "password1", "qwertyui", "qwerty123", "11111111", "abc12345", "iloveyou", "00000000", "88888888"]);
export function checkPassword(pw: unknown, email = "") {
  if (typeof pw !== "string" || pw.length < PW_MIN) throw new AuthError(`Mật khẩu cần ít nhất ${PW_MIN} ký tự.`);
  if (pw.length > PW_MAX) throw new AuthError("Mật khẩu quá dài.");
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw) || pw.toLowerCase() === email.toLowerCase()) throw new AuthError("Mật khẩu này quá dễ đoán. Hãy chọn mật khẩu khác.");
  return pw;
}

export function normEmail(e: unknown) {
  const s = typeof e === "string" ? e.trim().toLowerCase() : "";
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new AuthError("Email không hợp lệ.");
  return s;
}

// ---- request ----
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const clientIp = (req: Request) => ((req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "local").slice(0, 64);
const host = (req: Request) => req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
const isHttps = (req: Request) => (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
export const appUrl = (req: Request) => (process.env.APP_URL ?? `${isHttps(req) ? "https" : "http"}://${host(req)}`).replace(/\/$/, "");

// Mọi request thay đổi dữ liệu phải đến từ chính trang Synchro (chặn CSRF).
export function sameOrigin(req: Request) {
  const o = req.headers.get("origin");
  try { if (o && new URL(o).host === host(req)) return; } catch {}
  throw new AuthError("Yêu cầu không hợp lệ.", 403);
}

export function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export function cookie(req: Request, name: string, value: string, maxAge: number, o: { sameSite?: "Lax" | "None"; path?: string } = {}) {
  const ss = o.sameSite ?? "Lax";
  return `${name}=${encodeURIComponent(value)}; Path=${o.path ?? "/"}; HttpOnly; SameSite=${ss}; Max-Age=${maxAge}${isHttps(req) || ss === "None" ? "; Secure" : ""}`;
}

// ---- giới hạn tần suất (bộ nhớ trong; app chạy một tiến trình) ----
const hits = new Map<string, { n: number; t: number }>();
// Môi trường kiểm thử (npm run dev:mock, CI) chạy hàng trăm lượt đăng nhập, đăng ký, tạo connector liên tục từ một địa chỉ:
// nới giới hạn 50 lần. Chỉ dev-mock đặt biến này; bản chạy thật không đặt nên giới hạn giữ nguyên.
const RELAX = process.env.SYNCHRO_RELAX_LIMITS === "1" ? 50 : 1;
export function limit(key: string, max: number, windowMs: number) {
  max *= RELAX;
  const now = Date.now();
  if (hits.size > 20_000) for (const [k, v] of hits) if (v.t < now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.t < now) { hits.set(key, { n: 1, t: now + windowMs }); return; }
  if (++h.n > max) throw new AuthError("Bạn đã thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.", 429);
}

// ---- cài đặt + nhật ký ----
export const getSetting = (k: string, d: string) => (db().prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value ?? d;
export const setSetting = (k: string, v: string) => db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
export const signupOpen = () => getSetting("signup_open", "1") === "1";

let auditN = 0;
export function audit(action: string, o: { actor?: UserRow | null; target?: UserRow | null; targetEmail?: string; ip?: string; detail?: string } = {}) {
  db().prepare("INSERT INTO audit (at, action, actor_id, actor_email, target_id, target_email, ip, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(Date.now(), action, o.actor?.id ?? null, o.actor?.email ?? null, o.target?.id ?? null, o.target?.email ?? o.targetEmail ?? null, o.ip ?? null, o.detail ?? null);
  if (++auditN % 200 === 0) db().prepare("DELETE FROM audit WHERE id <= (SELECT MAX(id) FROM audit) - 50000").run();
}

// ---- người dùng ----
export const getUser = (id: string) => db().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
export const findByEmail = (email: string) => db().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
// Khóa truy cập (passkeys.ts) cũng là một cách đăng nhập: gỡ Google khi chỉ còn khóa vẫn vào lại được. Bảng tạo khi dùng lần đầu.
const hasPasskeys = (uid: string) => { try { return !!db().prepare("SELECT 1 FROM user_passkeys WHERE user_id = ? LIMIT 1").get(uid); } catch { return false; } };
const methodsOf = (u: UserRow) => [...(u.password_hash ? ["password"] : []), ...(db().prepare("SELECT provider FROM identities WHERE user_id = ? ORDER BY created_at").all(u.id) as { provider: string }[]).map((r) => r.provider), ...(hasPasskeys(u.id) ? ["passkey"] : [])];
const inGoodStanding = (u: UserRow) => u.email_verified === 1 && u.status === "active";
export type Role = "owner" | "admin" | "member";
export const isOwner = (u: UserRow) => OWNER_EMAILS.has(u.email.toLowerCase()) && inGoodStanding(u);
export const isAdmin = (u: UserRow) => (reservedEmail(u.email) || u.role === "admin") && inGoodStanding(u);
export const roleOf = (u: UserRow): Role => (isOwner(u) ? "owner" : isAdmin(u) ? "admin" : "member");
/** Tài khoản mang vai trò quản trị (gồm chủ sở hữu), kể cả khi đang bị khóa hoặc chưa xác minh: quyền chỉ chủ sở hữu xét theo cái này,
 *  để quản trị viên khác không đặt sẵn điều gì lên tài khoản quản trị đang bị khóa chờ chủ sở hữu mở lại. */
export const adminRole = (u: UserRow) => reservedEmail(u.email) || u.role === "admin";
/** Vai trò ghi trên tài khoản (danh sách người dùng của quản trị viên), kể cả khi tài khoản đang bị khóa hoặc chưa xác minh. */
const roleLabel = (u: UserRow): Role => (OWNER_EMAILS.has(u.email.toLowerCase()) ? "owner" : reservedEmail(u.email) || u.role === "admin" ? "admin" : "member");
export const OWNER_ONLY = "Chỉ chủ sở hữu (Owner) mới có quyền này.";
/** Việc chỉ chủ sở hữu được làm: quản trị viên nhận 403. */
export function ownerOnly(u: UserRow) { if (!isOwner(u)) throw new AuthError(OWNER_ONLY, 403); }

export function createUser(o: { email: string; name: string; passwordHash?: string | null; verified: boolean; avatar?: string | null }) {
  const id = crypto.randomUUID();
  db().prepare("INSERT INTO users (id, email, name, avatar, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, o.email, o.name.slice(0, 100), o.avatar ?? null, o.passwordHash ?? null, o.verified ? 1 : 0, Date.now());
  return getUser(id)!;
}

// Ảnh tự tải lên lưu dạng data URL (có thể hàng trăm KB): /api/auth/me và danh sách quản trị chỉ trả đường dẫn kèm mã phiên bản, trình duyệt nhớ lâu theo mã đó.
const avatarUrl = (u: UserRow) => (u.avatar?.startsWith("data:") ? `/api/auth/avatar?u=${encodeURIComponent(u.id)}&v=${crypto.createHash("sha1").update(u.avatar).digest("base64url").slice(0, 12)}` : u.avatar || null);
export function publicUser(u: UserRow) {
  return {
    id: u.id, email: u.email, name: u.name, avatar: avatarUrl(u), isAdmin: isAdmin(u), role: roleOf(u), hasPassword: !!u.password_hash, methods: methodsOf(u), createdAt: u.created_at,
    verifyPending: needsVerify(u), verifyLocked: verifyLocked(u),
    profile: { fullName: u.full_name, nickname: u.nickname, birthDate: u.birth_date, occupation: u.occupation, instructions: u.instructions ?? "" },
    needsProfile: !u.full_name || !u.birth_date,
    perms: permsOf(u),
  };
}

// ---- quyền dùng model / tính năng ----
// Mặc định áp cho mọi người; quản trị có thể đặt quyền riêng cho từng tài khoản. Quản trị viên luôn có toàn quyền.
export const defaultPerms = (): Perms => { try { return normPerms(JSON.parse(getSetting("default_perms", "null"))); } catch { return FULL_PERMS; } };
/** Quyền quản trị viên đã đặt, chưa tính khóa tạm vì chưa xác minh email (màn hình sửa quyền dùng cái này, không thì lưu nhầm khóa tạm thành quyền thật). */
export function basePerms(u: UserRow): Perms {
  if (isAdmin(u)) return FULL_PERMS;
  const d = defaultPerms();
  if (!u.perms) return d;
  try { return normPerms(JSON.parse(u.perms), d); } catch { return d; }
}
// Tài khoản mới chưa xác minh email chưa dùng được phần tốn tài nguyên hoặc gắn được thứ sống lâu vào tài khoản: chat vẫn dùng bình thường.
// Chặn người đăng ký trước bằng email của người khác rồi cài sẵn connector, tác vụ; và chặn lấp đầy đĩa bằng tài khoản ảo.
const VERIFY_GATED: Feature[] = ["files", "connectors", "speech", "sandbox", "code", "chrome"];
export function permsOf(u: UserRow): Perms {
  const p = basePerms(u);
  if (!verifyLocked(u)) return p;
  const features = { ...p.features };
  for (const f of VERIFY_GATED) features[f] = false;
  return { ...p, features };
}
export const can = (u: UserRow, f: Feature) => permsOf(u).features[f];
// Quyền dùng một model đi theo bản thay thế của nó (sổ model, app/modelreg.ts: model đã cũ hoặc bị hãng gỡ nhường chỗ cho bản mới nhất cùng dòng),
// để người chỉ được dùng một model vẫn chat được khi hãng ra bản mới. Sổ model tự đăng ký hàm này khi nạp (không nhập vòng hai module).
const viaReplacement = (allowed: string[], model: string) => ((globalThis as { __synchroModelAllow?: (a: string[], k: string) => boolean }).__synchroModelAllow?.(allowed, model) ?? false);
export const canModel = (u: UserRow, model: string) => { const m = permsOf(u).models; return allowsModel(m, model) || viaReplacement(m, model); };

// Cổng cho API nội bộ: phải đăng nhập và được quản trị cho phép dùng tính năng này.
export function featureGate(req: Request, f: Feature) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  if (!can(c.user, f)) return verifyLocked(c.user) ? Response.json({ error: VERIFY_FIRST, verify: true }, { status: 403 }) : Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng tính năng này." }, { status: 403 });
  return null;
}

// ---- hồ sơ cá nhân ----
type ProfileIn = { fullName?: unknown; nickname?: unknown; birthDate?: unknown; occupation?: unknown; avatar?: unknown; instructions?: unknown };
type ProfileCols = Partial<Pick<UserRow, "full_name" | "nickname" | "birth_date" | "occupation" | "avatar" | "instructions">>;
const oneLine = (v: unknown) => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : "");

// Kiểm tra các trường được gửi lên; trường không gửi thì bỏ qua (cho phép cập nhật từng phần).
export function cleanProfile(p: ProfileIn): ProfileCols {
  const out: ProfileCols = {};
  if (p.fullName !== undefined) {
    const v = oneLine(p.fullName);
    if (v.length < 2 || v.length > 80) throw new AuthError("Họ và tên cần từ 2 đến 80 ký tự.");
    out.full_name = v;
  }
  if (p.nickname !== undefined) {
    const v = oneLine(p.nickname);
    if (v.length > 40) throw new AuthError("Tên gọi tối đa 40 ký tự.");
    out.nickname = v || null;
  }
  if (p.birthDate !== undefined) {
    const v = oneLine(p.birthDate);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!m || !d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new AuthError("Ngày sinh không hợp lệ.");
    const now = new Date();
    let age = now.getUTCFullYear() - d.getUTCFullYear();
    if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age--;
    if (age < 13) throw new AuthError("Bạn cần từ 13 tuổi trở lên để dùng Synchro.");
    if (age > 120) throw new AuthError("Ngày sinh không hợp lệ.");
    out.birth_date = v;
  }
  if (p.occupation !== undefined) {
    const v = oneLine(p.occupation);
    if (v.length > 60) throw new AuthError("Công việc tối đa 60 ký tự.");
    out.occupation = v || null;
  }
  // Hướng dẫn cho Synchro: giữ nguyên xuống dòng; chuỗi rỗng = xóa.
  if (p.instructions !== undefined) {
    const v = typeof p.instructions === "string" ? p.instructions.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim() : "";
    if (v.length > 20000) throw new AuthError("Phần giới thiệu và hướng dẫn cho Synchro tối đa 20.000 ký tự.");
    out.instructions = v || null;
  }
  // Ảnh đại diện tự tải lên: ảnh nhỏ đã cắt ở trình duyệt, lưu dạng data URL. Chuỗi rỗng = xóa ảnh.
  if (p.avatar !== undefined) {
    const v = typeof p.avatar === "string" ? p.avatar : "";
    if (v && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > 400_000)) throw new AuthError("Ảnh đại diện không hợp lệ hoặc quá lớn.");
    out.avatar = v; // "" = đã chủ động xóa ảnh: đăng nhập Google/GitHub sau này không tự gắn lại
  }
  return out;
}

function writeProfile(id: string, c: ProfileCols) {
  const keys = Object.keys(c) as (keyof ProfileCols)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`);
  const vals: unknown[] = keys.map((k) => c[k]);
  // name là tên hiển thị trong quản trị: theo họ tên khi có.
  if (c.full_name) { sets.push("name = ?"); vals.push(c.full_name); }
  db().prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

/** Synchro tự viết lại "Hướng dẫn cho Synchro" từ những gì bộ não học được (brain.ts); cùng giới hạn độ dài với bản người dùng tự viết. */
export function setInstructions(uid: string, text: string) {
  const c = cleanProfile({ instructions: text });
  writeProfile(uid, c);
}

/** Xóa bộ não (brain.ts): quên tên gọi và phần tự giới thiệu / hướng dẫn; giữ đúng những gì có lúc tạo tài khoản (họ tên, lĩnh vực). */
export function forgetProfile(uid: string) {
  writeProfile(uid, { nickname: null, instructions: null });
}

export function updateProfile(req: Request, u: UserRow, p: ProfileIn) {
  limit("profile:" + u.id, 30, 15 * MIN);
  const c = cleanProfile(p);
  writeProfile(u.id, c);
  if (Object.keys(c).length) audit("profile_updated", { actor: u, ip: clientIp(req) });
  return getUser(u.id)!;
}
export type PublicUser = ReturnType<typeof publicUser>;

// ---- phiên ----
// ---- xác minh hai bước: mật khẩu hoặc Google đúng rồi mà tài khoản đã bật thì chưa tạo phiên, chỉ cấp vé 10 phút để nhập mã (mfa.ts). Vé ở bộ nhớ: khởi động lại thì đăng nhập lại. ----
const MFA_COOKIE = "synchro_mfa";
const mfaTickets = ((globalThis as { __synchroMfaTickets?: Map<string, { uid: string; method: string; exp: number }> }).__synchroMfaTickets ??= new Map());
const mfaOn = (uid: string) => { try { return !!db().prepare("SELECT 1 FROM user_mfa WHERE user_id = ? AND enabled_at IS NOT NULL").get(uid); } catch { return false; } };
/** Tạo phiên, hoặc vé bước hai nếu tài khoản đã bật. */
function signIn(u: UserRow, req: Request, method: string): { cookie: string; mfa: boolean } {
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
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db().prepare("INSERT INTO sessions (id, user_id, method, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(sha256(token), u.id, method, now, now, now + SESSION_TTL, clientIp(req), (req.headers.get("user-agent") ?? "").slice(0, 300));
  db().prepare("UPDATE users SET last_login_at = ?, last_seen_at = ? WHERE id = ?").run(now, now, u.id);
  db().prepare("DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT ?)").run(u.id, u.id, MAX_SESSIONS);
  return cookie(req, COOKIE, token, SESSION_TTL / 1000);
}
export const clearSessionCookie = (req: Request) => cookie(req, COOKIE, "", 0);

export function current(req: Request): { user: UserRow; session: SessionRow } | null {
  const t = readCookie(req, COOKIE);
  if (!t || t.length > 100) return null;
  const s = db().prepare("SELECT * FROM sessions WHERE id = ?").get(sha256(t)) as SessionRow | undefined;
  if (!s) return null;
  const now = Date.now();
  if (s.expires_at < now) { db().prepare("DELETE FROM sessions WHERE id = ?").run(s.id); return null; }
  const user = getUser(s.user_id);
  if (!user || user.status !== "active") return null;
  // gia hạn trượt, ghi tối đa 10 phút một lần
  if (now - s.last_seen_at > 10 * MIN) {
    db().prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(now, now + SESSION_TTL, s.id);
    db().prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now, user.id);
  }
  return { user, session: s };
}
/** Tài khoản của một phiên còn hiệu lực, khi không có cookie phiên trong yêu cầu (oauth.ts: Apple gửi kết quả bằng POST từ trang khác). */
export function sessionUser(sid: string) {
  const s = db().prepare("SELECT * FROM sessions WHERE id = ?").get(sid) as SessionRow | undefined;
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
export const sessionsOf = (userId: string) => db().prepare("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC").all(userId, Date.now()) as SessionRow[];

// ---- đăng ký / đăng nhập bằng email ----
/** Tab mở từ bản cũ còn gọi bước kiểm tra email: không còn cho biết email có tài khoản hay không, bản cũ đi tiếp sang ô mật khẩu. */
export function lookup(req: Request, email: string) {
  limit("check:" + clientIp(req), 30, 10 * MIN);
  normEmail(email);
  return { exists: true, hasPassword: true, methods: [] as string[], reserved: false };
}

export async function login(req: Request, email0: unknown, pw: unknown) {
  const ip = clientIp(req);
  const email = normEmail(email0);
  limit("login-ip:" + ip, 30, 15 * MIN);
  // Theo email + IP: người lạ thử sai liên tục không khóa được chủ tài khoản (ở IP khác); mức theo email lớn hơn nhiều để chặn dò từ nhiều IP.
  limit(`login-em:${email}:${ip}`, 10, 15 * MIN);
  limit("login-em:" + email, 100, 15 * MIN);
  const u = findByEmail(email);
  const ok = typeof pw === "string" && pw.length <= PW_MAX && (await verifyPassword(pw, u?.password_hash ?? null));
  if (!u || !ok) { audit("login_failed", { target: u, targetEmail: email, ip }); throw new AuthError("Email hoặc mật khẩu không đúng. Nếu bạn đăng ký bằng Google, GitHub hoặc Apple, hãy dùng nút đó.", 401); }
  if (u.status !== "active") { audit("login_blocked", { target: u, ip }); throw new AuthError("Tài khoản này đã bị khóa. Hãy liên hệ quản trị viên.", 403); }
  const s = signIn(u, req, "password");
  // Chưa xong bước hai thì chưa phải đăng nhập: /api/auth/mfa ghi nhật ký khi xong.
  if (!s.mfa) audit("login", { actor: u, ip, detail: "password" });
  return { user: u, ...s };
}

/** pending: email này không tạo mới được (đã có tài khoản hoặc được dành riêng). Không báo trùng: chủ email nhận thư hướng dẫn, người khác không biết thêm gì. */
export async function signup(req: Request, email0: unknown, pw0: unknown, profile: ProfileIn = {}, lang?: unknown): Promise<{ pending: true; user?: undefined; cookie?: undefined } | { pending?: false; user: UserRow; cookie: string }> {
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
    // Dò email qua đăng ký vẫn có dấu hiệu (không có phiên đăng nhập) nên giới hạn chặt theo IP, và mỗi lần dò chủ email đều nhận thư.
    limit("signup-taken:" + ip, 3, 60 * MIN);
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
  return { user: u, cookie: createSession(u, req, "password") };
}

// ---- xác minh email: mềm, không chặn đăng nhập hay chat ----
// Mã nằm sau dấu # của đường dẫn (không vào nhật ký máy chủ) và phải bấm nút trên trang /verify (trình quét liên kết của hộp thư không xác minh hộ được).
const VERIFY_TTL = 7 * DAY;
/** Mọi đường ghi dữ liệu người dùng vào cơ sở dữ liệu đều qua đây: đĩa đầy thì SQLite ngừng ghi và cả trang hỏng cho mọi người. Đọc và xóa không bị chặn. */
export const needDisk = () => { if (diskLow(DATA_DIR)) throw new AuthError(DISK_FULL, 507); };
export const VERIFY_FIRST = "Hãy xác minh email để dùng tính năng này. Mở thư Synchro đã gửi, hoặc gửi lại từ dải thông báo trên cùng.";
const verifySince = () => Number(getSetting("verify_since", "0")) || Infinity;
export const verifyGateOn = () => getSetting("verify_gate", process.env.SYNCHRO_VERIFY_GATE_DEFAULT === "0" ? "0" : "1") === "1";
export const setVerifyGate = (on: boolean) => setSetting("verify_gate", on ? "1" : "0");
/** Tài khoản đăng ký bằng mật khẩu sau khi có tính năng này và chưa bấm xác minh. Tài khoản cũ, tài khoản Google / GitHub / Apple không bị ảnh hưởng. */
export const needsVerify = (u: UserRow) => !u.email_verified && u.created_at >= verifySince();
/** Quản trị viên có thể tắt khóa này (Cài đặt → Quản trị viên), ví dụ khi thư đang không gửi được. */
export const verifyLocked = (u: UserRow) => needsVerify(u) && verifyGateOn();
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
export function denyVerify(req: Request, token: unknown) {
  const u = verifyRow(req, token);
  if (!needsVerify(u)) throw new AuthError(BAD_VERIFY, 400);
  db().prepare("DELETE FROM users WHERE id = ?").run(u.id);
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
/** Đường dẫn còn dùng được không: trang đặt lại báo hết hạn ngay, trước khi người dùng gõ mật khẩu. */
export function checkResetLink(req: Request, token: unknown) {
  // Khóa riêng với lần đổi mật khẩu thật: nhiều người chung IP mở thư không làm hỏng lần đặt mật khẩu của nhau.
  limit("reset-check:" + clientIp(req), 60, 15 * MIN);
  const r = typeof token === "string" && token.length <= 100 ? db().prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(sha256(token)) as { user_id: string; expires_at: number; used_at: number | null } | undefined : undefined;
  if (!r || r.used_at || r.expires_at <= Date.now() || getUser(r.user_id)?.status !== "active") throw new AuthError(BAD_RESET, 400);
}
const BAD_RESET = "Đường dẫn đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu đường dẫn mới.";
export function createResetLink(req: Request, admin: UserRow, t: UserRow) {
  const token = crypto.randomBytes(32).toString("base64url");
  db().prepare("DELETE FROM password_resets WHERE user_id = ?").run(t.id);
  db().prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)").run(sha256(token), t.id, Date.now() + DAY, admin.id);
  audit("admin_reset_link", { actor: admin, target: t, ip: clientIp(req) });
  return `${appUrl(req)}/reset#${token}`;
}
export async function redeemResetLink(req: Request, token: unknown, next: unknown, lang?: unknown) {
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
  let dropped = false;
  db().transaction(() => {
    db().prepare(`UPDATE users SET password_hash = ?${proved ? ", email_verified = 1" : ""} WHERE id = ?`).run(hash, u.id);
    db().prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ?").run(Date.now(), sha256(token));
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
    dropEmailChange(u.id);
    if (claim) dropped = dropSquatter(u.id);
    if (proved) db().prepare("DELETE FROM email_verifications WHERE user_id = ?").run(u.id);
  })();
  audit("password_reset", { actor: u, target: u, ip });
  if (fresh) audit("account_claimed", { target: u, ip, detail: "reset" });
  notifyChanged(req, u, lang);
  return { user: u, fresh, dropped };
}

export async function deleteOwnAccount(req: Request, u: UserRow, pw: unknown) {
  if (isAdmin(u)) throw new AuthError("Không thể tự xóa tài khoản quản trị viên.", 403);
  limit("del:" + u.id, 5, 15 * MIN);
  if (u.password_hash && !(typeof pw === "string" && (await verifyPassword(pw, u.password_hash)))) throw new AuthError("Mật khẩu không đúng.", 401);
  db().prepare("DELETE FROM users WHERE id = ?").run(u.id);
  audit("account_deleted", { actor: u, target: u, ip: clientIp(req) });
}

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
  audit("admin_delete", { actor: admin, target: t, ip: clientIp(req) });
}

export function adminRevokeSession(req: Request, admin: UserRow, sid: string) {
  const s = db().prepare("SELECT * FROM sessions WHERE id = ?").get(sid) as SessionRow | undefined;
  if (!s) return;
  const t = s.user_id === admin.id ? admin : target(admin, s.user_id);
  db().prepare("DELETE FROM sessions WHERE id = ?").run(sid);
  audit("admin_revoke_session", { actor: admin, target: t, ip: clientIp(req) });
}

// Bọc route handler: AuthError → JSON lỗi; lỗi khác → 500 và ghi log.
export function handle<A extends unknown[]>(fn: (req: Request, ...a: A) => Promise<Response> | Response) {
  return async (req: Request, ...a: A) => {
    try { return await fn(req, ...a); } catch (e) {
      if (e instanceof AuthError) return Response.json({ error: e.message, ...e.extra }, { status: e.status });
      console.error("[auth]", e);
      return Response.json({ error: "Lỗi máy chủ. Vui lòng thử lại." }, { status: 500 });
    }
  };
}
export const withCookies = (res: Response, ...cookies: string[]) => { cookies.forEach((c) => res.headers.append("Set-Cookie", c)); return res; };

// Chặn API nội bộ (LLM, skills, file…) với người chưa đăng nhập.
export const authGate = (req: Request) => (current(req) ? null : Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 }));
