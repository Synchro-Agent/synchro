import { clientIp, current, handle, limit, sameOrigin } from "../../../server/authstore";
import { recordOps } from "../../../server/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lỗi hiển thị ở trình duyệt (errorreport.ts), kể cả trước khi đăng nhập. Không gắn với tài khoản; làm sạch và cắt ngắn trong recordOps, sổ có giới hạn số dòng.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  // Kiểm tra nguồn giả được ngoài trình duyệt. Chưa đăng nhập: ít hơn theo IP, và có trần chung cho mọi khách để một vòng lặp đổi IP không làm đầy sổ.
  const c = current(req);
  if (c) limit("client-error:" + c.user.id, 20, 10 * 60_000);
  else { limit("client-error:" + clientIp(req), 5, 10 * 60_000); limit("client-error:anon", 60, 60 * 60_000); }
  const b = await req.json().catch(() => ({}));
  const msg = [b.where, b.message, b.stack].filter((x) => typeof x === "string" && x).map((x: string) => x.slice(0, 600)).join(" | ");
  if (msg) recordOps("browser", msg);
  return Response.json({ ok: true });
});
