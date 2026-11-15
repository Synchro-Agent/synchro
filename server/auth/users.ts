// Người dùng: tra cứu, vai trò (chủ sở hữu / quản trị viên / thành viên), quyền dùng model / tính năng, hồ sơ cá nhân, cổng xác minh email.
import "server-only";
import crypto from "node:crypto";
import { allowsModel, FULL_PERMS, normPerms, type Feature, type Perms } from "../../shared/catalog";
import { db, stmt } from "../db/db";
import { audit, getSetting, setSetting } from "../db/settings";
import { limit } from "../ratelimit";
import { MIN, OWNER_EMAILS, reservedEmail } from "./config";
import { AuthError } from "./errors";
import { clientIp } from "./request";
import type { UserRow } from "./types";

// ---- người dùng ----
export const getUser = (id: string) => stmt("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
export const findByEmail = (email: string) => stmt("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
// Khóa truy cập (passkeys.ts) cũng là một cách đăng nhập: gỡ Google khi chỉ còn khóa vẫn vào lại được. Bảng tạo khi dùng lần đầu.
export const hasPasskeys = (uid: string) => { try { return !!stmt("SELECT 1 FROM user_passkeys WHERE user_id = ? LIMIT 1").get(uid); } catch { return false; } };
export const methodsOf = (u: UserRow) => [...(u.password_hash ? ["password"] : []), ...(db().prepare("SELECT provider FROM identities WHERE user_id = ? ORDER BY created_at").all(u.id) as { provider: string }[]).map((r) => r.provider), ...(hasPasskeys(u.id) ? ["passkey"] : [])];
export const inGoodStanding = (u: UserRow) => u.email_verified === 1 && u.status === "active";
export type Role = "owner" | "admin" | "member";
export const isOwner = (u: UserRow) => OWNER_EMAILS.has(u.email.toLowerCase()) && inGoodStanding(u);
export const isAdmin = (u: UserRow) => (reservedEmail(u.email) || u.role === "admin") && inGoodStanding(u);
export const roleOf = (u: UserRow): Role => (isOwner(u) ? "owner" : isAdmin(u) ? "admin" : "member");
/** Tài khoản mang vai trò quản trị (gồm chủ sở hữu), kể cả khi đang bị khóa hoặc chưa xác minh: quyền chỉ chủ sở hữu xét theo cái này,
 *  để quản trị viên khác không đặt sẵn điều gì lên tài khoản quản trị đang bị khóa chờ chủ sở hữu mở lại. */
export const adminRole = (u: UserRow) => reservedEmail(u.email) || u.role === "admin";
/** Vai trò ghi trên tài khoản (danh sách người dùng của quản trị viên), kể cả khi tài khoản đang bị khóa hoặc chưa xác minh. */
export const roleLabel = (u: UserRow): Role => (OWNER_EMAILS.has(u.email.toLowerCase()) ? "owner" : reservedEmail(u.email) || u.role === "admin" ? "admin" : "member");
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
// Quyền dùng một model đi theo bản thay thế của nó (sổ model, server/modelreg.ts: model đã cũ hoặc bị hãng gỡ nhường chỗ cho bản mới nhất cùng dòng),
// để người chỉ được dùng một model vẫn chat được khi hãng ra bản mới. Sổ model tự đăng ký hàm này khi nạp (không nhập vòng hai module).
const viaReplacement = (allowed: string[], model: string) => ((globalThis as { __synchroModelAllow?: (a: string[], k: string) => boolean }).__synchroModelAllow?.(allowed, model) ?? false);
export const canModel = (u: UserRow, model: string) => { const m = permsOf(u).models; return allowsModel(m, model) || viaReplacement(m, model); };


// ---- hồ sơ cá nhân ----
export type ProfileIn = { fullName?: unknown; nickname?: unknown; birthDate?: unknown; occupation?: unknown; avatar?: unknown; instructions?: unknown };
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

export function writeProfile(id: string, c: ProfileCols) {
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

// ---- cổng xác minh email (quyền của tài khoản chưa xác minh; đường dẫn xác minh ở flows.ts) ----
export const VERIFY_FIRST = "Hãy xác minh email để dùng tính năng này. Mở thư Synchro đã gửi, hoặc gửi lại từ dải thông báo trên cùng.";
const verifySince = () => Number(getSetting("verify_since", "0")) || Infinity;
export const verifyGateOn = () => getSetting("verify_gate", process.env.SYNCHRO_VERIFY_GATE_DEFAULT === "0" ? "0" : "1") === "1";
export const setVerifyGate = (on: boolean) => setSetting("verify_gate", on ? "1" : "0");
/** Tài khoản đăng ký bằng mật khẩu sau khi có tính năng này và chưa bấm xác minh. Tài khoản cũ, tài khoản Google / GitHub / Apple không bị ảnh hưởng. */
export const needsVerify = (u: UserRow) => !u.email_verified && u.created_at >= verifySince();
/** Quản trị viên có thể tắt khóa này (Cài đặt → Quản trị viên), ví dụ khi thư đang không gửi được. */
export const verifyLocked = (u: UserRow) => needsVerify(u) && verifyGateOn();
