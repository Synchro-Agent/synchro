import { limit, sameOrigin } from "../../../../authstore";
import { connect, listConnectors } from "../../../../connectors";
import { connectorUser, policyOf, route } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Kết nối lại: thử máy chủ, cần đăng nhập thì trả về authorizeUrl để mở cửa sổ đăng nhập.
export const POST = route(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const user = connectorUser(req);
  const pol = policyOf(user);
  limit("conn:" + user.id, 60, 10 * 60_000);
  const r = await connect(req, user.id, (await params).id, pol);
  return Response.json({ ...r, connectors: listConnectors(user.id, pol) });
});
