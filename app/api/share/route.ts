import { AuthError, handle, requireUser, sameOrigin } from "../../authstore";
import { listShares, putShare, revokeConvShare, revokeShare, shareOfConv } from "../../sharestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liên kết chia sẻ của chính người dùng. GET: danh sách (?conv=: liên kết của một đoạn chat). POST { conv, title, msgs }: tạo hoặc cập nhật bản chụp.
// DELETE ?token= hoặc ?conv=: dừng chia sẻ. Trang xem công khai ở /share/<mã> không đi qua đây.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const conv = new URL(req.url).searchParams.get("conv");
  return Response.json(conv ? { share: shareOfConv(user.id, conv) } : { shares: listShares(user.id) });
});
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => null)) as { conv?: unknown; title?: unknown; msgs?: unknown } | null;
  if (!b) throw new AuthError("Yêu cầu không hợp lệ.", 400);
  return Response.json({ share: await putShare(user.id, b.conv, b.title, b.msgs) });
});
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const q = new URL(req.url).searchParams, token = q.get("token"), conv = q.get("conv");
  return Response.json({ ok: token ? revokeShare(user.id, token) : conv ? revokeConvShare(user.id, conv) : false });
});
