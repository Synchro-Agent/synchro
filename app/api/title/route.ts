import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { splitArtifacts } from "../../artifacts";
import { OneShotErr, quickCall } from "../../ai/anymodel";
import { cleanTitle as clean } from "../../names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tự đặt tên đoạn chat theo nội dung (giống Claude, ChatGPT): model nhanh nhất đang dùng được (gói subscription hoặc khóa API)
// đọc vài tin đầu rồi trả về một tên ngắn cho thanh bên.
const TITLE = `<chat_title>
Bạn đặt tên ngắn cho một đoạn chat, giống tên đoạn chat ở thanh bên của Claude hay ChatGPT.
- 2 đến 6 từ, tối đa 48 ký tự, bằng đúng ngôn ngữ người dùng đang viết.
- Nêu đúng chủ đề hoặc việc người dùng cần (ví dụ: "Thiết kế web quán cà phê", "Sửa lỗi đăng nhập Next.js", "Kế hoạch du lịch Đà Lạt", "Quarterly sales report").
- Viết hoa chữ cái đầu; không dấu ngoặc kép, không dấu chấm cuối, không emoji, không mở đầu bằng "Đoạn chat về", "Hỏi về", "Chat about".
- Tin nhắn chỉ là lời chào hay chưa rõ ý thì đặt tên theo đúng nội dung đó (ví dụ "Lời chào", "Greeting").
Chỉ trả về tên, không giải thích, không gì khác.
</chat_title>`;

export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("title:" + user.id, 120, 60 * 60_000);
  const b = await req.json().catch(() => ({}));
  const msgs = (Array.isArray(b.messages) ? b.messages : []).slice(0, 6)
    .filter((m: unknown): m is { role: string; text: string } => !!m && typeof (m as { text?: unknown }).text === "string")
    // Sản phẩm chỉ giữ tên, code chỉ giữ chỗ: đủ để biết đoạn chat nói về gì.
    .map((m: { role: string; text: string }) => `[${m.role === "assistant" ? "Trợ lý" : "Người dùng"}]\n${splitArtifacts(m.text).map((sg) => (sg.kind === "text" ? sg.text : `[sản phẩm "${sg.art.title}"]`)).join("")
      .replace(/```[\s\S]*?(```|$)/g, "[khối code]").replace(/#(?:tool|args)=\S+/g, "").trim().slice(0, 1500)}`);
  if (!msgs.length || !msgs[0].trim()) return Response.json({ error: "Chưa có nội dung để đặt tên." }, { status: 400 });
  try {
    const { text, model } = await quickCall(user, TITLE, `Đoạn chat cần đặt tên:\n\n${msgs.join("\n\n")}`, { maxTokens: 40, job: "title" });
    const title = clean(text);
    const words = title.split(" ").length;
    if (!title || title.length > 80 || words > 12) return Response.json({ error: "Model không trả về tên hợp lệ." }, { status: 422 });
    return Response.json({ title: title.length > 60 ? `${title.slice(0, 59).replace(/\s+\S*$/, "")}…` : title, model });
  } catch (e) {
    if (e instanceof OneShotErr) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
