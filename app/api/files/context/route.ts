import { buildContext } from "../../../fileproc";
import { MAX_FILES_PER_MESSAGE } from "../../../fileproc/types";

export const runtime = "nodejs";

// POST { ids: string[], names: {id: name}, query } -> { blocks: ContentBlock[] }
export async function POST(req: Request) {
  const { ids, names = {}, query = "" } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids)) return Response.json({ error: "Thiếu ids" }, { status: 400 });
  if (ids.length > MAX_FILES_PER_MESSAGE) return Response.json({ error: `Tối đa ${MAX_FILES_PER_MESSAGE} tệp mỗi tin nhắn` }, { status: 413 });
  return Response.json({ blocks: await buildContext(ids.map(String), names, String(query)) });
}
