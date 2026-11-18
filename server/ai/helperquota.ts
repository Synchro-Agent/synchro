// Việc phụ chạy trên gói của chính người dùng (đặt tên đoạn chat, rút bộ nhớ, chưng cất bộ não, phản biện tự động, đánh giá phiên Code…):
// mỗi việc là một lượt thật của gói, tính vào hạn mức của hãng y như tin nhắn của người dùng. Trên production 15/11, 57 trong 59 lượt
// GPT-6 Luna của một tài khoản miễn phí là việc phụ và hạn mức tuần ChatGPT Free lên 48% sau chừng 10 việc. Mô-đun này quyết định việc phụ
// nào còn được chạy trên gói hôm nay, để việc phụ không bao giờ tiêu hết gói trước lượt của chính người dùng. Thuần (không đọc cơ sở dữ liệu)
// để kiểm thử không cần máy chủ; số đếm và cửa sổ hạn mức do ai/subs.ts đưa vào.
import "server-only";

/** Lượt của gói ghi ở engine_turns.via: việc phụ ghi "job:<tên>", lượt làm ấm phiên ghi "warm"; còn lại là lượt của người dùng. */
export const JOB_VIA = "job:";
export const isUserVia = (via: string) => via !== "warm" && !via.startsWith(JOB_VIA);

/**
 * Việc phụ chạy tự động, không ai bấm: chịu ngân sách. Việc người dùng tự bấm hoặc đang đứng chờ (phản biện bấm tay, nén ngữ cảnh,
 * tóm tắt để đọc to, lập lịch tự động hóa, quét skill…) vẫn là việc phụ (không tính vào "tin nhắn hôm nay") nhưng không bị chặn.
 */
export const THROTTLED_JOBS = new Set(["title", "memory", "project-memory", "brain", "meta", "critic-auto", "skill-studio"]);

/**
 * Lượt làm tiếp trong cùng một tin nhắn của người dùng (nhắc làm tiếp khi model mới báo "Mình sẽ…", nhắc dùng công cụ được phép, chờ kết quả
 * công cụ wait_for_result): một lượt thật của gói nhưng không phải tin nhắn mới, nên ghi "job:cont" (không đếm vào "tin nhắn hôm nay").
 * Tin nhắn người dùng gửi thêm khi đang làm (<user_followup>) vẫn là lượt của người dùng.
 */
export const CONT_JOB = "cont";

/** Cấu hình (biến môi trường): dừng việc phụ khi một cửa sổ của gói đã dùng tới STOP_PCT; mỗi ngày tối đa BASE + PER_TURN × số lượt của người dùng, trần MAX. */
export const helperCfg = () => ({
  stopPct: num(process.env.SYNCHRO_HELPER_STOP_PCT, 70),
  base: num(process.env.SYNCHRO_HELPER_BASE, 4),
  perTurn: num(process.env.SYNCHRO_HELPER_PER_TURN, 2),
  max: num(process.env.SYNCHRO_HELPER_DAY_MAX, 30),
});
const num = (v: string | undefined, d: number) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d; };

export type HelperWindow = { usedPct?: number; status?: string; resetsAt?: number };
export type HelperInput = {
  /** Việc phụ đã chạy hôm nay trên gói này. */ helpers: number;
  /** Lượt của chính người dùng hôm nay (mọi gói). */ userTurns: number;
  /** Cửa sổ hạn mức gói đang báo (đã áp mốc đặt lại). */ windows: HelperWindow[];
  /** Gói đang bị chặn tới lúc nào (hãng báo hết hạn mức), hoặc null. */ blockedUntil: number | null;
};
export type HelperVerdict = { ok: true; cap: number } | { ok: false; why: "near-limit" | "blocked" | "budget"; cap: number };

/** Hôm nay còn chạy việc phụ tự động trên gói này được không. */
export function helperVerdict(x: HelperInput, now = Date.now(), cfg = helperCfg()): HelperVerdict {
  const cap = Math.min(cfg.max, cfg.base + cfg.perTurn * Math.max(0, x.userTurns));
  if (x.blockedUntil && x.blockedUntil > now) return { ok: false, why: "blocked", cap };
  // Gói sắp chạm giới hạn: phần còn lại dành cho tin nhắn của người dùng.
  if (x.windows.some((w) => w.status === "rejected" || (w.usedPct ?? 0) >= cfg.stopPct)) return { ok: false, why: "near-limit", cap };
  if (x.helpers >= cap) return { ok: false, why: "budget", cap };
  return { ok: true, cap };
}

// Câu người dùng tự mô tả mình (tên, nghề, nơi sống, sở thích, cách muốn được trả lời) hoặc dặn nhớ: đáng rút bộ nhớ ngay trong lượt. Câu khác,
// kể cả yêu cầu mở đầu bằng ngôi thứ nhất ("Mình muốn làm slide…", "Tôi cần viết email…", "Em có bài toán…", "I'm trying to…", "I use Next.js,
// how do I…"), để lần chưng cất đoạn chat của bộ não (gom cả đoạn, một lời gọi) rút sau, không tốn thêm một lượt gói cho mỗi tin nhắn.
// Không có các động từ chung muốn / cần / có / đang / làm / dùng, "I'm" / "I use": gần như mọi yêu cầu đều mở đầu như vậy.
const ME = "(?:tôi|mình|em|tớ)", END = "(?![\\p{L}\\p{N}])";
const FACT_VI = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[
  `tên (?:của )?${ME}${END}`, `${ME} tên là${END}`, `gọi ${ME} là${END}`, `xưng hô${END}`,
  // "Mình là kỹ sư điện", "Tôi là giáo viên": tự giới thiệu (không gồm "tôi là ai", "mình là gì").
  `${ME} là (?!(?:ai|gì)${END})`,
  `${ME} (?:làm nghề|làm việc (?:ở|tại|cho|bên)|sống (?:ở|tại)|ở (?:Hà Nội|Sài Gòn|TP|thành phố|Đà Nẵng|Huế|Cần Thơ|Hải Phòng)|học lớp|học (?:ở|tại) trường|là sinh viên|(?:bị )?dị ứng|ăn chay)${END}`,
  `nghề (?:nghiệp )?của ${ME}${END}`, `công việc của ${ME}${END}`,
  // Sở thích của chính người dùng, không phải khen câu trả lời vừa rồi ("mình thích bài này").
  `${ME} (?:rất |cũng |không )?(?:thích|ghét|ưu tiên|quen dùng)${END}(?! (?:câu|bài|cái|đoạn|ý|kết quả|phần|bản) (?:này|đó|trên|vừa|kia))`,
  `trả lời (?:ngắn|gọn|chi tiết|bằng tiếng)${END}`, `luôn trả lời${END}`, `từ (?:giờ|nay) trở đi${END}`, `từ (?:giờ|nay|lần sau),? (?:hãy |cứ |nhớ |luôn |đừng )`, `nhớ giúp${END}`, `nhớ (?:rằng|là) ${ME}${END}`, `(?:hãy )?ghi nhớ (?:giúp|rằng|là|điều này|nhé)${END}`, `đừng bao giờ${END}`, `luôn luôn${END}`,
].join("|")})`, "iu");
const FACT_EN = /\b(?:my name(?:'s| is)|call me|i am an? (?!bit\b|little\b|lot\b)|i'm an? (?!bit\b|little\b|lot\b)|i work (?:as|at|for|in)|i live in|i'm from|i am from|i (?:really )?(?:prefer|like|love|hate|enjoy) (?!this\b|that\b|it\b|the\b)|i'm allergic|i am allergic|i'm vegetarian|remember (?:that|this|my)|from now on|always (?:answer|reply|respond|write)|never (?:answer|reply|respond)|keep (?:answers|replies|it) (?:short|brief))/i;
export const factLike = (text: string) => FACT_VI.test(text) || FACT_EN.test(text);
