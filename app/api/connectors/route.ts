import { limit, sameOrigin } from "../../authstore";
import { addConnector, listConnectors } from "../../connectors";
import { DIRECTORY } from "../../connectordir";
import { connectorUser, policyOf, route } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Danh sách connector của tài khoản và danh mục connector có sẵn.
export const GET = route(async (req) => {
  const user = connectorUser(req);
  const policy = policyOf(user);
  return Response.json({ connectors: listConnectors(user.id, policy), directory: DIRECTORY, policy });
});

// Thêm connector: { dir } từ danh mục, hoặc { name, url, clientId?, clientSecret?, token?, header? } tùy chỉnh. Trả về authorizeUrl nếu cần đăng nhập.
export const POST = route(async (req) => {
  sameOrigin(req);
  const user = connectorUser(req);
  limit("conn:" + user.id, 60, 10 * 60_000);
  const body = await req.json().catch(() => ({}));
  const policy = policyOf(user);
  const r = await addConnector(req, user.id, body, policy);
  return Response.json({ ...r, connectors: listConnectors(user.id, policy) });
});
