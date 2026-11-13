import { isAdmin } from "../../../../authstore";
import { getSkill, removeSkill, skillErr } from "../../../../skillstore";
import { listPlugins, PluginError, publishSkill } from "../../../../plugins";
import { route } from "../../../../../server/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Đưa một skill của bạn vào "Thư viện cho mọi người" (chỉ quản trị viên): mọi tài khoản dùng được; bản riêng của bạn bỏ đi để không trùng.
// { source?: link gốc của skill (hiện ở thư viện) }
export const POST = route<{ name: string }>({ feature: "skills", json: true }, async ({ req, user, params }) => {
  const name = params.name;
  if (!isAdmin(user)) return Response.json({ error: "Chỉ quản trị viên thêm được skill vào thư viện cho mọi người." }, { status: 403 });
  try {
    const b = await req.json().catch(() => ({})) as { source?: unknown };
    const s = await getSkill(user.id, name);
    if (!s) return Response.json({ error: "Không có skill này" }, { status: 404 });
    const plugin = await publishSkill(s, { name: user.full_name || user.name || user.email, source: typeof b.source === "string" ? b.source.slice(0, 300) : undefined });
    await removeSkill(user.id, name);
    return Response.json({ plugin, plugins: listPlugins(user.id) });
  } catch (e) {
    if (e instanceof PluginError) return Response.json({ error: e.message }, { status: e.status });
    return skillErr(e);
  }
});
