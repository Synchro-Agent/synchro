import { authErrorCode } from "../../../../../autherrors";
import { connectIdentity, appUrl, audit, AuthError, clientIp, current, limit, oauthLogin } from "../../../../../authstore";
import { afterClaim } from "../../../../../claim";
import { saveLink } from "../../../../../github";
import { clearState, finish, isProvider, purposeOf } from "../../../../../oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ provider: string }> };

async function done(req: Request, provider: string, params: URLSearchParams) {
  const h = new Headers({ "Cache-Control": "no-store" });
  let to = `${appUrl(req)}/`;
  const purpose = isProvider(provider) ? purposeOf(req, provider) : "login";
  try {
    if (!isProvider(provider)) throw new AuthError("Không hỗ trợ cách đăng nhập này.", 404);
    h.append("Set-Cookie", clearState(req, provider));
    const r = await finish(req, provider, params);
    if (purpose === "link") {
      // Kết nối GitHub cho Synchro Code: lưu token vào tài khoản đang đăng nhập rồi báo cho cửa sổ chính.
      const c = current(req);
      if (!c) throw new AuthError("Bạn cần đăng nhập trước khi kết nối GitHub.", 401);
      if (!r.token || !r.login) throw new AuthError("GitHub không trả về quyền truy cập.", 502);
      saveLink(c.user.id, { id: r.subject, login: r.login, token: r.token, scopes: r.scopes ?? "", refresh: r.refresh, expiresIn: r.expiresIn, refreshExpiresIn: r.refreshExpiresIn });
      audit("github_link", { actor: c.user, target: c.user, detail: r.login });
      h.set("Location", `${appUrl(req)}/api/github/done`);
      return new Response(null, { status: 303, headers: h });
    }
    if (purpose === "connect") {
      const c = current(req);
      if (!c) throw new AuthError("Bạn cần đăng nhập trước khi thêm cách đăng nhập.", 401);
      connectIdentity(req, c.user, r);
      h.set("Location", `${appUrl(req)}/?settings=Account&msg=${encodeURIComponent("Sign-in method added")}`);
      return new Response(null, { status: 303, headers: h });
    }
    const { cookie, user, claimed, fresh } = oauthLogin(req, r);
    h.append("Set-Cookie", cookie);
    if (claimed) {
      // Nhận lại tài khoản chưa xác minh: thứ người đăng ký trước có thể đã gắn vào phải tắt, và người dùng phải được báo (không âm thầm mất mật khẩu).
      await afterClaim(user.id, fresh, "oauth", claimed === "password");
    }
  } catch (e) {
    if (!(e instanceof AuthError)) console.error("[oauth]", e);
    // Quản trị viên thấy lỗi gần nhất của từng nhà cung cấp (khóa bị thu hồi…); người dùng tự hủy hoặc phiên hết hạn không phải lỗi cấu hình.
    if (purpose === "login" && isProvider(provider) && !/hủy đăng nhập|Phiên đăng nhập đã hết hạn/.test((e as Error).message)) {
      try { limit("oauth-fail:" + clientIp(req), 20, 900_000); audit("oauth_failed", { ip: clientIp(req), detail: `${provider}: ${(e as Error).message}`.slice(0, 300) }); } catch { /* quá nhiều: bỏ qua, không ghi đầy nhật ký */ }
    }
    const text = e instanceof AuthError ? e.message : "Lỗi máy chủ. Vui lòng thử lại.";
    to = purpose === "link" ? `${appUrl(req)}/api/github/done?error=${encodeURIComponent(text)}` : purpose === "connect" ? `${to}?settings=Account&msg=${encodeURIComponent(/khác\.$/.test(text) ? "That account is already linked to another Synchro account" : "Couldn't add the sign-in method")}` : `${to}?auth_error=${authErrorCode(text)}`;
  }
  h.set("Location", to);
  return new Response(null, { status: 303, headers: h });
}

export async function GET(req: Request, { params }: Ctx) {
  return done(req, (await params).provider, new URL(req.url).searchParams);
}

// Apple trả kết quả bằng form POST (response_mode=form_post).
export async function POST(req: Request, { params }: Ctx) {
  return done(req, (await params).provider, new URLSearchParams(await req.text()));
}
