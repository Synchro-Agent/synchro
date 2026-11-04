import { handle, publicUser, sameOrigin, signup, withCookies } from "../../../authstore";

export const runtime = "nodejs";

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { email, password, profile, lang } = await req.json();
  const { user, cookie, pending } = await signup(req, email, password, profile ?? {}, lang);
  if (pending) return Response.json({ pending: true });
  return withCookies(Response.json({ user: publicUser(user) }), cookie);
});
