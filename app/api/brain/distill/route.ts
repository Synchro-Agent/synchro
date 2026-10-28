import { handle, limit, requireUser, sameOrigin } from "../../../authstore";
import { brainGraph, distillPending } from "../../../brain";
import { memCfg } from "../../../memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Chạy ngay một vòng học và chăm sóc cho người dùng này (bộ lập lịch vẫn tự làm ở nền; đường này cho kiểm thử và công cụ quản trị).
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("braindistill:" + user.id, 30, 60 * 60_000);
  const done = await distillPending({ uid: user.id, now: true, max: 10 });
  return Response.json({ done, ...brainGraph(user), cfg: memCfg(user.id) });
});
