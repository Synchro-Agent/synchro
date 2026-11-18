// Việc phụ chạy trên gói của chính người dùng (đặt tên đoạn chat, rút bộ nhớ, chưng cất bộ não, phản biện tự động, đánh giá phiên Code…):
// mỗi việc là một lượt thật của gói, tính vào hạn mức của hãng y như tin nhắn của người dùng. Trên production 15/11, 57 trong 59 lượt
// GPT-6 Luna của một tài khoản miễn phí là việc phụ và hạn mức tuần ChatGPT Free lên 48% sau chừng 10 việc. Mô-đun này quyết định việc phụ
// nào còn được chạy trên gói hôm nay, để việc phụ không bao giờ tiêu hết gói trước lượt của chính người dùng. Thuần (không đọc cơ sở dữ liệu)
// để kiểm thử không cần máy chủ; số đếm và cửa sổ hạn mức do ai/subs.ts đưa vào.

/** Lượt của gói ghi ở engine_turns.via: việc phụ ghi "job:<tên>", lượt làm ấm phiên ghi "warm"; còn lại là lượt của người dùng. */
export const JOB_VIA = "job:";
export const isUserVia = (via: string) => via !== "warm" && !via.startsWith(JOB_VIA);

/**
 * Việc phụ chạy tự động, không ai bấm: chịu ngân sách. Việc người dùng tự bấm hoặc đang đứng chờ (phản biện bấm tay, nén ngữ cảnh,
 * tóm tắt để đọc to, lập lịch tự động hóa, quét skill…) vẫn là việc phụ (không tính vào "tin nhắn hôm nay") nhưng không bị chặn.
 */
export const THROTTLED_JOBS = new Set(["title", "memory", "project-memory", "brain", "meta", "critic-auto"]);

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

// Câu người dùng tự nói về mình (tên, nghề, thói quen, cách muốn được trả lời): đáng rút bộ nhớ ngay trong lượt. Câu khác để lần chưng cất
// đoạn chat của bộ não (gom cả đoạn, một lời gọi) rút sau, không tốn thêm một lượt gói cho mỗi tin nhắn.
const FACT_VI = /(?<![\p{L}\p{N}])(?:tên (?:tôi|mình|em|tớ|anh|chị)|(?:tôi|mình|em|tớ) (?:là|tên|đang|hay|thường|thích|muốn|cần|làm|học|sống|ở|không thích|ghét|ưu tiên|dùng|có)|gọi (?:tôi|mình|em|tớ) là|nghề|công việc của|xưng hô|trả lời (?:ngắn|dài|bằng|chi tiết)|nhớ giúp|ghi nhớ|đừng bao giờ|luôn luôn)(?![\p{L}\p{N}])/iu;
const FACT_EN = /\b(?:my name|call me|i am|i'm|i work|i study|i live|i prefer|i like|i love|i hate|i usually|i always|i never|i use|remember (?:that|this)|always answer|never answer|keep (?:answers|replies) (?:short|brief))\b/i;
export const factLike = (text: string) => FACT_VI.test(text) || FACT_EN.test(text);
