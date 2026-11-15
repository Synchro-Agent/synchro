import { limit, sameOrigin } from "../../../../../server/authstore";
import { listConnectors, refreshConnector } from "../../../../../server/connectors";
import { connectorUser, policyOf, route } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Tải lại danh sách công cụ từ máy chủ MCP (giữ nguyên quyền đã đặt).
export const POST = route(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const user = connectorUser(req);
  const pol = policyOf(user);
  limit("conn:" + user.id, 60, 10 * 60_000);
  const connector = await refreshConnector(user.id, (await params).id, pol);
  return Response.json({ connector, connectors: listConnectors(user.id, pol) });
});
