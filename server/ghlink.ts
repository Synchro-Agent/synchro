// Kết nối GitHub luôn lưu vào đúng tài khoản Synchro đã bấm "Kết nối GitHub", không theo cookie của trình duyệt
// đang mở trang GitHub:
// - Trên web, cửa sổ cấp quyền dùng chung cookie với trang, nhưng tab khác vẫn có thể đổi tài khoản giữa chừng.
// - Ứng dụng máy tính mở trang cấp quyền ở trình duyệt của máy, nơi có thể đăng nhập tài khoản khác hoặc chưa
//   đăng nhập. App xin một mã trao tay dùng một lần (gắn với tài khoản của app, hạn 10 phút), trình duyệt mở
//   /api/github/connect?handoff=<mã>, và app hỏi kết quả theo id của lượt để báo ngay khi xong hay lỗi.
// Mỗi lượt kết nối có một vé theo mã trạng thái OAuth (không ai đoán được); callback chỉ lưu token cho người trên vé.
// Vé và lượt trao tay ở bộ nhớ như vé thêm cách đăng nhập (server/oauth.ts): khởi động lại máy chủ giữa chừng thì
// người dùng bấm Kết nối lại, không bao giờ rơi về tài khoản đang đăng nhập ở trình duyệt.
import "server-only";
import crypto from "node:crypto";

const TTL = 10 * 60_000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const eq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type HandoffState = "wait" | "open" | "done" | "error";
type Handoff = { uid: string; secret: string; exp: number; state: HandoffState; error?: string; login?: string };
type Ticket = { uid: string; handoff: string | null; exp: number };
type Store = { handoffs: Map<string, Handoff>; tickets: Map<string, Ticket> };
const g = globalThis as { __synchroGhLink?: Store };
const store = (g.__synchroGhLink ??= { handoffs: new Map(), tickets: new Map() });

function sweep() {
  const now = Date.now();
  for (const [k, v] of store.handoffs) if (v.exp < now) store.handoffs.delete(k);
  for (const [k, v] of store.tickets) if (v.exp < now) store.tickets.delete(k);
}

/** Ứng dụng máy tính bắt đầu kết nối: { id để hỏi kết quả, mã cho đường dẫn mở ở trình duyệt }.
 *  Mỗi tài khoản chỉ một lượt đang chờ: bấm lại thì lượt cũ hết hiệu lực. */
export function startHandoff(uid: string) {
  sweep();
  for (const [k, v] of store.handoffs) if (v.uid === uid && v.state !== "done") store.handoffs.delete(k);
  const id = crypto.randomBytes(12).toString("base64url"), secret = crypto.randomBytes(24).toString("base64url");
  store.handoffs.set(id, { uid, secret: sha(secret), exp: Date.now() + TTL, state: "wait" });
  return { id, code: `${id}.${secret}` };
}

/** Trình duyệt mở đường dẫn trao tay: tài khoản của app, hoặc null (sai mã, hết hạn, đã dùng). Mã chỉ dùng một lần. */
export function claimHandoff(code: string): { id: string; uid: string } | null {
  sweep();
  const [id = "", secret = ""] = code.split(".");
  const h = store.handoffs.get(id);
  if (!h || h.state !== "wait" || !eq(h.secret, sha(secret))) return null;
  h.state = "open";
  return { id, uid: h.uid };
}

/** Kết quả của lượt trao tay cho app hỏi (chỉ chủ lượt mới đọc được); null khi không còn lượt này. */
export function handoffState(uid: string, id: string) {
  const h = store.handoffs.get(id);
  if (!h || h.uid !== uid || h.exp < Date.now()) return null;
  return { state: h.state, error: h.error ?? null, login: h.login ?? null };
}

export function settleHandoff(id: string | null, r: { error?: string; login?: string }) {
  const h = id ? store.handoffs.get(id) : null;
  if (!h) return;
  Object.assign(h, r.error ? { state: "error", error: r.error } : { state: "done", login: r.login });
}

/** Ghi vé cho lượt cấp quyền vừa bắt đầu (theo mã trạng thái OAuth). */
export function bindLink(state: string, uid: string, handoff: string | null = null) {
  sweep();
  store.tickets.set(sha(state), { uid, handoff, exp: Date.now() + TTL });
}

/** Callback: người đã bắt đầu lượt này (vé dùng một lần). Gọi sau khi oauth.finish đã đối chiếu mã trạng thái. */
export function takeLink(state: string): Ticket | null {
  if (!state) return null;
  const k = sha(state), t = store.tickets.get(k);
  store.tickets.delete(k);
  return t && t.exp > Date.now() ? t : null;
}
/** Lượt trao tay của vé mà không xóa vé (để báo lỗi cho app khi GitHub từ chối trước khi đọc được vé). */
export const peekLink = (state: string) => (state ? (store.tickets.get(sha(state))?.handoff ?? null) : null);
