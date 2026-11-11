// Dùng chung cho các route connector: kiểm tra đăng nhập + quyền dùng connector, đổi lỗi thành JSON.
import { AuthError, can, handle, isAdmin, permsOf, requireUser, VERIFY_FIRST, verifyLocked, type UserRow } from "../../authstore";
import { connPolicy, type ConnPolicy } from "../../catalog";
import { composioConnector, ConnectorError, ensureComposio, type ComposioStatus } from "../../connectors";
import { appCount, ComposioError } from "../../composio";

export function connectorUser(req: Request) {
  const { user } = requireUser(req);
  if (!can(user, "connectors")) throw new AuthError(verifyLocked(user) ? VERIFY_FIRST : "Quản trị viên chưa cho phép tài khoản của bạn dùng connector.", 403);
  return user;
}
// Quyền connector quản trị viên đặt cho tài khoản này (quản trị viên: không giới hạn).
export const policyOf = (user: Parameters<typeof permsOf>[0]) => connPolicy(permsOf(user));

export function route<A extends unknown[]>(fn: (req: Request, ...a: A) => Promise<Response>) {
  return handle(async (req: Request, ...a: A) => {
    try { return await fn(req, ...a); }
    catch (e) { if (e instanceof ConnectorError || e instanceof ComposioError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
  });
}

// Không để Composio chậm giữ cả trang Connectors / menu +: quá hạn thì trả phần đã biết.
const within = <T,>(p: Promise<T>, ms: number, late: T) => Promise.race([p, new Promise<T>((ok) => setTimeout(() => ok(late), ms))]);
/** Phần Composio của trang Connectors và menu +: trạng thái, connector (quyền công cụ, bật/tắt), số ứng dụng đã kết nối. Không bao giờ có khóa. */
export async function composioSummary(user: UserRow, pol: ConnPolicy, force = false) {
  const state: ComposioStatus = await within(ensureComposio(user.id, pol, force), force ? 30_000 : 8000, "error");
  const on = state === "active" || state === "error";
  return { state, admin: isAdmin(user), connector: on ? composioConnector(user.id, pol) : null, apps: state === "active" ? await within(appCount(user.id), 4000, null) : null };
}
