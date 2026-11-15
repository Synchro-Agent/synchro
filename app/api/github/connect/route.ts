import { appUrl, AuthError, can, current } from "../../../../server/authstore";
import { start } from "../../../../server/oauth";
import { timed } from "../../../../server/servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mở trang cấp quyền GitHub (quyền repo) để kết nối repo vào Synchro Code. Kết quả về /api/github/done.
export const GET = timed(async (req: Request) => {
  try {
    const c = current(req);
    if (!c) throw new AuthError("Bạn cần đăng nhập trước khi kết nối GitHub.", 401);
    if (!can(c.user, "code")) throw new AuthError("Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code.", 403);
    const { url, cookie } = start(req, "github", "link");
    return new Response(null, { status: 302, headers: { Location: url, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof AuthError ? e.message : "Lỗi máy chủ. Vui lòng thử lại.";
    return new Response(null, { status: 302, headers: { Location: `${appUrl(req)}/api/github/done?error=${encodeURIComponent(msg)}` } });
  }
});
