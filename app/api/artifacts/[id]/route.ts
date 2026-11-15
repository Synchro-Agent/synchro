import { handle, requireUser, sameOrigin } from "../../../../server/authstore";
import { deleteArtifact, getArtifact } from "../../../../server/artifactstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// ?latest=1: chỉ nội dung bản mới nhất (ảnh thu nhỏ ở trang Artifacts: danh sách chỉ kèm phần đầu, trang web dài bị cắt thì trống / đen).
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const a = getArtifact(requireUser(req).user.id, (await ctx.params).id);
  if (a && new URL(req.url).searchParams.has("latest")) return Response.json({ content: a.versions[a.versions.length - 1]?.content ?? "" });
  return a ? Response.json({ artifact: a }) : Response.json({ error: "Không tìm thấy artifact." }, { status: 404 });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  return deleteArtifact(requireUser(req).user.id, (await ctx.params).id) ? Response.json({ ok: true }) : Response.json({ error: "Không tìm thấy artifact." }, { status: 404 });
});
