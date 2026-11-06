import { AuthError, disconnectIdentity, getUser, handle, publicUser, requireUser, sameOrigin } from "../../../authstore";
import { isProvider, start } from "../../../oauth";

export const runtime = "nodejs";

// POST { provider }: bắt đầu thêm cách đăng nhập (trả về địa chỉ của nhà cung cấp). Dùng POST để trang khác không tự khởi động được.
export const POST = handle(async (req) => {
  sameOrigin(req);
  requireUser(req);
  const { provider } = await req.json();
  if (!isProvider(provider)) throw new AuthError("Không hỗ trợ cách đăng nhập này.", 404);
  const { url, cookie } = start(req, provider, "connect");
  return new Response(JSON.stringify({ url }), { headers: { "content-type": "application/json", "Set-Cookie": cookie, "Cache-Control": "no-store" } });
});
// DELETE { provider }: gỡ cách đăng nhập; từ chối nếu đó là cách cuối cùng.
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const { provider } = await req.json();
  disconnectIdentity(req, user, provider);
  return Response.json({ user: publicUser(getUser(user.id)!) });
});
