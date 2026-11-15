import { AuthError, can, handle, requireUser, sameOrigin } from "../../../../server/authstore";
import { setStudioOverride, studioOf } from "../../../../server/plugins";

export const runtime = "nodejs";

// { studio, name, on }: mỗi người tự thêm (true), bỏ (false) một skill ở một mục của trang Artifacts, null là trả về như Synchro tự xếp. Chỉ ảnh hưởng tới chính họ.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  if (!can(user, "skills")) throw new AuthError("Quản trị viên chưa cho phép tài khoản của bạn dùng Skills và Plugins.", 403);
  const { studio, name, on } = await req.json();
  const st = studioOf(studio);
  if (!st || typeof name !== "string" || !name.trim() || name.length > 200 || !(on === true || on === false || on === null)) throw new AuthError("Yêu cầu không hợp lệ.", 400);
  setStudioOverride(user.id, st, name, on);
  return Response.json({ ok: true });
});
