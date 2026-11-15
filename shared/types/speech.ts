// Gói ElevenLabs của người dùng (ui/speech/client.ts hỏi /api/speech, shared/speech/data.ts tính credit theo gói).
// Chỉ có kiểu (xóa khi biên dịch): mô-đun gốc xuất lại các kiểu này nên mã đang nhập từ đó không đổi.

// Từ ui/speech/client.ts.
export type Feat = "tts" | "dialogue" | "stt" | "live" | "agent" | "sfx" | "isolate" | "changer" | "align" | "music" | "design" | "remix" | "ivc" | "pvc" | "dub" | "dubClean" | "podcast" | "book" | "dict" | "native";
export type ModelOut = { id: string; name: string; desc: string; langs: { id: string; name: string }[]; max: number; rate: number; style: boolean; boost: boolean };
export type Plan = {
  connected: boolean; readPlan: boolean; tier: string; tierName: string; status: string;
  /** shared: hạn mức giọng AI chung của máy chủ hôm nay đã hết (còn 0 dù hạn mức riêng còn). */
  credits: { used: number; limit: number; resetAt: number | null; shared?: boolean };
  voices: { used: number; limit: number }; pro: { used: number; limit: number };
  features: Record<Feat, boolean>; locked: Partial<Record<Feat, string>>;
  /** Quyền khóa còn thiếu (tính năng đó bị ẩn); realtime: dùng được Eleven Realtime; library: dùng được giọng Thư viện qua API (gói trả phí). */
  perms: Partial<Record<Feat, string>>; realtime: boolean; library: boolean;
  formats: { id: string; label: string }[]; tts: ModelOut[]; sts: ModelOut[];
  note: string | null; checkedAt: number;
  /** true khi người xem là chủ sở hữu: chỉ chủ sở hữu thấy số credit dùng chung của cả hệ thống; người khác thấy "credits" là hạn mức riêng của họ trong ngày. */
  owner?: boolean;
};
