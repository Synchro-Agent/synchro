import { appUrl, AuthError, current } from "../../../authstore";
import { start } from "../../../oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mở trang cấp quyền GitHub (quyền repo) để kết nối repo vào Synchro Code. Kết quả về /api/github/done.
export async function GET(req: Request) {
  try {
    const c = current(req);
    if (!c) throw new AuthError("Bạn cần đăng nhập trước khi kết nối GitHub.", 401);
    const { url, cookie } = start(req, "github", "link");
    return new Response(null, { status: 302, headers: { Location: url, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof AuthError ? e.message : "Lỗi máy chủ. Vui lòng thử lại.";
    return new Response(null, { status: 302, headers: { Location: `${appUrl(req)}/api/github/done?error=${encodeURIComponent(msg)}` } });
  }
}
