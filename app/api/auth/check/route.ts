import { handle, lookup, sameOrigin } from "../../../authstore";

export const runtime = "nodejs";

// Bước nhập email: cho biết nên hiện màn hình đăng nhập hay tạo mật khẩu.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { email } = await req.json();
  return Response.json(lookup(req, email));
});
