import { handle, requireUser } from "../../authstore";
import { usageState } from "../../usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mức dùng của tài khoản: giới hạn phiên 5 giờ, giới hạn tuần, và hạn mức gọi API của nhà cung cấp đang chọn (?provider=anthropic).
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const p = new URL(req.url).searchParams.get("provider");
  return Response.json(usageState(user, p && /^[a-z0-9-]{1,40}$/.test(p) ? p : undefined), { headers: { "cache-control": "no-store" } });
});
