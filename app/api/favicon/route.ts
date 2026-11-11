import { AuthError, handle, limit, requireUser } from "../../authstore";
import { cachedIcon, iconResponse, publicHost } from "../../iconproxy";
import { fetchIconBytes, siteIcon } from "../../connicons";
import { composioKey, toolkitLogoUrl } from "../../composio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ảnh nhỏ máy chủ tải hộ, qua bộ đệm (app/iconproxy.ts):
//  ?d=<tên miền>   favicon của nguồn trích dẫn tìm web
//  ?app=<slug>     logo ứng dụng Composio (meta.logo của API toolkits)
// 404: không có ảnh, giao diện hiện chữ cái đầu. Ảnh đã có trong bộ đệm trả ngay; mỗi tài khoản tải mới tối đa 150 ảnh / 10 phút
// (mỗi lần tải mới là một lần máy chủ gọi ra ngoài, logo ứng dụng còn tốn một lần gọi Composio bằng khóa của chủ máy chủ).
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const gate = () => limit("favicon:" + user.id, 150, 10 * 60_000);
  const q = new URL(req.url).searchParams;
  const d = q.get("d"), app = q.get("app");
  if (d !== null) {
    const host = publicHost(d);
    if (!host) throw new AuthError("Tên miền không hợp lệ.", 400);
    const icon = await cachedIcon(`site:${host}`, () => siteIcon(host), gate);
    return icon ? iconResponse(icon) : new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
  }
  if (app !== null) {
    const slug = app.toLowerCase();
    if (!/^[a-z0-9_-]{1,60}$/.test(slug)) throw new AuthError("Ứng dụng không hợp lệ.", 400);
    if (!composioKey()) return new Response(null, { status: 404 });
    const icon = await cachedIcon(`kit:${slug}`, async () => { const u = await toolkitLogoUrl(slug); return u ? fetchIconBytes(u, 256 * 1024) : null; }, gate);
    return icon ? iconResponse(icon) : new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
  }
  throw new AuthError("Thiếu tham số.", 400);
});
