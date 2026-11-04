import { processFile } from "../../fileproc";
import { FileError } from "../../fileproc/types";
import { AuthError, current, featureGate, limit, sameOrigin } from "../../authstore";
import { deleteUserFile, listUserFiles } from "../../fileproc/owners";

export const runtime = "nodejs";

// GET: tệp đã tải lên của tài khoản này (Cài đặt → Quyền riêng tư). DELETE ?id=: xóa một tệp; đoạn chat vẫn giữ tên tệp nhưng model không đọc được nữa.
export async function GET(req: Request) {
  const denied = featureGate(req, "files"); if (denied) return denied;
  return Response.json(await listUserFiles(current(req)!.user.id));
}
export async function DELETE(req: Request) {
  const denied = featureGate(req, "files"); if (denied) return denied;
  try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); }
  const ok = await deleteUserFile(current(req)!.user.id, new URL(req.url).searchParams.get("id") ?? "");
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Không tìm thấy tệp này." }, { status: 404 });
}

// POST multipart (field "file") -> { id, name, kind, tokens, large, preview, images }
export async function POST(req: Request) {
  const denied = featureGate(req, "files"); if (denied) return denied;
  const form = await req.formData().catch(() => null);
  const f = form?.get("file");
  if (!(f instanceof File)) return Response.json({ error: "Thiếu tệp" }, { status: 400 });
  const uid = current(req)!.user.id;
  try {
    limit("upload:" + uid, 300, 3_600_000);
    // ?raw=1 (Synchro Code): nhận mọi loại tệp, tệp không đọc được chữ vẫn được giữ để chép nguyên vào workspace.
    const r = await processFile(Buffer.from(await f.arrayBuffer()), f.name, uid, { raw: new URL(req.url).searchParams.get("raw") === "1" });
    const text = r.blocks.map((b) => (b.type === "text" ? b.text : b.type === "document" ? b.fallbackText ?? "" : "")).filter(Boolean).join("\n\n");
    return Response.json({ id: r.id, name: f.name, kind: r.kind, tokens: r.tokens, large: r.large, preview: r.raw ? "" : text.slice(0, 200_000), images: r.blocks.filter((b) => b.type === "image").length, ...(r.raw ? { raw: true } : {}) });
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    const user = e instanceof FileError;
    return Response.json({ error: user ? e.message : `Không xử lý được "${f.name}": ${(e as Error).message.slice(0, 200)}` }, { status: user ? 422 : 500 });
  }
}
