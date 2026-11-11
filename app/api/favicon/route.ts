import { AuthError, handle, requireUser } from "../../authstore";
import { cachedIcon, iconResponse, publicHost } from "../../iconproxy";
import { fetchIconBytes, siteIcon } from "../../connicons";
import { composioKey, toolkitLogoUrl } from "../../composio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ảnh nhỏ máy chủ tải hộ, qua bộ đệm (app/iconproxy.ts):
//  ?d=<tên miền>   favicon của nguồn trích dẫn tìm web
//  ?app=<slug>     logo ứng dụng Composio (meta.logo của API toolkits)
// 404: không có ảnh, giao diện hiện chữ cái đầu.
export const GET = handle(async (req: Request) => {
  requireUser(req);
  const q = new URL(req.url).searchParams;
  const d = q.get("d"), app = q.get("app");
  if (d !== null) {
    const host = publicHost(d);
    if (!host) throw new AuthError("Tên miền không hợp lệ.", 400);
    const icon = await cachedIcon(`site:${host}`, () => siteIcon(host));
    return icon ? iconResponse(icon) : new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
  }
  if (app !== null) {
    const slug = app.toLowerCase();
    if (!/^[a-z0-9_-]{1,60}$/.test(slug)) throw new AuthError("Ứng dụng không hợp lệ.", 400);
    if (!composioKey()) return new Response(null, { status: 404 });
    const icon = await cachedIcon(`kit:${slug}`, async () => { const u = await toolkitLogoUrl(slug); return u ? fetchIconBytes(u, 256 * 1024) : null; });
    return icon ? iconResponse(icon) : new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
  }
  throw new AuthError("Thiếu tham số.", 400);
});
