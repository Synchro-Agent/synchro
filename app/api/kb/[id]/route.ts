import { handle, requireUser, sameOrigin } from "../../../authstore";
import { deleteDoc, deleteMemory, getDoc, KbError } from "../../../kb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// Xem một tài liệu (kèm các đoạn) để mở đúng nguồn được trích dẫn.
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { user } = requireUser(req);
  const doc = getDoc(user, (await ctx.params).id);
  return doc ? Response.json({ doc }) : Response.json({ error: "Không tìm thấy tài liệu." }, { status: 404 });
});

// Xóa tài liệu (kb_…) hoặc mục trí nhớ (mem_…).
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const id = (await ctx.params).id;
  try { if (id.startsWith("mem_")) deleteMemory(user, id); else deleteDoc(user, id); return Response.json({ ok: true }); }
  catch (e) { if (e instanceof KbError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
