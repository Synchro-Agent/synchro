// Dùng chung cho các route connector: kiểm tra đăng nhập + quyền dùng connector, đổi lỗi thành JSON.
import { AuthError, can, handle, requireUser } from "../../authstore";
import { ConnectorError } from "../../connectors";

export function connectorUser(req: Request) {
  const { user } = requireUser(req);
  if (!can(user, "connectors")) throw new AuthError("Quản trị viên chưa cho phép tài khoản của bạn dùng connector.", 403);
  return user;
}

export function route<A extends unknown[]>(fn: (req: Request, ...a: A) => Promise<Response>) {
  return handle(async (req: Request, ...a: A) => {
    try { return await fn(req, ...a); }
    catch (e) { if (e instanceof ConnectorError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
  });
}
