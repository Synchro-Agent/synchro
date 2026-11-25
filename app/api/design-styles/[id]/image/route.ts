// Ảnh của một phong cách (ảnh người dùng gửi, ảnh chụp trang họ dán, ảnh artifact): chỉ chủ phong cách xem được.
// Ảnh mẫu của thư viện tham chiếu không đi qua đây: ảnh đó chỉ dành cho model, không hiện cho người dùng.
import fs from "node:fs";
import { handle, requireUser } from "../../../../../server/authstore";
import { getStyle, styleImageFile } from "../../../../../server/designstyles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, { params }: Ctx) => {
  const uid = requireUser(req).user.id;
  const { id } = await params;
  const file = getStyle(uid, id) ? styleImageFile(id) : null;
  if (!file) return Response.json({ error: "Không có ảnh này." }, { status: 404 });
  const headers = { "content-type": "image/webp", "cache-control": "private, max-age=3600" };
  return new Response(new Uint8Array(await fs.promises.readFile(file)), { headers });
});
