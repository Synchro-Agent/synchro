import { limit, sameOrigin } from "../../../authstore";
import { disconnectApp, listApps } from "../../../composio";
import { composioSummary, connectorUser, policyOf, route } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Composio của tài khoản: trạng thái và các ứng dụng đã kết nối (Gmail, Slack…). ?retry=1: thử tạo lại phiên ngay (nút Thử lại).
export const GET = route(async (req) => {
  const user = connectorUser(req);
  const policy = policyOf(user);
  const retry = new URL(req.url).searchParams.get("retry") === "1";
  if (retry) limit("cx:" + user.id, 20, 10 * 60_000);
  const s = await composioSummary(user, policy, retry);
  if (s.state !== "active") return Response.json({ ...s, list: [] });
  try { return Response.json({ ...s, list: await listApps(user.id, true) }); }
  catch (e) { return Response.json({ ...s, list: [], appsError: (e as Error).message }); }
});

// Ngắt một ứng dụng khỏi Composio (chỉ ứng dụng của chính tài khoản này): ?id=<mã tài khoản đã kết nối>.
export const DELETE = route(async (req) => {
  sameOrigin(req);
  const user = connectorUser(req);
  const policy = policyOf(user);
  limit("cx:" + user.id, 20, 10 * 60_000);
  const app = await disconnectApp(user.id, new URL(req.url).searchParams.get("id") ?? "");
  const s = await composioSummary(user, policy);
  return Response.json({ ...s, removed: app.name, list: await listApps(user.id, true).catch(() => []) });
});
