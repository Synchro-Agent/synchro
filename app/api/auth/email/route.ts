import { handle, requestEmailChange, requireUser, sameOrigin } from "../../../../server/authstore";

export const runtime = "nodejs";

// { password, email, lang }: xin đổi email. Luôn trả lời như nhau dù email mới đã có người dùng: không để lộ email nào đã đăng ký.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const { password, email, lang } = await req.json();
  await requestEmailChange(req, user, password, email, lang);
  return Response.json({ ok: true });
});
