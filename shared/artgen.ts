// Phần nhỏ của artdoc.ts mà trang chủ và thẻ artifact cần ngay (nhận ra bản trình bày, ảnh dựng nền đang chờ / đã xong): tách riêng để
// phần tải đầu không kéo theo bộ thiết kế (artkit, các mẫu) mà artdoc.ts dùng để dựng khung artifact (blueprint B3.2).
import type { ArtType } from "./artifacts";

export const isDeck = (a: { type: ArtType; content: string }) => a.type === "html" &&
  ((a.content.match(/<section\b[^>]*(class=["'][^"']*\bslide\b|data-slide)/gi)?.length ?? 0) >= 2 || ((a.content.match(/<section\b/gi)?.length ?? 0) >= 2 && /ArrowRight|PageDown/.test(a.content)));
/** Khoảng chờ trước lần hỏi lại thứ n ảnh đang dựng nền: 5 s, tăng dần tới 30 s; null là thôi (sau khoảng 17 phút, quá thời gian dựng ảnh). */
export const pendingRetryMs = (n: number): number | null => (n >= 40 ? null : Math.min(30_000, Math.round(5000 * 1.4 ** n)));
/** Sự kiện trên window khi một ảnh dựng nền vừa xong / vừa hỏng (detail: { id, ok }): trang chat báo người dùng một dòng (W23-2, G4.2). */
export const GEN_IMG_EVENT = "synchro:genimg";
const genSeenPending = new Set<string>(), genTold = new Set<string>();
/** Khung xem trước / thẻ ảnh vừa thấy ảnh giữ chỗ "đang chờ" của ảnh id. */
export const noteGenPending = (id: string) => { genSeenPending.add(id); };
/** Ảnh id không còn là ảnh giữ chỗ (ok) hoặc máy chủ báo dựng hỏng (!ok). Chỉ báo khi trong phiên này đã thấy ảnh đang chờ (mở đoạn chat cũ thì im),
 *  và mỗi ảnh một lần dù nhiều khung cùng thấy. Trả về true khi đã phát sự kiện. */
export function noteGenSettled(id: string, ok: boolean): boolean {
  if (!genSeenPending.has(id) || genTold.has(id)) return false;
  genTold.add(id);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(GEN_IMG_EVENT, { detail: { id, ok } }));
  return true;
}
