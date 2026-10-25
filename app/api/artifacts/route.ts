import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { listArtifacts, saveArtifact, validArt } from "../../artifactstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => Response.json({ artifacts: listArtifacts(requireUser(req).user.id) }));

// Lưu artifact của một câu trả lời: { conv, items: [{ ident, title, type, lang?, content }] } → { ids }.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("art:" + user.id, 300, 10 * 60_000);
  const body = await req.json().catch(() => ({}));
  const conv = typeof body.conv === "string" && /^[\w-]{1,64}$/.test(body.conv) ? body.conv : null;
  if (!conv || !Array.isArray(body.items)) return Response.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  const ids = (body.items as unknown[]).slice(0, 10).map(validArt).map((a) => (a ? saveArtifact(user.id, conv, a) : null));
  return Response.json({ ids });
});
