import { authErrorCode } from "../../../../../../shared/autherrors";
import { connectIdentity, appUrl, audit, AuthError, clientIp, current, getUser, limit, oauthLogin }
  from "../../../../../../server/authstore";
import { afterClaim, noticeDropped } from "../../../../../../server/claim";
import { saveLink } from "../../../../../../server/github";
import { peekLink, settleHandoff, takeLink } from "../../../../../../server/ghlink";
import { clearState, connectUser, finish, isProvider, purposeOf, stateOf } from "../../../../../../server/oauth";
import { timed } from "../../../../../../server/servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ provider: string }> };

async function done(req: Request, provider: string, params: URLSearchParams) {
  const h = new Headers({ "Cache-Control": "no-store" });
  let to = `${appUrl(req)}/`;
  const purpose = isProvider(provider) ? purposeOf(req, provider) : "login";
  // Kết nối GitHub bắt đầu từ ứng dụng máy tính: kết quả (cả khi lỗi) báo về lượt trao tay để app biết ngay.
  const state = purpose === "link" && isProvider(provider) ? stateOf(req, provider) : "";
  const handoff = peekLink(state);
  const doneUrl = (error?: string) => {
    const q = new URLSearchParams(error ? { error } : {});
    if (handoff) q.set("app", "1");
    const qs = q.toString();
    return `${appUrl(req)}/api/github/done${qs ? `?${qs}` : ""}`;
  };
  try {
    if (!isProvider(provider)) throw new AuthError("Không hỗ trợ cách đăng nhập này.", 404);
    h.append("Set-Cookie", clearState(req, provider));
    const r = await finish(req, provider, params);
    if (purpose === "link") {
      // Kết nối GitHub cho Synchro Code: lưu token vào đúng tài khoản đã bấm Kết nối (vé của lượt này), không theo
      // cookie của trình duyệt: ứng dụng máy tính cấp quyền ở trình duyệt có thể đang đăng nhập tài khoản khác.
      const t = takeLink(state);
      if (!t) throw new AuthError("Lượt kết nối GitHub đã hết hạn. Bấm Kết nối GitHub lại.", 400);
      const who = getUser(t.uid);
      if (!who || who.status !== "active") throw new AuthError("Tài khoản Synchro này không còn dùng được.", 403);
      if (!r.token || !r.login) throw new AuthError("GitHub không trả về quyền truy cập.", 502);
      saveLink(who.id, { id: r.subject, login: r.login, token: r.token, scopes: r.scopes ?? "", refresh: r.refresh,
        expiresIn: r.expiresIn, refreshExpiresIn: r.refreshExpiresIn });
      audit("github_link", { actor: who, target: who, detail: r.login });
      settleHandoff(t.handoff, { login: r.login });
      h.set("Location", doneUrl());
      return new Response(null, { status: 303, headers: h });
    }
    if (purpose === "connect") {
      // Đúng tài khoản đã bấm thêm, kể cả khi yêu cầu không có cookie phiên (Apple) hay tab khác vừa đổi tài khoản. Không có vé (bắt đầu trước khi khởi động lại): theo phiên hiện tại.
      const who = connectUser(req, provider) ?? current(req)?.user;
      if (!who) throw new AuthError("Bạn cần đăng nhập trước khi thêm cách đăng nhập.", 401);
      connectIdentity(req, who, r);
      h.set("Location", `${appUrl(req)}/?settings=Account&msg=${encodeURIComponent("Sign-in method added")}`);
      return new Response(null, { status: 303, headers: h });
    }
    const { cookie, user, claimed, fresh, dropped, mfa } = oauthLogin(req, r);
    h.append("Set-Cookie", cookie);
    if (mfa) to = `${appUrl(req)}/?mfa=1`;
    if (claimed) {
      // Nhận lại tài khoản chưa xác minh: thứ người đăng ký trước có thể đã gắn vào phải tắt, và người dùng phải được báo (không âm thầm mất mật khẩu).
      await afterClaim(user.id, fresh, "oauth", claimed === "password");
      if (dropped) noticeDropped(user.id);
    }
  } catch (e) {
    if (!(e instanceof AuthError)) console.error("[oauth]", e);
    // Quản trị viên thấy lỗi gần nhất của từng nhà cung cấp (khóa bị thu hồi…); người dùng tự hủy hoặc phiên hết hạn không phải lỗi cấu hình.
    if (purpose === "login" && isProvider(provider) && !/hủy đăng nhập|Phiên đăng nhập đã hết hạn/.test((e as Error).message)) {
      try { limit("oauth-fail:" + clientIp(req), 20, 900_000); audit("oauth_failed", { ip: clientIp(req), detail: `${provider}: ${(e as Error).message}`.slice(0, 300) }); } catch { /* quá nhiều: bỏ qua, không ghi đầy nhật ký */ }
    }
    const text = e instanceof AuthError ? e.message : "Lỗi máy chủ. Vui lòng thử lại.";
    if (purpose === "link") settleHandoff(handoff, { error: text });
    const added = /khác\.$/.test(text) ? "That account is already linked to another Synchro account"
      : "Couldn't add the sign-in method";
    to = purpose === "link" ? doneUrl(text)
      : purpose === "connect" ? `${to}?settings=Account&msg=${encodeURIComponent(added)}`
      : `${to}?auth_error=${authErrorCode(text)}`;
  }
  h.set("Location", to);
  return new Response(null, { status: 303, headers: h });
}

export const GET = timed(async (req: Request, { params }: Ctx) => {
  return done(req, (await params).provider, new URL(req.url).searchParams);
});

// Apple trả kết quả bằng form POST (response_mode=form_post).
export const POST = timed(async (req: Request, { params }: Ctx) => {
  return done(req, (await params).provider, new URLSearchParams(await req.text()));
});
