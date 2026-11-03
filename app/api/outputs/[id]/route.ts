import fs from "node:fs";
import { Readable } from "node:stream";
import { handle, requireUser } from "../../../authstore";
import { outputFile } from "../../../outputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INLINE = /^(image\/(png|jpeg|gif|webp)|audio\/(mpeg|wav|mp4|ogg|flac)|video\/(mp4|webm|quicktime))$/;

// Tải tệp code đã tạo. ?inline=1 để xem ngay trong Synchro: ảnh raster, âm thanh, video. Các loại khác (PDF, Office, SVG,
// HTML) luôn tải về dạng tệp: khung xem trước tự đọc nội dung rồi dựng trong khung cô lập, không chạy trên nguồn gốc của Synchro.
// Hỗ trợ Range (206): trình phát video tua được và Safari mới phát MP4; tệp đọc dần từ đĩa thay vì nạp cả tệp vào bộ nhớ.
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const f = outputFile(requireUser(req).user.id, (await ctx.params).id);
  if (!f) return Response.json({ error: "Tệp không còn nữa (tệp được giữ 30 ngày)." }, { status: 404 });
  const inline = new URL(req.url).searchParams.get("inline") === "1" && INLINE.test(f.mime);
  const headers: Record<string, string> = {
    "content-type": inline ? f.mime : f.mime.startsWith("text/") || f.mime === "image/svg+xml" ? "application/octet-stream" : f.mime,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  let start = 0, end = f.size - 1, status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), f.size - 1); }
    else start = Math.max(0, f.size - Number(m[2]));
    if (start > end || start >= f.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${f.size}` } });
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${f.size}`;
  }
  headers["content-length"] = String(f.size ? end - start + 1 : 0);
  if (!f.size) return new Response(new Uint8Array(0), { status, headers });
  const body = Readable.toWeb(fs.createReadStream(f.path, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
});
