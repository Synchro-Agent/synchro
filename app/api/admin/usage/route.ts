import { db, getUser, handle, requireAdmin, sameOrigin, type UserRow } from "../../../authstore";
import { catalog } from "../../../providers";
import { adminUsage, getConfig, priceTable, setConfig, setOverride } from "../../../usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function state() {
  const users = db().prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT 2000").all() as UserRow[];
  const models = (await catalog()).flatMap((p) => p.models.map((m) => m.key));
  return { config: getConfig(), users: adminUsage(users), prices: priceTable(models) };
}

// Hạn mức sử dụng: cấu hình chung, bảng giá, mức dùng của từng người.
export const GET = handle(async (req: Request) => { requireAdmin(req); return Response.json(await state()); });

// { config: { session, weekly, admins, prices } } hoặc { user, override: { session?, weekly? } | null }
export const PATCH = handle(async (req: Request) => {
  sameOrigin(req);
  requireAdmin(req);
  const b = await req.json().catch(() => ({}));
  if (b.config && typeof b.config === "object") setConfig(b.config);
  if (typeof b.user === "string") {
    if (!getUser(b.user)) return Response.json({ error: "Không tìm thấy tài khoản." }, { status: 404 });
    setOverride(b.user, b.override && typeof b.override === "object" ? b.override : null);
  }
  return Response.json(await state());
});
