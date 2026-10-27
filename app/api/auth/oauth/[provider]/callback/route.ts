import { appUrl, audit, AuthError, current, oauthLogin } from "../../../../../authstore";
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
    const { cookie } = oauthLogin(req, r);
    h.append("Set-Cookie", cookie);
  } catch (e) {
    if (!(e instanceof AuthError)) console.error("[oauth]", e);
    const msg = encodeURIComponent(e instanceof AuthError ? e.message : "Lỗi máy chủ. Vui lòng thử lại.");
    to = purpose === "link" ? `${appUrl(req)}/api/github/done?error=${msg}` : `${to}?auth_error=${msg}`;
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
