import { handle, requireUser } from "../../authstore";
import { fetchImage } from "../../artimg";
import { genImageId, isPlaceholderPng } from "../../artdoc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ảnh từ URL ngoài cho khung artifact: khung xem trước tải ảnh qua đây rồi nhúng thành data: (CSP của khung chỉ cho ảnh nhúng).
export const GET = handle(async (req: Request) => {
  const user = requireUser(req);
  const u = new URL(req.url).searchParams.get("u") ?? "";
  if (!/^https?:\/\//i.test(u) || u.length > 2000) return Response.json({ error: "Địa chỉ ảnh không hợp lệ." }, { status: 400 });
  const img = await fetchImage(u, user.user.id);
  if (!img) return Response.json({ error: "Không tải được ảnh." }, { status: 404 });
  // W23-2: ảnh do Synchro dựng còn là ảnh giữ chỗ (đang dựng ở chế độ nền) thì không cho lưu đệm và báo "đang chờ": khung xem trước hỏi lại tới khi
  // byte thật thay vào cùng id. Trước đây ảnh giữ chỗ được trình duyệt giữ 24 giờ nên ảnh thật không bao giờ hiện, kể cả khi tải lại trang.
  const pending = !!genImageId(u) && isPlaceholderPng(img.data);
  return new Response(new Uint8Array(img.data), { headers: {
    "content-type": img.mime, "content-length": String(img.data.length), "cache-control": pending ? "no-store" : "private, max-age=86400",
    ...(pending ? { "x-synchro-pending": "1" } : {}),
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
  } });
});
