import { canModel, handle, limit, requireUser, sameOrigin } from "../../../authstore";
import { catalog, mainModels, resolveModel } from "../../../providers";
import { ALL } from "../../../catalog";
import { routeModel } from "../../../router";
import { chatOnce, HttpErr } from "../../../llmcall";
import { overLimit, withUsage } from "../../../usage";
import { splitArtifacts } from "../../../artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Giọng nói hai luồng, luồng thứ hai: việc chính đã xong (câu trả lời đầy đủ nằm trong khung chat),
// model nhanh nhất đang có chuyển nó thành vài câu để đọc to.
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
  const over = overLimit(user);
  if (over) return Response.json({ error: over }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 2000) : "";
  const answer = typeof b.answer === "string" ? b.answer : "";
  if (!answer.trim()) return Response.json({ error: "Chưa có câu trả lời để tóm tắt." }, { status: 400 });
  // Sản phẩm chỉ giữ tên, code chỉ giữ chỗ: model không cần đọc nội dung để nói "đã làm xong trang …".
  const flat = splitArtifacts(answer).map((sg) => (sg.kind === "text" ? sg.text : `[sản phẩm "${sg.art.title}"]`)).join("")
    .replace(/```[\s\S]*?(```|$)/g, "[khối code]").slice(0, 12_000);
  const main = mainModels();
  const allowed = (await catalog()).flatMap((p) => p.models.map((m) => m.key)).filter((k) => (main.includes(ALL) || main.includes(k)) && canModel(user, k));
  const pick = routeModel({ text: "tóm tắt", attachments: 0, turns: 1, studio: false }, allowed);
  const t = pick && (await resolveModel(pick.model));
  if (!t) return Response.json({ error: "Synchro chưa được kết nối với model nào." }, { status: 503 });
  try {
    const text = await withUsage(user.id, "internal", () => chatOnce(t, BRIEF, [{ role: "user", content: `Câu hỏi: ${question || "(không rõ)"}\n\nCâu trả lời đã viết:\n${flat}` }], 300));
    return Response.json({ brief: text.replace(/[#*_`>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 600), model: pick!.model });
  } catch (e) {
    if (e instanceof HttpErr) return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    throw e;
  }
});
