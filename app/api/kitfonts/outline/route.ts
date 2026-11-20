import { route } from "../../../../server/route";
import { outlineLogos } from "../../../../server/fontoutline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tải về SVG: chữ <text data-sx-logo> thành đường nét (server/fontoutline.ts). { svg } → { svg }.
// 422 khi máy chủ không đổi được (không có sandbox, fontTools lỗi): trình duyệt giữ chữ kèm phông nhúng.
const LIMIT = { key: "kitfonts-outline", max: 60, windowMs: 10 * 60_000 };
export const POST = route({ json: true, limit: LIMIT }, async ({ req, user }) => {
  // Thân không phải JSON hợp lệ: coi như không có SVG, trả 400 ngay bên dưới.
  const body = (await req.json().catch(() => ({}))) as { svg?: unknown };
  const svg = typeof body.svg === "string" ? body.svg : "";
  if (!svg || svg.length > 2_000_000 || !/<svg\b/i.test(svg)) {
    return Response.json({ error: "Cần nội dung SVG (tối đa 2 MB)." }, { status: 400 });
  }
  const out = await outlineLogos(user.id, svg, req.signal);
  if (out === null) {
    return Response.json({ error: "Chưa đổi được chữ logo thành nét trên máy chủ này." }, { status: 422 });
  }
  return Response.json({ svg: out });
});
