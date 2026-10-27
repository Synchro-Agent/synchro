import { handle, limit, requireUser } from "../../../authstore";
import { exportVault } from "../../../brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tải bộ não về thành thư mục Obsidian (.zip các tệp Markdown có liên kết [[...]]), mở thẳng bằng Obsidian.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  limit("brainexport:" + user.id, 20, 60 * 60_000);
  const zip = await exportVault(user);
  return new Response(zip, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="bo-nao-synchro.zip"`, "cache-control": "no-store" } });
});
