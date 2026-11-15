import { current, handle } from "../../../../server/authstore";
import { authPart } from "../../../../server/bootdata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const c = current(req);
  return Response.json(authPart(c ? c.user : null));
});
