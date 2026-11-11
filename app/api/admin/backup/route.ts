import { audit, clientIp, handle, limit, requireAdmin, sameOrigin } from "../../../authstore";
import { litestreamAdmin, restoreDrill, saveLitestream } from "../../../litestream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cài đặt → Sức khỏe hệ thống → Sao lưu liên tục (app/litestream.ts). Chỉ quản trị viên; không bao giờ trả khóa bí mật.
export const GET = handle(async (req) => { requireAdmin(req); return Response.json(await litestreamAdmin()); });

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
    const was = (await litestreamAdmin()).enabled;
    await saveLitestream(b.action === "clear" ? { clear: true } : b);
    const now = await litestreamAdmin();
    audit(b.action === "clear" ? "admin_backup_cleared" : was !== now.enabled ? (now.enabled ? "admin_backup_on" : "admin_backup_off") : "admin_backup_saved", { actor: user, ip: clientIp(req) });
    return Response.json(now);
  }
  return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
});
