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
  gender: "Nữ" | "Nam"; age: "Trẻ" | "Trung niên" | "Lớn tuổi"; use: string; uses: number; color: string;
  kind?: "library" | "designed" | "cloned" | "pro";
};
export const VOICES: Voice[] = [
  { id: "demo-lan", name: "Lan", desc: "Ấm áp, kể chuyện", lang: "Tiếng Việt", accent: "Miền Bắc", gender: "Nữ", age: "Trẻ", use: "Kể chuyện", uses: 1_200_000, color: "#e8c9a8" },
  { id: "demo-minh", name: "Minh", desc: "Trầm, đáng tin", lang: "Tiếng Việt", accent: "Miền Bắc", gender: "Nam", age: "Trung niên", use: "Quảng cáo", uses: 842_000, color: "#a9c1e8" },
  { id: "demo-thao", name: "Thảo", desc: "Trẻ trung, vui tươi", lang: "Tiếng Việt", accent: "Miền Nam", gender: "Nữ", age: "Trẻ", use: "Mạng xã hội", uses: 515_000, color: "#d6b8e3" },
  { id: "demo-hung", name: "Hùng", desc: "Phát thanh viên", lang: "Tiếng Việt", accent: "Miền Bắc", gender: "Nam", age: "Trung niên", use: "Tin tức", uses: 398_000, color: "#b9d8c2" },
  { id: "demo-ngoc", name: "Ngọc", desc: "Dịu dàng, tổng đài", lang: "Tiếng Việt", accent: "Miền Nam", gender: "Nữ", age: "Trẻ", use: "Hội thoại", uses: 276_000, color: "#f0d3a1" },
  { id: "demo-bao", name: "Bảo", desc: "Ông kể chuyện", lang: "Tiếng Việt", accent: "Miền Trung", gender: "Nam", age: "Lớn tuổi", use: "Kể chuyện", uses: 121_000, color: "#c9c4ba" },
  { id: "demo-rachel", name: "Rachel", desc: "Calm, narration", lang: "Tiếng Anh", accent: "Mỹ", gender: "Nữ", age: "Trẻ", use: "Kể chuyện", uses: 4_100_000, color: "#cfe0d8" },
  { id: "demo-adam", name: "Adam", desc: "Deep, radio announcer", lang: "Tiếng Anh", accent: "Mỹ", gender: "Nam", age: "Trung niên", use: "Quảng cáo", uses: 1_500_000, color: "#d8d0e8" },
  { id: "demo-yuki", name: "Yuki", desc: "Bright, anime", lang: "Tiếng Nhật", accent: "Tokyo", gender: "Nữ", age: "Trẻ", use: "Nhân vật", uses: 690_000, color: "#f3c9cf" },
  { id: "demo-jiwoo", name: "Jiwoo", desc: "Soft, conversational", lang: "Tiếng Hàn", accent: "Seoul", gender: "Nam", age: "Trẻ", use: "Hội thoại", uses: 233_000, color: "#c8dcef" },
];
export const MY_VOICES: Voice[] = [
  { ...VOICES[0], kind: "library" },
  { id: "demo-vy", name: "Vy", desc: "Quảng cáo mỹ phẩm", lang: "Tiếng Việt", accent: "Miền Nam", gender: "Nữ", age: "Trẻ", use: "Quảng cáo", uses: 0, color: "#e3c3dc", kind: "designed" },
  { id: "demo-tung", name: "Giọng của Tùng", desc: "Nhân bản nhanh · 2 phút mẫu", lang: "Tiếng Việt", accent: "Miền Bắc", gender: "Nam", age: "Trẻ", use: "Cá nhân", uses: 0, color: "#a9c1e8", kind: "cloned" },
  { id: "demo-tung-pro", name: "Tùng (chuyên sâu)", desc: "Huấn luyện từ 42 phút mẫu", lang: "Tiếng Việt", accent: "Miền Bắc", gender: "Nam", age: "Trẻ", use: "Cá nhân", uses: 0, color: "#8fb0de", kind: "pro" },
];
export const KIND_LABEL: Record<NonNullable<Voice["kind"]>, string> = { library: "Thư viện", designed: "Thiết kế", cloned: "Nhân bản nhanh", pro: "Nhân bản chuyên sâu" };

export const TTS_MODELS = [
  { id: "eleven_v4", name: "Eleven v4", note: "Biểu cảm nhất · 90+ ngôn ngữ · có tiếng Việt", rate: 1 },
  { id: "eleven_v4_turbo", name: "Eleven v4 Turbo", note: "Thời gian thực ~100 ms · 90+ ngôn ngữ", rate: 0.5 },
  { id: "eleven_v3", name: "Eleven v3", note: "Biểu cảm · 70+ ngôn ngữ", rate: 1 },
  { id: "eleven_multilingual_v2", name: "Multilingual v2", note: "Ổn định · 29 ngôn ngữ (không có tiếng Việt)", rate: 1 },
  { id: "eleven_flash_v2_5", name: "Flash v2.5", note: "Nhanh nhất ~75 ms · 32 ngôn ngữ, có tiếng Việt", rate: 0.5 },
];
export const TAGS = ["[cười]", "[thở dài]", "[thì thầm]", "[hào hứng]", "[ngập ngừng]", "[hét lên]", "[nghỉ ngắn]", "[buồn]", "[mỉa mai]", "[ho]"];
export const LANGS = ["Tự nhận diện", "Tiếng Việt", "Tiếng Anh", "Tiếng Nhật", "Tiếng Hàn", "Tiếng Trung", "Tiếng Pháp", "Tiếng Đức", "Tiếng Tây Ban Nha", "Tiếng Thái", "Tiếng Indonesia"];
export const FORMATS = ["MP3 44.1 kHz · 128 kbps", "MP3 44.1 kHz · 192 kbps", "WAV 44.1 kHz", "PCM 24 kHz", "Opus 48 kHz", "μ-law 8 kHz (điện thoại)"];
export const DUB_LANGS = ["Tiếng Anh", "Tiếng Nhật", "Tiếng Hàn", "Tiếng Trung", "Tiếng Pháp", "Tiếng Đức", "Tiếng Tây Ban Nha", "Tiếng Thái", "Tiếng Indonesia", "Tiếng Hindi"];

export const fmtUses = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} Tr lượt` : n >= 1000 ? `${Math.round(n / 1000)} N lượt` : `${n} lượt`);
export const fmtNum = (n: number) => n.toLocaleString("vi-VN");

// Thông báo khi bấm tạo âm thanh lúc chưa gắn API (giao diện chạy ở chế độ mẫu).
export const DEMO_NOTE = "Giao diện mẫu: sẽ tạo âm thanh thật khi gắn API ElevenLabs";
