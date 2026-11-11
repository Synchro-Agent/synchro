import { AuthError, handle, requireUser } from "../../authstore";
import { cachedIcon, iconResponse, publicHost } from "../../iconproxy";
import { siteIcon } from "../../connicons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ảnh nhỏ máy chủ tải hộ, qua bộ đệm (app/iconproxy.ts):
//  ?d=<tên miền>   favicon của nguồn trích dẫn tìm web
// 404: không có ảnh, giao diện hiện chữ cái đầu.
export const GET = handle(async (req: Request) => {
  requireUser(req);
  const q = new URL(req.url).searchParams;
  const d = q.get("d");
  if (d !== null) {
    const host = publicHost(d);
    if (!host) throw new AuthError("Tên miền không hợp lệ.", 400);
    const icon = await cachedIcon(`site:${host}`, () => siteIcon(host));
    return icon ? iconResponse(icon) : new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
  }
  throw new AuthError("Thiếu tham số.", 400);
});
