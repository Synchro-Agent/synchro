import { clientIp, current, handle, limit, sameOrigin } from "../../authstore";
import { cachedD2, renderD2 } from "../../d2render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sơ đồ D2 → SVG: { code, dark } → { svg } hoặc { error }. Khối ```d2 trong chat và artifact application/vnd.d2 gọi tới đây.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "", dark = body.dark === true;
  // Trang chia sẻ công khai (người xem chưa đăng nhập): chỉ trả sơ đồ chủ artifact đã vẽ (bộ nhớ đệm), không chạy sandbox cho người lạ.
  const c = current(req);
  if (!c) {
    limit("d2-anon:" + clientIp(req), 120, 10 * 60_000);
    const svg = cachedD2(code, dark);
    return Response.json(svg ? { svg } : { error: "Đăng nhập để vẽ sơ đồ này." }, { status: svg ? 200 : 401 });
  }
  limit("d2:" + c.user.id, 120, 10 * 60_000);
  const r = await renderD2(c.user.id, code, dark);
  return Response.json(r, { status: "svg" in r ? 200 : 422 });
});
