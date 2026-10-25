import { current, permsOf } from "../../authstore";
import { ALL } from "../../catalog";
import { catalog, mainModels, pickDefault } from "../../providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Danh sách model cho bộ chọn model: chỉ những model quản trị viên cho hiện ở màn hình chính, kèm quyền của tài khoản.
export async function GET(req: Request) {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  const cat = await catalog();
  const main = mainModels();
  const providers = cat.map((p) => ({ ...p, models: main.includes(ALL) ? p.models : p.models.filter((m) => main.includes(m.key)) })).filter((p) => p.models.length);
  const perms = permsOf(c.user);
  return Response.json({ providers, default: pickDefault(cat, main), allowed: perms.models, effort: perms.effort ?? {} });
}
