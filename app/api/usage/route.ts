import { handle, requireUser } from "../../authstore";
import { usageState } from "../../usage";
import { subCli, subUsage } from "../../ai/subs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mức dùng của tài khoản: giới hạn phiên 5 giờ, giới hạn tuần, hạn mức gọi API và số dư API đã nạp của nhà cung cấp đang chọn (?provider=anthropic).
// Model của gói subscription (?provider=sub-claude): kèm hạn mức của gói (phiên 5 giờ, tuần) do CLI báo về.
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const p = new URL(req.url).searchParams.get("provider");
  const provider = p && /^[a-z0-9-]{1,40}$/.test(p) ? p : undefined;
  const cli = provider ? subCli(`${provider}/x`) : null;
  const st = usageState(user, cli ? undefined : provider);
  return Response.json(cli ? { ...st, sub: await subUsage(user, cli) } : st, { headers: { "cache-control": "no-store" } });
});
