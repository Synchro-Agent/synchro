// Dùng chung cho các route connector: kiểm tra đăng nhập + quyền dùng connector, đổi lỗi thành JSON.
import "server-only";
import { AuthError, can, handle, permsOf, requireUser, VERIFY_FIRST, verifyLocked } from "../authstore";
import { connPolicy } from "../../shared/catalog";
import { ConnectorError } from "../connectors";

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
    catch (e) { if (e instanceof ConnectorError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
  });
}
