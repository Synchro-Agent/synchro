import { authErrorCode } from "../../../../../shared/autherrors";
import { appUrl, AuthError } from "../../../../../server/authstore";
import { isProvider, start } from "../../../../../server/oauth";
import { timed } from "../../../../../server/servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ provider: string }> };

// Chuyển hướng sang trang đăng nhập của Google / GitHub / Apple.
export const GET = timed(async (req: Request, { params }: Ctx) => {
  const p = (await params).provider;
  try {
    if (!isProvider(p)) throw new AuthError("Không hỗ trợ cách đăng nhập này.", 404);
    const { url, cookie } = start(req, p);
    return new Response(null, { status: 302, headers: { Location: url, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof AuthError ? e.message : "Lỗi máy chủ. Vui lòng thử lại.";
    return new Response(null, { status: 302, headers: { Location: `${appUrl(req)}/?auth_error=${authErrorCode(msg)}` } });
  }
});
