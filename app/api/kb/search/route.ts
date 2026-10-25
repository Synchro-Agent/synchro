import { handle, limit, requireUser } from "../../../authstore";
import { searchKb } from "../../../kb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Thử tìm trong kho tài liệu (trang Tri thức): ?q=… → các đoạn khớp nhất.
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  limit("kbq:" + user.id, 120, 60_000);
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 500);
  return Response.json({ hits: searchKb(user, q, 8).map(({ score: _s, ...h }) => h) });
});
