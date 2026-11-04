import { handle, requireUser, sameOrigin } from "../../authstore";
import { inbox, inboxCount, markRead, markUnread, removeItems } from "../../tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hộp thư: kết quả các lần chạy tác vụ nền, theo trang (?before=<mốc>&limit=). ?count=1: chỉ số đếm cho thanh bên, không có nội dung. POST { read: [mã lượt] | "all" } đánh dấu đã đọc; { unread: [...] } chưa đọc; { remove: [...] } gỡ khỏi Hộp thư.
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const q = new URL(req.url).searchParams;
  if (q.get("count")) return Response.json(inboxCount(user.id));
  return Response.json(inbox(user.id, { before: Number(q.get("before")) || undefined, limit: Number(q.get("limit")) || undefined }));
});
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
