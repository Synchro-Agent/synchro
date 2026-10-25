// Kênh trực tiếp của ứng dụng nội bộ (chỉ chạy ở máy chủ, một tiến trình): mỗi ứng dụng một "phòng" gồm những người đang mở nó.
// Dữ liệu chung đổi, bình luận mới, ai vào / ra đều được đẩy ngay tới mọi người trong phòng (qua SSE /api/apps/<id>/live).
export type LiveEvent =
  | { type: "presence"; people: { id: string; name: string }[] }
  | { type: "data"; key: string; client?: string }
  | { type: "comment"; comment: unknown }
  | { type: "comment-update"; id: string; resolved?: boolean; deleted?: boolean };
type Sub = { uid: string; name: string; send: (e: LiveEvent) => void };
const g = globalThis as unknown as { __synchroLive?: Map<string, Set<Sub>> };
const rooms = (g.__synchroLive ??= new Map());

export function publish(app: string, e: LiveEvent) { for (const s of rooms.get(app) ?? []) { try { s.send(e); } catch { /* kết nối đã đóng */ } } }
function presence(app: string) {
  const seen = new Map<string, string>();
  for (const s of rooms.get(app) ?? []) seen.set(s.uid, s.name);
  publish(app, { type: "presence", people: [...seen].map(([id, name]) => ({ id, name })) });
}
/** Vào phòng (người gọi đã kiểm tra quyền xem ứng dụng); trả về hàm rời phòng. */
export function enter(app: string, uid: string, name: string, send: (e: LiveEvent) => void) {
  const s: Sub = { uid, name, send };
  const set = rooms.get(app) ?? rooms.set(app, new Set()).get(app)!;
  set.add(s); presence(app);
  return () => { set.delete(s); if (!set.size) rooms.delete(app); else presence(app); };
}
