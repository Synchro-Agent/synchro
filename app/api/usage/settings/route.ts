import { handle, requireUser, sameOrigin } from "../../../authstore";
import { catalog } from "../../../providers";
import { getConfig, priceTable, setConfig } from "../../../usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function state() {
  const models = (await catalog()).flatMap((p) => p.models.map((m) => m.key));
  return { budget: getConfig().budget, prices: priceTable(models) };
}

// Ngân sách tự đặt (USD mỗi phiên 5 giờ, mỗi tuần; null = không giới hạn) và bảng giá model.
export const GET = handle(async (req: Request) => { requireUser(req); return Response.json(await state()); });

// { budget?: { session?, weekly? }, prices?: { "hãng/model": { in, out, cache } | null } }
export const PATCH = handle(async (req: Request) => {
  sameOrigin(req);
  requireUser(req);
  const b = await req.json().catch(() => ({}));
  setConfig({ budget: b.budget && typeof b.budget === "object" ? b.budget : undefined, prices: b.prices && typeof b.prices === "object" ? b.prices : undefined });
  return Response.json(await state());
});
