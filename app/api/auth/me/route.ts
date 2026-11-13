import { current, handle } from "../../../authstore";
import { authPart } from "../../../bootdata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const c = current(req);
  return Response.json(authPart(c ? c.user : null));
});
