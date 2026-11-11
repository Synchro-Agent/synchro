import { audit, clientIp, handle, isOwner, limit, ownerOnly, requireAdmin, sameOrigin, type UserRow } from "../../../authstore";
import { litestreamAdmin, restoreDrill, saveLitestream } from "../../../litestream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cài đặt → Sức khỏe hệ thống → Sao lưu liên tục (app/litestream.ts). Quản trị viên xem trạng thái và chạy thử khôi phục; lưu / gỡ cấu hình R2
// và bật / tắt chỉ chủ sở hữu, quản trị viên khác cũng không thấy Account ID và Access Key ID. Không bao giờ trả khóa bí mật.
const view = async (u: UserRow) => {
  const s = await litestreamAdmin();
  return isOwner(u) ? { ...s, owner: true } : { ...s, accountId: s.accountId ? "••••" : "", accessKeyId: s.accessKeyId ? "••••" : "", owner: false };
};
export const GET = handle(async (req) => { const { user } = requireAdmin(req); return Response.json(await view(user)); });

// { action: "save", enabled, accountId, bucket, accessKeyId, secret, prefix } | { action: "clear" } | { action: "drill" }
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.action === "drill") {
    limit("backup-drill:" + user.id, 10, 60 * 60_000);
    const r = await restoreDrill();
    audit("admin_backup_drill", { actor: user, ip: clientIp(req), detail: r.ok ? `ok ${r.ms}ms` : `failed: ${r.integrity !== "—" ? r.integrity : r.error ?? ""}`.slice(0, 200) });
    return Response.json(r);
  }
  if (b.action === "save" || b.action === "clear") {
    ownerOnly(user);
    const was = (await litestreamAdmin()).enabled;
    await saveLitestream(b.action === "clear" ? { clear: true } : b);
    const now = await litestreamAdmin();
    audit(b.action === "clear" ? "admin_backup_cleared" : was !== now.enabled ? (now.enabled ? "admin_backup_on" : "admin_backup_off") : "admin_backup_saved", { actor: user, ip: clientIp(req) });
    return Response.json({ ...now, owner: true });
  }
  return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
});
