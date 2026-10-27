// Chế độ "Tự động": Synchro tự chọn model (qua cả Claude, ChatGPT, Gemini — gói subscription lẫn khóa API) và mức nỗ lực
// theo từng việc. Nguyên tắc: đủ chất lượng cho việc đó với chi phí và thời gian thấp nhất —
//  1) nhận dạng loại việc (trò chuyện, hỏi đáp, viết, dịch, code, gỡ lỗi, suy luận, phân tích, tạo sản phẩm, đọc ảnh, tài liệu dài, số liệu)
//     và độ khó (điểm);
//  2) mỗi model có điểm chất lượng theo loại việc = hạng của model (nhanh / cân bằng / mạnh / mạnh nhất) + thế mạnh của hãng;
//  3) độ khó quyết định mức chất lượng cần đạt; chọn model rẻ, nhanh nhất vẫn đạt mức đó (không model nào đạt thì lấy model tốt nhất);
//     gói subscription đã trả tiền nên được ưu tiên hơn khóa API cùng mức;
//  4) mức nỗ lực theo độ khó: việc dễ nỗ lực thấp cho nhanh, việc khó nỗ lực cao;
//  5) người dùng chê câu trả lời trước ("sai rồi", "làm lại") thì nâng độ khó và đổi sang model khác.
import { expand, fold } from "./skillroute";

export const AUTO = "auto";
export type Tier = "fast" | "balanced" | "strong";
export type Vendor = "anthropic" | "openai" | "google" | "other";
export type Task = "chat" | "qa" | "write" | "translate" | "code" | "debug" | "reason" | "analyze" | "build" | "vision" | "longdoc" | "data";
export type AutoEffort = "low" | "medium" | "high" | "extra" | "max";

// Hạng theo tên model của các hãng (không khớp thì coi là "balanced"); "mạnh nhất" là dòng đầu bảng của từng hãng.
const FAST = /(haiku|flash|lite|mini|nano|luna|small)/i;
const STRONG = /(opus|fable|astra|argon|ultra|-pro\b|\bpro\b)/i;
const FRONTIER = /(fable|astra|argon|ultra)/i;
export const tierOf = (key: string): Tier => (STRONG.test(key) ? "strong" : FAST.test(key) ? "fast" : "balanced");
export function vendorOf(key: string): Vendor {
  const k = key.toLowerCase();
  if (/^(anthropic|sub-claude)\//.test(k) || /claude|opus|sonnet|haiku|fable/.test(k)) return "anthropic";
  if (/^(openai|sub-codex)\//.test(k) || /\bgpt|\bo\d|chatgpt|codex/.test(k)) return "openai";
  if (/^(google|sub-agy)\//.test(k) || /gemini/.test(k)) return "google";
  return "other";
}
const BASE: Record<Tier | "frontier", number> = { fast: 6, balanced: 7.5, strong: 9, frontier: 9.5 };
const COST: Record<Tier | "frontier", number> = { fast: 1, balanced: 3, strong: 8, frontier: 12 };
// Thế mạnh của từng hãng theo loại việc (cộng vào điểm chất lượng của model).
const EDGE: Record<Vendor, Partial<Record<Task, number>>> = {
  anthropic: { code: 0.7, debug: 0.6, build: 0.8, write: 0.5, analyze: 0.3, reason: 0.2, longdoc: 0.2 },
  openai: { reason: 0.8, data: 0.6, code: 0.4, debug: 0.4, analyze: 0.4, qa: 0.3, write: 0.2, translate: 0.2, build: 0.2 },
  google: { longdoc: 0.9, vision: 0.9, translate: 0.5, qa: 0.3, data: 0.3, reason: 0.3, code: 0.1 },
  other: {},
};
export type Profile = { key: string; vendor: Vendor; tier: Tier; frontier: boolean; sub: boolean; cost: number };
export function profileOf(key: string): Profile {
  const tier = tierOf(key), frontier = tier === "strong" && FRONTIER.test(key), sub = /^sub-/.test(key);
  // Gói subscription đã trả theo tháng: mỗi lượt gần như không tốn thêm, nên rẻ hơn khóa API cùng hạng.
  return { key, vendor: vendorOf(key), tier, frontier, sub, cost: COST[frontier ? "frontier" : tier] * (sub ? 0.25 : 1) };
}
export const quality = (p: Profile, task: Task) => BASE[p.frontier ? "frontier" : p.tier] + (EDGE[p.vendor][task] ?? 0);

// ---- nhận dạng việc ----
// Tạo ra cả một sản phẩm (trang web, ứng dụng, slide, tài liệu, văn bản) → cần model mạnh.
const BUILD = /\b(thiet ke|lam|tao|xay dung|viet|soan)\b.*\b(trang web|website|landing|ung dung|app|dashboard|slide|bai trinh bay|bao cao|ke hoach|hop dong|van ban|cong van|de xuat|tai lieu|logo|banner|poster)\b|\b(landing page|pitch deck|dashboard|website)\b/;
const THINK = /\b(phan tich|so sanh|danh gia|toi uu|chien luoc|kien truc|nghien cuu|tom tat tai lieu|viet lai|dich (tai lieu|van ban)|report|analy[sz]e|strategy|architecture|refactor|debug)\b/;
const CODE = /```|\b(function|class|import|select .* from|stack trace|traceback|exception|loi code|bug|sql|regex|typescript|python|javascript)\b/i;
const DEBUG = /\b(loi|bug|khong chay|bi sai|crash|exception|traceback|stack trace|fix|sua loi|debug|undefined|null pointer)\b/;
const REASON = /\b(chung minh|giai (bai|phuong trinh|he)|tinh toan|xac suat|thong ke|toan|logic|suy luan|prove|calculate|probability|equation|optimi[sz]e)\b|\d+\s*[\^*/]\s*\d+/;
const TRANSLATE = /\b(dich|translate|sang tieng|ra tieng|into (english|vietnamese))\b/;
const WRITE = /\b(viet|soan|bien tap|sua van|email|thu|bai dang|caption|tho|truyen|kich ban|write|draft|essay)\b/;
const DATA = /\b(bang|excel|csv|so lieu|du lieu|bieu do|thong ke|pivot|chart|spreadsheet)\b/;
const CHAT = /^(xin chao|chao|hi|hello|hey|cam on|thanks|ok|oke|vang|da|uh|yes|no)\b/;
// Người dùng chê câu trả lời trước → nâng độ khó, đổi model.
const RETRY = /\b(sai roi|chua dung|khong dung|lam lai|viet lai di|chua on|te qua|kem qua|chua hay|chua duoc|van sai|van loi|wrong|try again|redo|not right|still (wrong|broken))\b/;

export type RouteInput = { text: string; attachments: number; turns: number; studio: boolean; images?: number; docChars?: number; prev?: string | null; prevText?: string };
export function taskOf(q: RouteInput): Task {
  const t = fold(q.text);
  if (q.images) return "vision";
  if ((q.docChars ?? 0) > 60_000) return "longdoc";
  if (DEBUG.test(t) && CODE.test(q.text)) return "debug";
  if (CODE.test(q.text)) return "code";
  if (BUILD.test(t) || q.studio) return "build";
  if (REASON.test(t)) return "reason";
  if (TRANSLATE.test(t)) return "translate";
  if (DATA.test(t)) return "data";
  if (THINK.test(t)) return "analyze";
  if (WRITE.test(t)) return "write";
  if (q.text.length < 60 && CHAT.test(t)) return "chat";
  return "qa";
}
/** Điểm độ khó: ≤ 0 dễ, 1-2 vừa, 3-4 khó, ≥ 5 rất khó. */
export function difficulty(q: RouteInput): { score: number; why: string[] } {
  const t = fold(q.text).trim();
  const why: string[] = [];
  let s = 0;
  const add = (n: number, w: string) => { s += n; why.push(w); };
  if (q.studio) add(3, "chế độ studio");
  if (q.attachments) add(2, "có tệp đính kèm");
  const code = CODE.test(q.text);
  if (code) add(2, "có code");
  if (BUILD.test(t)) add(3, "tạo sản phẩm hoàn chỉnh");
  else if (THINK.test(t)) add(2, "phân tích nhiều bước");
  else if (REASON.test(t)) add(2, "cần suy luận, tính toán");
  // Chủ đề chuyên môn chỉ tính khi chưa có dấu hiệu nào khác (code, dịch câu ngắn không cần model mạnh hơn vì vài từ chuyên môn).
  else if (!code && !TRANSLATE.test(t) && expand(q.text).concepts) add(1, "có chủ đề chuyên môn");
  if ((q.docChars ?? 0) > 60_000) add(2, "tài liệu dài");
  if (q.text.length > 600) add(2, "yêu cầu dài");
  else if (q.text.length > 200) add(1, "yêu cầu vừa");
  if (q.turns > 12) add(1, "hội thoại dài");
  if (RETRY.test(t)) add(2, "bạn chưa hài lòng với câu trả lời trước");
  if (q.text.length < 60 && CHAT.test(t)) add(-2, "trò chuyện ngắn");
  return { score: s, why };
}
const NEED = (score: number) => (score <= 0 ? 6 : score <= 2 ? 7.5 : score <= 4 ? 8.8 : 9.4);
/** Mức nỗ lực theo độ khó (máy chủ còn hạ theo giới hạn của quản trị viên và các mức model hỗ trợ). */
export function effortFor(score: number, task: Task): AutoEffort {
  if (task === "chat") return "low";
  if (score <= 0) return "low";
  if (score <= 2) return task === "reason" || task === "debug" ? "high" : "medium";
  if (score <= 4) return "high";
  return score >= 7 ? "max" : "extra";
}

export type Route = { model: string; tier: Tier; vendor: Vendor; task: Task; effort: AutoEffort; why: string[]; alt: string[] };
/** Chọn model cho chế độ Tự động trong danh sách được phép (cả ba hãng, gói lẫn khóa API). avoid: model vừa bị chê / vừa lỗi. */
export function routeModel(q: RouteInput, allowed: string[], o: { avoid?: string[] } = {}): Route | null {
  if (!allowed.length) return null;
  const { score, why } = difficulty(q);
  const task = taskOf(q);
  const need = NEED(score);
  const retry = RETRY.test(fold(q.text));
  const avoid = new Set([...(o.avoid ?? []), ...(retry && q.prev ? [q.prev] : [])]);
  const all = allowed.map((k, i) => ({ p: profileOf(k), i })).map((x) => ({ ...x, q: quality(x.p, task) }));
  const pool = all.filter((x) => !avoid.has(x.p.key)).length ? all.filter((x) => !avoid.has(x.p.key)) : all;
  // Đạt mức cần: rẻ nhất → chất lượng cao hơn → nhanh hơn → thứ tự quản trị viên hiển thị. Không ai đạt: chất lượng cao nhất.
  const ok = pool.filter((x) => x.q >= need);
  const rank = ok.length
    ? ok.sort((a, b) => a.p.cost - b.p.cost || b.q - a.q || a.i - b.i)
    : pool.sort((a, b) => b.q - a.q || a.p.cost - b.p.cost || a.i - b.i);
  const pick = rank[0];
  const label = { chat: "trò chuyện", qa: "hỏi đáp", write: "viết", translate: "dịch", code: "viết code", debug: "gỡ lỗi", reason: "suy luận", analyze: "phân tích", build: "tạo sản phẩm", vision: "đọc ảnh", longdoc: "tài liệu dài", data: "số liệu" }[task];
  // Dự phòng khi model đã chọn lỗi / hết hạn mức: model tốt kế tiếp, ưu tiên hãng khác.
  const alt = [...ok, ...pool.filter((x) => !ok.includes(x)).sort((a, b) => b.q - a.q)].filter((x) => x.p.key !== pick.p.key)
    .sort((a, b) => Number(a.p.vendor === pick.p.vendor) - Number(b.p.vendor === pick.p.vendor)).map((x) => x.p.key);
  return { model: pick.p.key, tier: pick.p.tier, vendor: pick.p.vendor, task, effort: effortFor(score, task), why: [`việc ${label}`, ...why], alt };
}
/** Mức nỗ lực tự động cho một yêu cầu khi người dùng để effort "Tự động" (model chọn tay hay chế độ Tự động đều dùng). */
export const autoEffort = (q: RouteInput): AutoEffort => effortFor(difficulty(q).score, taskOf(q));
