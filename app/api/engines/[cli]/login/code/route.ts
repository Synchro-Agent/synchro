import { limit } from "../../../../../../server/authstore";
import { submitCode } from "../../../../../../server/ai/cli_auth";
import { engineRoute, noStore } from "../../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dán mã trang đăng nhập trả về: { code }. Mã chỉ đưa vào CLI, không lưu và không ghi log.
export const POST = engineRoute(async (req, user, cli) => {
  limit(`engine-code:${user.id}`, 20, 10 * 60_000);
  const b = (await req.json().catch(() => ({}))) as { code?: unknown };
  return Response.json(await submitCode(cli, user.id, typeof b.code === "string" ? b.code : ""), noStore);
});
