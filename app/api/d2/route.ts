import { clientIp, current, handle, limit, sameOrigin } from "../../authstore";
import { cachedD2, D2_MAX, renderD2 } from "../../d2render";
import { shareOwnerWithCode } from "../../sharestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sơ đồ D2 → SVG: { code, dark } → { svg } hoặc { error }. Khối ```d2 trong chat và artifact application/vnd.d2 gọi tới đây.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "", dark = body.dark === true;
  // Trang chia sẻ công khai (người xem chưa đăng nhập): trả sơ đồ đã vẽ (bộ nhớ đệm, cả trên đĩa). Chưa có thì chỉ vẽ khi đoạn mã nằm trong đúng
  // liên kết chia sẻ người xem đang mở (share), dưới tên chủ liên kết; không chạy sandbox cho mã tùy ý của người lạ.
  const c = current(req);
  if (!c) {
    const ip = clientIp(req);
    limit("d2-anon:" + ip, 120, 10 * 60_000);
    const svg = cachedD2(code, dark);
    if (svg) return Response.json({ svg });
    const share = typeof body.share === "string" ? body.share : "";
    const owner = share && code.length <= D2_MAX ? shareOwnerWithCode(share, code) : null;
    if (owner) {
      limit("d2-share:" + ip, 30, 10 * 60_000);
      const r = await renderD2(owner, code, dark);
      if ("svg" in r) return Response.json(r);
    }
    // Không vẽ được theo chủ đề của người xem: bản của chủ đề kia vẫn hơn ô báo lỗi.
    const other = cachedD2(code, dark, true);
    return Response.json(other ? { svg: other } : { error: "Đăng nhập để vẽ sơ đồ này." }, { status: other ? 200 : 401 });
  }
  limit("d2:" + c.user.id, 120, 10 * 60_000);
  const r = await renderD2(c.user.id, code, dark);
  return Response.json(r, { status: "svg" in r ? 200 : 422 });
});
