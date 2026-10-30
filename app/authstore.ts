// Tài khoản, mật khẩu, phiên đăng nhập, nhật ký (chỉ chạy ở server).
// Dữ liệu nằm trong data/synchro.db (SQLite); thư mục data/ không vào git và không bị rsync ghi đè khi deploy.
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
export const ADMIN_EMAILS = new Set((process.env.ADMIN_EMAILS ?? "nguyenhuulamtung@gmail.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

export class AuthError extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

export type UserRow = {
  id: string; email: string; name: string; avatar: string | null; password_hash: string | null; email_verified: number;
  status: "active" | "suspended"; created_at: number; last_login_at: number | null; last_seen_at: number | null;
  full_name: string | null; nickname: string | null; birth_date: string | null; occupation: string | null; perms: string | null;
  /** Hướng dẫn cho Synchro (Cài đặt → Tài khoản): áp dụng cho mọi lượt chat và Synchro Code của người này. */
  instructions: string | null;
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
  for (const c of ["full_name", "nickname", "birth_date", "occupation", "perms", "instructions"]) if (!cols.has(c)) d.exec(`ALTER TABLE users ADD COLUMN ${c} TEXT`);
  const sk = new Set((d.prepare("PRAGMA table_info(skills)").all() as { name: string }[]).map((c) => c.name));
  if (!sk.has("use_count")) d.exec("ALTER TABLE skills ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0");
  if (!sk.has("last_used_at")) d.exec("ALTER TABLE skills ADD COLUMN last_used_at INTEGER");
  return (g.__synchroDb = d);
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
const methodsOf = (u: UserRow) => [...(u.password_hash ? ["password"] : []), ...(db().prepare("SELECT provider FROM identities WHERE user_id = ? ORDER BY created_at").all(u.id) as { provider: string }[]).map((r) => r.provider)];
export const isAdmin = (u: UserRow) => ADMIN_EMAILS.has(u.email.toLowerCase()) && u.email_verified === 1 && u.status === "active";

export function createUser(o: { email: string; name: string; passwordHash?: string | null; verified: boolean; avatar?: string | null }) {
  const id = crypto.randomUUID();
  db().prepare("INSERT INTO users (id, email, name, avatar, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, o.email, o.name.slice(0, 100), o.avatar ?? null, o.passwordHash ?? null, o.verified ? 1 : 0, Date.now());
  return getUser(id)!;
}

export function publicUser(u: UserRow) {
  return {
    id: u.id, email: u.email, name: u.name, avatar: u.avatar || null, isAdmin: isAdmin(u), hasPassword: !!u.password_hash, methods: methodsOf(u), createdAt: u.created_at,
    profile: { fullName: u.full_name, nickname: u.nickname, birthDate: u.birth_date, occupation: u.occupation, instructions: u.instructions ?? "" },
    needsProfile: !u.full_name || !u.birth_date,
    perms: permsOf(u),
  };
}

// ---- quyền dùng model / tính năng ----
// Mặc định áp cho mọi người; quản trị có thể đặt quyền riêng cho từng tài khoản. Quản trị viên luôn có toàn quyền.
export const defaultPerms = (): Perms => { try { return normPerms(JSON.parse(getSetting("default_perms", "null"))); } catch { return FULL_PERMS; } };
export function permsOf(u: UserRow): Perms {
  if (isAdmin(u)) return FULL_PERMS;
  const d = defaultPerms();
  if (!u.perms) return d;
  try { return normPerms(JSON.parse(u.perms), d); } catch { return d; }
}
export const can = (u: UserRow, f: Feature) => permsOf(u).features[f];
export const canModel = (u: UserRow, model: string) => allowsModel(permsOf(u).models, model);

// Cổng cho API nội bộ: phải đăng nhập và được quản trị cho phép dùng tính năng này.
export function featureGate(req: Request, f: Feature) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  if (!can(c.user, f)) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng tính năng này." }, { status: 403 });
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

export function device(ua: string | null) {
  const s = ua ?? "";
  const b = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "macOS" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "";
  return os ? `${b} · ${os}` : b;
}
export const publicSession = (s: SessionRow, cur?: string) => ({ id: s.id, current: s.id === cur, method: s.method, device: device(s.user_agent), ip: s.ip, createdAt: s.created_at, lastSeen: s.last_seen_at });
export const sessionsOf = (userId: string) => db().prepare("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC").all(userId, Date.now()) as SessionRow[];

// ---- đăng ký / đăng nhập bằng email ----
export function lookup(req: Request, email: string) {
  limit("check:" + clientIp(req), 60, 10 * MIN);
  const em = normEmail(email);
  const u = findByEmail(em);
  return { exists: !!u, hasPassword: !!u?.password_hash, methods: u ? methodsOf(u).filter((m) => m !== "password") : [], reserved: !u && ADMIN_EMAILS.has(em) };
}

export async function login(req: Request, email0: unknown, pw: unknown) {
  const ip = clientIp(req);
  const email = normEmail(email0);
  limit("login-ip:" + ip, 30, 15 * MIN);
  limit("login-em:" + email, 10, 15 * MIN);
  const u = findByEmail(email);
  const ok = typeof pw === "string" && pw.length <= PW_MAX && (await verifyPassword(pw, u?.password_hash ?? null));
  if (!u || !ok) { audit("login_failed", { target: u, targetEmail: email, ip }); throw new AuthError("Email hoặc mật khẩu không đúng.", 401); }
  if (u.status !== "active") { audit("login_blocked", { target: u, ip }); throw new AuthError("Tài khoản này đã bị khóa. Hãy liên hệ quản trị viên.", 403); }
  audit("login", { actor: u, ip, detail: "password" });
  return { user: u, cookie: createSession(u, req, "password") };
}

export async function signup(req: Request, email0: unknown, pw0: unknown, profile: ProfileIn = {}) {
  const ip = clientIp(req);
  limit("signup:" + ip, 10, 60 * MIN);
  const email = normEmail(email0);
  const pw = checkPassword(pw0, email);
  if (ADMIN_EMAILS.has(email)) throw new AuthError("Email này được dành riêng. Hãy đăng nhập bằng Google hoặc liên hệ quản trị viên.", 403);
  if (!signupOpen()) throw new AuthError("Synchro hiện tạm ngừng nhận đăng ký mới.", 403);
  if (findByEmail(email)) throw new AuthError("Email này đã có tài khoản. Hãy đăng nhập.", 409);
  if (profile.fullName === undefined || profile.birthDate === undefined) throw new AuthError("Hãy điền họ tên và ngày sinh.");
  const prof = cleanProfile(profile);
  const hash = await hashPassword(pw);
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
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new AuthError("Email này đã có tài khoản. Hãy đăng nhập.", 409);
    throw e;
  }
  const u = getUser(id)!;
  audit("signup", { actor: u, ip, detail: "password" });
  return { user: u, cookie: createSession(u, req, "password") };
}

// ---- đăng nhập bằng Google / GitHub / Apple ----
export type OAuthProfile = { provider: string; subject: string; email: string | null; emailVerified: boolean; name: string; avatar: string | null };
export function oauthLogin(req: Request, p: OAuthProfile) {
  const ip = clientIp(req);
  const ident = db().prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").get(p.provider, p.subject) as { user_id: string } | undefined;
  let u = ident ? getUser(ident.user_id) : undefined;
  if (!u) {
    if (!p.email || !p.emailVerified) throw new AuthError("Tài khoản này chưa có email đã xác minh, không thể dùng để đăng nhập.");
    const email = normEmail(p.email);
    u = findByEmail(email);
    if (u) {
      // Email của tài khoản cũ chưa từng được xác minh → mật khẩu có thể do người khác đặt trước.
      // Nhà cung cấp vừa xác minh chủ thật của email nên xóa mật khẩu và mọi phiên cũ.
      if (!u.email_verified) {
        db().prepare("UPDATE users SET email_verified = 1, password_hash = NULL WHERE id = ?").run(u.id);
        db().prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
      }
      audit("oauth_link", { actor: u, ip, detail: p.provider });
    } else {
      if (!signupOpen() && !ADMIN_EMAILS.has(email)) throw new AuthError("Synchro hiện tạm ngừng nhận đăng ký mới.", 403);
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
  audit("login", { actor: u, ip, detail: p.provider });
  return { user: u, cookie: createSession(u, req, p.provider) };
}

// ---- tài khoản của chính mình ----
export async function changePassword(req: Request, u: UserRow, cur: unknown, next: unknown) {
  limit("pw:" + u.id, 10, 15 * MIN);
  if (u.password_hash && !(typeof cur === "string" && (await verifyPassword(cur, u.password_hash)))) throw new AuthError("Mật khẩu hiện tại không đúng.", 401);
  const pw = checkPassword(next, u.email);
  db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(pw), u.id);
  audit("password_changed", { actor: u, ip: clientIp(req) });
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
  };
}

export function adminUsers() {
  const rows = db().prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT 2000").all() as UserRow[];
  const sess = new Map((db().prepare("SELECT user_id, COUNT(*) n FROM sessions WHERE expires_at > ? GROUP BY user_id").all(Date.now()) as { user_id: string; n: number }[]).map((r) => [r.user_id, r.n]));
  return rows.map((u) => ({ ...publicUser(u), status: u.status, verified: !!u.email_verified, lastLogin: u.last_login_at, lastSeen: u.last_seen_at, sessions: sess.get(u.id) ?? 0, protected: ADMIN_EMAILS.has(u.email.toLowerCase()), customPerms: !!u.perms }));
}

export function adminAudit(lim = 100, before?: number) {
  return db().prepare(`SELECT * FROM audit ${before ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ?`).all(...(before ? [before, lim] : [lim]));
}

function target(admin: UserRow, id: string) {
  const t = getUser(id);
  if (!t) throw new AuthError("Không tìm thấy người dùng.", 404);
  if (t.id === admin.id || ADMIN_EMAILS.has(t.email.toLowerCase())) throw new AuthError("Không thể thao tác trên tài khoản quản trị viên.", 403);
  return t;
}

export async function adminAct(req: Request, admin: UserRow, id: string, action: unknown, body: Record<string, unknown> = {}) {
  const t = target(admin, id);
  const ip = clientIp(req);
  if (action === "set_password") {
    // Quản trị đặt mật khẩu mới cho người khác, không cần mật khẩu cũ. Mặc định đăng xuất mọi phiên của họ.
    const pw = checkPassword(body.password, t.email);
    db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(pw), t.id);
    if (body.signOut !== false) db().prepare("DELETE FROM sessions WHERE user_id = ?").run(t.id);
    audit("admin_set_password", { actor: admin, target: t, ip });
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
      if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
      console.error("[auth]", e);
      return Response.json({ error: "Lỗi máy chủ. Vui lòng thử lại." }, { status: 500 });
    }
  };
}
export const withCookies = (res: Response, ...cookies: string[]) => { cookies.forEach((c) => res.headers.append("Set-Cookie", c)); return res; };

// Chặn API nội bộ (LLM, skills, file…) với người chưa đăng nhập.
export const authGate = (req: Request) => (current(req) ? null : Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 }));
