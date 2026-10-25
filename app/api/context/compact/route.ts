import { handle, limit, requireUser, sameOrigin } from "../../../authstore";
import { catalog, mainModels, resolveModel } from "../../../providers";
import { ALL } from "../../../catalog";
import { routeModel } from "../../../router";
import { chatOnce, HttpErr } from "../../../llmcall";
import { overLimit, withUsage } from "../../../usage";
import { splitArtifacts } from "../../../artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nén lịch sử (bàn trộn ngữ cảnh → Auto-Compact): tóm tắt các lượt cũ thành bản ngắn (~500 từ) bằng model nhanh nhất đang có.
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
  const over = overLimit(user);
  if (over) return Response.json({ error: over }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const msgs = (Array.isArray(b.messages) ? b.messages : []).filter((m: { role?: unknown; content?: unknown }) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string") as { role: string; content: string }[];
  if (msgs.length < 2) return Response.json({ error: "Chưa đủ nội dung để nén." }, { status: 400 });
  // Artifact chỉ giữ tên (nội dung đầy đủ vẫn gửi riêng ở mỗi lượt), cắt bớt tin quá dài.
  const flat = msgs.map((m) => `${m.role === "user" ? "Người dùng" : "Trợ lý"}: ${splitArtifacts(m.content).map((sg) => (sg.kind === "text" ? sg.text : `[artifact "${sg.art.title}"]`)).join("").slice(0, 4000)}`).join("\n\n").slice(-120_000);
  const prev = typeof b.summary === "string" && b.summary.trim() ? `Tóm tắt các lượt trước đó:\n${b.summary.slice(0, 8000)}\n\n` : "";
  const main = mainModels();
  const allowed = (await catalog()).flatMap((p) => p.models.map((m) => m.key)).filter((k) => main.includes(ALL) || main.includes(k));
  const pick = routeModel({ text: "tóm tắt", attachments: 0, turns: 1, studio: false }, allowed);
  const t = pick && (await resolveModel(pick.model));
  if (!t) return Response.json({ error: "Synchro chưa được kết nối với model nào. Hãy nhập khóa API ở Cài đặt → API." }, { status: 503 });
  try {
    const text = await withUsage(user.id, "internal", () => chatOnce(t, COMPACT, [{ role: "user", content: `${prev}Cuộc trò chuyện cần tóm tắt:\n\n${flat}` }], 1200));
    return Response.json({ summary: text.trim().slice(0, 8000), model: pick!.model, chars: flat.length });
  } catch (e) {
    if (e instanceof HttpErr) return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    throw e;
  }
});
