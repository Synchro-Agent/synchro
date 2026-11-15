import { AuthError, can, handle, requireUser, sameOrigin } from "../../../server/authstore";
import { extAllowed, hasDevice } from "../../../server/browserext";
import { browserDefault, capsState } from "../../../server/caps";
import { agent, ticket } from "../../../server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trình duyệt của Synchro ở khung chat và trang Trình duyệt: Chromium thật trong workspace của người dùng (cùng trình duyệt
// mà model điều khiển qua công cụ browser_*). GET: dùng được không (kèm lý do), có dùng được Chrome của người dùng (tiện ích Synchro)
// không và model mặc định làm ở trình duyệt nào; POST { op: "ticket" }: vé màn hình trực tiếp; { op: "wipe" }: xóa dữ liệu duyệt web.
const lockReason = (k?: string) => k === "admin" ? "Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code và Cloud sandbox, nên chưa dùng được trình duyệt." : k === "server" ? "Máy chủ chưa bật dịch vụ workspace nên chưa có trình duyệt." : undefined;

export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const st = capsState(user);
  const reason = lockReason(st.locks.browse);
  return Response.json({ available: !reason, reason, control: st.caps.browse, ext: { allowed: extAllowed() && can(user, "chrome"), paired: hasDevice(user.id) && can(user, "chrome") }, target: browserDefault(st) });
});

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const st = capsState(user);
  const reason = lockReason(st.locks.browse);
  if (reason) throw new AuthError(reason, 403);
  const b = (await req.json().catch(() => ({}))) as { op?: string };
  // Xóa dữ liệu duyệt web (cookie, đăng nhập, bộ nhớ trang) của trình duyệt Synchro ngay (Cài đặt → Synchro Code → Trình duyệt).
  if (b.op === "wipe") { await agent("/browser", { u: user.id, action: "wipe" }, 60_000); return Response.json({ ok: true }); }
  if (b.op !== "ticket") throw new AuthError("Thao tác không hợp lệ.", 400);
  await agent("/ensure", { u: user.id });
  return Response.json({ url: ticket(req, user.id, "browser", "screen") });
});
