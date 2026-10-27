import { handle, requireUser, sameOrigin } from "../../../authstore";
import { brainNote, mergeNotes } from "../../../brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gộp ghi chú (Note composer của Obsidian): from nối vào into, tên cũ thành bí danh, mọi liên kết trỏ về into.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => ({}))) as { from?: unknown; into?: unknown };
  try { const n = mergeNotes(user, String(b.from ?? ""), String(b.into ?? "")); return Response.json(brainNote(user, n.title)); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
});
