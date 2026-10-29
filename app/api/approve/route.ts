import { AuthError, handle, requireUser, sameOrigin } from "../../authstore";
import { answer } from "../../approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Người dùng trả lời câu hỏi duyệt của một lượt đang chạy (sửa tệp, chạy lệnh, dùng trình duyệt trên trang chưa được phép):
// { id, ok, always?, note? }. 409: câu hỏi không còn chờ (đã trả lời ở thiết bị khác hay lượt đã dừng).
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; ok?: unknown; always?: unknown; note?: unknown };
  if (typeof b.id !== "string" || !b.id) throw new AuthError("Thiếu câu hỏi.", 400);
  if (!answer(user.id, b.id, { ok: b.ok === true, always: b.always === true, note: typeof b.note === "string" ? b.note : "" })) throw new AuthError("Câu hỏi này không còn chờ trả lời.", 409);
  return Response.json({ ok: true });
});
