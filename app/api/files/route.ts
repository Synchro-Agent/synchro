import { processFile } from "../../fileproc";
import { FileError } from "../../fileproc/types";

export const runtime = "nodejs";

// POST multipart (field "file") -> { id, name, kind, tokens, large, preview, images }
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const f = form?.get("file");
  if (!(f instanceof File)) return Response.json({ error: "Thiếu tệp" }, { status: 400 });
  try {
    const r = await processFile(Buffer.from(await f.arrayBuffer()), f.name);
    const text = r.blocks.map((b) => (b.type === "text" ? b.text : b.type === "document" ? b.fallbackText ?? "" : "")).filter(Boolean).join("\n\n");
    return Response.json({ id: r.id, name: f.name, kind: r.kind, tokens: r.tokens, large: r.large, preview: text.slice(0, 200_000), images: r.blocks.filter((b) => b.type === "image").length });
  } catch (e) {
    const user = e instanceof FileError;
    return Response.json({ error: user ? e.message : `Không xử lý được "${f.name}": ${(e as Error).message.slice(0, 200)}` }, { status: user ? 422 : 500 });
  }
}
