import { handle, requireUser, sameOrigin, VERIFY_FIRST, verifyLocked } from "../../../authstore";
import { AppError, getApp, removeApp, updateApp } from "../../../appstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const err = (e: unknown) => (e instanceof AppError ? Response.json({ error: e.message }, { status: e.status }) : null);

// Mở ứng dụng (?open=1 đếm lượt mở). Người không có quyền nhận 404 như ứng dụng không tồn tại.
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { user } = requireUser(req);
  const app = getApp(user.id, (await ctx.params).id, new URL(req.url).searchParams.get("open") === "1");
  return app ? Response.json({ app }) : Response.json({ error: "Không tìm thấy ứng dụng hoặc bạn không có quyền dùng." }, { status: 404 });
});

// Đổi tên hoặc phạm vi chia sẻ (chỉ chủ ứng dụng).
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = await req.json().catch(() => ({}));
  if (b?.visibility === "org" && verifyLocked(user)) return Response.json({ error: VERIFY_FIRST, verify: true }, { status: 403 });
  try { updateApp(user.id, (await ctx.params).id, b); return Response.json({ ok: true }); }
  catch (e) { return err(e) ?? (() => { throw e; })(); }
});

// Gỡ ứng dụng và toàn bộ dữ liệu của nó (chỉ chủ ứng dụng).
export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  return removeApp(user.id, (await ctx.params).id) ? Response.json({ ok: true }) : Response.json({ error: "Không tìm thấy ứng dụng của bạn." }, { status: 404 });
});
