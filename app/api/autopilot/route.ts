import { handle, requireUser, sameOrigin } from "../../../server/authstore";
import { inbox, inboxCount, markRead, markUnread, removeItems } from "../../../server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Autopilot: kết quả các lần chạy (và thông báo không cần model), theo trang (?before=<mốc>&limit=). ?count=1: chỉ số
// đếm cho thanh bên, không có nội dung. POST { read: [mã lượt] | "all" } đánh dấu đã đọc; { unread: [...] } chưa đọc; {
// remove: [...] } gỡ khỏi danh sách Kết quả (việc và lịch giữ nguyên). Địa chỉ cũ /api/inbox xuất lại đúng các hàm này.
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const q = new URL(req.url).searchParams;
  if (q.get("count")) return Response.json(inboxCount(user.id));
  const before = Number(q.get("before")) || undefined, max = Number(q.get("limit")) || undefined;
  return Response.json(inbox(user.id, { before, limit: max }));
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
