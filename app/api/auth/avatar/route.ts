import { getUser, handle, isAdmin, requireUser } from "../../../../server/authstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ảnh đại diện tự tải lên. ?v= đổi khi ảnh đổi nên nhớ lâu được; private: chỉ trình duyệt của người đang đăng nhập nhớ, không qua bộ nhớ đệm chung. Chỉ chính chủ và quản trị viên.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const id = new URL(req.url).searchParams.get("u") ?? "";
  const t = id === user.id ? user : isAdmin(user) ? getUser(id) : undefined;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(t?.avatar ?? "");
  if (!m) return new Response(null, { status: 404 });
  const data = Buffer.from(m[2], "base64");
  return new Response(new Uint8Array(data), { headers: {
    "content-type": m[1], "content-length": String(data.length), "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
  } });
});
