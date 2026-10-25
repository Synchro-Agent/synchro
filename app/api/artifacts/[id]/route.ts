import { handle, requireUser, sameOrigin } from "../../../authstore";
import { deleteArtifact, getArtifact } from "../../../artifactstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const a = getArtifact(requireUser(req).user.id, (await ctx.params).id);
  return a ? Response.json({ artifact: a }) : Response.json({ error: "Không tìm thấy artifact." }, { status: 404 });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  return deleteArtifact(requireUser(req).user.id, (await ctx.params).id) ? Response.json({ ok: true }) : Response.json({ error: "Không tìm thấy artifact." }, { status: 404 });
});
