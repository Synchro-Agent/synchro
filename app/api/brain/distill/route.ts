import { handle, limit, requireUser, sameOrigin } from "../../../authstore";
import { brainGraph, distillPending } from "../../../brain";
import { memCfg } from "../../../memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "Chưng cất ngay": chưng cất mọi đoạn chat đang chờ của người dùng và tổng hợp lại trung tâm, không chờ bộ hẹn giờ.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("braindistill:" + user.id, 30, 60 * 60_000);
  const done = await distillPending({ uid: user.id, now: true, max: 10 });
  return Response.json({ done, ...brainGraph(user), cfg: memCfg(user.id) });
});
