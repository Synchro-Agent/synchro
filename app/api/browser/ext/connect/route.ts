import { AuthError, can, handle } from "../../../../../server/authstore";
import { avatarOf, CHROME_LOCKED, deviceOf, extAllowed, touchDevice } from "../../../../../server/browserext";
import { ticket } from "../../../../../server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tiện ích Synchro (Authorization: Bearer <khóa của trình duyệt>) xin vé WebSocket một phút để nối tới /ws-agent/ext.
// Trình duyệt đã bị gỡ hoặc tài khoản bị khóa: 401, tiện ích quay về màn hình ghép nối.
export const POST = handle(async (req) => {
  const { row, user } = deviceOf(req);
  if (!extAllowed()) throw new AuthError("Máy chủ Synchro này chưa bật dịch vụ workspace.", 501);
  if (!can(user, "chrome")) throw new AuthError(CHROME_LOCKED, 403);
  const b = (await req.json().catch(() => ({}))) as { name?: string; browser?: string };
  touchDevice(row.id, { name: b.name, browser: b.browser });
  return Response.json({ url: ticket(req, user.id, row.id, "ext"), device: { id: row.id, name: row.name }, user: { name: user.full_name || user.name, email: user.email, avatar: avatarOf(user.avatar) } });
});
