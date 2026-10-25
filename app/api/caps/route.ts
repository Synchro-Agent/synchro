import { handle, requireUser, sameOrigin } from "../../authstore";
import { capsState, setUserCaps } from "../../caps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cài đặt → Khả năng của tài khoản: lựa chọn đã áp dụng quyền quản trị viên, lý do bị khóa, và nơi máy chủ chạy code.
export const GET = handle(async (req: Request) => Response.json(capsState(requireUser(req).user)));

export const PATCH = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const body = await req.json().catch(() => ({}));
  setUserCaps(user.id, body && typeof body === "object" ? body : {});
  return Response.json(capsState(user));
});
