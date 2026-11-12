import { limit, sameOrigin } from "../../authstore";
import { addConnector, composioInfo, listConnectors } from "../../connectors";
import { connectorUser, policyOf, route } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Composio của bạn (có sẵn cho mọi tài khoản, chờ liên kết) và connector người dùng tự thêm.
export const GET = route(async (req) => {
  const user = connectorUser(req);
  const policy = policyOf(user);
  return Response.json({ composio: composioInfo(user.id, policy), connectors: listConnectors(user.id, policy), policy });
});

// Thêm connector tự kết nối: { name, url, … } (giao diện không còn danh mục gợi ý; { dir } vẫn nhận cho connector danh mục cũ), hoặc { name, url, clientId?, clientSecret?, token?, header? } tùy chỉnh. Trả về authorizeUrl nếu cần đăng nhập.
export const POST = route(async (req) => {
  sameOrigin(req);
  const user = connectorUser(req);
  limit("conn:" + user.id, 60, 10 * 60_000);
  const body = await req.json().catch(() => ({}));
  const policy = policyOf(user);
  const r = await addConnector(req, user.id, body, policy);
  return Response.json({ ...r, connectors: listConnectors(user.id, policy) });
});
