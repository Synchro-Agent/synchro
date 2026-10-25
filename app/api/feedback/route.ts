import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { scores, vote } from "../../feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Điểm của các skill (Kho kỹ năng hiện cạnh từng skill).
export const GET = handle(async (req: Request) => { requireUser(req); return Response.json({ scores: scores() }); });

// Chấm một câu trả lời: { msg: mã câu trả lời, skills: [tên skill / thư viện đã dùng], value: 1 | -1 | 0 }.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("vote:" + user.id, 300, 10 * 60_000);
  const b = await req.json().catch(() => ({}));
  if (typeof b.msg !== "string" || !Array.isArray(b.skills)) return Response.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
  return Response.json({ ok: true, n: vote(user.id, b.msg, b.skills, Number(b.value)) });
});
