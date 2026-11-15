import { clearRelogin, refreshVendorCache, status } from "../../../../../server/ai/cli_auth";
import { forgetPlan } from "../../../../../server/ai/subs";
import { codexRpc } from "../../../../../server/ai/subs";
import { engineRoute, noStore } from "../../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Người dùng đổi gói ở trang của hãng: đọc lại gói và danh sách model ngay, không phải đăng xuất rồi đăng nhập lại. Không đụng tới đăng nhập đã lưu.
export const POST = engineRoute(async (_req, user, cli) => {
  await refreshVendorCache(cli, user.id);
  forgetPlan(cli, user.id);
  clearRelogin(cli, user.id);
  const s = await status(cli, user.id, { fresh: true });
  // Codex không báo gói ở lệnh status: hỏi app-server (cùng nguồn với Cài đặt → Mức dùng).
  if (cli === "codex" && s.loggedIn) { const [r] = await codexRpc(user.id, [{ method: "account/read" }], 15_000).catch(() => [null]); const t = (r as { account?: { planType?: unknown } } | null)?.account?.planType; if (typeof t === "string") return Response.json({ ...s, plan: t }, noStore); }
  return Response.json(s, noStore);
});
