// Dùng chung cho các route connector: kiểm tra đăng nhập, đổi lỗi thành JSON.
import { handle, requireUser } from "../../authstore";
import { ConnectorError } from "../../connectors";

export const connectorUser = (req: Request) => requireUser(req).user;

export function route<A extends unknown[]>(fn: (req: Request, ...a: A) => Promise<Response>) {
  return handle(async (req: Request, ...a: A) => {
    try { return await fn(req, ...a); }
    catch (e) { if (e instanceof ConnectorError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
  });
}
