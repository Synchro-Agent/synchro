import { AuthError, handle, requireUser, sameOrigin } from "../../authstore";
import { answer } from "../../approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Người dùng trả lời câu hỏi duyệt của một lượt đang chạy (sửa tệp, chạy lệnh, dùng trình duyệt trên trang chưa được phép, dùng công cụ connector):
// { id, ok, always?, chat?, note?, input? }. 409: câu hỏi không còn chờ (đã trả lời ở thiết bị khác hay lượt đã dừng).
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; ok?: unknown; always?: unknown; chat?: unknown; note?: unknown; input?: unknown };
  if (typeof b.id !== "string" || !b.id) throw new AuthError("Thiếu câu hỏi.", 400);
  // input: tham số người dùng sửa trước khi cho phép (công cụ connector). Máy chủ kiểm tra lại theo schema của công cụ; sai thì 400, câu hỏi vẫn chờ.
  const r = answer(user.id, b.id, { ok: b.ok === true, always: b.always === true, chat: b.chat === true, note: typeof b.note === "string" ? b.note : "", ...(b.input !== undefined ? { input: b.input as Record<string, unknown> } : {}) });
  if (r === false) throw new AuthError("Câu hỏi này không còn chờ trả lời.", 409);
  if (typeof r === "string") throw new AuthError(r, 400);
  return Response.json({ ok: true });
});
