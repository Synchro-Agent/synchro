import { handle, limit, needDisk, requireUser, sameOrigin, VERIFY_FIRST, verifyLocked } from "../../authstore";
import { AppError, listApps, publishApp } from "../../appstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ứng dụng nội bộ: của mình và của cả tổ chức.
export const GET = handle(async (req: Request) => Response.json({ apps: listApps(requireUser(req).user.id) }));

// Xuất bản artifact thành ứng dụng: { conv, ident, title, type, content, visibility: "private" | "org" } → { id, created }.
export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("app-pub:" + user.id, 60, 10 * 60_000);
  needDisk();
  const b = await req.json().catch(() => ({}));
  // Ứng dụng cho cả tổ chức: mọi tài khoản mở được, nên tài khoản ảo chưa xác minh không được đăng. Ứng dụng riêng thì vẫn được.
  if (b?.visibility === "org" && verifyLocked(user)) return Response.json({ error: VERIFY_FIRST, verify: true }, { status: 403 });
  try { return Response.json(publishApp(user.id, b)); }
  catch (e) { if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status }); throw e; }
});
