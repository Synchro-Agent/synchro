import { AuthError, handle, requireUser, sameOrigin } from "../../authstore";
import { capsState } from "../../caps";
import { agent, ticket } from "../../workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trình duyệt của Synchro ở khung chat và trang Trình duyệt: Chromium thật trong workspace của người dùng (cùng trình duyệt
// mà model điều khiển qua công cụ browser_*). GET: dùng được không (kèm lý do); POST { op: "ticket" }: vé màn hình trực tiếp.
const lockReason = (k?: string) => k === "admin" ? "Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code và Cloud sandbox, nên chưa dùng được trình duyệt." : k === "server" ? "Máy chủ chưa bật dịch vụ workspace nên chưa có trình duyệt." : undefined;

export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const st = capsState(user);
  const reason = lockReason(st.locks.browse);
  return Response.json({ available: !reason, reason, control: st.caps.browse });
});

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const st = capsState(user);
  const reason = lockReason(st.locks.browse);
  if (reason) throw new AuthError(reason, 403);
  const b = (await req.json().catch(() => ({}))) as { op?: string };
  if (b.op !== "ticket") throw new AuthError("Thao tác không hợp lệ.", 400);
  await agent("/ensure", { u: user.id });
  return Response.json({ url: ticket(req, user.id, "browser", "screen") });
});
