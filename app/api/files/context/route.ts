import { buildContext } from "../../../../server/fileproc";
import { MAX_FILES_PER_MESSAGE } from "../../../../shared/fileproc/types";
import { route } from "../../../../server/route";

export const runtime = "nodejs";

// POST { ids: string[], names: {id: name}, query } -> { blocks: ContentBlock[] }
// Giới hạn theo tài khoản: dựng ngữ cảnh tệp có thể đọc/nhúng nhiều tệp lớn mỗi lần.
export const POST = route({ feature: "files", json: true, limit: { key: "files-ctx", max: 600, windowMs: 3_600_000 } }, async ({ req, user }) => {
  const { ids, names = {}, query = "" } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids)) return Response.json({ error: "Thiếu ids" }, { status: 400 });
  if (ids.length > MAX_FILES_PER_MESSAGE) return Response.json({ error: `Tối đa ${MAX_FILES_PER_MESSAGE} tệp mỗi tin nhắn` }, { status: 413 });
  return Response.json({ blocks: await buildContext(ids.map(String), names, String(query), user.id) });
});
