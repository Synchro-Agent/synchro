import { AuthError, clientIp, handle, limit, requireAdmin, sameOrigin } from "../../../authstore";
import { reportShare, shareReports, takeDownShare } from "../../../sharestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Báo cáo một liên kết chia sẻ (người xem không cần đăng nhập): lưu lại và gửi thư cho quản trị viên.
// GET: quản trị viên xem danh sách. DELETE ?token=: quản trị viên gỡ bản chia sẻ vi phạm.
export const POST = handle(async (req) => {
  sameOrigin(req);
  limit("share-report:" + clientIp(req), 5, 10 * 60_000);
  const b = (await req.json().catch(() => null)) as { token?: unknown; reason?: unknown } | null;
  if (!b || !reportShare(String(b.token ?? ""), String(b.reason ?? ""), clientIp(req))) throw new AuthError("Không tìm thấy bản chia sẻ này.", 404);
  return Response.json({ ok: true });
});
export const GET = handle(async (req) => { requireAdmin(req); return Response.json({ reports: shareReports() }); });
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  requireAdmin(req);
  return Response.json({ ok: takeDownShare(new URL(req.url).searchParams.get("token") ?? "") });
});
