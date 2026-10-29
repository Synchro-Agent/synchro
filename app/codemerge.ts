// Gộp hai bản của cùng một phiên Synchro Code (thiết bị này / máy chủ / thiết bị khác). Dùng ở cả trình duyệt và máy chủ.
export type CodeNode = { id: number; parent: number; user?: string; ai?: string; done?: boolean; steps?: unknown[]; [k: string]: unknown };
/** Gộp dữ liệu hai bản của cùng một phiên: lấy hợp các lượt (theo id); lượt có ở cả hai thì giữ bản đã xong / dài hơn. */
export function mergeData(a: Record<string, unknown> | null, b: Record<string, unknown> | null, bNewer: boolean) {
  if (!a) return b; if (!b) return a;
  const na = (a.nodes as CodeNode[] | undefined) ?? [], nb = (b.nodes as CodeNode[] | undefined) ?? [];
  const map = new Map<number, CodeNode>();
  for (const n of na) map.set(n.id, n);
  for (const n of nb) {
    const o = map.get(n.id);
    if (!o) { map.set(n.id, n); continue; }
    const score = (x: CodeNode) => (x.done ? 1e9 : 0) + String(x.ai ?? "").length + (x.steps?.length ?? 0) * 10;
    map.set(n.id, score(n) > score(o) || (score(n) === score(o) && bNewer) ? n : o);
  }
  const newer = bNewer ? b : a;
  return { ...a, ...b, ...newer, nodes: [...map.values()].sort((x, y) => x.id - y.id) };
}

