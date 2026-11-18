import "server-only";
// Danh sách việc của một lượt khi model có hai công cụ update_plan (lỗi 8 của ma trận H1). Không phụ thuộc gì, kiểm thử chạy thẳng (tests/api/codex-plan.test.mjs).
// Một danh sách việc mỗi lượt dù có hai nguồn: GPT qua Codex có update_plan DỰNG SẴN của Codex (sự kiện "plan" của engine, routing.ts) bên cạnh
// update_plan của Synchro (MCP). Mỗi lần gọi thay cả danh sách, nên model dùng cả hai với hai danh sách khác nhau thì thanh việc nhảy qua lại giữa hai danh sách.
// Synchro là nguồn chính (lời dặn trong prompt, chữ do model viết cho người dùng): đã có danh sách của Synchro thì danh sách dựng sẵn chỉ cập nhật trạng thái
// khi cùng số việc (giữ chữ của Synchro), khác số việc thì bỏ qua. Chưa có danh sách của Synchro thì danh sách dựng sẵn hiện như thường.
// Trả về danh sách cần hiện, hoặc null khi không đổi gì. update_plan của Synchro luôn hiện đúng như gửi (kể cả danh sách rỗng, như trước).
export type PlanItem = { content: string; status: string };
export type PlanSrc = "synchro" | "native";
export type PlanState = { src: PlanSrc; items: PlanItem[] };
export function notePlan(x: { plan?: PlanState } | null | undefined, src: PlanSrc, items: PlanItem[]): PlanItem[] | null {
  if (src === "native" && !items.length) return null;
  const cur = x?.plan;
  let next = items;
  if (src === "native" && cur?.src === "synchro") {
    if (cur.items.length !== items.length) return null;
    next = cur.items.map((it, i) => ({ content: it.content, status: items[i].status }));
    if (next.every((it, i) => it.status === cur.items[i].status)) return null;
  }
  if (x) x.plan = { src: src === "native" && cur?.src === "synchro" ? "synchro" : src, items: next };
  return next;
}
