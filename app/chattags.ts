// Thẻ (tag) của đoạn chat: nằm ngay trong đoạn chat (Chat.tags) nên đi theo tài khoản qua đồng bộ đoạn chat (chatsync.ts → /api/chats), như ghim hay dự án.
// Hàm thuần, dùng chung cho thanh bên, đầu trang chat và bảng lệnh ⌘K; kiểm thử: tests/api/chattags.test.mjs.
export const TAG_MAX = 8, TAG_LEN = 24;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
/** Khóa so sánh: không phân biệt hoa thường và dấu ("Công việc" = "cong viec"). */
export const tagKey = (t: string) => fold(t).replace(/\s+/g, " ").trim();
/** Chuẩn hóa chữ người dùng gõ: bỏ # đầu, gộp khoảng trắng, bỏ ký tự điều khiển / dấu phân cách, tối đa 24 ký tự. "" nếu không còn gì. */
export function normTag(raw: string): string {
  return raw.replace(/^[#\s]+/, "").replace(/[\u0000-\u001f\u007f,;#<>"`]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TAG_LEN).trim();
}
/** Danh sách thẻ hợp lệ của một đoạn chat (bỏ trùng, tối đa 8), dùng khi đọc dữ liệu từ máy chủ / thiết bị khác. */
export function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [], seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = normTag(x), k = tagKey(t);
    if (!t || seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= TAG_MAX) break;
  }
  return out;
}
export const hasTag = (tags: readonly string[] | undefined, t: string) => Array.isArray(tags) && tags.some((x) => typeof x === "string" && tagKey(x) === tagKey(t));
/** Bật / tắt một thẻ. Thêm thẻ trùng tên với thẻ đã có ở đoạn chat khác thì dùng đúng cách viết đã có (all). */
export function toggleTag(tags: readonly string[] | undefined, raw: string, all: readonly string[] = []): string[] {
  const t = normTag(raw);
  if (!t) return [...(tags ?? [])];
  const cur = tags ?? [];
  if (hasTag(cur, t)) return cur.filter((x) => tagKey(x) !== tagKey(t));
  if (cur.length >= TAG_MAX) return [...cur];
  return [...cur, all.find((x) => tagKey(x) === tagKey(t)) ?? t];
}
/** Mọi thẻ đang dùng, nhiều đoạn chat nhất trước, rồi theo chữ cái. */
export function allTags(chats: readonly { tags?: string[]; inc?: boolean }[]): { tag: string; n: number }[] {
  const m = new Map<string, { tag: string; n: number }>();
  for (const c of chats) if (!c.inc) for (const t of cleanTags(c.tags)) { const k = tagKey(t); const e = m.get(k); if (e) e.n++; else m.set(k, { tag: t, n: 1 }); }
  return [...m.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, "vi"));
}
