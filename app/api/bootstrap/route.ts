import { current, handle } from "../../../server/authstore";
import { bootEtag, bootOf, etagMatch } from "../../../server/bootdata";
import { prewarmLater } from "../../../server/modelslist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lệnh khởi động (blueprint A3): { user, providers, signupOpen, speechReady, models, caps, studios, inboxCount } từ một lần tra phiên.
// ETag theo người dùng; If-None-Match khớp thì trả 304 không thân. Trang chủ thường đã nhận gói này dựng sẵn ở máy chủ (app/page.tsx).
export const GET = handle(async (req: Request) => {
  const c = current(req);
  const boot = await bootOf(c?.user ?? null);
  const body = JSON.stringify(boot);
  const tag = bootEtag(c?.user.id ?? null, body);
  const headers = { ETag: tag, "Cache-Control": "private, no-cache", Vary: "Cookie" };
  if (c && boot.models) prewarmLater(c.user);
  if (etagMatch(req.headers.get("if-none-match"), tag)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers: { ...headers, "content-type": "application/json" } });
});
