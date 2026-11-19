import { adminRole, db, getUser, handle, isOwner, ownerOnly, requireAdmin, sameOrigin, type UserRow } from "../../../../server/authstore";
import { adminList, catalog, isService } from "../../../../server/providers";
import { adminUsage, getConfig, priceTable, setConfig, setOverride } from "../../../../server/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function state(viewer: UserRow) {
  const users = db().prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT 2000").all() as UserRow[];
  const models = (await catalog()).flatMap((p) => p.models.map((m) => m.key));
  // Hạn mức đô la chỉ áp cho lượt chạy bằng khóa API chung (lượt chạy bằng gói của từng người không tính vào, xem /api/llm): không có khóa nào thì giao diện không hứa điều đó.
  const apiKeys = (await adminList()).some((p) => p.configured && !isService(p.kind));
  return { config: getConfig(), users: adminUsage(users), prices: priceTable(models), apiKeys, owner: isOwner(viewer) };
}

// Hạn mức sử dụng: cấu hình chung, bảng giá, mức dùng của từng người.
export const GET = handle(async (req: Request) => { const { user } = requireAdmin(req); return Response.json(await state(user)); });

// { config: { session, weekly, daily, admins, sharedKey, sharedTop, prices } } hoặc { user, override: { session?, weekly?, daily?, shared?, top? } | null }
// sharedKey / sharedTop: tài khoản thường được dùng khóa API chung không và tới hạng model nào (server/auth/sharedkey.ts); không ràng buộc quản trị viên nên quản trị viên đổi được.
// Bảng giá (tiền), "áp hạn mức cho quản trị viên" và hạn mức riêng của tài khoản quản trị viên: chỉ chủ sở hữu. Khi hạn mức đang áp cho quản trị viên,
// hạn mức mặc định (session, weekly) cũng ràng buộc chủ sở hữu: chỉ chủ sở hữu đổi được, nếu không quản trị viên khác đặt 0 là chặn được chủ sở hữu.
export const PATCH = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const b = await req.json().catch(() => ({}));
  if (b.config && typeof b.config === "object" && ("prices" in b.config || "admins" in b.config || (getConfig().admins && ("session" in b.config || "weekly" in b.config || "daily" in b.config)))) ownerOnly(user);
  const t = typeof b.user === "string" ? getUser(b.user) : undefined;
  if (typeof b.user === "string" && !t) return Response.json({ error: "Không tìm thấy tài khoản." }, { status: 404 });
  if (t && adminRole(t)) ownerOnly(user);
  if (b.config && typeof b.config === "object") setConfig(b.config);
  if (t) setOverride(t.id, b.override && typeof b.override === "object" ? b.override : null);
  return Response.json(await state(user));
});
