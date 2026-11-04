import { AppError } from "../../../../appstore";
import { handle, limit, requireUser } from "../../../../authstore";
import { mentionable } from "../../../../collab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gợi ý người để @nhắc trong bình luận (chỉ người đã tham gia ứng dụng): ?q=tên.
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = requireUser(req);
  limit("people:" + user.id, 60, 60_000);
  try { return Response.json({ people: mentionable(user, (await ctx.params).id, new URL(req.url).searchParams.get("q") ?? "") }); }
  catch (e) { if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
