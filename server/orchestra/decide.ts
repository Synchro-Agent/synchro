// Có nên chia lượt này cho cả nhóm Orchestra không. Đây là hành vi mặc định của mọi lượt Tự động, nên quyết định phải
// rẻ: chỉ luật trên chữ và bộ định tuyến sẵn có (router.ts), không gọi model nào. Câu đơn giản ("2+2 bằng mấy", một câu
// dịch, câu trả lời ngắn) đi đúng đường cũ, không chậm thêm và không tốn thêm token. Chỉ chia khi việc tự nó có nhiều
// nhánh: tra cứu + viết, lấy số liệu + phân tích, nhiều phần việc liệt kê, so sánh nhiều đối tượng rồi viết kết luận,
// code nhiều phần, việc dài của Autopilot.
import "server-only";
import {
  difficulty, fold, isCrisis, isFollowUp, needsNoTools, splitAsk, taskOf, wantsImage, type RouteInput,
} from "../router";

// So khớp trên chữ đã bỏ dấu (fold) để người dùng gõ không dấu vẫn nhận ra. Vì vậy tránh từ mà khi bỏ dấu trùng với từ
// thông dụng khác ("dựng" thành "dung" như "dùng", "lập" thành "lap" như "lặp"): dùng cụm dài hơn.
const F = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, "iu");
// Nhánh tìm hiểu / lấy dữ liệu.
const RESEARCH = F([
  "tim hieu|nghien cuu|khao sat|tra cuu|thu thap|tong hop thong tin|so sanh|doi chieu|so lieu|thong ke|du lieu|nguon",
  "xu huong|thi truong|doi thu|research|investigate|look up|gather|compare|comparison|survey|benchmark|data|statistics",
  "sources|market|competitors?|trends?",
].join("|"));
// Nhánh tạo ra sản phẩm.
const PRODUCE = F([
  "viet|soan|lap ke hoach|lap bang|xay dung|thiet ke|dung trang|bao cao|slide|thuyet trinh|ke hoach|de xuat|bai viet",
  "tai lieu|trang web",
  "write|draft|build|create|design|prepare|report|deck|presentation|plan|proposal|article|blog post|website|document",
].join("|"));
// Nhánh kiểm tra.
const CHECK = F("kiem tra|ra soat|kiem chung|soat loi|fact[ -]?check|verify|double[ -]?check|proofread|review lai");
// Nối các phần việc: "rồi", "sau đó", "kèm", "then"…
const JOIN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[
  "roi|sau do|tiep theo|cuoi cung|dong thoi|kem theo|ngoai ra",
  "then|after that|finally|and also|as well as|plus",
].join("|")})(?![\\p{L}\\p{N}])`, "giu");
const LIST = /^\s*(?:[-*•]|\d+[.)])\s+\S/gm;
// Code nhiều phần: nhiều tệp, frontend + backend, kèm kiểm thử / tài liệu.
const CODE_PARTS = F([
  "nhieu tep|nhieu file|frontend|backend|api|giao dien|database|co so du lieu|kiem thu|unit tests?|tests|tai lieu",
  "readme|migration|multi[- ]file",
].join("|"));
// Chỗ tách các đối tượng trong "so sánh A, B và C".
const ITEM_SEP = /,|;|(?<![\p{L}\p{N}])(?:va|voi|hoac|and|or|vs\.?|versus)(?![\p{L}\p{N}])/u;
const CODE_TASKS = new Set(["code", "build", "debug"]);
// Tín hiệu đủ mạnh để chia một mình.
const STRONG = new Set(["research+produce", "code-parts", "autopilot"]);
// "So sánh A, B và C": từ ba đối tượng trở lên.
const COMPARE = /(?<![\p{L}\p{N}])(?:so sanh|compare)(?![\p{L}\p{N}])([^.?!\n]{0,160})/iu;

/** Loại việc tự nó chỉ có một nhánh (trả lời một lần là xong). */
const ONE_SHOT = new Set(["chat", "qa", "language", "translate", "vision", "lookup", "summarize"]);

export type Split = { split: boolean; branches: string[] };
const NO: Split = { split: false, branches: [] };

/**
 * pool: số model dùng được (một model thì chia cũng không có ai khác nhận); autopilot: lượt của việc tự động chạy theo
 * lịch (không ai ngồi chờ, việc thường dài, nhiều bước).
 */
export function shouldSplit(q: RouteInput, o: { pool: number; autopilot?: boolean }): Split {
  if (o.pool < 2 || q.answeredAsk || q.images || q.studio) return NO;
  if (needsNoTools(q) || isFollowUp(q) || isCrisis(q.text) || wantsImage(q.text)) return NO;
  const a = splitAsk(q.text);
  const ins = fold(a.ins).toLowerCase();
  if (ins.length < 40) return NO;
  const { score } = difficulty(q);
  const task = taskOf(q);
  const steps = (ins.match(JOIN)?.length ?? 0) + (a.ins.match(LIST)?.length ?? 0);
  if (score < 2 && !(o.autopilot && steps >= 1)) return NO;
  if (ONE_SHOT.has(task) && steps < 2) return NO;
  const why: string[] = [];
  const research = RESEARCH.test(ins), produce = PRODUCE.test(ins), check = CHECK.test(ins);
  if (research && produce) why.push("research+produce");
  if (check && (produce || research)) why.push("check");
  if (steps >= 2) why.push(`steps:${steps}`);
  const cmp = COMPARE.exec(ins)?.[1] ?? "";
  const items = cmp ? cmp.split(ITEM_SEP).filter((x) => x.trim()).length : 0;
  if (items >= 3) why.push(`compare:${items}`);
  if (CODE_TASKS.has(task) && score >= 4 && CODE_PARTS.test(ins)) why.push("code-parts");
  if (o.autopilot && steps >= 1 && (research || produce)) why.push("autopilot");
  // Một tín hiệu nhẹ thôi (chỉ có "kiểm tra", hay chỉ có hai bước nối) chưa đủ: cần hai tín hiệu, hoặc một tín hiệu
  // mạnh.
  const strong = steps >= 3 || why.some((w) => STRONG.has(w));
  return strong || why.length >= 2 ? { split: true, branches: why } : NO;
}
