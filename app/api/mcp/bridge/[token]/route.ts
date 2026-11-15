import { bridgeRoute } from "../../../../../server/mcpbridge";
import { timed } from "../../../../../server/servertiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Máy chủ MCP nội bộ cho CLI của gói subscription (xem mcpbridge.ts): không dùng phiên đăng nhập, xác thực bằng mã của lượt.
type Ctx = { params: Promise<{ token: string }> };
export const POST = timed(async (req: Request, ctx: Ctx) => bridgeRoute(req, (await ctx.params).token));
export const GET = timed(async (req: Request, ctx: Ctx) => bridgeRoute(req, (await ctx.params).token));
export const DELETE = timed(async (req: Request, ctx: Ctx) => bridgeRoute(req, (await ctx.params).token));
