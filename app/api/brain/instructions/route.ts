import { getUser, handle, requireUser, sameOrigin } from "../../../authstore";
import { instructionsInfo, restoreInstructions } from "../../../brain";
import { setMemCfg } from "../../../memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Hướng dẫn cho Synchro" tự cập nhật từ bộ não: bật / tắt, lịch sử các bản (bạn viết / Synchro viết) và quay lại một bản cũ.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  return Response.json(instructionsInfo(user.id));
});
export const PUT = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = await req.json().catch(() => ({}));
  if (typeof b.auto === "boolean") setMemCfg(user.id, { autoIns: b.auto });
  return Response.json(instructionsInfo(user.id));
});
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const b = await req.json().catch(() => ({}));
  try { return Response.json({ ...restoreInstructions(user, String(b.restore ?? "")), instructions: getUser(user.id)?.instructions ?? "" }); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 404 }); }
});
