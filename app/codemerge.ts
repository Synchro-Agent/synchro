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

/** Giữ phiên dưới max khi lưu từ máy chủ: bỏ chi tiết công cụ của lượt cũ trước (đầu ra, rồi diff và tham số, rồi cả nhật ký làm việc), lượt keep sau cùng; chữ trả lời của lượt cũ không đụng tới.
 *  Không tự co được (toàn chữ trả lời) thì null, không ghi đè. Không sửa dữ liệu truyền vào: lượt keep còn đang chạy. */
export function fitSession(data: Record<string, unknown>, max: number, keep?: number): { data: Record<string, unknown>; json: string } | null {
  let json = JSON.stringify(data);
  if (json.length <= max) return { data, json };
  const nodes = [...((data.nodes as CodeNode[] | undefined) ?? [])].map((n) => ({ ...n }));
  const order = [...nodes].sort((a, b) => (a.id === keep ? 1 : b.id === keep ? -1 : a.id - b.id));
  const size = (v: unknown) => (v === undefined ? 0 : JSON.stringify(v).length);
  let over = json.length - max;
  for (const keys of [["output"], ["diff", "input"]]) {
    for (const n of order) {
      if (over <= 0) break;
      n.steps = n.steps?.map((x) => {
        const st = x as Record<string, unknown>;
        if (over <= 0 || st.k !== "tool" || !keys.some((k) => st[k] !== undefined)) return x;
        const out = { ...st };
        for (const k of keys) { over -= size(out[k]); delete out[k]; }
        return out;
      });
    }
  }
  for (const n of order) { if (over > 0 && n.id !== keep && n.steps) { over -= size(n.steps); delete n.steps; } }
  const cur = over > 0 ? nodes.find((n) => n.id === keep) : undefined;
  if (cur) {
    over -= size(cur.steps); delete cur.steps;
    if (typeof cur.ai === "string" && cur.ai.length > 200_000) { over -= cur.ai.length - 200_000; cur.ai = `…\n${cur.ai.slice(-200_000)}`; }
  }
  const out = { ...data, nodes };
  json = JSON.stringify(out);
  return json.length <= max ? { data: out, json } : null;
}
