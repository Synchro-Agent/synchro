import { setApiOptIn } from "../../../../../server/ai/subs";
import { engineRoute, noStore } from "../../../../../server/routes/engines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Người dùng đồng ý (hoặc thôi) dùng khóa API dùng chung thay cho gói đã hết hạn mức: { on: boolean }.
// Synchro không bao giờ tự chuyển; đồng ý thì nhóm model của hãng đó hiện model API cho tới khi gói hồi lại.
export const POST = engineRoute(async (req, user, cli) => {
  const b = (await req.json().catch(() => ({}))) as { on?: unknown };
  return Response.json({ usingApiUntil: setApiOptIn(user.id, cli, b.on === true) }, noStore);
});
