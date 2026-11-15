// Dùng chung cho API đăng nhập CLI: kiểm tra tên CLI, phạm vi đăng nhập là chính tài khoản đang gọi.
import { AuthError, handle, requireUser, sameOrigin, type UserRow } from "../../../server/authstore";
import { CLIS, type Cli } from "../../../server/ai/cli_runtime";

export type Ctx = { params: Promise<{ cli: string }> };

export async function cliOf(ctx: Ctx): Promise<Cli> {
  const c = (await ctx.params).cli;
  if (!CLIS.includes(c as Cli)) throw new AuthError("Không có CLI này.", 404);
  return c as Cli;
}

/** Route của engine: người dùng đã đăng nhập Synchro; POST phải cùng nguồn. Lỗi của CLI (chưa cài, mã sai…) trả 400 kèm lời nhắn. */
export function engineRoute(fn: (req: Request, user: UserRow, cli: Cli) => Promise<Response>) {
  return handle(async (req: Request, ctx: Ctx) => {
    if (req.method !== "GET") sameOrigin(req);
    const { user } = requireUser(req);
    const cli = await cliOf(ctx);
    try { return await fn(req, user, cli); } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError((e as Error).message || "Thao tác không thành công.", 400);
    }
  });
}

export const noStore = { headers: { "cache-control": "no-store" } };
