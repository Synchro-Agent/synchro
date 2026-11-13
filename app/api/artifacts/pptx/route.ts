import { handle, limit, requireUser, sameOrigin } from "../../../authstore";
import { exportDeckPptx, type DeckInput } from "../../../deckexport";
import { getArtifactByIdent } from "../../../artifactstore";
import type { ArtType } from "../../../artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// G4: xuất bản trình bày HTML thành PowerPoint ở máy chủ (dùng Chromium của workspace, không cần trình duyệt người dùng mở).
// Nhận { type, content, title } (khung xem gửi thẳng) hoặc { conv, identifier } (lấy từ kho artifact). Trả tệp .pptx.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("pptx:" + user.id, 30, 10 * 60_000);
  const body = (await req.json().catch(() => ({}))) as { type?: unknown; content?: unknown; title?: unknown; complete?: unknown; conv?: unknown; identifier?: unknown };
  const origin = process.env.APP_URL || new URL(req.url).origin;
  let deck: DeckInput | null = null;
  if (typeof body.content === "string" && typeof body.type === "string") {
    deck = { type: body.type as ArtType, content: body.content, title: String(body.title ?? "Bản trình bày"), complete: body.complete !== false };
  } else if (typeof body.conv === "string" && typeof body.identifier === "string") {
    const row = getArtifactByIdent(user.id, body.conv, body.identifier);
    const last = row?.versions[row.versions.length - 1];
    if (row && last) deck = { type: row.type, content: last.content, title: row.title };
  }
  if (!deck) return Response.json({ error: "Thiếu dữ liệu bản trình bày." }, { status: 400 });
  const r = await exportDeckPptx(user.id, deck, origin);
  if (!r.ok) return Response.json({ error: r.error }, { status: 422 });
  return new Response(new Uint8Array(r.data), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="${r.name}"`, "x-content-type-options": "nosniff", "cache-control": "no-store",
    },
  });
});
