import { handle, limit, requireUser, sameOrigin } from "../../../../server/authstore";
import { splitArtifacts } from "../../../artifacts";
import { OneShotErr, quickCall } from "../../../../server/ai/anymodel";
import { memCfg } from "../../../../server/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rút bộ nhớ dự án từ vài tin gần đây. Từng đi qua /api/llm bằng đúng model và nỗ lực người dùng đang chọn: để Tự động thì bộ định tuyến đọc cả đoạn hội thoại dán vào rồi có thể chọn model mạnh nhất,
// chọn tay thì chạy đúng GPT-6.1 Sol với cả artifact trong lịch sử (promptKB 14), tốn hạn mức cho việc người dùng không hề chờ. Giờ là việc nền như các việc rút ý khác: model rẻ nhất, nỗ lực thấp, artifact chỉ giữ tên.
const SYSTEM = "Bạn trích xuất bộ nhớ dài hạn cho một dự án. Chỉ giữ thông tin bền vững và hữu ích cho các cuộc chat sau: sở thích, quyết định, ràng buộc, mục tiêu, bối cảnh của dự án. Bỏ qua chuyện vặt nhất thời. Không lặp lại những gì đã có trong bộ nhớ hiện tại. Mỗi mục là một câu ngắn. CHỈ trả về một mảng JSON các chuỗi, không thêm chữ nào khác. Nếu không có gì mới, trả về [].";
const PER_MSG = 1500;

export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("projmem:" + user.id, 30, 10 * 60_000);
  // Đã tắt "Tạo bộ nhớ từ đoạn chat" thì không ghi nhớ gì và không tốn lượt của gói.
  if (!memCfg(user.id).gen) return Response.json({ items: [] });
  const b = await req.json().catch(() => ({}));
  const existing = (Array.isArray(b.existing) ? b.existing : []).filter((x: unknown): x is string => typeof x === "string").slice(0, 200);
  const msgs = (Array.isArray(b.messages) ? b.messages : []).slice(-8).filter((m: { text?: unknown }) => typeof m?.text === "string") as { role?: string; text: string }[];
  if (!msgs.length) return Response.json({ items: [] });
  const transcript = msgs.map((m) => `${m.role === "assistant" ? "assistant" : "user"}: ${splitArtifacts(m.text).map((sg) => (sg.kind === "text" ? sg.text : `[sản phẩm "${sg.art.title}"]`)).join("").replace(/```[\s\S]*?(```|$)/g, "[khối code]").trim().slice(0, PER_MSG)}`).join("\n");
  try {
    const { text } = await quickCall(user, SYSTEM, `Bộ nhớ hiện có:\n${JSON.stringify(existing).slice(0, 8000)}\n\nHội thoại gần đây:\n${transcript}`, { maxTokens: 600, job: "project-memory", bg: true });
    const arr = JSON.parse(/\[[\s\S]*\]/.exec(text)?.[0] ?? "[]") as unknown[];
    return Response.json({ items: arr.filter((x): x is string => typeof x === "string" && !!x.trim() && !existing.includes(x)).map((x) => x.trim()).slice(0, 3) });
  } catch (e) {
    if (e instanceof OneShotErr || e instanceof SyntaxError) return Response.json({ items: [] });
    throw e;
  }
});
