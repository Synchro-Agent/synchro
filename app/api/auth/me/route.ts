import { current, handle, publicUser, signupOpen } from "../../../authstore";
import { turnstileSiteKey } from "../../../turnstile";
import { providerStatus } from "../../../oauth";
import { hasSharedChat, serviceKey } from "../../../providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const c = current(req);
  return Response.json({ user: c ? publicUser(c.user) : null, providers: providerStatus(), signupOpen: signupOpen(), speechReady: !!serviceKey("elevenlabs"), plansOnly: !hasSharedChat(), turnstile: turnstileSiteKey(), support: process.env.SUPPORT_EMAIL || null });
});
