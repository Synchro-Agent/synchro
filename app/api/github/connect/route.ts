import { appUrl, AuthError, can, current, getUser, handle, limit, requireUser, sameOrigin }
  from "../../../../server/authstore";
import { bindLink, claimHandoff, settleHandoff, startHandoff } from "../../../../server/ghlink";
import { configured, start } from "../../../../server/oauth";
import { timed } from "../../../../server/servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CODE = "Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code.";
const STALE = "Đường dẫn kết nối GitHub này đã hết hạn hoặc đã được dùng. Bấm Kết nối GitHub lại trong ứng dụng"
  + " Synchro.";

// Mở trang cấp quyền GitHub (quyền repo) để kết nối repo vào Synchro Code. Kết quả về /api/github/done.
// ?handoff=<mã>: trang mở ở trình duyệt của máy từ ứng dụng máy tính; token lưu cho tài khoản của app (theo mã),
// không theo tài khoản đang đăng nhập (hay chưa đăng nhập) ở trình duyệt này. Xem server/ghlink.ts.
export const GET = timed(async (req: Request) => {
  const code = new URL(req.url).searchParams.get("handoff");
  let hid: string | null = null;
  try {
    let uid: string;
    if (code !== null) {
      const h = claimHandoff(code);
      if (!h) throw new AuthError(STALE, 400);
      hid = h.id;
      const u = getUser(h.uid);
      if (!u || u.status !== "active") throw new AuthError("Tài khoản Synchro này không còn dùng được.", 403);
      if (!can(u, "code")) throw new AuthError(NO_CODE, 403);
      uid = u.id;
    } else {
      const c = current(req);
      if (!c) throw new AuthError("Bạn cần đăng nhập trước khi kết nối GitHub.", 401);
      if (!can(c.user, "code")) throw new AuthError(NO_CODE, 403);
      uid = c.user.id;
    }
    const { url, state, cookie } = start(req, "github", "link");
    bindLink(state, uid, hid);
    return new Response(null, { status: 302, headers: { Location: url, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch (e) {
    if (!(e instanceof AuthError)) console.error("[github] mở trang kết nối", e);
    const msg = e instanceof AuthError ? e.message : "Lỗi máy chủ. Vui lòng thử lại.";
    settleHandoff(hid, { error: msg });
    const to = `${appUrl(req)}/api/github/done?error=${encodeURIComponent(msg)}${code !== null ? "&app=1" : ""}`;
    return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });
  }
});

// Ứng dụng máy tính xin đường dẫn trao tay để mở trang cấp quyền ở trình duyệt của máy:
// → { id (hỏi kết quả ở GET /api/github?handoff=id), url }.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  if (!can(user, "code")) throw new AuthError(NO_CODE, 403);
  if (!configured("github")) throw new AuthError("Máy chủ chưa bật đăng nhập GitHub.", 503);
  limit(`gh-handoff:${user.id}`, 20, 10 * 60_000);
  const { id, code } = startHandoff(user.id);
  return Response.json({ id, url: `${appUrl(req)}/api/github/connect?handoff=${encodeURIComponent(code)}` });
});
