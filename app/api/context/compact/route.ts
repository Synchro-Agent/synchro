import { handle, limit, requireUser, sameOrigin } from "../../../../server/authstore";
import { splitArtifacts } from "../../../artifacts";
import { OneShotErr, quickCall } from "../../../../server/ai/anymodel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nén lịch sử (bàn trộn ngữ cảnh → Auto-Compact): tóm tắt các lượt cũ thành bản ngắn (~500 từ) bằng model nhanh nhất đang dùng được
// (gói subscription hoặc khóa API).
// Đoạn chat giữ nguyên trên màn hình; các lượt sau chỉ gửi bản tóm tắt thay cho các lượt cũ.
const COMPACT = `<compact_history>
Bạn tóm tắt một cuộc trò chuyện giữa người dùng và trợ lý AI để dùng làm ngữ cảnh cho các lượt sau.
Viết tối đa 500 từ, bằng ngôn ngữ của cuộc trò chuyện, dạng gạch đầu dòng ngắn: mục tiêu của người dùng, quyết định và yêu cầu đã chốt (kể cả lời dặn về cách trả lời), sản phẩm đã tạo (tên artifact, tệp) và trạng thái hiện tại, việc còn dở hoặc câu hỏi mở.
Không chép lại code hay nội dung dài; không bịa thêm điều chưa có trong cuộc trò chuyện.
</compact_history>`;

export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("compact:" + user.id, 30, 10 * 60_000);
  const b = await req.json().catch(() => ({}));
  const msgs = (Array.isArray(b.messages) ? b.messages : []).filter((m: { role?: unknown; content?: unknown }) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string") as { role: string; content: string }[];
  if (msgs.length < 2) return Response.json({ error: "Chưa đủ nội dung để nén." }, { status: 400 });
  // Artifact chỉ giữ tên (nội dung đầy đủ vẫn gửi riêng ở mỗi lượt), cắt bớt tin quá dài.
  const flat = msgs.map((m) => `${m.role === "user" ? "Người dùng" : "Trợ lý"}: ${splitArtifacts(m.content).map((sg) => (sg.kind === "text" ? sg.text : `[artifact "${sg.art.title}"]`)).join("").slice(0, 4000)}`).join("\n\n").slice(-120_000);
  const prev = typeof b.summary === "string" && b.summary.trim() ? `Tóm tắt các lượt trước đó:\n${b.summary.slice(0, 8000)}\n\n` : "";
  try {
    const { text, model } = await quickCall(user, COMPACT, `${prev}Cuộc trò chuyện cần tóm tắt:\n\n${flat}`, { maxTokens: 1200, job: "compact" });
    return Response.json({ summary: text.trim().slice(0, 8000), model, chars: flat.length });
  } catch (e) {
    if (e instanceof OneShotErr) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
