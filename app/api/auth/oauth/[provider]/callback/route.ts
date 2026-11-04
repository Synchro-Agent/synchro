import { appUrl, audit, AuthError, clientIp, current, limit, oauthLogin } from "../../../../../authstore";
import { removeUserDevices } from "../../../../../browserext";
import { disableUserConnectors } from "../../../../../connectors";
import { addNotice } from "../../../../../tasks";
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
    const { cookie, user, claimed } = oauthLogin(req, r);
    h.append("Set-Cookie", cookie);
    if (claimed) {
      // Nhận lại tài khoản chưa xác minh: thứ người đăng ký trước có thể đã gắn vào phải tắt, và người dùng phải được báo (không âm thầm mất mật khẩu).
      await removeUserDevices(user.id).catch((e) => console.error("[oauth]", e));
      const off = disableUserConnectors(user.id);
      addNotice(user.id, "Đã xác minh email của bạn", `${claimed === "password" ? "Mật khẩu cũ đã được gỡ vì email chưa từng được xác minh, nên có thể do người khác đặt. Nếu vẫn muốn đăng nhập bằng email, hãy đặt mật khẩu mới trong Cài đặt → Tài khoản. " : ""}Các thiết bị khác đã được đăng xuất, tiện ích Chrome đã ghép nối được gỡ${off ? ", connector đã được tắt (bật lại trong Cài đặt nếu đúng là của bạn)" : ""}. Hãy kiểm tra hướng dẫn tùy chỉnh trong Cài đặt.`, "settings:Account");
    }
  } catch (e) {
    if (!(e instanceof AuthError)) console.error("[oauth]", e);
    // Quản trị viên thấy lỗi gần nhất của từng nhà cung cấp (khóa bị thu hồi…); người dùng tự hủy hoặc phiên hết hạn không phải lỗi cấu hình.
    if (purpose === "login" && isProvider(provider) && !/hủy đăng nhập|Phiên đăng nhập đã hết hạn/.test((e as Error).message)) {
      try { limit("oauth-fail:" + clientIp(req), 20, 900_000); audit("oauth_failed", { ip: clientIp(req), detail: `${provider}: ${(e as Error).message}`.slice(0, 300) }); } catch { /* quá nhiều: bỏ qua, không ghi đầy nhật ký */ }
    }
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
