import { featureGate, handle, limit, requireUser, sameOrigin } from "../../../server/authstore";
import { OneShotErr, usableModels } from "../../../server/ai/anymodel";
import { getScan, scanCount, scanning, startScan, stopScan } from "../../../server/skillscan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kho kỹ năng → Quét skill rác (server/skillscan.ts). Đường dẫn riêng (không nằm dưới /api/skills/) để không lẫn với skill tên "scan".
// GET: lần quét đang chạy hoặc gần nhất, số skill sẽ quét, các model chọn được (?lite: chỉ lần quét, khi hỏi lại tiến độ).
// POST { model?, lang }: bắt đầu quét. DELETE: dừng.
export const GET = handle(async (req: Request) => {
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const { user } = requireUser(req);
  if (new URL(req.url).searchParams.has("lite")) return Response.json({ job: await getScan(user) });
  const [job, count, { groups }] = await Promise.all([getScan(user), scanCount(user), usableModels(user)]);
  return Response.json({ job, count, models: groups });
});

export const POST = handle(async (req: Request) => {
  sameOrigin(req);
  const denied = featureGate(req, "skills"); if (denied) return denied;
  const { user } = requireUser(req);
  const b = await req.json().catch(() => ({}));
  if (!scanning(user.id)) limit("skill-scan:" + user.id, 12, 3600_000);
  try {
    return Response.json({ job: await startScan(user, { model: typeof b.model === "string" && b.model ? b.model : undefined, lang: b.lang === "en" ? "en" : "vi" }) });
  } catch (e) {
    if (e instanceof OneShotErr) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});

export const DELETE = handle(async (req: Request) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  return Response.json({ job: stopScan(user.id) });
});
