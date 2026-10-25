import { limit, sameOrigin } from "../../../../authstore";
import { listConnectors, refreshConnector } from "../../../../connectors";
import { connectorUser, route } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Tải lại danh sách công cụ từ máy chủ MCP (giữ nguyên quyền đã đặt).
export const POST = route(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const user = connectorUser(req);
  limit("conn:" + user.id, 60, 10 * 60_000);
  const connector = await refreshConnector(user.id, (await params).id);
  return Response.json({ connector, connectors: listConnectors(user.id) });
});
