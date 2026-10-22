import { appUrl, AuthError, oauthLogin } from "../../../../../authstore";
import { clearState, finish, isProvider } from "../../../../../oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ provider: string }> };

async function done(req: Request, provider: string, params: URLSearchParams) {
  const h = new Headers({ "Cache-Control": "no-store" });
  let to = `${appUrl(req)}/`;
  try {
    if (!isProvider(provider)) throw new AuthError("Không hỗ trợ cách đăng nhập này.", 404);
    h.append("Set-Cookie", clearState(req, provider));
    const { cookie } = oauthLogin(req, await finish(req, provider, params));
    h.append("Set-Cookie", cookie);
  } catch (e) {
    if (!(e instanceof AuthError)) console.error("[oauth]", e);
    to += `?auth_error=${encodeURIComponent(e instanceof AuthError ? e.message : "Lỗi máy chủ. Vui lòng thử lại.")}`;
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
