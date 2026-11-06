import { handle, limit, requireUser, sameOrigin, verifyLocked } from "../../authstore";
import { ART_LIMITS, artifactTitles, listArtifacts, removeConvArtifacts, saveArtifact, validArt } from "../../artifactstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const uid = requireUser(req).user.id;
  return Response.json({ artifacts: new URL(req.url).searchParams.get("view") === "titles" ? artifactTitles(uid) : listArtifacts(uid) });
});

// Lưu artifact của một câu trả lời: { conv, items: [{ ident, title, type, lang?, content }] } → { ids }.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("art:" + user.id, 300, 10 * 60_000);
  const body = await req.json().catch(() => ({}));
  const conv = typeof body.conv === "string" && /^[\w-]{1,64}$/.test(body.conv) ? body.conv : null;
  if (!conv || !Array.isArray(body.items)) return Response.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  const ids = (body.items as unknown[]).slice(0, 10).map(validArt).map((a) => (a ? saveArtifact(user.id, conv, a, verifyLocked(user) ? { maxBytes: ART_LIMITS.lockedBytes } : undefined) : null));
  return Response.json({ ids });
});

// DELETE ?conv=: xóa mọi artifact của một đoạn chat (người dùng chọn khi xóa đoạn chat đó).
export const DELETE = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const conv = new URL(req.url).searchParams.get("conv") ?? "";
  if (!/^[\w-]{1,64}$/.test(conv)) return Response.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  return Response.json({ removed: removeConvArtifacts(user.id, conv) });
});
