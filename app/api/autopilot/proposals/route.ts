import { handle, limit, requireUser, sameOrigin } from "../../../../server/authstore";
import { decideProposal } from "../../../../server/automate";
import { listProposals, TaskError } from "../../../../server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Đề xuất của Autopilot chờ người dùng duyệt (mục Cần duyệt). GET ?all=1 (kèm đề xuất đã xử lý) | ?run=<mã lượt> (đề
// xuất của một lần chạy). POST { id, decision: "approve" | "reject", edits?: { skill_md?, instructions? } } → Synchro
// làm ngay việc đã duyệt.
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const u = new URL(req.url);
  const q = u.searchParams;
  return Response.json({ proposals: listProposals(user.id, { all: q.get("all") === "1", run: q.get("run") ?? undefined }) });
});
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("proposal:" + user.id, 120, 10 * 60_000);
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; edits?: unknown };
  if (typeof b.id !== "string" || (b.decision !== "approve" && b.decision !== "reject")) {
    return Response.json({ error: "Thiếu mã đề xuất hoặc quyết định (approve | reject)." }, { status: 400 });
  }
  const edits = (b.edits && typeof b.edits === "object" ? b.edits : {}) as Record<string, unknown>;
  try { return Response.json(await decideProposal(user, b.id, b.decision, edits)); }
  // Lỗi nghiệp vụ (đề xuất không còn, đã xử lý…) trả về đúng mã cho người dùng; lỗi khác để handle() ghi nhật ký.
  catch (e) { if (e instanceof TaskError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
