// Lời báo khi chạm hạn mức (Blueprint H1.2): mỗi lời báo nói đủ ba điều — hạn mức NÀO, BAO GIỜ hồi lại, và người dùng làm gì TRONG LÚC CHỜ.
// Một chỗ cho mọi hạn mức Synchro tự đặt (chi phí API theo phiên / tuần, credit giọng AI mỗi ngày, số ảnh mỗi giờ) để câu chữ thống nhất và
// bản tiếng Anh (RULES_EN trong i18n-dict.ts) khớp đúng một mẫu. Hạn mức của hãng (gói ChatGPT, Claude…) do ai/subs.ts báo kèm resetsAt.
// Không vượt hạn mức của hãng: cách thay thế chỉ trỏ tới thứ người dùng được dùng (gói của chính họ, giọng trình duyệt, minh họa không tốn ảnh).

/** Thời gian chờ dạng "45 phút", "2 giờ 5 phút", "3 ngày" (luôn làm tròn lên phút; tối thiểu 1 phút). */
export function waitVi(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return m < 60 ? `${m} phút` : m < 1440 ? `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ""}` : `${Math.round(m / 1440)} ngày`;
}

// Cách thay thế chung khi hết hạn mức chi phí API của Synchro: gói subscription của chính người dùng không tính vào hạn mức này
// (usage.ts overLimit chỉ áp cho khóa API; chatengine plansOnly tự hạ xuống gói khi đang để Tự động).
export const USAGE_ALT = "Trong lúc chờ, model của gói bạn đã kết nối (Claude, ChatGPT, Gemini, Grok) vẫn dùng được vì không tính vào giới hạn này: chọn Tự động hoặc một model của gói, hoặc kết nối gói ở Cài đặt → Providers.";

/** Hết hạn mức chi phí API của Synchro (usage.ts): phiên 5 giờ hoặc tuần. */
export function usageLimitMsg(key: "session" | "weekly", resetAt: number, now = Date.now()): string {
  const t = waitVi(resetAt - now);
  return key === "session"
    ? `Bạn đã dùng hết giới hạn của phiên này (phiên 5 giờ). Phiên mới bắt đầu sau ${t}. ${USAGE_ALT}`
    : `Bạn đã dùng hết giới hạn hằng tuần. Giới hạn được đặt lại sau ${t}. ${USAGE_ALT}`;
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
export const IMAGE_ALT = "Trong lúc chờ, hãy dựng minh họa bằng SVG, HTML/CSS hoặc biểu đồ (không tính vào hạn mức ảnh), hoặc dùng ảnh người dùng tải lên.";
export function imageLimitMsg(max: number, waitMs: number): string {
  return `Tài khoản đã dùng hết hạn mức ${max} ảnh AI mỗi giờ. Hạn mức hồi lại sau khoảng ${Math.ceil(waitMs / 60_000)} phút. ${IMAGE_ALT}`;
}

/** Kiểm một lời báo hạn mức có đủ ba phần không (dùng trong kiểm thử): nói hạn mức nào, khi nào hồi, làm gì trong lúc chờ. */
export function limitParts(msg: string): { which: boolean; when: boolean; alt: boolean } {
  return {
    which: /(phiên|tuần|hôm nay|mỗi giờ|mỗi ngày|session|week|today|per hour|per day|limit)/i.test(msg),
    when: /(sau (khoảng )?\d+ (phút|giờ|ngày)|ngày mai|in (about )?\d+ ?(min|minutes|h|hours|days?)|tomorrow|resets? (at|in))/i.test(msg),
    alt: /(Trong lúc chờ|vẫn dùng được|chọn Tự động|Cài đặt → Providers|In the meantime|still work|still available|choose Auto|Settings → Providers)/i.test(msg),
  };
}
