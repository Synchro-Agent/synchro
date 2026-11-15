import { AuthError, handle, isAdmin, requireUser, sameOrigin } from "../../../../server/authstore";
import { markRemoved } from "../../../../server/plugjob";
import { addZipToPlugin, checkUpdate, getPlugin, listPlugins, pluginOwner, PluginError, removePlugin, removePluginSkills, setPlugin, setPref, updatePlugin, type StudioMode } from "../../../../server/plugins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

// Quản lý được: chủ plugin cá nhân, hoặc quản trị viên với plugin của tổ chức.
async function access(req: Request, ctx: Ctx) {
  const { user } = requireUser(req);
  const id = (await ctx.params).id;
  const owner = pluginOwner(id);
  if (!owner || (owner !== "org" && owner !== user.id)) throw new AuthError("Không tìm thấy plugin.", 404);
  return { user, id, manage: owner === user.id || (owner === "org" && isAdmin(user)), org: owner === "org" };
}
const err = (e: unknown) => { if (e instanceof PluginError) return Response.json({ error: e.message }, { status: e.status }); throw e; };

// Chi tiết một thư viện: mọi skill kèm mô tả, giấy phép, mức rủi ro (danh sách ở GET /api/plugins chỉ có tên skill).
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const a = await access(req, ctx);
  return Response.json({ plugin: getPlugin(a.id, a.user.id) });
});

// Quản lý: { enabled?, everywhere?, studio?: "auto" | "none" | "design" | "slides" | "docs", skills?: { tên: bật } }. Người dùng với plugin tổ chức: { mine: { enabled?, everywhere? } }.
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const a = await access(req, ctx);
  const b = await req.json().catch(() => ({}));
  if (b.mine && typeof b.mine === "object") setPref(a.user.id, a.id, { enabled: b.mine.enabled, everywhere: b.mine.everywhere });
  const admin = { enabled: b.enabled, everywhere: b.everywhere, studio: b.studio as StudioMode | null | undefined, skills: b.skills };
  if (Object.values(admin).some((v) => v !== undefined)) {
    if (!a.manage) throw new AuthError("Chỉ quản trị viên mới đổi được plugin của tổ chức.", 403);
    setPlugin(a.id, admin);
  }
  return Response.json({ plugin: getPlugin(a.id, a.user.id), plugins: listPlugins(a.user.id) });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const a = await access(req, ctx);
  if (!a.manage) throw new AuthError("Chỉ quản trị viên mới gỡ được plugin của tổ chức.", 403);
  const cid = a.org ? getPlugin(a.id)?.catalogId ?? null : null;
  await removePlugin(a.id);
  // Thư viện mặc định (danh mục của Claude) quản trị viên đã gỡ: không tự cài lại khi danh mục cập nhật.
  markRemoved(cid);
  return Response.json({ plugins: listPlugins(a.user.id) });
});

// { action: "check" | "update" }, { action: "remove-skills", names } (xóa hẳn skill khỏi thư viện, không quay lại khi cập nhật)
// hoặc tải lên zip (multipart, trường "file") để thêm skill vào plugin.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const a = await access(req, ctx);
  if (!a.manage) throw new AuthError("Chỉ quản trị viên mới cập nhật được plugin của tổ chức.", 403);
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const f = (await req.formData()).get("file");
      if (!(f instanceof File)) return Response.json({ error: "Thiếu file zip." }, { status: 400 });
      const r = await addZipToPlugin(a.id, Buffer.from(await f.arrayBuffer()));
      return Response.json({ added: r.added, plugin: getPlugin(a.id, a.user.id), plugins: listPlugins(a.user.id) });
    }
    const b = await req.json().catch(() => ({}));
    if (b.action === "check") return Response.json({ ...(await checkUpdate(a.id)), plugin: getPlugin(a.id, a.user.id) });
    if (b.action === "update") { await updatePlugin(a.id); return Response.json({ plugin: getPlugin(a.id, a.user.id), plugins: listPlugins(a.user.id) }); }
    if (b.action === "remove-skills") {
      const names = Array.isArray(b.names) ? b.names.filter((x: unknown): x is string => typeof x === "string").slice(0, 500) : [];
      if (!names.length) return Response.json({ error: "Chưa chọn skill nào để xóa." }, { status: 400 });
      const r = await removePluginSkills(a.id, names);
      return Response.json({ ...r, plugin: r.uninstalled ? null : getPlugin(a.id, a.user.id), plugins: listPlugins(a.user.id) });
    }
    return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
  } catch (e) { return err(e); }
});
