// Chế độ "Tự động" của bộ chọn model: Synchro tự chọn model theo độ khó của yêu cầu để tiết kiệm.
// Câu hỏi ngắn, trò chuyện → model nhanh, rẻ. Việc chuyên môn (thiết kế, tài liệu, code, phân tích, tệp đính kèm) → model mạnh nhất được phép.
// Chỉ chọn trong các model tài khoản được phép dùng và quản trị viên cho hiện.
import { expand, fold } from "./skillroute";

export const AUTO = "auto";
export type Tier = "fast" | "balanced" | "strong";

// Phân hạng theo tên model của các hãng (không có trong danh sách thì coi là "balanced").
const FAST = /(haiku|flash|lite|mini|nano|luna|small)/i;
const STRONG = /(opus|fable|astra|argon|ultra|-pro\b|\bpro\b)/i;
export const tierOf = (key: string): Tier => (STRONG.test(key) ? "strong" : FAST.test(key) ? "fast" : "balanced");

// Tạo ra cả một sản phẩm (trang web, ứng dụng, slide, tài liệu, văn bản) → model mạnh.
const BUILD = /\b(thiet ke|lam|tao|xay dung|viet|soan)\b.*\b(trang web|website|landing|ung dung|app|dashboard|slide|bai trinh bay|bao cao|ke hoach|hop dong|van ban|cong van|de xuat|tai lieu|logo|banner|poster)\b|\b(landing page|pitch deck|design|build an? (app|website|dashboard))\b/;
// Phân tích, lập luận nhiều bước.
const THINK = /\b(phan tich|so sanh|danh gia|toi uu|chien luoc|kien truc|nghien cuu|tom tat tai lieu|viet lai|dich (tai lieu|van ban)|report|analy[sz]e|strategy|architecture|refactor|debug)\b/;
const CODE = /```|\b(function|class|import|select .* from|stack trace|traceback|exception|loi code|bug|sql|regex|typescript|python|javascript)\b/i;
const CHAT = /^(xin chao|chao|hi|hello|hey|cam on|thanks|ok|oke|vang|da|uh|yes|no)\b/;

export type RouteInput = { text: string; attachments: number; turns: number; studio: boolean };
/** Điểm độ khó: ≥ 3 → model mạnh, 1-2 → model cân bằng, ≤ 0 → model nhanh. */
export function difficulty(q: RouteInput): { score: number; why: string[] } {
  const t = fold(q.text).trim();
  const why: string[] = [];
  let s = 0;
  const add = (n: number, w: string) => { s += n; why.push(w); };
  if (q.studio) add(3, "chế độ studio");
  if (q.attachments) add(2, "có tệp đính kèm");
  if (CODE.test(q.text)) add(2, "có code");
  if (BUILD.test(t)) add(3, "tạo sản phẩm hoàn chỉnh");
  else if (THINK.test(t)) add(2, "phân tích nhiều bước");
  else if (expand(q.text).concepts) add(1, "có chủ đề chuyên môn");
  if (q.text.length > 600) add(2, "yêu cầu dài");
  else if (q.text.length > 200) add(1, "yêu cầu vừa");
  if (q.turns > 12) add(1, "hội thoại dài");
  if (q.text.length < 60 && CHAT.test(t)) add(-2, "trò chuyện ngắn");
  return { score: s, why };
}

/** Chọn model cho chế độ Tự động trong danh sách được phép (thứ tự = thứ tự quản trị viên hiển thị). */
export function routeModel(q: RouteInput, allowed: string[]): { model: string; tier: Tier; why: string[] } | null {
  if (!allowed.length) return null;
  const { score, why } = difficulty(q);
  const want: Tier = score >= 3 ? "strong" : score >= 1 ? "balanced" : "fast";
  // Không có model đúng hạng thì lấy hạng gần nhất (mạnh → cân bằng → nhanh, hoặc ngược lại).
  const order: Tier[] = want === "strong" ? ["strong", "balanced", "fast"] : want === "fast" ? ["fast", "balanced", "strong"] : ["balanced", "strong", "fast"];
  for (const tier of order) {
    const m = allowed.find((k) => tierOf(k) === tier);
    if (m) return { model: m, tier, why };
  }
  return { model: allowed[0], tier: tierOf(allowed[0]), why };
}
