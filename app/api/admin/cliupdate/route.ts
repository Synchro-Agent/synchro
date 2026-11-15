import { audit, clientIp, handle, isOwner, ownerOnly, requireAdmin, sameOrigin } from "../../../../server/authstore";
import { CLIS, type Cli } from "../../../../server/ai/cli_runtime";
import { cliUpdateView, envOff, rollback, runUpdate, setAutoUpdate } from "../../../../server/ai/cliupdate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cài đặt → Providers → Cập nhật CLI (server/ai/cliupdate.ts). Quản trị viên xem; bật / tắt, "Cập nhật ngay" và trả về bản trước chỉ chủ sở hữu
// (cài phần mềm lên máy chủ, đổi bản mọi người đang dùng).
export const GET = handle(async (req) => { const { user } = requireAdmin(req); return Response.json({ ...(await cliUpdateView()), owner: isOwner(user) }); });

// { action: "run", cli? } chạy ở nền (trang hỏi lại tới khi xong) | { action: "auto", on } | { action: "rollback", cli }
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireAdmin(req);
  ownerOnly(user);
  const b = (await req.json().catch(() => ({}))) as { action?: string; on?: unknown; cli?: unknown };
  const cli = CLIS.includes(b.cli as Cli) ? (b.cli as Cli) : undefined;
  if (b.action === "auto") {
    setAutoUpdate(!!b.on);
    audit("admin_cli_autoupdate", { actor: user, ip: clientIp(req), detail: b.on ? "on" : "off" });
  } else if (b.action === "run") {
    if (envOff()) return Response.json({ error: "Máy chủ đã tắt cập nhật CLI (SYNCHRO_CLI_AUTOUPDATE=0)." }, { status: 409 });
    audit("admin_cli_update", { actor: user, ip: clientIp(req), detail: cli ?? "all" });
    void runUpdate("owner", cli).catch((e) => console.error("[cli-update]", e));
  } else if (b.action === "rollback" && cli) {
    const r = await rollback(cli, "Chủ sở hữu trả về bản trước.", "owner");
    audit("admin_cli_rollback", { actor: user, ip: clientIp(req), detail: `${cli} ${r.outcome}` });
    if (r.outcome !== "rolled_back") return Response.json({ error: r.detail, ...(await cliUpdateView()), owner: true }, { status: 400 });
  } else return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
  return Response.json({ ...(await cliUpdateView()), owner: true });
});
