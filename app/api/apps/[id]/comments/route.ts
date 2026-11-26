import { AppError } from "../../../../../server/appstore";
import { handle, limit, requireUser, sameOrigin } from "../../../../../server/authstore";
import { addComment, listComments } from "../../../../../server/collab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const err = (e: unknown) => { if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status }); throw e; };

// Bình luận của ứng dụng.
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = requireUser(req);
  try { return Response.json({ comments: listComments(user, (await ctx.params).id) }); } catch (e) { return err(e); }
});
// Thêm bình luận: { body, mentions: [id người được nhắc] } — người được nhắc nhận thông báo trong Autopilot.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("cmt:" + user.id, 60, 10 * 60_000);
  const b = await req.json().catch(() => ({}));
  try { return Response.json({ comment: addComment(user, (await ctx.params).id, b.body, b.mentions) }); } catch (e) { return err(e); }
});
