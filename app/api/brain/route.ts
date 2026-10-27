import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { brainGraph, searchNotes, wipeBrain } from "../../brain";
import { memCfg } from "../../memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bộ não tổng hợp của chính người dùng (Cài đặt → Bộ não): đồ thị ghi chú và liên kết, số liệu, cài đặt học; ?q= tìm ghi chú.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const q = new URL(req.url).searchParams.get("q");
  if (q !== null) return Response.json({ results: searchNotes(user.id, q.slice(0, 300)).map((n) => ({ title: n.title, kind: n.kind, gist: n.props.gist ?? n.body.replace(/\s+/g, " ").slice(0, 160), updatedAt: n.updatedAt })) });
  return Response.json({ ...brainGraph(user), cfg: memCfg(user.id) });
});
// Xóa toàn bộ bộ não (ghi chú, liên kết, hàng chờ); ký ức dài hạn xóa riêng ở mục Ký ức.
export const DELETE = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  limit("brainwipe:" + user.id, 10, 60 * 60_000);
  wipeBrain(user.id);
  return Response.json({ ...brainGraph(user), cfg: memCfg(user.id) });
});
