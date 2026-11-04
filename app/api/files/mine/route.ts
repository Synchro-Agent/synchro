import { handle, requireUser, sameOrigin } from "../../../authstore";
import { myFiles, releaseFile } from "../../../fileproc/owners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tệp đã tải lên của chính người dùng (Cài đặt → Quyền riêng tư). Không đi qua cổng tính năng "files": người đã bị tắt tính năng vẫn phải xóa được tệp của mình.
export const GET = handle(async (req) => Response.json(myFiles(requireUser(req).user.id)));
// DELETE ?id=<mã tệp>
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  return await releaseFile(user.id, new URL(req.url).searchParams.get("id") ?? "") ? Response.json({ ok: true }) : Response.json({ error: "Không tìm thấy tệp." }, { status: 404 });
});
