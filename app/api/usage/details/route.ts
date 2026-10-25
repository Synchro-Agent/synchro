import { handle, requireUser } from "../../../authstore";
import { usageDetails } from "../../../usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chi tiết 30 ngày cho Cài đặt → Usage (?tz= độ lệch múi giờ của trình duyệt, phút).
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  return Response.json(usageDetails(user.id, Number(new URL(req.url).searchParams.get("tz")) || 0), { headers: { "cache-control": "no-store" } });
});
