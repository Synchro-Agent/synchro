import { AuthError, handle, limit, requireUser } from "../../authstore";
import { cachedIcon, iconResponse, publicHost } from "../../iconproxy";
import { siteIcon } from "../../connicons";
import { providerSiteOf } from "../../providers";
import { APP_SITES } from "../../connlogos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ảnh nhỏ máy chủ tải hộ, qua bộ đệm (app/iconproxy.ts):
//  ?d=<tên miền>   favicon của nguồn trích dẫn tìm web
//  ?app=<slug>     logo ứng dụng trong Composio (Gmail, Slack…): biểu tượng trang chủ của ứng dụng theo bảng APP_SITES (slug → tên miền), không cần
//                  khóa Composio nào (không còn khóa dự án dùng chung). Ứng dụng không có trong bảng: 404, giao diện hiện chữ cái đầu.
//  ?p=<mã>         biểu tượng trang của nhà cung cấp model tương thích OpenAI (tên miền thương hiệu của địa chỉ API, chỉ máy chủ biết địa chỉ)
// 404: không có ảnh, giao diện hiện chữ cái đầu. Ảnh đã có trong bộ đệm trả ngay; mỗi tài khoản tải mới tối đa 150 ảnh / 10 phút
// (mỗi lần tải mới là một lần máy chủ gọi ra ngoài).
const none = () => new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const gate = () => limit("favicon:" + user.id, 150, 10 * 60_000);
  const q = new URL(req.url).searchParams;
  const d = q.get("d"), app = q.get("app"), prov = q.get("p");
  // Tên miền chỉ lấy từ bảng có sẵn hoặc từ cấu hình máy chủ, không bao giờ từ tham số; vẫn qua publicHost (chặn IP / tên nội bộ) và cùng bộ đệm site:.
  const site = async (h: string | null) => { const host = h ? publicHost(h) : null; if (!host) return none(); const icon = await cachedIcon(`site:${host}`, () => siteIcon(host), gate); return icon ? iconResponse(icon) : none(); };
  if (d !== null) {
    const host = publicHost(d);
    if (!host) throw new AuthError("Tên miền không hợp lệ.", 400);
    return site(host);
  }
  if (app !== null) {
    const slug = app.toLowerCase();
    if (!/^[a-z0-9_-]{1,60}$/.test(slug)) throw new AuthError("Ứng dụng không hợp lệ.", 400);
    return site(Object.hasOwn(APP_SITES, slug) ? APP_SITES[slug] : null);
  }
  if (prov !== null) {
    if (!/^[\w-]{1,80}$/.test(prov)) throw new AuthError("Nhà cung cấp không hợp lệ.", 400);
    return site(providerSiteOf(prov));
  }
  throw new AuthError("Thiếu tham số.", 400);
});
