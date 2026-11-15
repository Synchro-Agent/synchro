import { limit, sameOrigin } from "../../../../../server/authstore";
import { connect, listConnectors } from "../../../../../server/connectors";
import { connectorUser, policyOf, route } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Kết nối lại: thử máy chủ, cần đăng nhập thì trả về authorizeUrl để mở cửa sổ đăng nhập.
// { force: true }: đăng nhập lại / cấp thêm quyền ngay cả khi đang chạy tốt. { token, header? } hoặc { clientId, clientSecret? }: dùng thông tin đăng nhập người dùng tự nhập.
export const POST = route(async (req, { params }: Ctx) => {
  sameOrigin(req);
  const user = connectorUser(req);
  const pol = policyOf(user);
  limit("conn:" + user.id, 60, 10 * 60_000);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await connect(req, user.id, (await params).id, pol, { force: body.force === true, token: body.token, header: body.header, clientId: body.clientId, clientSecret: body.clientSecret });
  return Response.json({ ...r, connectors: listConnectors(user.id, pol) });
});
