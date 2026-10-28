import { handle, limit, requireUser } from "../../../authstore";
import { exportBrain } from "../../../brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tải bộ não về thành thư mục Markdown (.zip, mỗi ghi chú một tệp .md, liên kết [[...]] và thuộc tính ở đầu tệp): dữ liệu là của bạn.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  limit("brainexport:" + user.id, 20, 60 * 60_000);
  const zip = await exportBrain(user);
  return new Response(zip, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="bo-nao-synchro.zip"`, "cache-control": "no-store" } });
});
