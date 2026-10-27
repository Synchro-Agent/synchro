import { handle, requireUser, sameOrigin } from "../../../authstore";
import { brainNote, deleteNote, saveNote } from "../../../brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Một ghi chú của bộ não (?title=): nội dung, liên kết đi, liên kết đến đây, chỗ nhắc tên mà chưa nối. PUT sửa / tạo, DELETE xóa.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const title = new URL(req.url).searchParams.get("title") ?? "";
  const n = brainNote(user, title);
  return n ? Response.json(n) : Response.json({ error: "Chưa có ghi chú này." }, { status: 404 });
});
export const PUT = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => ({}))) as { title?: unknown; body?: unknown; userNote?: unknown; newTitle?: unknown };
  const title = typeof b.title === "string" ? b.title.slice(0, 200) : "";
  if (!title) return Response.json({ error: "Thiếu tên ghi chú." }, { status: 400 });
  try {
    const n = saveNote(user, title, { body: typeof b.body === "string" ? b.body : undefined, userNote: typeof b.userNote === "string" ? b.userNote : undefined, newTitle: typeof b.newTitle === "string" ? b.newTitle : undefined });
    return Response.json(brainNote(user, n.title));
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
});
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const ok = deleteNote(user, new URL(req.url).searchParams.get("title") ?? "");
  return ok ? Response.json({ ok }) : Response.json({ error: "Không xóa được ghi chú này." }, { status: 400 });
});
