// Công cụ chung của các mẫu điền sẵn (designtemplates.ts, designcharts.ts, designdocs.ts, designemails.ts): đọc props của model một cách phòng thủ
// (thiếu trường, sai kiểu, chuỗi quá dài đều không làm vỡ trang) và thoát HTML cho mọi chữ, vì props là dữ liệu model viết, không phải mã.
// Tệp thuần, dùng chung cho trình duyệt và máy chủ.

export type Props = Record<string, unknown>;
/** Ngữ cảnh dựng một trang: id là tiền tố data-node-id (p1, p2… hoặc pageId của model). */
export type Ctx = { id: string };

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
/** Chuỗi của props: số đổi thành chuỗi, kiểu khác thành rỗng; cắt ở max ký tự để một trường quá dài không làm treo bố cục. */
export const str = (v: unknown, max = 600) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
export const num = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : NaN; return Number.isFinite(n) ? n : 0; };
export const obj = (v: unknown): Props => (v && typeof v === "object" && !Array.isArray(v) ? (v as Props) : {});
export const arr = (v: unknown, max = 40): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
/** Chữ có nhấn: thoát HTML, rồi **chữ** thành chữ nhấn màu và xuống dòng thành <br>. Không nhận thẻ nào khác. */
export const rich = (v: unknown, max = 600) => esc(str(v, max)).replace(/\*\*(.+?)\*\*/g, '<strong class="sx-accent">$1</strong>').replace(/\n/g, "<br>");
/** Đoạn văn: tách theo dòng trống thành nhiều <p>, mỗi đoạn một ô chữ. */
export const paras = (v: unknown, c: Ctx, field: string, cls = "sx-text", max = 4000) =>
  str(v, max).split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t, i) => `<p class="${cls}" ${nid(c, i ? `${field}.${i}` : field)}>${rich(t, max)}</p>`).join("");
/** Ảnh: chỉ https hoặc data:image (khung artifact tự nhúng ảnh https, chặn mọi giao thức khác). */
export const safeUrl = (v: unknown) => { const s = str(v, 4000).trim(); return /^https:\/\/[^\s"'<>]+$/i.test(s) || /^data:image\/(?:png|jpe?g|webp|gif|avif|svg\+xml);base64,[\w+/=]+$/i.test(s) ? s : ""; };
/** Thuộc tính data-node-id cho một ô chữ: tầng tự vá co chữ / đổi màu chữ theo ô, Chỉ và sửa nhắm đúng trường. */
export const nid = (c: Ctx, field: string) => `data-node-id="${esc(`${c.id}.${field}`)}"`;
/** Cỡ theo thang của khung (px ở 1280 với slide, 1080 / 1200 với poster). */
export const u = (n: number | string) => `calc(${n}*var(--sx-u))`;
/** Danh sách gạch đầu dòng từ mảng chuỗi. */
export const bullets = (v: unknown, c: Ctx, field: string, cls = "sx-text") => {
  const items = arr(v, 8).map((x) => str(x, 300)).filter(Boolean);
  return items.length ? `<ul class="sx-tpl-list">${items.map((t, i) => `<li class="${cls}" ${nid(c, `${field}.${i}`)}>${rich(t)}</li>`).join("")}</ul>` : "";
};
