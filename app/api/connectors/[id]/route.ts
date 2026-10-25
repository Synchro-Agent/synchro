import { sameOrigin } from "../../../authstore";
import { listConnectors, removeConnector, updateConnector } from "../../../connectors";
import { connectorUser, route } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// { enabled?, name?, perms?: { tên công cụ: "allow" | "ask" | "block" }, group?: { kind: "read" | "write", perm } }
export const PATCH = route(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const user = connectorUser(req);
  const connector = updateConnector(user.id, (await params).id, await req.json().catch(() => ({})));
  return Response.json({ connector, connectors: listConnectors(user.id) });
});

export const DELETE = route(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const user = connectorUser(req);
  removeConnector(user.id, (await params).id);
  return Response.json({ connectors: listConnectors(user.id) });
});
