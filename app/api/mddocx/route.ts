import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { blocksToDocx } from "../../mddocx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tài liệu Markdown đã dựng (app/htmlblocks.ts) → tệp Word thật: { blocks, title } → .docx. Không lưu lại gì.
const MAX_BODY = 60 * 1024 * 1024;
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("mddocx:" + user.id, 120, 10 * 60_000);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "Tài liệu quá lớn để xuất Word." }, { status: 413 });
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.blocks)) return Response.json({ error: "Thiếu nội dung tài liệu." }, { status: 400 });
  const buf = await blocksToDocx(body.blocks, typeof body.title === "string" ? body.title : "");
  return new Response(new Uint8Array(buf), { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "content-disposition": 'attachment; filename="tai-lieu.docx"', "x-content-type-options": "nosniff",
  } });
});
