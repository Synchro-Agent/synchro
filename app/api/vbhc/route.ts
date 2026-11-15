import { handle, limit, requireUser, sameOrigin } from "../../../server/authstore";
import { parseVbhc } from "../../../shared/vbhc";
import { vbhcDocx } from "../../../server/vbhcdocx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Văn bản hành chính → tệp Word đúng thể thức NĐ 30/2020: { content: JSON của artifact, name } → .docx.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("vbhc:" + user.id, 120, 10 * 60_000);
  const body = await req.json().catch(() => ({}));
  const { spec, error } = parseVbhc(typeof body.content === "string" ? body.content.slice(0, 200_000) : "");
  if (!spec) return Response.json({ error }, { status: 400 });
  const name = (typeof body.name === "string" && /^[\w.-]{1,80}\.docx$/.test(body.name) ? body.name : "van-ban.docx");
  const buf = await vbhcDocx(spec);
  return new Response(new Uint8Array(buf), { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "content-disposition": `attachment; filename="${name}"`, "x-content-type-options": "nosniff",
  } });
});
