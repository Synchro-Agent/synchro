import { handle, publicUser, sameOrigin, signup, withCookies } from "../../../authstore";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { email, password, profile } = await req.json();
  const { user, cookie } = await signup(req, email, password, profile ?? {});
  return withCookies(Response.json({ user: publicUser(user) }), cookie);
});
