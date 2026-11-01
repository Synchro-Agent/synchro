import { handle, requireUser, sameOrigin } from "../../authstore";
import { inbox, markRead, markUnread, removeItems } from "../../tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hộp thư: kết quả các lần chạy tác vụ nền. POST { read: [mã lượt] | "all" } đánh dấu đã đọc; { unread: [...] } chưa đọc; { remove: [...] } gỡ khỏi Hộp thư.
export const GET = handle(async (req: Request) => Response.json(inbox(requireUser(req).user.id)));
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = await req.json().catch(() => ({}));
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === "string") : []);
  if (b.read !== undefined) markRead(user.id, b.read === "all" ? "all" : ids(b.read));
  if (b.unread !== undefined) markUnread(user.id, ids(b.unread));
  if (b.remove !== undefined) removeItems(user.id, ids(b.remove));
  return Response.json(inbox(user.id));
});
