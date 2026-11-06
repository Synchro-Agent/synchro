import { handle, requireUser } from "../../authstore";
import { fetchImage } from "../../artimg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ảnh từ URL ngoài cho khung artifact: khung xem trước tải ảnh qua đây rồi nhúng thành data: (CSP của khung chỉ cho ảnh nhúng).
export const GET = handle(async (req: Request) => {
  const user = requireUser(req);
  const u = new URL(req.url).searchParams.get("u") ?? "";
  if (!/^https?:\/\//i.test(u) || u.length > 2000) return Response.json({ error: "Địa chỉ ảnh không hợp lệ." }, { status: 400 });
  const img = await fetchImage(u, user.user.id);
  if (!img) return Response.json({ error: "Không tải được ảnh." }, { status: 404 });
  return new Response(new Uint8Array(img.data), { headers: {
    "content-type": img.mime, "content-length": String(img.data.length), "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
  } });
});
