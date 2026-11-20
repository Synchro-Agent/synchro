import { handle, limit, requireUser, sameOrigin } from "../../../server/authstore";
import { splitArtifacts } from "../../../shared/artifacts";
import { NO_CHEAP, OneShotErr, quickCall } from "../../../server/ai/anymodel";
import { cleanTitle as clean, stripRole, topicTitle } from "../../../shared/names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tự đặt tên đoạn chat theo nội dung (giống Claude, ChatGPT): model nhanh nhất đang dùng được (gói subscription hoặc khóa API)
// đọc vài tin đầu rồi trả về một tên ngắn cho thanh bên.
const TITLE = `<chat_title>
Bạn đặt tên ngắn cho một đoạn chat, giống tên đoạn chat ở thanh bên của Claude hay ChatGPT.
- 2 đến 6 từ, tối đa 48 ký tự, bằng đúng ngôn ngữ người dùng đang viết.
- Nêu đúng chủ đề hoặc việc người dùng cần (ví dụ: "Thiết kế web quán cà phê", "Sửa lỗi đăng nhập Next.js", "Kế hoạch du lịch Đà Lạt", "Quarterly sales report").
- Người dùng nhờ làm một sản phẩm thì đặt theo sản phẩm và đối tượng của nó (ví dụ: "Dashboard chuỗi cà phê",
  "Bộ slide trà Sương Sớm", "Poster jazz Hà Nội Sau Mưa"), không theo vai họ giao cho trợ lý
  ("Bạn là nhà thiết kế…", "You are a…").
- Viết hoa chữ cái đầu; không dấu ngoặc kép, không dấu chấm cuối, không emoji, không mở đầu bằng "Đoạn chat về", "Hỏi về", "Chat about".
- Tin nhắn chỉ là lời chào hay chưa rõ ý thì đặt tên theo đúng nội dung đó (ví dụ "Lời chào", "Greeting").
Chỉ trả về tên, không giải thích, không gì khác.
</chat_title>`;

// Sản phẩm chỉ giữ tên, code chỉ giữ chỗ: đủ để biết đoạn chat nói về gì. Câu đóng vai đầu brief ("Bạn là nhà thiết kế
// …") không nói gì về chủ đề mà chiếm chỗ trong 1500 ký tự gửi model: bỏ trước. Tên tạm (localTitle) cần giữ câu đó:
// topicTitle chỉ đặt theo sản phẩm khi tin mở bằng câu đóng vai.
function brief(m: { role: string; text: string }, keepRole = false) {
  const text = m.role === "assistant" || keepRole ? m.text : stripRole(m.text);
  const segs = splitArtifacts(text);
  const parts = segs.map((sg) => (sg.kind === "text" ? sg.text : `[sản phẩm "${sg.art.title}"]`)).join("");
  return parts.replace(/```[\s\S]*?(```|$)/g, "[khối code]").replace(/#(?:tool|args)=\S+/g, "").trim().slice(0, 1500);
}

export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("title:" + user.id, 120, 60 * 60_000);
  const b = await req.json().catch(() => ({}));
  type Msg = { role: string; text: string };
  const rows: Msg[] = (Array.isArray(b.messages) ? b.messages : []).slice(0, 6)
    .filter((m: unknown): m is Msg => !!m && typeof (m as { text?: unknown }).text === "string");
  const msgs = rows.map((m) => `[${m.role === "assistant" ? "Trợ lý" : "Người dùng"}]\n${brief(m)}`);
  if (!msgs.length || !msgs[0].trim()) return Response.json({ error: "Chưa có nội dung để đặt tên." }, { status: 400 });
  try {
    const { text, model } = await quickCall(user, TITLE, `Đoạn chat cần đặt tên:\n\n${msgs.join("\n\n")}`, { maxTokens: 40, job: "title" });
    const title = clean(text);
    const words = title.split(" ").length;
    if (!title || title.length > 80 || words > 12) return Response.json({ error: "Model không trả về tên hợp lệ." }, { status: 422 });
    return Response.json({ title: title.length > 60 ? `${title.slice(0, 59).replace(/\s+\S*$/, "")}…` : title, model });
  } catch (e) {
    // Gói của người dùng sắp chạm giới hạn hoặc đã hết phần việc phụ của hôm nay (ai/helperquota.ts): đặt tên từ chính câu đầu, không tốn lượt nào.
    // Trả tên (không phải lỗi) để trình duyệt không gọi lại sau mỗi câu trả lời.
    if (e instanceof OneShotErr && e.message === NO_CHEAP) {
      const t = localTitle(brief(rows[0], true));
      if (t) return Response.json({ title: t, local: true });
    }
    if (e instanceof OneShotErr) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});

/**
 * Tên tạm từ tin đầu của người dùng (không gọi model): bỏ khối code, lời chào đầu câu; brief mở bằng câu đóng vai thì
 * đặt theo sản phẩm, còn lại theo câu đầu (topicTitle); tối đa 48 ký tự.
 */
function localTitle(first: string) {
  const greet = /^(?:(?:xin )?chào|hi|hello|hey)[\s,!.]+/i;
  const holders = /\[(?:khối code|sản phẩm[^\]]*)\]/g;
  const t = first.replace(holders, " ").trim().replace(greet, "");
  return clean(topicTitle(t));
}
