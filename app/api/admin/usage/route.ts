import { db, getUser, handle, requireAdmin, sameOrigin, type UserRow } from "../../../authstore";
import { adminList, catalog, isService } from "../../../providers";
import { adminUsage, getConfig, priceTable, setConfig, setOverride } from "../../../usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function state() {
  const users = db().prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT 2000").all() as UserRow[];
  const models = (await catalog()).flatMap((p) => p.models.map((m) => m.key));
  // Hạn mức đô la chỉ áp cho lượt chạy bằng khóa API chung (lượt chạy bằng gói của từng người không tính vào, xem /api/llm): không có khóa nào thì giao diện không hứa điều đó.
  const apiKeys = (await adminList()).some((p) => p.configured && !isService(p.kind));
  return { config: getConfig(), users: adminUsage(users), prices: priceTable(models), apiKeys };
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
