import { handle, limit, requireUser, sameOrigin } from "../../../../server/authstore";
import { splitArtifacts } from "../../../../shared/artifacts";
import { OneShotErr, quickCall } from "../../../../server/ai/anymodel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Giọng nói hai luồng, luồng thứ hai: việc chính đã xong (câu trả lời đầy đủ nằm trong khung chat),
// model nhanh nhất đang dùng được (gói subscription hoặc khóa API) chuyển nó thành vài câu để đọc to.
const BRIEF = `<voice_brief>
Bạn chuyển câu trả lời đã viết của Synchro thành lời nói ngắn để đọc to trong chế độ trò chuyện bằng giọng nói.
- 1 đến 3 câu, tối đa khoảng 60 từ, bằng đúng ngôn ngữ của câu hỏi.
- Nói điều quan trọng nhất trước: kết luận, con số chính, việc đã làm xong. Không đọc code, bảng, đường dẫn hay danh sách dài.
- Câu trả lời có sản phẩm (trang web, tài liệu, tệp, bảng, code) hoặc nhiều chi tiết thì kết thúc bằng một câu ngắn rằng chi tiết đã có trong khung chat.
- Văn nói tự nhiên, không Markdown, không ký hiệu; số và đơn vị viết theo cách đọc. Không bịa thêm điều câu trả lời không có.
</voice_brief>`;

export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("brief:" + user.id, 60, 10 * 60_000);
  const b = await req.json().catch(() => ({}));
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 2000) : "";
  const answer = typeof b.answer === "string" ? b.answer : "";
  if (!answer.trim()) return Response.json({ error: "Chưa có câu trả lời để tóm tắt." }, { status: 400 });
  // Sản phẩm chỉ giữ tên, code chỉ giữ chỗ: model không cần đọc nội dung để nói "đã làm xong trang …".
  const flat = splitArtifacts(answer).map((sg) => (sg.kind === "text" ? sg.text : `[sản phẩm "${sg.art.title}"]`)).join("")
    .replace(/```[\s\S]*?(```|$)/g, "[khối code]").slice(0, 12_000);
  try {
    const { text, model } = await quickCall(user, BRIEF, `Câu hỏi: ${question || "(không rõ)"}\n\nCâu trả lời đã viết:\n${flat}`, { maxTokens: 300, job: "voice" });
    return Response.json({ brief: text.replace(/[#*_`>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 600), model });
  } catch (e) {
    if (e instanceof OneShotErr) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
