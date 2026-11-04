import { clientIp, handle, limit, sameOrigin } from "../../authstore";
import { recordOps } from "../../ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lỗi hiển thị ở trình duyệt (errorreport.ts), kể cả trước khi đăng nhập. Không gắn với tài khoản; làm sạch và cắt ngắn trong recordOps, sổ có giới hạn số dòng.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  limit("client-error:" + clientIp(req), 20, 10 * 60_000);
  const b = await req.json().catch(() => ({}));
  const msg = [b.where, b.message, b.stack].filter((x) => typeof x === "string" && x).map((x: string) => x.slice(0, 600)).join(" | ");
  if (msg) recordOps("browser", msg);
  return Response.json({ ok: true });
});
