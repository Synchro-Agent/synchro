import { handle, requireAdmin, sameOrigin } from "../../../../../server/authstore";
import { chatOnce, HttpErr } from "../../../../../server/llmcall";
import { resolveModel } from "../../../../../server/providers";
import { withUsage } from "../../../../../server/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gửi thử một câu tới model để kiểm tra khóa, địa chỉ và mã model, trả về câu trả lời và thời gian phản hồi.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const { model, prompt } = await req.json();
  // Quản trị viên gửi thử được cả model sổ model chưa thử đạt.
  const t = typeof model === "string" ? await resolveModel(model, { untested: true }) : null;
  if (!t) return Response.json({ error: "Không tìm thấy model này. Hãy làm mới danh sách model." }, { status: 400 });
  const q = String(prompt || "Chào bạn! Hãy giới thiệu ngắn gọn bạn là model nào trong một câu.").slice(0, 2000);
  const t0 = Date.now();
  try {
    const text = await withUsage(user.id, "test", () => chatOnce(t, "", [{ role: "user", content: q }], 300, AbortSignal.timeout(60_000)));
    return Response.json({ text: text || "(Model không trả lời nội dung nào)", ms: Date.now() - t0 });
  } catch (e) {
    const status = e instanceof HttpErr ? e.status : 502;
    return Response.json({ error: (e as Error).name === "TimeoutError" ? "Model không phản hồi sau 60 giây." : (e as Error).message, ms: Date.now() - t0 }, { status: status >= 500 ? 502 : status });
  }
});
