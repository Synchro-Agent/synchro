import { AuthError, handle, limit, requireUser } from "../../authstore";
import { cachedIcon, iconResponse, publicHost } from "../../iconproxy";
import { fetchIconBytes, siteIcon } from "../../connicons";
import { composioKey, toolkitLogoUrl } from "../../composio";
import { providerSiteOf } from "../../providers";
import { APP_SITES } from "../../connlogos";

// Logo ứng dụng Composio: meta.logo qua API khi máy chủ có khóa Composio, rồi kho logo công khai của Composio (không cần khóa; ứng dụng
// lạ thì kho trả hình lưới dự phòng, coi như không có), rồi biểu tượng trang của ứng dụng. COMPOSIO_LOGO_URL (bản giả lập): mẫu địa chỉ có {slug}.
const LOGO_URL = () => process.env.COMPOSIO_LOGO_URL || "https://logos.composio.dev/api/{slug}";
async function appIcon(slug: string) {
  if (composioKey()) { const u = await toolkitLogoUrl(slug).catch(() => null); const b = u ? await fetchIconBytes(u, 256 * 1024) : null; if (b) return b; }
  const b = await fetchIconBytes(LOGO_URL().replace("{slug}", encodeURIComponent(slug)), 256 * 1024);
  if (b && !(b.mime === "image/svg+xml" && b.buf.includes("composio-fallback"))) return b;
  const site = Object.hasOwn(APP_SITES, slug) ? publicHost(APP_SITES[slug]) : null;
  return site ? siteIcon(site) : null;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ảnh nhỏ máy chủ tải hộ, qua bộ đệm (app/iconproxy.ts):
//  ?d=<tên miền>   favicon của nguồn trích dẫn tìm web
//  ?app=<slug>     logo ứng dụng Composio (meta.logo, kho logo công khai của Composio, rồi biểu tượng trang của ứng dụng)
//  ?p=<mã>         biểu tượng trang của nhà cung cấp model tương thích OpenAI (tên miền thương hiệu của địa chỉ API, chỉ máy chủ biết địa chỉ)
// 404: không có ảnh, giao diện hiện chữ cái đầu. Ảnh đã có trong bộ đệm trả ngay; mỗi tài khoản tải mới tối đa 150 ảnh / 10 phút
// (mỗi lần tải mới là một lần máy chủ gọi ra ngoài, logo ứng dụng còn tốn một lần gọi Composio bằng khóa của chủ máy chủ).
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  const gate = () => limit("favicon:" + user.id, 150, 10 * 60_000);
  const q = new URL(req.url).searchParams;
  const d = q.get("d"), app = q.get("app"), prov = q.get("p");
  if (d !== null) {
    const host = publicHost(d);
    if (!host) throw new AuthError("Tên miền không hợp lệ.", 400);
    const icon = await cachedIcon(`site:${host}`, () => siteIcon(host), gate);
    return icon ? iconResponse(icon) : new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
  }
  if (app !== null) {
    const slug = app.toLowerCase();
    if (!/^[a-z0-9_-]{1,60}$/.test(slug)) throw new AuthError("Ứng dụng không hợp lệ.", 400);
    const icon = await cachedIcon(`kit:${slug}`, () => appIcon(slug), gate);
    return icon ? iconResponse(icon) : new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
  }
  if (prov !== null) {
    if (!/^[\w-]{1,80}$/.test(prov)) throw new AuthError("Nhà cung cấp không hợp lệ.", 400);
    const host = providerSiteOf(prov);
    if (!host) return new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
    const icon = await cachedIcon(`site:${host}`, () => siteIcon(host), gate);
    return icon ? iconResponse(icon) : new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
  }
  throw new AuthError("Thiếu tham số.", 400);
});
