import { handle, limit, requireUser, sameOrigin } from "../../authstore";
import { brainGraph, brainTable, queryNotes, tagCounts, wipeBrain } from "../../brain";
import { memCfg } from "../../memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bộ não tổng hợp của chính người dùng (Cài đặt → Bộ não): đồ thị ghi chú và liên kết, số liệu, cài đặt học; ?q= tìm ghi chú.
export const GET = handle(async (req) => {
  const { user } = requireUser(req);
  const sp = new URL(req.url).searchParams, q = sp.get("q");
  // Tìm có toán tử (tag:, loai:, file:, task-todo:, [thuộc tính:giá trị], "cụm từ", -loại trừ), danh sách thẻ, bảng kiểu Bases.
  if (q !== null) return Response.json({ results: queryNotes(user.id, q.slice(0, 300)).map(({ note: n, snippet }) => ({ title: n.title, kind: n.kind, snippet, updatedAt: n.updatedAt })) });
  if (sp.get("tags") === "1") return Response.json({ tags: tagCounts(user.id) });
  const table = sp.get("table");
  if (table) return Response.json({ rows: brainTable(user.id, table) });
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
