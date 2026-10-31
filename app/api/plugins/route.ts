import { AuthError, can, handle, isAdmin, limit, requireUser, sameOrigin } from "../../authstore";
import { findLinkDup, installPlugin, linkDupMessage, listPlugins, parseRepo, PluginError, previewPlugin, studioSummary, type PluginDef } from "../../plugins";
import { PLUGIN_DIR } from "../../plugindir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const err = (e: unknown) => (e instanceof PluginError ? Response.json({ error: e.message }, { status: e.status }) : null);

// Plugin của tổ chức + của riêng mình, và danh mục plugin dựng sẵn.
export const GET = handle(async (req: Request) => {
  const { user } = requireUser(req);
  // studios: thư viện của Tài liệu / Trình bày / Thiết kế ở trang Artifacts, gồm cả skill Synchro tự nhận diện thuộc mục đó.
  return Response.json({ plugins: listPlugins(user.id), directory: PLUGIN_DIR, admin: isAdmin(user), canInstall: can(user, "skills"), studios: can(user, "skills") ? studioSummary(user.id) : {} });
});

// { action: "preview" | "install", catalogId? | url?, scope: "org" | "personal", skip?: string[] }
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  if (!can(user, "skills")) throw new AuthError("Quản trị viên chưa cho phép tài khoản của bạn dùng Skills và Plugins.", 403);
  const b = await req.json().catch(() => ({}));
  const scope = b.scope === "org" ? "org" : "personal";
  if (scope === "org" && !isAdmin(user)) throw new AuthError("Chỉ quản trị viên mới cài được plugin cho cả tổ chức.", 403);
  let def: PluginDef | undefined;
  try {
    if (typeof b.catalogId === "string") def = PLUGIN_DIR.find((p) => p.catalogId === b.catalogId);
    else if (typeof b.url === "string") {
      // Link đã dùng để thêm skill / thư viện (của chính mình, hoặc thư viện cho mọi người): báo trùng, không cài lại.
      const dup = findLinkDup(user.id, b.url);
      if (dup) return Response.json({ error: linkDupMessage(dup), duplicate: dup }, { status: 409 });
      const src = parseRepo(b.url);
      const repo = src.repo.split("/")[1];
      const slug = (src.path ? `${repo}-${src.path.split("/").pop()}` : repo).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plugin";
      def = { slug, name: src.path ? `${repo} / ${src.path.split("/").pop()}` : repo, description: `Cài từ github.com/${src.repo}${src.path ? `/${src.path}` : ""}`, author: src.repo.split("/")[0], homepage: `https://github.com/${src.repo}`, sources: [src] };
    }
    if (!def) return Response.json({ error: "Không tìm thấy plugin." }, { status: 404 });
    if (b.action === "install") {
      limit("plugin:" + user.id, 20, 3600_000);
      const skip = Array.isArray(b.skip) ? b.skip.filter((x: unknown): x is string => typeof x === "string").slice(0, 200) : [];
      const plugin = await installPlugin(scope === "org" ? "org" : user.id, def, { skip, by: user.id });
      return Response.json({ plugin, plugins: listPlugins(user.id) });
    }
    limit("plugin-preview:" + user.id, 60, 3600_000);
    return Response.json({ preview: await previewPlugin(def) });
  } catch (e) { return err(e) ?? (() => { throw e; })(); }
});
