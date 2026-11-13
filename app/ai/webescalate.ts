// Tự nâng cấp khi tìm / đọc web (blueprint D2): trang dựng bằng JavaScript phía client thường trả về rất ít chữ, hoặc chỉ một màn
// "đang cập nhật" / "enable JavaScript" / "loading" / "just a moment" khi lấy nhanh (fetch hay tóm tắt tìm kiếm). Khi đó Synchro nên
// MỞ LẠI trang trong trình duyệt của workspace (browser_navigate → browser_wait → browser_text) để đọc DOM đã dựng, thay vì trả lời "không chắc".
// Hàm thuần, không phụ thuộc máy chủ: dùng được cả ở nơi lấy trang (browsertools, searchWeb) lẫn trong kiểm thử.

// Màn chặn / chưa dựng xong hay gặp: chỉ xét khi phần chữ còn ngắn (dưới ngưỡng) để không nhầm một bài dài có lỡ chứa chữ "loading".
const STALL = /đang cập nhật|đang tải|vui lòng (?:chờ|đợi|bật javascript)|hãy bật javascript|enable javascript|javascript is (?:required|disabled)|please enable javascript|just a moment|checking your browser|one moment|loading\.{0,3}/i;
/** Ngưỡng chữ: dưới mức này coi là "mỏng". Màn chặn chỉ tính khi tổng chữ cũng còn ngắn (tránh báo nhầm bài dài). */
export const THIN_CHARS = 500;
const STALL_MAX = 2000;

/** Nội dung LẤY TRANG (browser_text / fetch nhanh) có quá mỏng hoặc là màn chưa dựng xong / chặn JavaScript không: một trang thật mà chỉ trả
 * về vài chữ gần như luôn là chưa dựng xong, nên ở đây độ dài mới là tín hiệu. Dùng cho nơi lấy trang, KHÔNG cho tóm tắt tìm web. */
export function needsRenderEscalation(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (t.length < THIN_CHARS) return true;
  return t.length < STALL_MAX && STALL.test(t);
}

/** Kết quả TÓM TẮT của công cụ tìm web (geminiSearch / responsesSearch) là câu trả lời CÓ DẪN NGUỒN, vốn có thể ngắn gọn một cách hợp lệ
 * (vài con số kèm nguồn). KHÔNG nâng cấp chỉ vì ngắn — chỉ khi tóm tắt thật sự kẹt: trống, không có nguồn nào (model trả lời chay, không
 * grounding), hoặc dính màn "đang cập nhật" / cần bật JavaScript / "loading". */
export function searchNeedsEscalation(text: string | null | undefined, hasSource: boolean): boolean {
  const t = (text ?? "").trim();
  if (!t || !hasSource) return true;
  return t.length < STALL_MAX && STALL.test(t);
}

/** Lời nhắc để model tự mở lại trang và đọc DOM đã dựng (gắn vào kết quả lấy web khi nội dung mỏng). */
export const RENDER_ESCALATION_HINT =
  "Nội dung lấy được quá mỏng hoặc trang còn \"đang tải\" / cần bật JavaScript. Hãy mở trang này trong trình duyệt của Synchro " +
  "(browser_navigate → browser_wait → browser_text) để đọc DOM đã dựng; với số liệu trong ngày (tỷ giá, giá, kết quả), ưu tiên trang chính thức; " +
  "nếu vẫn chưa có con số, thử thêm một nguồn nữa trước khi trả lời \"không chắc\".";

/** Lời nhắc khi lượt KHÔNG có công cụ trình duyệt: không nhắc tên công cụ model không có, chỉ bảo thử nguồn khác. */
export const SEARCH_RETRY_HINT =
  "Kết quả tìm web còn mỏng hoặc trang nguồn chưa dựng xong. Với số liệu trong ngày (tỷ giá, giá, kết quả), gọi web_search lại với nguồn chính thức khác " +
  "trước khi trả lời \"không chắc\".";

// ---------------------------------------------------------------- D2.1: máy chủ tự mở trang mỏng trong trình duyệt của workspace
// Không chỉ nhắc model: khi kết quả lấy web còn mỏng / kẹt, máy chủ tự mở trang nguồn bằng chính đường công cụ trình duyệt
// (browser_navigate → browser_wait → browser_text) và gắn chữ của DOM đã dựng vào kết quả công cụ. Có giới hạn: mỗi địa chỉ một lần
// mỗi lượt (done), tối đa ESCALATE_MAX trang, mỗi trang ESCALATE_MS; địa chỉ phải qua kiểm tra (allow: https công khai, trang được phép).
export const ESCALATE_MAX = 2;
export const ESCALATE_MS = 40_000;
export const RENDERED_MAX = 4000;
export type Rendered = { url: string; text: string };

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((ok) => { const t = setTimeout(() => ok(null), ms); p.then((v) => { clearTimeout(t); ok(v); }, () => { clearTimeout(t); ok(null); }); });

/** Mở lần lượt các trang nguồn (chưa mở trong lượt) tới khi có một trang đọc được đủ chữ. read: mở trang, trả chữ của DOM đã dựng (null: không đọc được). */
export async function autoRender(urls: string[], o: { done: Set<string>; read: (url: string) => Promise<string | null>; allow?: (url: string) => Promise<boolean>; max?: number; timeoutMs?: number }): Promise<Rendered[]> {
  const out: Rendered[] = [];
  let tried = 0;
  for (const url of [...new Set(urls)]) {
    if (tried >= (o.max ?? ESCALATE_MAX)) break;
    if (!/^https?:\/\//i.test(url) || o.done.has(url)) continue;
    o.done.add(url);
    if (o.allow && !(await o.allow(url).catch(() => false))) continue;
    tried++;
    const text = ((await withTimeout(o.read(url), o.timeoutMs ?? ESCALATE_MS)) ?? "").trim();
    if (!text) continue;
    out.push({ url, text: text.length > RENDERED_MAX ? `${text.slice(0, RENDERED_MAX)}…` : text });
    if (!needsRenderEscalation(text)) break;
  }
  return out;
}

/** Phần gắn vào kết quả công cụ: chữ của từng trang đã dựng. */
export const renderedBlock = (pages: Rendered[]) =>
  pages.map((p) => `\n\nSynchro đã tự mở trang này trong trình duyệt và đọc nội dung đã dựng (${p.url}):\n${p.text}`).join("");

/** Kết quả tìm web sau khi leo thang: kẹt + có trình duyệt thì gắn chữ các trang đã dựng (còn mỏng thì kèm lời nhắc tự mở trang);
 *  kẹt mà lượt không có công cụ trình duyệt thì chỉ nhắc thử nguồn khác (không nhắc tên công cụ model không có); không kẹt thì giữ nguyên. */
export async function escalateText(content: string, o: { stalled: boolean; urls: string[]; browse: boolean; done: Set<string>; read: (url: string) => Promise<string | null>; allow?: (url: string) => Promise<boolean> }): Promise<string> {
  if (!o.stalled) return content;
  if (!o.browse) return `${content}\n\n${SEARCH_RETRY_HINT}`;
  const pages = await autoRender(o.urls, { done: o.done, read: o.read, allow: o.allow });
  const good = pages.some((p) => !needsRenderEscalation(p.text));
  return `${content}${renderedBlock(pages)}${good ? "" : `\n\n${RENDER_ESCALATION_HINT}`}`;
}
