// Dữ liệu dùng cho giao diện Speech (ElevenLabs). Giọng ở đây là dữ liệu mẫu: khi gắn API,
// danh sách lấy trực tiếp từ /v1/shared-voices và /v1/voices của ElevenLabs.

export type SpeechTool = "home" | "tts" | "stt" | "agent" | "voices" | "audio" | "studio";
export const TOOLS: { k: SpeechTool; label: string; desc: string }[] = [
  { k: "home", label: "Trang chính", desc: "" },
  { k: "tts", label: "Đọc văn bản", desc: "Văn bản thành giọng nói, 90+ ngôn ngữ, thẻ cảm xúc." },
  { k: "stt", label: "Chép lời", desc: "Scribe v2: tách 32 người nói, mốc thời gian từng từ." },
  { k: "agent", label: "Voice Agent", desc: "Trò chuyện hai chiều thời gian thực." },
  { k: "voices", label: "Giọng nói", desc: "Nhân bản, thiết kế, remix giọng." },
  { k: "audio", label: "Âm thanh", desc: "Tiếng động, lọc tạp âm, đổi giọng, căn phụ đề." },
  { k: "studio", label: "Lồng tiếng & Studio", desc: "Lồng tiếng, sách nói, podcast, avatar." },
];

export type Voice = {
  id: string; name: string; desc: string; lang: string; accent: string;
  gender: "Nữ" | "Nam" | "Trung tính"; age: "Trẻ" | "Trung niên" | "Lớn tuổi"; use: string; uses: number; color: string;
  hue?: number; more?: number; notice?: string; studio?: boolean;
  kind?: "library" | "designed" | "cloned" | "pro";
};
export const CATEGORIES = ["Hội thoại", "Kể chuyện", "Nhân vật", "Mạng xã hội", "Giáo dục", "Quảng cáo", "Giải trí"];
export const NOTICES = ["30 ngày", "90 ngày", "1 năm", "2 năm", "Không thời hạn"];
const v = (id: string, name: string, desc: string, lang: string, accent: string, gender: Voice["gender"], age: Voice["age"], use: string, uses: number, hue: number, more = 0, notice = "2 năm", studio = false): Voice =>
  ({ id, name, desc, lang, accent, gender, age, use, uses, hue, more, notice, studio, color: `hsl(${hue} 62% 72%)` });
export const VOICES: Voice[] = [
  v("demo-lan", "Lan", "Ấm áp, kể chuyện", "Tiếng Việt", "Miền Bắc", "Nữ", "Trẻ", "Kể chuyện", 1_200_000, 28, 4, "2 năm", true),
  v("demo-minh", "Minh", "Trầm, đáng tin", "Tiếng Việt", "Miền Bắc", "Nam", "Trung niên", "Quảng cáo", 842_000, 215, 2),
  v("demo-thao", "Thảo", "Trẻ trung, vui tươi", "Tiếng Việt", "Miền Nam", "Nữ", "Trẻ", "Mạng xã hội", 515_000, 290, 6),
  v("demo-hung", "Hùng", "Phát thanh viên", "Tiếng Việt", "Miền Bắc", "Nam", "Trung niên", "Giáo dục", 398_000, 150, 0, "1 năm", true),
  v("demo-ngoc", "Ngọc", "Dịu dàng, tổng đài", "Tiếng Việt", "Miền Nam", "Nữ", "Trẻ", "Hội thoại", 276_000, 40, 3),
  v("demo-bao", "Bảo", "Ông kể chuyện", "Tiếng Việt", "Miền Trung", "Nam", "Lớn tuổi", "Kể chuyện", 121_000, 35, 0, "Không thời hạn"),
  v("demo-an", "An", "Trung tính, rõ ràng", "Tiếng Việt", "Miền Nam", "Trung tính", "Trẻ", "Giáo dục", 88_000, 185, 1),
  v("demo-phuc", "Phúc", "Hài hước, nhân vật hoạt hình", "Tiếng Việt", "Miền Nam", "Nam", "Trẻ", "Nhân vật", 64_000, 330, 0, "90 ngày"),
  v("demo-rachel", "Rachel", "Calm, narration", "Tiếng Anh", "Mỹ", "Nữ", "Trẻ", "Kể chuyện", 4_100_000, 160, 12, "2 năm", true),
  v("demo-adam", "Adam", "Deep, radio announcer", "Tiếng Anh", "Mỹ", "Nam", "Trung niên", "Quảng cáo", 1_500_000, 250, 14),
  v("demo-alice", "Alice", "Clear, engaging educator", "Tiếng Anh", "Anh", "Nữ", "Trung niên", "Giáo dục", 932_000, 120, 6),
  v("demo-yuki", "Yuki", "Bright, anime", "Tiếng Nhật", "Tokyo", "Nữ", "Trẻ", "Nhân vật", 690_000, 345, 3),
  v("demo-jiwoo", "Jiwoo", "Soft, conversational", "Tiếng Hàn", "Seoul", "Nam", "Trẻ", "Hội thoại", 233_000, 200, 2, "1 năm"),
  v("demo-mei", "Mei", "Warm storyteller", "Tiếng Trung", "Bắc Kinh", "Nữ", "Trung niên", "Kể chuyện", 410_000, 10, 5),
  v("demo-louis", "Louis", "Élégant, publicité", "Tiếng Pháp", "Paris", "Nam", "Trung niên", "Quảng cáo", 177_000, 230, 4, "30 ngày"),
  v("demo-somchai", "Somchai", "Friendly host", "Tiếng Thái", "Bangkok", "Nam", "Trẻ", "Giải trí", 59_000, 95, 0),
];
export const MY_VOICES: Voice[] = [
  { ...VOICES[0], kind: "library" },
  { ...v("demo-vy", "Vy", "Quảng cáo mỹ phẩm", "Tiếng Việt", "Miền Nam", "Nữ", "Trẻ", "Quảng cáo", 0, 310), kind: "designed" },
  { ...v("demo-tung", "Giọng của Tùng", "Nhân bản nhanh · 2 phút mẫu", "Tiếng Việt", "Miền Bắc", "Nam", "Trẻ", "Cá nhân", 0, 205), kind: "cloned" },
  { ...v("demo-tung-pro", "Tùng (chuyên sâu)", "Huấn luyện từ 42 phút mẫu", "Tiếng Việt", "Miền Bắc", "Nam", "Trẻ", "Cá nhân", 0, 225), kind: "pro" },
];
export const KIND_LABEL: Record<NonNullable<Voice["kind"]>, string> = { library: "Thư viện", designed: "Thiết kế", cloned: "Nhân bản nhanh", pro: "Nhân bản chuyên sâu" };

export const TTS_MODELS = [
  { id: "eleven_v4", name: "Eleven v4", note: "Biểu cảm nhất · 90+ ngôn ngữ · có tiếng Việt", rate: 1 },
  { id: "eleven_v4_turbo", name: "Eleven v4 Turbo", note: "Thời gian thực ~100 ms · 90+ ngôn ngữ", rate: 0.5 },
  { id: "eleven_v3", name: "Eleven v3", note: "Biểu cảm · 70+ ngôn ngữ", rate: 1 },
  { id: "eleven_multilingual_v2", name: "Multilingual v2", note: "Ổn định · 29 ngôn ngữ (không có tiếng Việt)", rate: 1 },
  { id: "eleven_flash_v2_5", name: "Flash v2.5", note: "Nhanh nhất ~75 ms · 32 ngôn ngữ, có tiếng Việt", rate: 0.5 },
];
// Thẻ âm thanh của Eleven v3/v4 là tiếng Anh (API chỉ hiểu thẻ tiếng Anh); nhãn tiếng Việt nằm ở title.
// Model của Voice Agent: chỉ dùng model ElevenLabs (Eleven Realtime).
export const AGENT_MODELS = [
  { id: "eleven_realtime_v1_max", name: "Eleven Realtime v1 Max", note: "Suy luận trước khi trả lời · gọi công cụ nhiều bước · ~0,57 s", rate: 1 },
  { id: "eleven_realtime_v1_mini", name: "Eleven Realtime v1 Mini", note: "Nhanh và rẻ nhất · hợp hội thoại tự nhiên · ~0,62 s", rate: 1 },
];
export const TAGS: [string, string][] = [["[laughs]", "cười"], ["[sighs]", "thở dài"], ["[whispers]", "thì thầm"], ["[excited]", "hào hứng"], ["[hesitates]", "ngập ngừng"], ["[shouts]", "hét lên"], ["[short pause]", "nghỉ ngắn"], ["[sad]", "buồn"], ["[sarcastic]", "mỉa mai"], ["[coughs]", "ho"]];
export const LANGS = ["Tự nhận diện", "Tiếng Việt", "Tiếng Anh", "Tiếng Nhật", "Tiếng Hàn", "Tiếng Trung", "Tiếng Pháp", "Tiếng Đức", "Tiếng Tây Ban Nha", "Tiếng Thái", "Tiếng Indonesia"];
export const FORMATS = ["MP3 44.1 kHz · 128 kbps", "MP3 44.1 kHz · 192 kbps", "WAV 44.1 kHz", "PCM 24 kHz", "Opus 48 kHz", "μ-law 8 kHz (điện thoại)"];
export const DUB_LANGS = ["Tiếng Anh", "Tiếng Nhật", "Tiếng Hàn", "Tiếng Trung", "Tiếng Pháp", "Tiếng Đức", "Tiếng Tây Ban Nha", "Tiếng Thái", "Tiếng Indonesia", "Tiếng Hindi"];

export const fmtUses = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} Tr lượt` : n >= 1000 ? `${Math.round(n / 1000)} N lượt` : `${n} lượt`);
export const fmtNum = (n: number) => n.toLocaleString("vi-VN");

// Thông báo khi bấm tạo âm thanh lúc chưa gắn API (giao diện chạy ở chế độ mẫu).
export const DEMO_NOTE = "Giao diện mẫu: sẽ tạo âm thanh thật khi gắn API ElevenLabs";
