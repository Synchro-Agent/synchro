import { AuthError, handle, requireUser, sameOrigin } from "../../../authstore";
import { addZipToPlugin, checkUpdate, getPlugin, listPlugins, pluginOwner, PluginError, removePlugin, setPlugin, updatePlugin, type Studio } from "../../../plugins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

// Plugin cài sẵn của hệ thống ("org") hoặc plugin tự cài.
async function access(req: Request, ctx: Ctx) {
  const { user } = requireUser(req);
  const id = (await ctx.params).id;
  const owner = pluginOwner(id);
  if (!owner || (owner !== "org" && owner !== user.id)) throw new AuthError("Không tìm thấy plugin.", 404);
  return { user, id };
}
const err = (e: unknown) => { if (e instanceof PluginError) return Response.json({ error: e.message }, { status: e.status }); throw e; };

// { enabled?, everywhere?, studio?, skills?: { tên: bật } }
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const a = await access(req, ctx);
  const b = await req.json().catch(() => ({}));
  setPlugin(a.id, { enabled: b.enabled, everywhere: b.everywhere, studio: b.studio as Studio | null | undefined, skills: b.skills });
  return Response.json({ plugin: getPlugin(a.id, a.user.id), plugins: listPlugins(a.user.id) });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const a = await access(req, ctx);
  await removePlugin(a.id);
  return Response.json({ plugins: listPlugins(a.user.id) });
});

// { action: "check" | "update" } hoặc tải lên zip (multipart, trường "file") để thêm skill vào plugin.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const a = await access(req, ctx);
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
    return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
  } catch (e) { return err(e); }
});
