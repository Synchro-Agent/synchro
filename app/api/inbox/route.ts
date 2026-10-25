import { handle, requireUser, sameOrigin } from "../../authstore";
import { inbox, markRead } from "../../tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hộp thư: kết quả các lần chạy tác vụ nền. POST { read: [mã lượt] | "all" } đánh dấu đã đọc.
export const GET = handle(async (req: Request) => Response.json(inbox(requireUser(req).user.id)));
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = await req.json().catch(() => ({}));
  markRead(user.id, b.read === "all" ? "all" : Array.isArray(b.read) ? b.read.filter((x: unknown): x is string => typeof x === "string") : []);
  return Response.json(inbox(user.id));
});
