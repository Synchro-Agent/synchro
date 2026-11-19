// Lời báo khi chạm hạn mức (Blueprint H1.2): mỗi lời báo nói đủ ba điều — hạn mức NÀO, BAO GIỜ hồi lại, và người dùng làm gì TRONG LÚC CHỜ.
// Một chỗ cho mọi hạn mức Synchro tự đặt (chi phí API theo phiên / tuần, credit giọng AI mỗi ngày, số ảnh mỗi giờ) để câu chữ thống nhất và
// bản tiếng Anh (RULES_EN trong i18n-dict.ts) khớp đúng một mẫu. Hạn mức của hãng (gói ChatGPT, Claude…) do ai/subs.ts báo kèm resetsAt.
// Không vượt hạn mức của hãng: cách thay thế chỉ trỏ tới thứ người dùng được dùng (gói của chính họ, giọng trình duyệt, minh họa không tốn ảnh).

/** Thời gian chờ dạng "45 phút", "2 giờ 5 phút", "3 ngày" (luôn làm tròn lên phút; tối thiểu 1 phút). */
import "server-only";
export function waitVi(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return m < 60 ? `${m} phút` : m < 1440 ? `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ""}` : `${Math.round(m / 1440)} ngày`;
}

// Cách thay thế khi hết hạn mức chi phí API của Synchro: gói subscription của chính người dùng không tính vào hạn mức này
// (usage.ts overLimit chỉ áp cho khóa API; chatengine plansOnly tự hạ xuống gói khi đang để Tự động). Câu chữ theo chỗ người dùng gặp lời báo:
// - "pick": chat với một model khóa API chọn tay → bảo chọn Tự động hoặc model của gói (bộ chọn model ngay đó).
// - "plans": đang để Tự động mà chưa có gói nào dùng được (chatengine plansOnly) → "chọn Tự động" là vô nghĩa, chỉ còn cách kết nối gói.
// - "code": lượt Synchro Code / việc nền chạy bằng Code (agentturn) → chọn model của gói trong Code, không nói "Tự động" (Tự động đã chọn khóa API).
// - "task": việc không có bộ chọn model (chạy việc tự động ngay, lời gọi phụ anymodel) → việc này chờ hồi, chat bằng gói vẫn dùng được.
export type UsageAlt = "pick" | "plans" | "code" | "task";
export const USAGE_ALT = "Trong lúc chờ, model của gói bạn đã kết nối (Claude, ChatGPT, Gemini, Grok) vẫn dùng được vì không tính vào giới hạn này: chọn Tự động hoặc một model của gói, hoặc kết nối gói ở Cài đặt → Providers.";
export const USAGE_ALT_PLANS = "Trong lúc chờ, kết nối gói Claude, ChatGPT, Gemini hoặc Grok của bạn ở Cài đặt → Providers: model của gói không tính vào giới hạn này và Tự động sẽ dùng gói ngay.";
export const USAGE_ALT_CODE = "Trong lúc chờ, chọn một model của gói bạn đã kết nối (Claude, ChatGPT, Gemini, Grok) để làm tiếp vì gói không tính vào giới hạn này, hoặc kết nối gói ở Cài đặt → Providers.";
export const USAGE_ALT_TASK = "Trong lúc chờ, chat bằng model của gói bạn đã kết nối (Claude, ChatGPT, Gemini, Grok) vẫn dùng được; việc này chạy lại được khi giới hạn hồi.";
const USAGE_ALTS: Record<UsageAlt, string> = { pick: USAGE_ALT, plans: USAGE_ALT_PLANS, code: USAGE_ALT_CODE, task: USAGE_ALT_TASK };

/** Hết hạn mức chi phí API của Synchro (usage.ts): phiên 5 giờ hoặc tuần. alt: chỗ người dùng gặp lời báo (xem UsageAlt). */
export function usageLimitMsg(key: "session" | "weekly" | "daily", resetAt: number, now = Date.now(), alt: UsageAlt = "pick"): string {
  const t = waitVi(resetAt - now), tail = USAGE_ALTS[alt];
  return key === "session"
    ? `Bạn đã dùng hết giới hạn của phiên này (phiên 5 giờ). Phiên mới bắt đầu sau ${t}. ${tail}`
    : key === "daily" ? `Bạn đã dùng hết giới hạn chi phí API của hôm nay. Giới hạn hồi lại sau ${t} (0 giờ UTC). ${tail}`
    : `Bạn đã dùng hết giới hạn hằng tuần. Giới hạn được đặt lại sau ${t}. ${tail}`;
}

// Giọng AI (ElevenLabs, khóa chung của máy chủ): hạn mức credit theo ngày UTC (speechapi.ts day()).
export const SPEECH_ALT_VOICE = "Đọc to và trò chuyện giọng nói vẫn dùng được bằng giọng của trình duyệt.";
export const SPEECH_ALT_STT = "Trong lúc chờ, nút micro trong ô chat vẫn nhận giọng nói bằng trình duyệt (không tốn credit); tệp âm thanh thì chép lời lại sau khi hạn mức hồi.";
export const SPEECH_ALT_OTHER = "Trong lúc chờ, Đọc to và trò chuyện giọng nói vẫn dùng được bằng giọng của trình duyệt; tính năng này dùng lại được khi hạn mức hồi.";
/** Mốc 0 giờ UTC kế tiếp: lúc hạn mức credit giọng AI của ngày hồi lại. */
export const nextUtcDay = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
export type SpeechUse = "voice" | "stt" | "other";
/** Hết credit giọng AI của hôm nay: scope "all" = trần chung cả máy chủ, "me" = trần của tài khoản (credits = mức mỗi ngày). */
export function speechLimitMsg(scope: "all" | "me", credits: number, use: SpeechUse = "voice", now = Date.now()): string {
  const head = scope === "all" ? "Giọng AI đã hết hạn mức chung của cả máy chủ hôm nay." : `Bạn đã dùng hết hạn mức giọng AI của hôm nay (${credits} credit).`;
  const alt = use === "stt" ? SPEECH_ALT_STT : use === "other" ? SPEECH_ALT_OTHER : SPEECH_ALT_VOICE;
  return `${head} Hạn mức hồi lại sau ${waitVi(nextUtcDay(now) - now)} (0 giờ UTC). ${alt}`;
}

// Ảnh AI: trần số ảnh mỗi giờ của một tài khoản (ai/imagegen.ts imageBudget), chặn model chạy vòng lặp đốt hết hạn mức gói ảnh.
// Lời báo là kết quả công cụ tạo ảnh: thẻ công cụ hiện nó cho người dùng (tóm tắt 140 ký tự đầu), model đọc toàn bộ. Nên câu đầu (imageLimitMsg)
// viết cho người dùng đọc, còn chỉ dẫn cho model (IMAGE_LIMIT_NOTE) đứng riêng sau một dòng trống, ngoài phần thẻ công cụ hiện.
export const IMAGE_ALT = "Trong lúc chờ, minh họa dựng bằng SVG, HTML/CSS hoặc biểu đồ vẫn làm được vì không tính vào hạn mức ảnh.";
export function imageLimitMsg(max: number, waitMs: number): string {
  return `Tài khoản đã dùng hết hạn mức ${max} ảnh AI mỗi giờ. Hạn mức hồi lại sau khoảng ${Math.ceil(waitMs / 60_000)} phút. ${IMAGE_ALT}`;
}
export const IMAGE_LIMIT_NOTE = "(Chỉ dẫn cho model, không nhắc lại nguyên văn: đừng gọi lại công cụ tạo ảnh trước giờ hồi. Báo người dùng hạn mức và giờ hồi ở trên; nếu việc vẫn cần hình thì dựng bằng SVG, HTML/CSS hoặc biểu đồ, hoặc dùng ảnh người dùng đã tải lên trong đoạn chat.)";

/** Kiểm một lời báo hạn mức có đủ ba phần không (dùng trong kiểm thử): nói hạn mức nào, khi nào hồi, làm gì trong lúc chờ. */
export function limitParts(msg: string): { which: boolean; when: boolean; alt: boolean } {
  return {
    which: /(phiên|tuần|hôm nay|mỗi giờ|mỗi ngày|[Gg]ói \S+|session|week|today|per hour|per day|limit)/i.test(msg),
    when: /(sau (khoảng )?\d+ (phút|giờ|ngày)|ngày mai|in (about )?\d+ ?(min|minutes|h|hours|days?)|tomorrow|resets? (at|in))/i.test(msg),
    alt: /(Trong lúc chờ|vẫn dùng được|vẫn làm được|chọn Tự động|Cài đặt → Providers|In the meantime|still work|still available|choose Auto|Settings → Providers)/i.test(msg),
  };
}

// Gói subscription của người dùng (Claude, ChatGPT, Gemini, Grok) hết hạn mức giữa lượt, Tự động đã trả lời bằng model khác (chat/routing.ts):
// câu "… đã hết hạn mức, nên Synchro đã trả lời bằng …" mới nói hãng và cách thay thế; thêm câu này để nói hạn mức nào (cả gói hay riêng model)
// và bao giờ hồi (resetsAt của ai/subs.ts). Bản tiếng Anh: luật trong RULES_EN (i18n-dict.ts).
export function planResetMsg(scope: "plan" | "model", name: string, resetAt: number, now = Date.now()): string {
  return `${scope === "plan" ? `Hạn mức gói ${name}` : `Hạn mức riêng của ${name}`} hồi lại sau ${waitVi(resetAt - now)}. Trong lúc chờ, Tự động dùng các model khác bạn đã kết nối.`;
}

// Tự động chọn một model chạy bằng khóa API chung của Synchro trong khi người dùng có gói đã kết nối (Blueprint H1 bổ sung):
// nói rõ lượt này tính vào hạn mức chi phí API của họ, không phải gói, để người dùng miễn phí không tưởng đang dùng gói của mình.
export function sharedKeyMsg(model: string): string {
  return `${model} chạy bằng khóa API chung của Synchro: lượt này tính vào hạn mức chi phí API của bạn (phiên 5 giờ và tuần, xem ở Cài đặt → Usage), không tính vào gói đã kết nối.`;
}
