import { current, handle, publicUser } from "../../../authstore";
import { providerStatus } from "../../../oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const c = current(req);
  return Response.json({ user: c ? publicUser(c.user) : null, providers: providerStatus() });
});
