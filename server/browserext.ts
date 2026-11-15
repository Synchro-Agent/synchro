// Tiện ích Synchro cho Chrome / Edge / Brave của người dùng (thư mục extension/): ghép nối thiết bị bằng mã một lần,
// khóa riêng của từng thiết bị (chỉ lưu bản băm), vé WebSocket ngắn hạn, và gửi lệnh browser_* tới tiện ích qua dịch vụ workspace
// (workspace/ext-relay.mjs: tiện ích nối WebSocket /ws-agent/ext, máy chủ này gửi lệnh qua HTTP /ext).
import "server-only";
import crypto from "node:crypto";
import { AuthError, can, db, getUser } from "./authstore";
import { agent, wsConfigured } from "./workspace";

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS browser_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      browser TEXT, created_at INTEGER NOT NULL, last_seen INTEGER);
      CREATE INDEX IF NOT EXISTS browser_devices_user ON browser_devices(user_id);
      CREATE TABLE IF NOT EXISTS browser_pair_codes (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
    ready = true;
  }
  return d;
}

export type Device = { id: string; name: string; browser: string | null; createdAt: number; lastSeen: number | null };
type Row = { id: string; user_id: string; token_hash: string; name: string; browser: string | null; created_at: number; last_seen: number | null };
const pub = (r: Row): Device => ({ id: r.id, name: r.name, browser: r.browser, createdAt: r.created_at, lastSeen: r.last_seen });
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
// Mã ghép nối dễ đọc, dễ gõ: 8 ký tự không lẫn (bỏ 0/O, 1/I/L), hiện dạng ABCD-EFGH.
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const normCode = (c: unknown) => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const CODE_TTL = 10 * 60_000;

export const extAllowed = () => wsConfigured();
/** Quản trị viên tắt "Your Chrome" (Quyền truy cập) cho tài khoản này: không ghép nối, không kết nối, model không điều khiển Chrome của họ. */
export const CHROME_LOCKED = "Quản trị viên chưa cho phép tài khoản của bạn dùng Chrome của bạn với Synchro.";
export const devicesOf = (uid: string) => (init().prepare("SELECT * FROM browser_devices WHERE user_id = ? ORDER BY created_at").all(uid) as Row[]).map(pub);
export const hasDevice = (uid: string) => !!init().prepare("SELECT 1 FROM browser_devices WHERE user_id = ? LIMIT 1").get(uid);

/** Mã ghép nối mới (thay mã cũ chưa dùng của người này), dùng một lần trong 10 phút. */
export function newPairCode(uid: string) {
  const d = init();
  let code = "";
  for (const b of crypto.randomBytes(8)) code += ALPHA[b % ALPHA.length];
  const exp = Date.now() + CODE_TTL;
  d.prepare("DELETE FROM browser_pair_codes WHERE user_id = ? OR expires_at < ?").run(uid, Date.now());
  d.prepare("INSERT INTO browser_pair_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha(code), uid, exp);
  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: exp };
}

/** Tiện ích đổi mã ghép nối lấy khóa riêng của thiết bị (trả về một lần, máy chủ chỉ giữ bản băm). */
export function redeemPairCode(code: unknown, meta: { name?: unknown; browser?: unknown }) {
  const d = init();
  const c = normCode(code);
  if (c.length !== 8) throw new AuthError("Mã ghép nối gồm 8 ký tự, ví dụ ABCD-EFGH.", 400);
  const row = d.prepare("SELECT * FROM browser_pair_codes WHERE code_hash = ?").get(sha(c)) as { user_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < Date.now()) throw new AuthError("Mã ghép nối không đúng hoặc đã hết hạn. Lấy mã mới trong Synchro: Cài đặt → Khả năng → Trình duyệt của bạn.", 400);
  d.prepare("DELETE FROM browser_pair_codes WHERE code_hash = ?").run(sha(c));
  const user = getUser(row.user_id);
  if (!user || user.status !== "active") throw new AuthError("Tài khoản không còn dùng được.", 403);
  if (!can(user, "chrome")) throw new AuthError(CHROME_LOCKED, 403);
  const first = !hasDevice(user.id);
  const id = crypto.randomBytes(12).toString("base64url");
  const token = "sxt_" + crypto.randomBytes(32).toString("base64url");
  const name = String(meta.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "Chrome";
  const browser = String(meta.browser ?? "").trim().slice(0, 40) || null;
  d.prepare("INSERT INTO browser_devices (id, user_id, token_hash, name, browser, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, user.id, sha(token), name, browser, Date.now(), Date.now());
  return { token, device: { id, name }, user, first };
}

/** Thiết bị theo khóa riêng (tiện ích gửi kèm Authorization: Bearer …). */
/** Ảnh đại diện gửi cho tiện ích: ảnh tự tải lên (data URL) hoặc ảnh từ Google / GitHub (https); khác thì không gửi (vẽ chữ cái đầu). */
export const avatarOf = (a: string | null | undefined) => (a && (/^https:\/\//.test(a) || /^data:image\/(png|jpeg|webp);base64,/.test(a)) ? a : null);

export function deviceOf(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const token = /^Bearer (sxt_[\w-]{20,})$/.exec(h)?.[1];
  if (!token) throw new AuthError("Thiếu khóa của tiện ích.", 401);
  const row = init().prepare("SELECT * FROM browser_devices WHERE token_hash = ?").get(sha(token)) as Row | undefined;
  if (!row) throw new AuthError("Trình duyệt này đã bị gỡ khỏi Synchro. Ghép nối lại bằng mã mới.", 401);
  const user = getUser(row.user_id);
  if (!user || user.status !== "active") throw new AuthError("Tài khoản không còn dùng được.", 401);
  return { row, user };
}
export function touchDevice(id: string, meta: { name?: unknown; browser?: unknown } = {}) {
  const name = String(meta.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const browser = String(meta.browser ?? "").trim().slice(0, 40);
  init().prepare("UPDATE browser_devices SET last_seen = ?, name = COALESCE(NULLIF(?, ''), name), browser = COALESCE(NULLIF(?, ''), browser) WHERE id = ?").run(Date.now(), name, browser, id);
}

/** Gỡ một thiết bị (đóng luôn kết nối đang mở của nó). */
export async function removeDevice(uid: string, id: string) {
  const r = init().prepare("DELETE FROM browser_devices WHERE user_id = ? AND id = ?").run(uid, id);
  if (wsConfigured()) await agent("/ext", { u: uid, op: "kick", d: id }, 10_000).catch(() => {});
  return r.changes > 0;
}
/** Xóa tài khoản: gỡ mọi thiết bị đã ghép nối. */
export async function removeUserDevices(uid: string) {
  const ids = devicesOf(uid).map((x) => x.id);
  init().prepare("DELETE FROM browser_devices WHERE user_id = ?").run(uid);
  init().prepare("DELETE FROM browser_pair_codes WHERE user_id = ?").run(uid);
  if (wsConfigured()) for (const id of ids) await agent("/ext", { u: uid, op: "kick", d: id }, 10_000).catch(() => {});
}

export type ExtLive = { id: string; name?: string; browser?: string; version?: string; ext?: string; scope?: "all" | "group"; tab?: { title: string; url: string } | null; tabs?: number; acting?: boolean; since: number; seen: number; last?: { kind: string; label: string; at: number } | null; active: boolean };
/** Thiết bị đang kết nối (theo dịch vụ workspace). */
export async function extLive(uid: string): Promise<{ connected: boolean; device: string | null; devices: ExtLive[] }> {
  if (!wsConfigured()) return { connected: false, device: null, devices: [] };
  return agent<{ connected: boolean; device: string | null; devices: ExtLive[] }>("/ext", { u: uid, op: "status" }, 8_000).catch(() => ({ connected: false, device: null, devices: [] }));
}
/** Danh sách thiết bị kèm trạng thái kết nối, cho Cài đặt và khung trình duyệt. */
export async function extOverview(uid: string) {
  const live = await extLive(uid);
  const devices = devicesOf(uid).map((d) => {
    const l = live.devices.find((x) => x.id === d.id);
    return { ...d, connected: !!l, active: !!l?.active, scope: l?.scope ?? null, tab: l?.tab ?? null, acting: !!l?.acting, last: l?.last ?? null, version: l?.ext ?? null };
  });
  const u = getUser(uid);
  const locked = !!u && !can(u, "chrome");
  return { allowed: extAllowed() && !locked, locked, connected: live.connected && !locked, devices };
}
export const extNotify = (uid: string, op: "stop" | "release") => (wsConfigured() ? agent("/ext", { u: uid, op }, 8_000).then(() => true, () => false) : Promise.resolve(false));
