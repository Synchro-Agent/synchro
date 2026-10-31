import { AuthError, audit, clientIp, handle, limit } from "../../../../authstore";
import { avatarOf, extAllowed, redeemPairCode } from "../../../../browserext";
import { setUserCaps } from "../../../../caps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tiện ích Synchro đổi mã ghép nối (người dùng lấy trong Cài đặt → Khả năng → Trình duyệt của bạn) lấy khóa riêng của trình duyệt đó.
// Không dùng cookie (tiện ích gọi từ nền), nên không cần kiểm tra cùng nguồn; giới hạn số lần thử theo địa chỉ IP.
// Trình duyệt đầu tiên của tài khoản: từ giờ Synchro làm mặc định trên trình duyệt này (đổi lại được ở khung trình duyệt).
export const POST = handle(async (req) => {
  limit(`ext-pair:${clientIp(req)}`, 10, 10 * 60_000);
  if (!extAllowed()) throw new AuthError("Máy chủ Synchro này chưa bật dịch vụ workspace nên chưa nối được trình duyệt.", 501);
  const b = (await req.json().catch(() => ({}))) as { code?: string; name?: string; browser?: string };
  const r = redeemPairCode(b.code, { name: b.name, browser: b.browser });
  if (r.first) setUserCaps(r.user.id, { mine: true });
  audit("browser_ext_pair", { actor: r.user, ip: clientIp(req), detail: `${r.device.name}${b.browser ? ` · ${String(b.browser).slice(0, 40)}` : ""}` });
  return Response.json({ token: r.token, device: r.device, user: { name: r.user.full_name || r.user.name, email: r.user.email, avatar: avatarOf(r.user.avatar) } });
});
