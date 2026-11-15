import { current } from "../../../server/authstore";
import { listRuns } from "../../../server/runs";
import { timed } from "../../../server/servertiming";

export const dynamic = "force-dynamic";

// Các lượt chạy gần đây của tài khoản (trang Hộp thư và lúc mở lại đoạn chat).
export const GET = timed(async (req: Request) => {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  return Response.json({ runs: listRuns(c.user.id).map((r) => ({ ...r, result: r.status === "running" ? null : r.result })) });
});
