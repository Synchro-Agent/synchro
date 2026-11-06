import { current, limit, verifyLocked } from "../../authstore";
import { overLimit, usageScope } from "../../usage";
import { chatPost } from "../../chatengine";
import { quickLimit, queueFull, startRun, turnsTotal, withStop } from "../../runs";
import { acquire, noteRefused, runningOf, withSlot } from "../../turngate";
import { subCli } from "../../ai/subs";
import { afterTurn } from "../../brain";

// Cổng duy nhất tới model của chat. Phần xử lý nằm ở chatengine.ts.
// async: true (lượt chat chính) → tạo lượt chạy bền ở nền và trả ngay { run }; trình duyệt theo dõi qua /api/runs/<id>.
const TOO_MANY = "Bạn đang có quá nhiều lượt chạy và chờ cùng lúc. Hãy chờ một lượt xong hoặc bấm Dừng rồi gửi lại.";
export async function POST(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  // Mỗi lượt là một CLI chạy trên máy chủ: chặn gửi dồn trước khi đọc nội dung.
  try { limit("llm:" + c.user.id, verifyLocked(c.user) ? 60 : 240, 10 * 60_000); } catch { return Response.json({ error: "Bạn gửi quá nhiều yêu cầu. Hãy thử lại sau ít phút." }, { status: 429 }); }
  const body = await req.json();
  // Thông tin việc tự động chỉ do bộ hẹn giờ của máy chủ đặt (tasks.ts), không nhận từ trình duyệt.
  if (body && typeof body === "object") delete body.task;
  // Mọi lời gọi model trong yêu cầu này được tính vào mức dùng của tài khoản; hết hạn mức thì dừng trước khi gọi.
  // Model của gói subscription (chạy bằng gói của chính người dùng) không tính vào hạn mức chi phí API.
  const over = subCli(body?.model) ? null : overLimit(c.user);
  if (over) return Response.json({ error: over, usageLimit: true }, { status: 429 });
  if (body.async === true) {
    const { async: _, ...rest } = body;
    // Lượt tiếp sau khi duyệt công cụ thuộc lượt đã nhận: từ chối ở đây là mất lượt giữa chừng, nên chỉ xếp hàng.
    if (!body.resume && queueFull(c.user.id)) return Response.json({ error: TOO_MANY, turnQueue: true }, { status: 429 });
    return Response.json({ run: startRun(c.user, "chat", rest, typeof body.conv === "string" ? body.conv.slice(0, 64) : null) });
  }
  // Lời gọi chờ kết quả là việc phụ ngắn (đặt tên, gợi ý…).
  const quick = quickLimit(c.user);
  if (runningOf(c.user.id, "quick") >= quick) { noteRefused(); return Response.json({ error: TOO_MANY, turnQueue: true }, { status: 429 }); }
  const slot = await acquire({ uid: c.user.id, lane: "quick", limit: quick, total: turnsTotal(c.user), signal: req.signal, maxWaitMs: 120_000 });
  if (typeof slot === "string") return Response.json({ error: "Máy chủ đang bận. Hãy thử lại sau ít phút." }, { status: 503 });
  const scope = { uid: c.user.id, feature: "chat" };
  // Không có lượt bền nào giữ lời gọi này: người gửi ngắt kết nối thì không còn ai nhận kết quả, dừng CLI và trả chỗ. Gửi rồi ngắt từng giữ chỗ tới hết lượt.
  const res = await withSlot(slot, () => withStop(req.signal, () => usageScope.run(scope, () => chatPost(body, c, scope))));
  // Bộ não tổng hợp: lượt chat chạy thẳng (không nền) cũng được ghi nhận để chưng cất.
  if (res.status === 200 && body?.skills) void res.clone().json().then((j) => afterTurn(c.user, body, j)).catch(() => {});
  return res;
}
