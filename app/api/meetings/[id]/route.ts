import { handle, requireUser, sameOrigin } from "../../../authstore";
import { deleteMeeting, getMeeting } from "../../../meetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const m = getMeeting(requireUser(req).user.id, (await ctx.params).id);
  return m ? Response.json({ meeting: m }) : Response.json({ error: "Không tìm thấy cuộc họp." }, { status: 404 });
});
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  return deleteMeeting(requireUser(req).user.id, (await ctx.params).id) ? Response.json({ ok: true }) : Response.json({ error: "Không tìm thấy cuộc họp." }, { status: 404 });
});
