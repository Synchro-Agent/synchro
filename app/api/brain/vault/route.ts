import { handle, limit, requireUser, sameOrigin } from "../../../authstore";
import { importVault } from "../../../brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Nhập thư mục Obsidian (.zip các tệp .md) vào bộ não: mỗi tệp thành một ghi chú, giữ thẻ, bí danh và [[liên kết]].
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("brainvault:" + user.id, 20, 60 * 60_000);
  const form = await req.formData().catch(() => null);
  const f = form?.get("file");
  if (!f || typeof f === "string") return Response.json({ error: "Chọn tệp .zip của thư mục Obsidian." }, { status: 400 });
  if (f.size > 25 * 1024 * 1024) return Response.json({ error: "Tệp quá lớn (tối đa 25 MB)." }, { status: 400 });
  try { return Response.json(await importVault(user, await f.arrayBuffer())); }
  catch { return Response.json({ error: "Không đọc được tệp .zip này." }, { status: 400 }); }
});
