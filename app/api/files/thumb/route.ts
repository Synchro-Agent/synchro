import { storedFile } from "../../../fileproc";
import { featureGate } from "../../../authstore";

export const runtime = "nodejs";

// GET ?id=<mã tệp> → ảnh (đã thu nhỏ khi tải lên) để thẻ tệp trong tin nhắn cũ vẫn hiện ảnh sau khi tải lại trang, như Claude.
export async function GET(req: Request) {
  const denied = featureGate(req, "files"); if (denied) return denied;
  const s = await storedFile(new URL(req.url).searchParams.get("id") ?? "");
  const img = s?.rec.blocks.find((b) => b.type === "image");
  if (!img || img.type !== "image") return new Response(null, { status: 404 });
  return new Response(Buffer.from(img.data, "base64"), { headers: { "Content-Type": img.media_type, "Cache-Control": "private, max-age=604800, immutable" } });
}
