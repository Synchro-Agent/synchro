import { handle, requireUser, sameOrigin } from "../../../../authstore";
import { MeetingError, updateItem } from "../../../../meetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sửa việc cần làm: { done, assignee, due (YYYY-MM-DD | null), text }.
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  try { return Response.json({ item: updateItem(user.id, (await ctx.params).id, await req.json().catch(() => ({}))) }); }
  catch (e) { if (e instanceof MeetingError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
