import { AuthError, handle, limit, requireUser } from "../../authstore";
import { cachedIcon, iconResponse, publicHost, usableIcon } from "../../iconproxy";
import { fetchIconBytes, siteIcon } from "../../connicons";
import { providerSiteOf } from "../../providers";
import { APP_SITES } from "../../connlogos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ảnh nhỏ máy chủ tải hộ, qua bộ đệm (app/iconproxy.ts):
//  ?d=<tên miền>   favicon của nguồn trích dẫn tìm web
//  ?app=<slug>     logo ứng dụng trong Composio (Gmail, Slack…): logo chính thức ở logos.composio.dev, không có thì biểu tượng trang chủ theo bảng APP_SITES (slug → tên miền), không cần
//                  khóa Composio nào (không còn khóa dự án dùng chung). Ứng dụng không có trong bảng: 404, giao diện hiện chữ cái đầu.
//  ?p=<mã>         biểu tượng trang của nhà cung cấp model tương thích OpenAI (tên miền thương hiệu của địa chỉ API, chỉ máy chủ biết địa chỉ)
// 404: không có ảnh, giao diện hiện chữ cái đầu. Ảnh đã có trong bộ đệm trả ngay; mỗi tài khoản tải mới tối đa 150 ảnh / 10 phút
// (mỗi lần tải mới là một lần máy chủ gọi ra ngoài).
// Dịch vụ logo công khai của Composio (ảnh SVG / PNG, không cần khóa; trả qua proxy với CSP sandbox nên SVG không chạy được mã).
const CX_LOGOS = process.env.COMPOSIO_LOGO_URL || "https://logos.composio.dev/api";
let cxDflt: Promise<Buffer | null> | null = null;
const cxDefault = () => (cxDflt ??= fetchIconBytes(`${CX_LOGOS}/zz-synchro-unknown-app`).then((r) => r?.buf ?? null).then((b) => { if (!b) cxDflt = null; return b; }));
const none = () => new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const gate = () => limit("favicon:" + user.id, 150, 10 * 60_000);
  const q = new URL(req.url).searchParams;
  const d = q.get("d"), app = q.get("app"), prov = q.get("p");
  // Tên miền chỉ lấy từ bảng có sẵn hoặc từ cấu hình máy chủ, không bao giờ từ tham số; vẫn qua publicHost (chặn IP / tên nội bộ) và cùng bộ đệm site:.
  const site = async (h: string | null) => { const host = h ? publicHost(h) : null; if (!host) return none(); const icon = usableIcon(await cachedIcon(`site:${host}`, () => siteIcon(host), gate)); return icon ? iconResponse(icon) : none(); };
  if (d !== null) {
    const host = publicHost(d);
    if (!host) throw new AuthError("Tên miền không hợp lệ.", 400);
    return site(host);
  }
  if (app !== null) {
    const slug = app.toLowerCase();
    if (!/^[a-z0-9_-]{1,60}$/.test(slug)) throw new AuthError("Ứng dụng không hợp lệ.", 400);
    // 1. Logo chính thức của ứng dụng ở dịch vụ logo công khai của Composio (không cần khóa). Ứng dụng lạ thì dịch vụ đó trả một ảnh mặc định
    //    chung: so với ảnh mặc định (tải một lần) để bỏ qua. 2. Biểu tượng trang chủ theo bảng APP_SITES. 3. 404 → chữ cái đầu.
    const official = await cachedIcon(`cxapp:${slug}`, async () => {
      const [img, dflt] = await Promise.all([fetchIconBytes(`${CX_LOGOS}/${slug}`), cxDefault()]);
      return img && !(dflt && dflt.equals(img.buf)) ? img : null;
    }, gate);
    if (official) return iconResponse(official);
    return site(Object.hasOwn(APP_SITES, slug) ? APP_SITES[slug] : null);
  }
  if (prov !== null) {
    if (!/^[\w-]{1,80}$/.test(prov)) throw new AuthError("Nhà cung cấp không hợp lệ.", 400);
    return site(providerSiteOf(prov));
  }
  throw new AuthError("Thiếu tham số.", 400);
});
