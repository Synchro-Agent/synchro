import { limit, sameOrigin } from "../../../../server/authstore";
import { composioInfo, linkComposio, unlinkComposio } from "../../../../server/connectors";
import { connectorUser, policyOf, route } from "../../../../server/routes/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Composio của bạn: trạng thái liên kết (không liệt kê ứng dụng: ứng dụng được liên kết trên trang của Composio).
export const GET = route(async (req) => {
  const user = connectorUser(req);
  return Response.json({ composio: composioInfo(user.id, policyOf(user)) });
});

// "Liên kết Composio": {} → đăng nhập Composio trong cửa sổ bật lên (trả authorizeUrl); { key: "ck_…" } (Nâng cao) → thử khóa với Composio rồi lưu (mã hóa).
export const POST = route(async (req) => {
  sameOrigin(req);
  const user = connectorUser(req);
  limit("cx:" + user.id, 30, 10 * 60_000);
  const body = await req.json().catch(() => ({}));
  const policy = policyOf(user);
  const r = await linkComposio(req, user.id, policy, { key: (body as { key?: unknown })?.key });
  return Response.json({ authorizeUrl: r.authorizeUrl, connector: r.connector, composio: composioInfo(user.id, policy) });
});

// "Ngắt liên kết": Synchro quên token / khóa Composio của tài khoản này.
export const DELETE = route(async (req) => {
  sameOrigin(req);
  const user = connectorUser(req);
  return Response.json({ composio: unlinkComposio(user.id, policyOf(user)) });
});
