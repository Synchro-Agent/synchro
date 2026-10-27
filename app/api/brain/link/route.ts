import { handle, requireUser, sameOrigin } from "../../../authstore";
import { brainNote, linkMention } from "../../../brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nối một chỗ nhắc tên thành [[liên kết]] (nút "Nối" ở phần nhắc tới mà chưa nối).
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => ({}))) as { source?: unknown; target?: unknown; view?: unknown };
  try { linkMention(user, String(b.source ?? ""), String(b.target ?? "")); return Response.json(brainNote(user, String(b.view ?? b.target ?? ""))); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
});
