// Hằng số của mục Speech (ElevenLabs). Giọng, model, credit và tính năng đều lấy thật từ tài khoản ElevenLabs qua /api/speech.
import type { Feat, Plan } from "./client";

export type SpeechTool = "home" | "tts" | "stt" | "agent" | "voices" | "audio" | "studio";
export const TOOLS: { k: SpeechTool; label: string; desc: string; feats: Feat[] }[] = [
  { k: "home", label: "Trang chính", desc: "", feats: [] },
  { k: "tts", label: "Đọc văn bản", desc: "Văn bản thành giọng nói, 90+ ngôn ngữ, thẻ cảm xúc.", feats: ["tts", "dialogue"] },
  { k: "stt", label: "Chép lời", desc: "Scribe v2: tách người nói, mốc thời gian từng từ.", feats: ["stt", "live"] },
  { k: "agent", label: "Voice Agent", desc: "Trò chuyện hai chiều thời gian thực.", feats: ["agent"] },
  { k: "voices", label: "Giọng nói", desc: "Giọng của bạn, thư viện, thiết kế và nhân bản giọng.", feats: ["tts"] },
  { k: "audio", label: "Âm thanh", desc: "Tiếng động, nhạc, lọc tạp âm, đổi giọng, căn phụ đề.", feats: ["sfx", "music", "isolate", "changer", "align"] },
  { k: "studio", label: "Lồng tiếng & Studio", desc: "Lồng tiếng video, podcast, sách nói.", feats: ["dub", "podcast", "book"] },
];
/** Công cụ hiện khi gói có ít nhất một tính năng của nó (trang chính luôn hiện). */
export const toolOn = (p: Plan | null, k: SpeechTool) => { const t = TOOLS.find((x) => x.k === k); return !t || !t.feats.length || (!!p?.connected && t.feats.some((f) => p.features[f])); };

// Thẻ âm thanh của Eleven v3/v4 là tiếng Anh (API chỉ hiểu thẻ tiếng Anh); nhãn tiếng Việt nằm ở title.
export const TAGS: [string, string][] = [["[laughs]", "cười"], ["[sighs]", "thở dài"], ["[whispers]", "thì thầm"], ["[excited]", "hào hứng"], ["[hesitates]", "ngập ngừng"], ["[shouts]", "hét lên"], ["[short pause]", "nghỉ ngắn"], ["[sad]", "buồn"], ["[sarcastic]", "mỉa mai"], ["[coughs]", "ho"]];
export const tagsOk = (model: string) => /v3|v4/.test(model);
// Danh mục của thư viện giọng: nhãn tiếng Việt → giá trị use_cases của ElevenLabs.
export const CATEGORIES: [string, string][] = [["Hội thoại", "conversational"], ["Kể chuyện", "narrative_story"], ["Nhân vật", "characters_animation"], ["Mạng xã hội", "social_media"],
  ["Giáo dục", "informative_educational"], ["Quảng cáo", "advertisement"], ["Giải trí", "entertainment_tv"]];
export const GENDERS: [string, string][] = [["Nữ", "female"], ["Nam", "male"], ["Trung tính", "neutral"]];
export const AGES: [string, string][] = [["Trẻ", "young"], ["Trung niên", "middle_aged"], ["Lớn tuổi", "old"]];
export const AGENT_MODELS = [
  { id: "eleven_realtime_v1_max", name: "Eleven Realtime v1 Max", note: "Suy luận trước khi trả lời · tự nhiên nhất", rate: 1 },
  { id: "eleven_realtime_v1_mini", name: "Eleven Realtime v1 Mini", note: "Nhanh và tiết kiệm phút của gói hơn", rate: 1 },
];
export const DUB_LANGS: [string, string][] = [["en", "Tiếng Anh"], ["vi", "Tiếng Việt"], ["ja", "Tiếng Nhật"], ["ko", "Tiếng Hàn"], ["zh", "Tiếng Trung"], ["fr", "Tiếng Pháp"], ["de", "Tiếng Đức"],
  ["es", "Tiếng Tây Ban Nha"], ["th", "Tiếng Thái"], ["id", "Tiếng Indonesia"], ["hi", "Tiếng Hindi"], ["pt", "Tiếng Bồ Đào Nha"]];
