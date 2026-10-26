import { current } from "../../authstore";
import { overLimit, usageScope } from "../../usage";
import { chatPost } from "../../chatengine";
import { startRun } from "../../runs";
import { subCli } from "../../ai/subs";

// Cổng duy nhất tới model của chat. Phần xử lý nằm ở chatengine.ts.
// async: true (lượt chat chính) → tạo lượt chạy bền ở nền và trả ngay { run }; trình duyệt theo dõi qua /api/runs/<id>.
export async function POST(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const body = await req.json();
  // Mọi lời gọi model trong yêu cầu này được tính vào mức dùng của tài khoản; hết hạn mức thì dừng trước khi gọi.
  // Model của gói subscription (chạy bằng gói của chính người dùng) không tính vào hạn mức chi phí API.
  const over = subCli(body?.model) ? null : overLimit(c.user);
  if (over) return Response.json({ error: over, usageLimit: true }, { status: 429 });
  if (body.async === true) {
    const { async: _, ...rest } = body;
    return Response.json({ run: startRun(c.user, "chat", rest, typeof body.conv === "string" ? body.conv.slice(0, 64) : null) });
  }
  const scope = { uid: c.user.id, feature: "chat" };
  return usageScope.run(scope, () => chatPost(body, c, scope));
}
