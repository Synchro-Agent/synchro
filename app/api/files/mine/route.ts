import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { handle, requireUser, sameOrigin } from "../../../../server/authstore";
import { fileBin, myFiles, releaseFile } from "../../../../server/fileproc/owners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tệp đã tải lên của chính người dùng (Cài đặt → Quyền riêng tư). Không đi qua cổng tính năng "files": người đã bị tắt tính năng vẫn phải xóa được tệp của mình.
// ?download=<mã tệp>: tải đúng tệp gốc, luôn là tệp đính kèm (không bao giờ mở tại chỗ trên tên miền của Synchro).
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const id = new URL(req.url).searchParams.get("download");
  if (id === null) return Response.json(myFiles(user.id));
  const f = fileBin(user.id, id);
  if (!f) return Response.json({ error: "Không tìm thấy tệp." }, { status: 404 });
  return new Response(Readable.toWeb(createReadStream(f.path)) as ReadableStream, { headers: {
    "content-type": "application/octet-stream", "content-length": String(statSync(f.path).size), "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name || `tep-${id.slice(0, 8)}`)}`,
  } });
});
// DELETE ?id=<mã tệp>
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  return await releaseFile(user.id, new URL(req.url).searchParams.get("id") ?? "") ? Response.json({ ok: true }) : Response.json({ error: "Không tìm thấy tệp." }, { status: 404 });
});
