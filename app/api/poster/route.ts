import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { POSTER_TEMPLATES, posterProps, renderPoster, type PosterTemplate } from "../../design-engine/posters/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Poster dựng ở máy chủ (Satori): { templateId: "poster-master-og", props: { tag, title, metricValue, metricLabel, author }, scale: 1 | 2 | 3 } → PNG 1200×630 × scale.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("poster:" + user.id, 60, 10 * 60_000);
  const body = await req.json().catch(() => ({}));
  const id = String(body.templateId ?? "poster-master-og");
  if (!(POSTER_TEMPLATES as readonly string[]).includes(id)) return Response.json({ error: `Không có mẫu ${id}` }, { status: 400 });
  const props = posterProps(body.props);
  if (typeof props === "string") return Response.json({ error: props }, { status: 400 });
  const scale = ([1, 2, 3] as const).find((s) => s === Number(body.scale)) ?? 3;
  const png = await renderPoster(id as PosterTemplate, props, scale);
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "content-disposition": `attachment; filename="poster-${scale}x.png"`, "x-content-type-options": "nosniff", "cache-control": "no-store" } });
});
