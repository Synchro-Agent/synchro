import { handle, requireUser } from "../../../authstore";
import { readOutput } from "../../../outputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tải tệp code đã tạo. ?inline=1 để xem ngay trong Synchro: ảnh raster, âm thanh, video. Các loại khác (PDF, Office, SVG,
// HTML) luôn tải về dạng tệp: khung xem trước tự đọc nội dung rồi dựng trong khung cô lập, không chạy trên nguồn gốc của Synchro.
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const f = readOutput(requireUser(req).user.id, (await ctx.params).id);
  if (!f) return Response.json({ error: "Tệp không còn nữa (tệp được giữ 30 ngày)." }, { status: 404 });
  const inline = new URL(req.url).searchParams.get("inline") === "1" && /^(image\/(png|jpeg|gif|webp)|audio\/(mpeg|wav)|video\/mp4)$/.test(f.mime);
  return new Response(new Uint8Array(f.data), { headers: {
    "content-type": inline ? f.mime : f.mime.startsWith("text/") || f.mime === "image/svg+xml" ? "application/octet-stream" : f.mime,
    "content-length": String(f.data.length),
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600",
    "content-security-policy": "default-src 'none'; sandbox",
  } });
});
