import { handle, isAdmin, limit, requireUser, sameOrigin } from "../../authstore";
import { addDoc, addMemory, KbError, listDocs, listMemory } from "../../kb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bộ não công ty: tài liệu và trí nhớ nhóm tài khoản xem được (của mình + cả tổ chức).
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  return Response.json({ docs: listDocs(user), memory: listMemory(user), admin: isAdmin(user) });
});

// { kind: "doc", title, text, source?, scope } hoặc { kind: "memory", content, scope }; scope "org" chỉ quản trị viên.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("kb:" + user.id, 120, 10 * 60_000);
  const b = await req.json().catch(() => ({}));
  try { return Response.json(b.kind === "memory" ? { memory: addMemory(user, b) } : { doc: addDoc(user, b) }); }
  catch (e) { if (e instanceof KbError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
