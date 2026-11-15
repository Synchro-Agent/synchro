import { logout, status } from "../../../../../server/ai/cli_auth";
import { forgetPlan } from "../../../../../server/ai/subs";
import { engineRoute, noStore } from "../../../../../server/routes/engines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Đăng xuất CLI của chính tài khoản: xóa thư mục cấu hình riêng (kể cả token đã lưu).
export const POST = engineRoute(async (_req, user, cli) => {
  await logout(cli, user.id);
  forgetPlan(cli, user.id);
  return Response.json(await status(cli, user.id, { fresh: true }), noStore);
});
