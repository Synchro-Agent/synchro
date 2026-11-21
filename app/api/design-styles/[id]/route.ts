// Một phong cách của người dùng: PATCH { name?, save? } đổi tên / lưu thành "Phong cách của tôi", DELETE xóa (cả ảnh).
import { route } from "../../../../server/route";
import { deleteStyle, publicStyle, StyleError, updateStyle } from "../../../../server/designstyles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>({ json: true }, async ({ req, user, params }) => {
  const b = (await req.json().catch(() => ({}))) as { name?: unknown; save?: unknown };
  try {
    const s = updateStyle(user.id, params.id, { name: b.name, save: b.save === true });
    return Response.json({ style: publicStyle(s) });
  } catch (e) {
    if (e instanceof StyleError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});

export const DELETE = route<{ id: string }>({}, async ({ user, params }) => {
  if (!deleteStyle(user.id, params.id)) return Response.json({ error: "Không có phong cách này." }, { status: 404 });
  return Response.json({ ok: true });
});
