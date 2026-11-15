import { audit, clearSessionCookie, clientIp, current, db, handle, sameOrigin, withCookies } from "../../../../server/authstore";
import { dropLiveBridge } from "../../../../server/mcpbridge";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  sameOrigin(req);
  const c = current(req);
  if (c) {
    db().prepare("DELETE FROM sessions WHERE id = ?").run(c.session.id);
    audit("logout", { actor: c.user, ip: clientIp(req) });
    // Thiết bị cuối cùng đăng xuất: bỏ mọi địa chỉ cầu nối sống của người dùng (G2.2). Còn thiết bị khác thì giữ: lượt đang chạy ở đó vẫn gọi công cụ qua địa chỉ này.
    const left = db().prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(c.user.id) as { n: number } | undefined;
    if (!left?.n) dropLiveBridge(c.user.id);
  }
  return withCookies(Response.json({ ok: true }), clearSessionCookie(req));
});
