import { AuthError, can, handle, limit, requireUser, sameOrigin } from "../../../../server/authstore";
import { CHROME_LOCKED, extAllowed, extNotify, extOverview, newPairCode, removeDevice } from "../../../../server/browserext";
import { browserDefault, capsState } from "../../../../server/caps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trình duyệt của bạn (tiện ích Synchro cho Chrome / Edge / Brave). GET: các trình duyệt đã ghép nối, trình duyệt nào đang kết nối và
// đang làm gì, model mặc định làm ở đâu. POST: { op: "code" } mã ghép nối mới · { op: "remove", id } gỡ một trình duyệt ·
// { op: "stop" } dừng ngay thao tác Synchro đang làm trên Chrome của bạn.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const st = capsState(user);
  return Response.json({ ...(await extOverview(user.id)), target: browserDefault(st), mine: st.caps.mine });
});

export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  if (!extAllowed()) throw new AuthError("Máy chủ chưa bật dịch vụ workspace nên chưa nối được trình duyệt của bạn.", 501);
  const b = (await req.json().catch(() => ({}))) as { op?: string; id?: string };
  if (b.op === "code") { if (!can(user, "chrome")) throw new AuthError(CHROME_LOCKED, 403); limit(`ext-code:${user.id}`, 20, 10 * 60_000); return Response.json(newPairCode(user.id)); }
  if (b.op === "remove") {
    if (!(await removeDevice(user.id, String(b.id ?? "")))) throw new AuthError("Không tìm thấy trình duyệt này.", 404);
    return Response.json(await extOverview(user.id));
  }
  if (b.op === "stop") return Response.json({ ok: await extNotify(user.id, "stop") });
  throw new AuthError("Thao tác không hợp lệ.", 400);
});
