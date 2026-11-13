import { featureGate, handle, limit, requireUser, sameOrigin } from "../../../authstore";
import { deckFromText, exportDeckPptx, type DeckInput } from "../../../deckexport";
import { getArtifactByIdent } from "../../../artifactstore";
import { capsState } from "../../../caps";
import { getRun } from "../../../runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// G4: xuất bản trình bày HTML thành PowerPoint ở máy chủ (dùng Chromium của workspace, không cần trình duyệt người dùng mở).
// SEC-5: chỉ xuất nội dung của chính người dùng do máy chủ tự nạp, không nhận HTML thô từ trình duyệt:
//   { conv, identifier }  artifact trong kho artifact của người dùng;
//   { run, identifier }   artifact trong kết quả một lượt của người dùng (Hộp thư, việc tự động chạy nền: kết quả không vào kho artifact).
// Trang slide chạy script trong Chromium nên cần quyền "Chạy code" như run_code, mạng theo quyền net / web của người dùng. Trả tệp .pptx.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const denied = featureGate(req, "sandbox"); if (denied) return denied;
  const { caps } = capsState(user);
  if (!caps.code) return Response.json({ error: "Chạy code đang tắt trong Cài đặt → Khả năng." }, { status: 403 });
  limit("pptx:" + user.id, 10, 10 * 60_000);
  const body = (await req.json().catch(() => ({}))) as { conv?: unknown; run?: unknown; identifier?: unknown };
  const origin = process.env.APP_URL || new URL(req.url).origin;
  let deck: DeckInput | null = null;
  if (typeof body.identifier === "string" && typeof body.conv === "string") {
    const row = getArtifactByIdent(user.id, body.conv, body.identifier);
    const last = row?.versions[row.versions.length - 1];
    if (row && last) deck = { type: row.type, content: last.content, title: row.title };
  } else if (typeof body.identifier === "string" && typeof body.run === "string") {
    const text = (getRun(body.run, user.id)?.result as { text?: unknown } | null)?.text;
    if (typeof text === "string") deck = deckFromText(text, body.identifier);
  }
  if (!deck) return Response.json({ error: "Thiếu dữ liệu bản trình bày." }, { status: 400 });
  const r = await exportDeckPptx(user.id, deck, origin, { net: caps.net, web: caps.web });
  if (!r.ok) return Response.json({ error: r.error }, { status: 422 });
  return new Response(new Uint8Array(r.data), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="${r.name}"`, "x-content-type-options": "nosniff", "cache-control": "no-store",
    },
  });
});
