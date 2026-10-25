import { limit, sameOrigin } from "../../authstore";
import { addConnector, listConnectors } from "../../connectors";
import { DIRECTORY } from "../../connectordir";
import { connectorUser, route } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Danh sách connector của tài khoản và danh mục connector có sẵn.
export const GET = route(async (req) => {
  const user = connectorUser(req);
  return Response.json({ connectors: listConnectors(user.id), directory: DIRECTORY });
});

// Thêm connector: { dir } từ danh mục, hoặc { name, url, clientId?, clientSecret? } tùy chỉnh. Trả về authorizeUrl nếu cần đăng nhập.
export const POST = route(async (req) => {
  sameOrigin(req);
  const user = connectorUser(req);
  limit("conn:" + user.id, 60, 10 * 60_000);
  const body = await req.json().catch(() => ({}));
  const r = await addConnector(req, user.id, body);
  return Response.json({ ...r, connectors: listConnectors(user.id) });
});
