// Khóa truy cập (passkey, WebAuthn): đăng ký trong Cài đặt → Tài khoản → Bảo mật, đăng nhập ở trang đăng nhập (nút riêng hoặc gợi ý ngay ở ô email).
// Kiểm tra chữ ký, nguồn gốc, rpID và bộ đếm bằng @simplewebauthn/server (bản cố định trong package.json). Không tin chứng thực của thiết bị
// (attestation "none"): khóa nào người dùng đã đăng nhập rồi tự thêm đều được, như mật khẩu.
// rpID lấy từ tên máy của APP_URL (synchro.net.nz khi chạy thật, localhost khi chạy giả lập): khóa tạo ở tên miền nào chỉ dùng được ở tên miền đó.
// Mỗi thử thách (challenge) dùng một lần, hết hạn sau 5 phút, gắn với việc nó được cấp cho (đăng ký của ai / đăng nhập): gửi lại câu trả lời cũ bị từ chối.
// Bảng có cột user_id nên xóa tài khoản tự xóa theo (purge.ts).
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { AuthError, appUrl, audit, clientIp, db, device, getUser, limit, markReauth, needsVerify, passkeySignIn, requireRecentReauth, VERIFY_FIRST, type SessionRow, type UserRow } from "./authstore";

const MIN = 60_000;
const CHALLENGE_TTL = 5 * MIN;
const MAX_KEYS = 20;

type Row = { id: string; user_id: string; name: string; public_key: Buffer; counter: number; transports: string; device_type: string; backed_up: number; created_at: number; last_used_at: number | null };
let ready = false;
function t() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS user_passkeys (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]', device_type TEXT NOT NULL DEFAULT '', backed_up INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, last_used_at INTEGER)`);
    d.exec("CREATE INDEX IF NOT EXISTS user_passkeys_user ON user_passkeys(user_id)");
    ready = true;
  }
  return d;
}

/** Nơi Synchro chạy: rpID là tên máy, origin là địa chỉ đầy đủ. APP_URL đặt cố định ở máy chủ thật, nên Host giả mạo không đổi được hai giá trị này. */
export function relyingParty(req: Request) {
  const u = new URL(process.env.APP_URL || appUrl(req));
  return { rpID: u.hostname, origin: u.origin };
}

// ---- thử thách: bộ nhớ trong (app chạy một tiến trình), dùng một lần ----
type Ch = { kind: "reg" | "auth" | "reauth"; uid?: string; exp: number };
const challenges = ((globalThis as { __synchroPasskeyCh?: Map<string, Ch> }).__synchroPasskeyCh ??= new Map());
function issue(challenge: string, c: Omit<Ch, "exp">) {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
  if (challenges.size > 20_000) throw new AuthError("Máy chủ đang bận. Hãy thử lại sau ít phút.", 503);
  challenges.set(challenge, { ...c, exp: now + CHALLENGE_TTL });
}
/** Lấy thử thách trong câu trả lời của trình duyệt ra và xóa ngay (kể cả khi phần kiểm tra sau đó thất bại): mỗi thử thách chỉ được thử một lần. */
function take(clientDataJSON: unknown, kind: Ch["kind"], uid?: string) {
  let ch = "";
  try { ch = String(JSON.parse(Buffer.from(String(clientDataJSON), "base64url").toString("utf8")).challenge ?? ""); } catch {}
  const c = ch ? challenges.get(ch) : undefined;
  if (ch) challenges.delete(ch);
  if (!c || c.kind !== kind || c.exp < Date.now() || (kind !== "auth" && c.uid !== uid)) throw new AuthError("Yêu cầu khóa truy cập đã hết hạn hoặc đã được dùng. Hãy thử lại.", 400);
  return ch;
}

const pub = (r: Row) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at, synced: !!r.backed_up });
export const listPasskeys = (uid: string) => (t().prepare("SELECT * FROM user_passkeys WHERE user_id = ? ORDER BY created_at").all(uid) as Row[]).map(pub);
export const hasPasskey = (uid: string) => { try { return !!t().prepare("SELECT 1 FROM user_passkeys WHERE user_id = ? LIMIT 1").get(uid); } catch { return false; } };

// ---- đăng ký (tài khoản đang đăng nhập) ----
export async function registrationOptions(req: Request, u: UserRow, session: SessionRow) {
  // Email chưa xác minh có thể là của người khác: người đăng ký trước không được cài sẵn đường vào tài khoản của chủ thật.
  if (needsVerify(u)) throw new AuthError(VERIFY_FIRST, 403);
  // Thêm khóa truy cập là hành động nhạy cảm: cần vừa xác minh lại (đăng nhập / mật khẩu) trong 5 phút.
  requireRecentReauth(session);
  limit("passkey-reg:" + u.id, 20, 15 * MIN);
  const mine = t().prepare("SELECT id, transports FROM user_passkeys WHERE user_id = ?").all(u.id) as { id: string; transports: string }[];
  if (mine.length >= MAX_KEYS) throw new AuthError("Mỗi tài khoản có tối đa 20 khóa truy cập. Hãy xóa bớt khóa không dùng nữa.", 400);
  const { rpID } = relyingParty(req);
  const opts = await generateRegistrationOptions({
    rpName: "Synchro", rpID, userName: u.email, userDisplayName: u.full_name || u.name, userID: new TextEncoder().encode(u.id),
    attestationType: "none", timeout: CHALLENGE_TTL,
    // Khóa đã có trên thiết bị này thì trình duyệt báo luôn, không tạo khóa thứ hai cho cùng tài khoản.
    excludeCredentials: mine.map((m) => ({ id: m.id, transports: JSON.parse(m.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  issue(opts.challenge, { kind: "reg", uid: u.id });
  return opts;
}

const cleanName = (v: unknown) => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 60) : "");

export async function registerPasskey(req: Request, u: UserRow, session: SessionRow, response: unknown, name?: unknown) {
  if (needsVerify(u)) throw new AuthError(VERIFY_FIRST, 403);
  requireRecentReauth(session);
  const resp = response as RegistrationResponseJSON;
  const challenge = take(resp?.response?.clientDataJSON, "reg", u.id);
  const { rpID, origin } = relyingParty(req);
  let v;
  try {
    v = await verifyRegistrationResponse({ response: resp, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
  } catch (e) {
    audit("passkey_add_failed", { actor: u, ip: clientIp(req), detail: String((e as Error).message ?? e).slice(0, 200) });
    throw new AuthError("Không thêm được khóa truy cập. Hãy thử lại.", 400);
  }
  if (!v.verified) throw new AuthError("Không thêm được khóa truy cập. Hãy thử lại.", 400);
  const c = v.registrationInfo.credential;
  if (t().prepare("SELECT 1 FROM user_passkeys WHERE id = ?").get(c.id)) throw new AuthError("Khóa truy cập này đã được thêm.", 409);
  const label = cleanName(name) || device(req.headers.get("user-agent"));
  t().prepare("INSERT INTO user_passkeys (id, user_id, name, public_key, counter, transports, device_type, backed_up, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(c.id, u.id, label, Buffer.from(c.publicKey), c.counter, JSON.stringify(c.transports ?? []), v.registrationInfo.credentialDeviceType, v.registrationInfo.credentialBackedUp ? 1 : 0, Date.now());
  audit("passkey_added", { actor: u, target: u, ip: clientIp(req), detail: label });
  return listPasskeys(u.id);
}

function own(u: UserRow, id: unknown) {
  const r = typeof id === "string" ? t().prepare("SELECT * FROM user_passkeys WHERE id = ? AND user_id = ?").get(id, u.id) as Row | undefined : undefined;
  if (!r) throw new AuthError("Không tìm thấy khóa truy cập này.", 404);
  return r;
}
export function renamePasskey(req: Request, u: UserRow, id: unknown, name: unknown) {
  const r = own(u, id), n = cleanName(name);
  if (!n) throw new AuthError("Hãy đặt tên cho khóa truy cập.", 400);
  t().prepare("UPDATE user_passkeys SET name = ? WHERE id = ?").run(n, r.id);
  audit("passkey_renamed", { actor: u, target: u, ip: clientIp(req), detail: n });
  return listPasskeys(u.id);
}
export function deletePasskey(req: Request, u: UserRow, id: unknown) {
  const r = own(u, id);
  // Khóa cuối cùng mà tài khoản không còn mật khẩu hay Google / GitHub / Apple: xóa là không vào lại được.
  const others = !!u.password_hash || !!t().prepare("SELECT 1 FROM identities WHERE user_id = ? LIMIT 1").get(u.id) || !!t().prepare("SELECT 1 FROM user_passkeys WHERE user_id = ? AND id != ? LIMIT 1").get(u.id, r.id);
  if (!others) throw new AuthError("Đây là cách đăng nhập duy nhất của tài khoản. Hãy đặt mật khẩu hoặc thêm cách khác trước.", 400);
  t().prepare("DELETE FROM user_passkeys WHERE id = ?").run(r.id);
  audit("passkey_removed", { actor: u, target: u, ip: clientIp(req), detail: r.name });
  return listPasskeys(u.id);
}

// ---- đăng nhập (chưa có phiên) ----
/** Không gửi danh sách khóa (chưa biết là ai): trình duyệt tự đưa ra các khóa đã lưu cho tên miền này. */
export async function authenticationOptions(req: Request) {
  limit("passkey-ip:" + clientIp(req), 60, 15 * MIN);
  const { rpID } = relyingParty(req);
  const opts = await generateAuthenticationOptions({ rpID, userVerification: "preferred", timeout: CHALLENGE_TTL });
  issue(opts.challenge, { kind: "auth" });
  return opts;
}

const BAD_LOGIN = "Khóa truy cập này không đăng nhập được. Có thể khóa đã bị xóa khỏi tài khoản. Hãy dùng cách đăng nhập khác.";
export async function loginWithPasskey(req: Request, response: unknown) {
  const ip = clientIp(req);
  limit("passkey-ip:" + ip, 60, 15 * MIN);
  const resp = response as AuthenticationResponseJSON;
  const challenge = take(resp?.response?.clientDataJSON, "auth");
  const r = typeof resp?.id === "string" && resp.id.length <= 1400 ? t().prepare("SELECT * FROM user_passkeys WHERE id = ?").get(resp.id) as Row | undefined : undefined;
  const u = r ? getUser(r.user_id) : undefined;
  if (!r || !u) { audit("login_failed", { ip, detail: "passkey: unknown" }); throw new AuthError(BAD_LOGIN, 401); }
  // userHandle (nếu có) phải trùng chủ của khóa: khóa của tài khoản này không đăng nhập được vào tài khoản khác.
  if (resp.response.userHandle && Buffer.from(resp.response.userHandle, "base64url").toString("utf8") !== u.id) { audit("login_failed", { target: u, ip, detail: "passkey: user" }); throw new AuthError(BAD_LOGIN, 401); }
  limit(`passkey-user:${u.id}`, 30, 15 * MIN);
  const { rpID, origin } = relyingParty(req);
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: resp, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      credential: { id: r.id, publicKey: new Uint8Array(r.public_key), counter: r.counter, transports: JSON.parse(r.transports) },
    });
  } catch (e) {
    // Bộ đếm lùi lại: có thể khóa đã bị sao chép. Ghi rõ để quản trị viên thấy trong nhật ký.
    audit("login_failed", { target: u, ip, detail: `passkey: ${String((e as Error).message ?? e).slice(0, 160)}` });
    throw new AuthError("Không xác minh được khóa truy cập. Hãy thử lại.", 401);
  }
  if (!v.verified) { audit("login_failed", { target: u, ip, detail: "passkey" }); throw new AuthError("Không xác minh được khóa truy cập. Hãy thử lại.", 401); }
  if (u.status !== "active") { audit("login_blocked", { target: u, ip, detail: "passkey" }); throw new AuthError("Tài khoản này đã bị khóa. Hãy liên hệ quản trị viên.", 403); }
  t().prepare("UPDATE user_passkeys SET counter = ?, last_used_at = ?, backed_up = ? WHERE id = ?").run(v.authenticationInfo.newCounter, Date.now(), v.authenticationInfo.credentialBackedUp ? 1 : 0, r.id);
  return { user: u, ...passkeySignIn(u, req, v.authenticationInfo.userVerified) };
}

// ---- xác minh lại bằng khóa (tài khoản đang đăng nhập) ----
// Trước hành động nhạy cảm (thêm khóa, bật xác minh hai bước) mà phiên không còn mới: tài khoản không có mật khẩu (chỉ Google / GitHub / Apple / khóa)
// chứng minh lại bằng một khóa ĐÃ có của chính tài khoản này. Thử thách gắn với tài khoản, chỉ nhận khóa của tài khoản đó.
export async function reauthOptions(req: Request, u: UserRow) {
  limit("passkey-reauth:" + u.id, 20, 15 * MIN);
  const mine = t().prepare("SELECT id, transports FROM user_passkeys WHERE user_id = ?").all(u.id) as { id: string; transports: string }[];
  if (!mine.length) throw new AuthError("Tài khoản này chưa có khóa truy cập.", 400);
  const { rpID } = relyingParty(req);
  const opts = await generateAuthenticationOptions({ rpID, userVerification: "preferred", timeout: CHALLENGE_TTL, allowCredentials: mine.map((m) => ({ id: m.id, transports: JSON.parse(m.transports) })) });
  issue(opts.challenge, { kind: "reauth", uid: u.id });
  return opts;
}
export async function reauthWithPasskey(req: Request, u: UserRow, session: SessionRow, response: unknown) {
  limit("passkey-reauth:" + u.id, 20, 15 * MIN);
  const resp = response as AuthenticationResponseJSON;
  const challenge = take(resp?.response?.clientDataJSON, "reauth", u.id);
  const r = typeof resp?.id === "string" && resp.id.length <= 1400 ? t().prepare("SELECT * FROM user_passkeys WHERE id = ? AND user_id = ?").get(resp.id, u.id) as Row | undefined : undefined;
  const bad = () => new AuthError("Không xác minh được khóa truy cập. Hãy thử lại.", 400);
  if (!r) throw bad();
  const { rpID, origin } = relyingParty(req);
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: resp, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      credential: { id: r.id, publicKey: new Uint8Array(r.public_key), counter: r.counter, transports: JSON.parse(r.transports) },
    });
  } catch (e) {
    audit("reauth_failed", { actor: u, target: u, ip: clientIp(req), detail: `passkey: ${String((e as Error).message ?? e).slice(0, 160)}` });
    throw bad();
  }
  if (!v.verified) throw bad();
  t().prepare("UPDATE user_passkeys SET counter = ?, last_used_at = ? WHERE id = ?").run(v.authenticationInfo.newCounter, Date.now(), r.id);
  markReauth(session.id); // chỉ phiên đang gọi được tính là vừa xác minh
}

/** Cho kiểm thử: số thử thách còn chờ (để chắc thử thách đã dùng bị xóa). */
export const pendingChallenges = () => challenges.size;
