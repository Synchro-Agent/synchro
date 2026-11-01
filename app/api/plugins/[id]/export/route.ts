import { handle, requireUser } from "../../../../authstore";
import { exportPlugin, ExportError, zipResponse } from "../../../../skillexport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Tải về thư viện (plugin) thành tệp .zip: mọi skill, nguồn, commit, giấy phép và tùy chọn (app/skillexport.ts). Ai thấy thư viện thì xuất được.
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = requireUser(req);
  const lang = new URL(req.url).searchParams.get("lang") === "en" ? "en" : "vi";
  try {
    const { filename, buf } = await exportPlugin(user.id, (await ctx.params).id, lang);
    return zipResponse(filename, buf);
  } catch (e) {
    if (e instanceof ExportError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
