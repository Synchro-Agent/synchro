// Hằng số của mục Speech (ElevenLabs). Giọng, model, credit và tính năng đều lấy thật từ tài khoản ElevenLabs qua /api/speech;
// tệp này chỉ giữ chữ giao diện: danh sách công cụ, hướng dẫn nhanh cho người mới, mẫu bắt đầu, thẻ cảm xúc, gợi ý.
import type { Feat, Plan } from "../types/speech";

export type SpeechTool = "home" | "tts" | "changer" | "voices" | "create" | "stt" | "dub" | "agent" | "music" | "sfx" | "isolate" | "dict" | "native" | "studio";
export type ToolDef = { k: SpeechTool; label: string; desc: string; feats: Feat[]; color: string };
export const TOOLS: ToolDef[] = [
  { k: "home", label: "Trang chính", desc: "", feats: [], color: "t-blue" },
  { k: "tts", label: "Đọc văn bản", desc: "Biến chữ thành giọng nói tự nhiên, một hoặc nhiều người nói", feats: ["tts", "dialogue"], color: "t-blue" },
  { k: "changer", label: "Đổi giọng", desc: "Bạn nói, AI đổi thành giọng khác mà vẫn giữ cảm xúc", feats: ["changer"], color: "t-violet" },
  { k: "agent", label: "Voice Agent", desc: "Trợ lý trò chuyện hai chiều bằng giọng nói", feats: ["agent"], color: "t-green" },
  { k: "voices", label: "Giọng nói", desc: "Nghe thử, tìm và chọn giọng để dùng", feats: ["tts"], color: "t-pink" },
  { k: "create", label: "Tạo giọng", desc: "Nhân bản giọng của bạn hoặc thiết kế giọng mới", feats: ["design", "ivc", "pvc", "remix"], color: "t-amber" },
  { k: "stt", label: "Chép lời", desc: "Âm thanh, video thành chữ; tách người nói, xuất phụ đề", feats: ["stt", "live", "align"], color: "t-blue" },
  { k: "dub", label: "Lồng tiếng", desc: "Dịch và lồng tiếng video sang ngôn ngữ khác", feats: ["dub"], color: "t-green" },
  { k: "music", label: "Nhạc", desc: "Sáng tác bài hát, nhạc nền từ một câu mô tả", feats: ["music"], color: "t-pink" },
  { k: "sfx", label: "Tiếng động", desc: "Hiệu ứng âm thanh từ mô tả, tới 30 giây", feats: ["sfx"], color: "t-amber" },
  { k: "isolate", label: "Lọc tạp âm", desc: "Tách giọng nói khỏi nhạc nền và tiếng ồn", feats: ["isolate"], color: "t-violet" },
  { k: "dict", label: "Từ điển phát âm", desc: "Dạy AI đọc đúng tên riêng, từ viết tắt", feats: ["dict"], color: "t-blue" },
  { k: "native", label: "Audio Native", desc: "Trình phát đọc bài viết trên website của bạn", feats: ["native"], color: "t-green" },
  { k: "studio", label: "Podcast & Sách nói", desc: "Tài liệu thành podcast, sách thành sách nói", feats: ["podcast", "book"], color: "t-amber" },
];
/** Nhóm công cụ cho trang chính và thanh bên, theo cách ElevenLabs xếp. */
export const GROUPS: { label: string; tools: SpeechTool[] }[] = [
  { label: "Giọng nói", tools: ["tts", "changer", "agent"] },
  { label: "Giọng của bạn", tools: ["voices", "create"] },
  { label: "Chép lời & dịch", tools: ["stt", "dub"] },
  { label: "Nhạc & hiệu ứng", tools: ["music", "sfx"] },
  { label: "Công cụ khác", tools: ["isolate", "dict", "native", "studio"] },
];
export const toolDef = (k: SpeechTool) => TOOLS.find((t) => t.k === k) ?? TOOLS[0];
/** Công cụ đã lưu từ bản trước (audio = âm thanh gộp) hoặc lạ → công cụ hiện có. */
export const normTool = (k: string): SpeechTool => (TOOLS.some((t) => t.k === k) ? (k as SpeechTool) : k === "audio" ? "sfx" : "home");
/** Công cụ hiện khi gói có ít nhất một tính năng của nó (trang chính luôn hiện). */
export const toolOn = (p: Plan | null, k: SpeechTool) => { const t = TOOLS.find((x) => x.k === k); return !t || !t.feats.length || (!!p?.connected && t.feats.some((f) => p.features[f])); };

// ---- hướng dẫn nhanh cho người mới: tính năng là gì, 3 bước, mẹo, chi phí ----
export type Guide = { what: string; steps: [string, string, string]; tips: string[]; cost: string };
export const GUIDES: Record<Exclude<SpeechTool, "home">, Guide> = {
  tts: {
    what: "Gõ hoặc dán văn bản, chọn một giọng, bấm Tạo: AI đọc lên như người thật. Thêm người nói để làm hội thoại; chèn thẻ như [laughs] để nhân vật cười, thì thầm hay hào hứng.",
    steps: ["Nhập văn bản, hoặc bấm một mẫu ở mục “Bắt đầu với”", "Chọn giọng và model trong Cài đặt (mặc định đã ổn)", "Bấm Tạo giọng nói, nghe thử rồi tải về"],
    tips: ["Thẻ cảm xúc viết bằng tiếng Anh trong ngoặc vuông và chỉ chạy với Eleven v3 / v4.", "Dấu chấm, dấu phẩy và xuống dòng giúp giọng ngắt nghỉ tự nhiên hơn.", "Hiệu ứng âm thanh (radio cũ, điện thoại, hội trường…) nằm cuối bảng Cài đặt."],
    cost: "Khoảng 1 credit mỗi ký tự; Flash và Turbo chỉ tốn một nửa",
  },
  changer: {
    what: "Thu âm hoặc tải lên giọng nói của bạn, AI đổi sang giọng khác nhưng giữ nguyên cách bạn nhấn nhá, cảm xúc và nhịp nói. Hợp để lồng tiếng nhân vật hay đổi giọng cho video.",
    steps: ["Thả tệp âm thanh (tối đa 5 phút) hoặc bấm Ghi âm", "Chọn giọng muốn đổi sang trong Cài đặt", "Bấm Đổi giọng, nghe so sánh bản gốc và bản mới"],
    tips: ["Thu ở nơi yên tĩnh, nói rõ ràng để kết quả tốt nhất.", "Bật “Lọc tạp âm nền” nếu bản thu có tiếng ồn.", "Tăng Độ giống nếu muốn nghe giống giọng đích hơn."],
    cost: "Tính theo thời lượng âm thanh",
  },
  agent: {
    what: "Một trợ lý nói chuyện bằng giọng nói: bạn nói, agent nghe, suy nghĩ rồi trả lời bằng giọng AI, tự nhận lượt nói và cho phép ngắt lời. Dùng để thử tổng đài, lễ tân, gia sư ngoại ngữ…",
    steps: ["Chọn một mẫu agent hoặc tự viết Hướng dẫn hệ thống", "Chọn giọng và lời chào đầu", "Bấm Gọi thử rồi nói chuyện qua micro"],
    tips: ["Agent tự nhận ngôn ngữ bạn nói.", "Hướng dẫn càng cụ thể (vai trò, giọng điệu, cần hỏi gì) thì agent càng đúng ý.", "Lời thoại mỗi cuộc gọi được lưu ở tab Lịch sử."],
    cost: "Tính theo phút trò chuyện",
  },
  voices: {
    what: "Nơi chứa mọi giọng bạn dùng được: giọng có sẵn của ElevenLabs và giọng bạn đã nhân bản hoặc thiết kế. Gói trả phí có thêm thư viện cộng đồng hàng nghìn giọng.",
    steps: ["Bấm vào quả cầu để nghe thử giọng", "Lọc theo ngôn ngữ, giới tính, độ tuổi để tìm nhanh", "Bấm “Dùng giọng” để mang sang Đọc văn bản"],
    tips: ["Nghe thử không tốn credit.", "Model đa ngôn ngữ cho mọi giọng đọc được tiếng Việt, kể cả giọng gốc tiếng Anh.", "Bấm Tạo giọng để có giọng của riêng bạn."],
    cost: "Nghe thử miễn phí",
  },
  create: {
    what: "Tạo giọng của riêng bạn theo bốn cách: nhân bản nhanh từ vài phút ghi âm, nhân bản chuyên sâu giống thật nhất, thiết kế giọng từ một câu mô tả, hoặc remix một giọng sẵn có.",
    steps: ["Chọn cách tạo giọng ở các thẻ bên dưới", "Tải mẫu lên, hoặc bấm Ghi âm và đọc to đoạn văn AI đưa ra (thiết kế giọng thì chỉ cần mô tả)", "Lưu lại: giọng mới nằm trong Giọng nói, dùng được ngay"],
    tips: ["Mẫu sạch, một người nói, không nhạc nền cho kết quả tốt nhất.", "Chỉ nhân bản giọng của bạn hoặc giọng bạn được phép dùng.", "Mỗi giọng chiếm một chỗ lưu giọng của gói."],
    cost: "Thiết kế giọng tốn credit theo câu nghe thử; nhân bản không tốn credit",
  },
  stt: {
    what: "Biến âm thanh hoặc video thành chữ với Scribe: 90+ ngôn ngữ, ghi ai nói câu nào, mốc thời gian từng từ, xuất phụ đề SRT. Có chép trực tiếp từ micro và model riêng cho thuật ngữ y khoa.",
    steps: ["Thả tệp, dán liên kết YouTube / TikTok hoặc ghi âm", "Chọn model và tùy chọn trong Cài đặt (để mặc định là được)", "Bấm Chép lời, đặt tên người nói rồi xuất TXT / SRT"],
    tips: ["Thêm Từ khóa (tên riêng, thuật ngữ) để chép đúng chính tả hơn.", "“Căn lời có sẵn” khớp kịch bản bạn đã có với âm thanh để làm phụ đề karaoke.", "Ô “Chỉnh bản chép” cho AI sửa bản chép theo yêu cầu, ví dụ bỏ từ đệm hay viết lại thành biên bản."],
    cost: "Tính theo thời lượng âm thanh",
  },
  dub: {
    what: "Dịch và lồng tiếng video hoặc âm thanh sang ngôn ngữ khác, giữ nguyên giọng và cảm xúc của người nói gốc. Hỗ trợ 30+ ngôn ngữ, tự nhận số người nói.",
    steps: ["Thả video / âm thanh hoặc dán liên kết YouTube, TikTok…", "Chọn ngôn ngữ muốn lồng sang", "Bấm Lồng tiếng: ElevenLabs xử lý vài phút, Synchro tự cập nhật khi xong"],
    tips: ["Thử trước một đoạn ngắn (Tùy chọn nâng cao → Cắt đoạn) để tiết kiệm credit.", "Giữ nhạc nền để video nghe tự nhiên.", "Gói thấp có watermark trên bản lồng tiếng."],
    cost: "Tính theo phút video",
  },
  music: {
    what: "Sáng tác nhạc hoàn chỉnh từ một câu mô tả: có lời hoặc không lời, mọi thể loại, dài tới 5 phút. Còn làm nhạc nền khớp video và tách bài hát thành giọng hát, trống, bass…",
    steps: ["Mô tả bản nhạc: thể loại, tâm trạng, nhạc cụ (bấm gợi ý để thêm nhanh)", "Chọn có lời hay không lời, độ dài", "Bấm Tạo nhạc và chờ khoảng một phút"],
    tips: ["Tự viết lời ở mục Lời bài hát để AI hát đúng lời bạn.", "Nhạc cho video: AI xem video rồi làm nhạc khớp cảnh.", "Tách stem để lấy riêng beat hoặc giọng hát."],
    cost: "Tính theo độ dài bản nhạc",
  },
  sfx: {
    what: "Tạo tiếng động, hiệu ứng âm thanh từ mô tả: tiếng mưa, bước chân, cửa kẽo kẹt, tiếng nổ, âm thanh giao diện… dài tới 30 giây, có thể lặp liền mạch làm âm nền.",
    steps: ["Mô tả âm thanh, hoặc chọn một danh mục để lấy gợi ý", "Chỉnh độ dài, bật Lặp nếu cần âm nền", "Bấm Tạo tiếng động; mỗi lần bấm ra một biến thể mới"],
    tips: ["Mô tả bằng tiếng Anh cho kết quả chính xác nhất (gợi ý có sẵn bản tiếng Anh).", "Tả cả không gian và khoảng cách: “sấm rền xa trong thung lũng”.", "Bám sát mô tả càng cao thì càng ít sáng tạo."],
    cost: "Tính theo độ dài âm thanh",
  },
  isolate: {
    what: "Tách giọng nói ra khỏi nhạc nền, tiếng gió, tiếng xe, tiếng vang phòng… cho bản thu sạch như phòng thu. Dùng cho podcast, phỏng vấn, video quay ngoài trời.",
    steps: ["Thả tệp âm thanh hoặc video, hoặc bấm Ghi âm", "Bấm Lọc tạp âm", "Nghe so sánh Gốc / Đã lọc rồi tải về"],
    tips: ["Kết quả chỉ giữ lại giọng nói; nhạc nền bị bỏ.", "Tệp tải lên tối đa 40 MB.", "Muốn tách nhạc thành từng nhạc cụ, dùng Nhạc → Tách stem."],
    cost: "Tính theo thời lượng âm thanh",
  },
  dict: {
    what: "Dạy AI đọc đúng những từ hay bị đọc sai: tên riêng, thương hiệu, từ viết tắt, thuật ngữ. Mỗi quy tắc nói “gặp từ này thì đọc thế này” và được áp dụng khi Đọc văn bản.",
    steps: ["Bấm Tạo từ điển và đặt tên", "Thêm quy tắc: từ gốc → cách đọc (ví dụ “AI” → “ây ai”)", "Bật từ điển trong Đọc văn bản → Cài đặt → Từ điển phát âm"],
    tips: ["Cách đọc thay thế chạy với mọi model.", "Phiên âm IPA chính xác hơn nhưng chỉ một số model tiếng Anh hỗ trợ.", "Dùng tối đa 3 từ điển cùng lúc."],
    cost: "Miễn phí",
  },
  native: {
    what: "Tạo trình phát nhúng cho website hay blog: người đọc bài bấm nghe được bài viết bằng giọng AI. Bạn dán nội dung bài, Synchro tạo mã nhúng để dán vào trang.",
    steps: ["Dán tiêu đề và nội dung bài viết", "Chọn giọng đọc và màu trình phát", "Bấm Tạo trình phát, sao chép mã nhúng dán vào website"],
    tips: ["Mã nhúng chạy trên mọi trang cho chèn HTML (WordPress, Ghost, Webflow…).", "Bài dài cần vài phút để chuyển thành giọng nói.", "Nghe thử ngay ở đây khi trình phát đã sẵn sàng."],
    cost: "Khoảng 1 credit mỗi ký tự của bài",
  },
  studio: {
    what: "Biến bài báo, tài liệu hay đường link thành podcast hai người dẫn trò chuyện; chuyển cả cuốn sách (EPUB, PDF, DOCX) thành sách nói theo chương.",
    steps: ["Chọn Podcast hoặc Sách nói", "Dán liên kết / văn bản, hoặc tải sách lên; chọn giọng", "Bấm Tạo: ElevenLabs xử lý vài phút, Synchro tự cập nhật"],
    tips: ["Podcast hai người nghe sinh động hơn một người bình luận.", "Ô Hướng nội dung giúp podcast tập trung vào điều bạn quan tâm.", "Chất lượng càng cao tốn càng nhiều credit."],
    cost: "Khoảng 1 credit mỗi ký tự",
  },
};

// ---- Đọc văn bản ----
// Thẻ âm thanh của Eleven v3 / v4 là tiếng Anh (API chỉ hiểu thẻ tiếng Anh); nhãn tiếng Việt để người dùng hiểu. Nhóm như bảng thẻ của ElevenLabs.
export const TAG_GROUPS: { label: string; tags: [string, string][] }[] = [
  { label: "Cảm xúc", tags: [["[excited]", "hào hứng"], ["[happy]", "vui vẻ"], ["[sad]", "buồn"], ["[angry]", "giận dữ"], ["[playful]", "tinh nghịch"], ["[menacing]", "đe dọa"], ["[bored]", "chán nản"], ["[tired]", "mệt mỏi"], ["[weak]", "yếu ớt"], ["[sarcastic]", "mỉa mai"], ["[curious]", "tò mò"]] },
  { label: "Âm thanh phát ra", tags: [["[laughs]", "cười"], ["[chuckles]", "cười khúc khích"], ["[sighs]", "thở dài"], ["[gasps]", "há hốc"], ["[clears throat]", "hắng giọng"], ["[coughs]", "ho"], ["[sniffles]", "sụt sịt"], ["[yawns]", "ngáp"], ["[scoffs]", "khịt mũi"], ["[hums]", "ngân nga"], ["[panting]", "thở hổn hển"], ["[exhales sharply]", "thở hắt"]] },
  { label: "Cách nói", tags: [["[whispers]", "thì thầm"], ["[shouts]", "hét lên"], ["[sings]", "hát"], ["[slowly]", "chậm rãi"], ["[softly]", "nhẹ nhàng"], ["[pause]", "ngừng"], ["[short pause]", "ngừng ngắn"], ["[hesitates]", "ngập ngừng"], ["[voice breaking]", "nghẹn giọng"]] },
  { label: "Nhân vật", tags: [["[sleepy drowsy voice]", "giọng ngái ngủ"], ["[witch voice]", "giọng phù thủy"], ["[drunken voice]", "giọng say"], ["[robotic voice]", "giọng robot"], ["[pirate voice]", "giọng cướp biển"]] },
  { label: "Tiếng động", tags: [["[keyboard typing]", "gõ phím"], ["[knocking on door]", "gõ cửa"], ["[phone ringing]", "điện thoại reo"], ["[bell ringing]", "chuông reo"], ["[dog barking]", "chó sủa"], ["[applause]", "vỗ tay"], ["[crowd cheering]", "đám đông reo hò"], ["[rain falling]", "mưa rơi"], ["[drum roll]", "trống dồn"], ["[heartbeat]", "nhịp tim"], ["[engine starting]", "nổ máy"], ["[echoing]", "vang vọng"]] },
];
export const tagsOk = (model: string) => /v3|v4/.test(model);
export const stripTags = (t: string) => t.replace(/\[[^\]\n]{1,40}\]\s?/g, "");

// ---- ước tính credit ----
// ElevenLabs tính credit theo số ký tự ĐỌC LÊN, không tính thẻ cảm xúc / audio tag ([happy], [whispers]…): model v3/v4
// nhận thẻ nhưng không tính tiền phần trong ngoặc vuông. Ước tính cũ nhân cả độ dài thô (kể cả thẻ) nên lệch nhiều
// (ví dụ 63 → thực tế 25). Đếm đúng phần đọc lên rồi nhân với hệ số giá thật của model (character_cost_multiplier).
export const billableChars = (modelId: string, text: string): number => (tagsOk(modelId) ? stripTags(text) : text).length;
/** Ước tính credit cho một lần đọc văn bản theo bảng giá thật của model đang chọn. */
export const estCredits = (model: { id: string; rate: number } | null | undefined, text: string): number =>
  Math.ceil(billableChars(model?.id ?? "", text) * (model?.rate ?? 1));
// Nhạc tính credit theo thời lượng bản nhạc (không theo câu mô tả). Hệ số dưới đây là ƯỚC TÍNH theo thời lượng để
// người dùng thấy khoảng chi phí trước khi tạo; số thật do ElevenLabs trả trong header sau khi tạo xong mới chính xác.
// Một chỗ duy nhất để chủ máy chủ chỉnh khi ElevenLabs đổi giá.
export const MUSIC_CREDIT_PER_SEC = 100;
export const MUSIC_DEFAULT_SEC = 30;
/** Ước tính credit cho một bản nhạc theo thời lượng (giây). */
export const estMusicCredits = (seconds: number): number => Math.max(0, Math.round(seconds * MUSIC_CREDIT_PER_SEC));
/** Mẫu “Bắt đầu với”: điền sẵn văn bản (có thẻ cảm xúc) để người mới bấm là nghe được ngay. */
export const STARTERS: { label: string; text?: string; lines?: [number, string][] }[] = [
  { label: "Kể một câu chuyện", text: "[softly] Ngày xửa ngày xưa, ở một ngôi làng nhỏ ven sông, có một cô bé tên là Mây. [pause] Sáng nào cô cũng ra bờ sông ngắm những cánh buồm nâu trôi chầm chậm… [excited] Cho đến một hôm, cô nhìn thấy một chiếc thuyền rất lạ!" },
  { label: "Kể chuyện cười", text: "[playful] Bạn có biết vì sao con cá không bao giờ đi học muộn không? [pause] Vì nó lúc nào cũng… bơi đúng giờ! [laughs]" },
  { label: "Ghi âm quảng cáo", text: "[excited] Chỉ trong tuần này! Giảm ngay ba mươi phần trăm cho mọi đơn hàng đầu tiên. [pause] Đặt hàng hôm nay, số lượng có hạn!" },
  { label: "Hội thoại hai người", lines: [[0, "[excited] Ê, cậu nghe tin gì chưa?"], [1, "[curious] Tin gì thế, kể mình nghe với!"], [0, "Synchro vừa có giọng nói AI đó, đọc tiếng Việt hay lắm. [laughs]"], [1, "[gasps] Thật á? Thử ngay thôi!"]] },
  { label: "Nói nhiều ngôn ngữ", text: "Xin chào! Hello! Bonjour! こんにちは! [pause] Một giọng nói, đọc được hàng chục ngôn ngữ." },
  { label: "Cảnh phim kịch tính", text: "[whispers] Đừng cử động… Có ai đó ở ngoài cửa. [knocking on door] [gasps] [shouts] Mở cửa ra! Tôi biết anh đang ở trong đó!" },
  { label: "Nhân vật trò chơi", text: "[menacing] Ngươi nghĩ có thể vượt qua ta sao, lữ khách? [chuckles] Vậy thì hãy chứng minh đi!" },
  { label: "Giới thiệu podcast", text: "Chào mừng các bạn đến với tập mới của podcast Cà Phê Sáng! [pause] Hôm nay chúng ta sẽ trò chuyện về một chủ đề rất thú vị: làm sao để bắt đầu một ngày thật năng lượng." },
  { label: "Hướng dẫn thiền", text: "[softly] [slowly] Hãy nhắm mắt lại… Hít một hơi thật sâu… [pause] rồi thở ra thật chậm. Cảm nhận cơ thể bạn đang dần thả lỏng." },
];
/** Ghi chú tiếng Việt cho model đọc văn bản (ElevenLabs chỉ trả mô tả tiếng Anh). */
export const MODEL_NOTE: Record<string, string> = {
  eleven_v4: "Mới nhất, biểu cảm nhất, hiểu thẻ cảm xúc",
  eleven_v4_turbo: "Biểu cảm, phản hồi nhanh, hợp trò chuyện",
  eleven_v3: "Rất biểu cảm, hiểu thẻ cảm xúc, hội thoại nhiều người",
  eleven_multilingual_v2: "Ổn định, tự nhiên, hợp đọc bài dài",
  eleven_flash_v2_5: "Nhanh nhất, chỉ tốn nửa credit",
  eleven_turbo_v2_5: "Nhanh, nửa credit, chất lượng cân bằng",
  eleven_flash_v2: "Nhanh nhất, chỉ tiếng Anh",
  eleven_turbo_v2: "Nhanh, chỉ tiếng Anh",
  eleven_monolingual_v1: "Model đầu tiên, chỉ tiếng Anh",
  eleven_multilingual_sts_v2: "Đổi giọng đa ngôn ngữ",
  eleven_english_sts_v2: "Đổi giọng tiếng Anh",
};
export const RECOMMENDED = ["eleven_v4", "eleven_v3", "eleven_multilingual_v2"];
// Hiệu ứng âm thanh của ElevenLabs (lọc âm, không gian, tiếng nền, khoảng cách); nhãn tiếng Việt theo ID của danh mục.
export const FX_VI: Record<string, string> = {
  old_radio: "Radio cũ", robot: "Robot", cheap_microphone: "Micro rẻ tiền", phone: "Điện thoại", low_quality_phone: "Điện thoại kém", bright_phone: "Điện thoại trong",
  small_room: "Phòng nhỏ", big_room: "Phòng lớn", hall: "Hội trường", tunnel: "Đường hầm", street: "Đường phố", valley: "Thung lũng", forest: "Rừng",
  call_center: "Tổng đài", cafe: "Quán cà phê", city: "Thành phố", keyboard: "Bàn phím",
};
export const DISTANCES: [string, string, number][] = [["near", "Gần", 0.15], ["medium", "Vừa", 0.5], ["far", "Xa", 0.9]];

// ---- giọng ----
// Danh mục của thư viện giọng: nhãn tiếng Việt → giá trị use_cases của ElevenLabs.
export const CATEGORIES: [string, string][] = [["Hội thoại", "conversational"], ["Kể chuyện", "narrative_story"], ["Nhân vật", "characters_animation"], ["Mạng xã hội", "social_media"],
  ["Giáo dục", "informative_educational"], ["Quảng cáo", "advertisement"], ["Giải trí", "entertainment_tv"]];
export const GENDERS: [string, string][] = [["Nữ", "female"], ["Nam", "male"], ["Trung tính", "neutral"]];
export const AGES: [string, string][] = [["Trẻ", "young"], ["Trung niên", "middle_aged"], ["Lớn tuổi", "old"]];
/** Gợi ý Thiết kế giọng (như các mẫu Evil Ogre, Little Mouse… của ElevenLabs, viết lại cho người Việt). */
export const DESIGN_PRESETS: [string, string][] = [
  ["Yêu tinh độc ác", "Giọng yêu tinh độc ác, khàn đặc, trầm và đáng sợ, nói chậm rãi đầy đe dọa"],
  ["Chú chuột nhỏ", "Giọng chú chuột nhỏ, cao vút, nhanh nhảu, vui nhộn và hơi rụt rè"],
  ["Cô gái miền Tây", "Cô gái miền Tây Nam Bộ ngoài 20 tuổi, giọng ngọt ngào, chân chất, nói nhanh và tươi vui"],
  ["Giọng trailer phim", "Giọng nam trầm, dày, đầy kịch tính, kiểu lồng tiếng trailer phim bom tấn"],
  ["Nữ CEO người Anh", "Nữ giám đốc người Anh khoảng 45 tuổi, giọng London chuẩn mực, tự tin và điềm tĩnh"],
  ["Cướp biển giận dữ", "Thuyền trưởng cướp biển già đang giận dữ, giọng khàn, nói to, đậm chất phiêu lưu"],
  ["Phát thanh viên Hà Nội", "Nam phát thanh viên Hà Nội, giọng rõ ràng, chuẩn mực, hơi nghiêm, nhịp đều"],
  ["Ông kể chuyện miền Trung", "Ông lão miền Trung trầm ấm, kể chuyện cổ tích chậm rãi, đầy tình cảm"],
  ["Cô giáo mầm non", "Cô giáo mầm non trẻ, giọng trong trẻo, dịu dàng, nói chậm và rõ từng chữ"],
];
export const REMIX_IDEAS = ["Trẻ hơn 10 tuổi", "Giọng miền Nam", "Vui tươi hơn", "Thêm chút khàn", "Thì thầm, bí ẩn", "Trầm và chậm hơn"];

// ---- Voice Agent ----
export const AGENT_MODELS = [
  { id: "eleven_realtime_v1_max", name: "Eleven Realtime v1 Max", note: "Suy luận trước khi trả lời · tự nhiên nhất", rate: 1 },
  { id: "eleven_realtime_v1_mini", name: "Eleven Realtime v1 Mini", note: "Nhanh và tiết kiệm phút của gói hơn", rate: 1 },
];
export const AGENT_TEMPLATES: { label: string; name: string; first: string; prompt: string }[] = [
  { label: "Trợ lý chung", name: "Trợ lý Synchro", first: "Xin chào! Mình là trợ lý của Synchro. Mình có thể giúp gì cho bạn hôm nay?", prompt: "Bạn là trợ lý thân thiện của Synchro. Trả lời ngắn gọn, tự nhiên như người thật, hỏi lại khi chưa rõ." },
  { label: "Chăm sóc khách hàng", name: "Trợ lý CSKH", first: "Xin chào, cảm ơn bạn đã liên hệ! Mình có thể giúp gì cho bạn?", prompt: "Bạn là nhân viên chăm sóc khách hàng thân thiện, kiên nhẫn. Lắng nghe vấn đề, hỏi lại thông tin cần thiết (tên, mã đơn hàng), đưa ra hướng giải quyết rõ ràng từng bước. Nếu không chắc, hứa chuyển cho bộ phận phụ trách." },
  { label: "Gia sư tiếng Anh", name: "Gia sư tiếng Anh", first: "Hi! Ready to practice English today? Tell me a little about your day.", prompt: "Bạn là gia sư tiếng Anh vui vẻ cho người Việt. Nói chủ yếu bằng tiếng Anh đơn giản, câu ngắn. Khi người học nói sai, nhẹ nhàng sửa lại và giải thích ngắn bằng tiếng Việt, rồi hỏi tiếp một câu để họ luyện nói." },
  { label: "Lễ tân phòng khám", name: "Lễ tân phòng khám", first: "Phòng khám An Tâm xin nghe! Anh chị muốn đặt lịch khám hay cần hỏi thông tin ạ?", prompt: "Bạn là lễ tân phòng khám lịch sự. Giúp đặt lịch hẹn: hỏi tên, số điện thoại, ngày giờ mong muốn và lý do khám; nhắc lại thông tin để xác nhận. Không tư vấn chẩn đoán y khoa." },
  { label: "Tư vấn bán hàng", name: "Tư vấn viên", first: "Chào bạn! Bạn đang tìm sản phẩm cho nhu cầu gì để mình tư vấn nhé?", prompt: "Bạn là tư vấn viên bán hàng nhiệt tình nhưng không ép mua. Hỏi nhu cầu, ngân sách, gợi ý hai đến ba lựa chọn phù hợp và nói ngắn gọn ưu nhược điểm của từng cái." },
  { label: "Đặt phòng khách sạn", name: "Lễ tân khách sạn", first: "Khách sạn Biển Xanh xin chào! Quý khách muốn đặt phòng cho ngày nào ạ?", prompt: "Bạn là nhân viên đặt phòng khách sạn. Hỏi ngày nhận và trả phòng, số khách, loại phòng; báo giá tham khảo hợp lý và xác nhận lại thông tin đặt phòng." },
  { label: "Bạn đọc sách", name: "Bạn đọc sách", first: "Chào bạn! Hôm nay mình cùng bàn về cuốn sách nào nhỉ?", prompt: "Bạn là người bạn mê sách, trò chuyện về cuốn sách người dùng đang đọc: tóm tắt, đặt câu hỏi gợi mở, chia sẻ cảm nhận. Giọng ấm áp, thong thả." },
];

// ---- Chép lời ----
export const STT_MODELS = [
  { id: "scribe_v2", name: "Scribe v2", note: "Chính xác nhất · tách người nói · 90+ ngôn ngữ" },
  { id: "scribe_v2_turbo", name: "Scribe v2 Turbo", note: "Nhanh hơn, hợp tệp dài" },
  { id: "scribe_v2_medical", name: "Scribe v2 Medical", note: "Thuật ngữ y khoa: thuốc, bệnh, giải phẫu" },
];
export const EDIT_IDEAS = ["Bỏ từ đệm “ừm, à”, giữ nguyên ý", "Viết lại thành biên bản cuộc họp có gạch đầu dòng", "Sửa chính tả và thêm dấu câu cho dễ đọc"];

// ---- Lồng tiếng ----
export const DUB_LANGS: [string, string][] = [["en", "Tiếng Anh"], ["vi", "Tiếng Việt"], ["ja", "Tiếng Nhật"], ["ko", "Tiếng Hàn"], ["zh", "Tiếng Trung"], ["fr", "Tiếng Pháp"], ["de", "Tiếng Đức"],
  ["es", "Tiếng Tây Ban Nha"], ["th", "Tiếng Thái"], ["id", "Tiếng Indonesia"], ["ms", "Tiếng Mã Lai"], ["fil", "Tiếng Philippines"], ["hi", "Tiếng Hindi"], ["ta", "Tiếng Tamil"], ["pt", "Tiếng Bồ Đào Nha"],
  ["it", "Tiếng Ý"], ["ru", "Tiếng Nga"], ["uk", "Tiếng Ukraina"], ["pl", "Tiếng Ba Lan"], ["nl", "Tiếng Hà Lan"], ["tr", "Tiếng Thổ Nhĩ Kỳ"], ["ar", "Tiếng Ả Rập"], ["sv", "Tiếng Thụy Điển"],
  ["da", "Tiếng Đan Mạch"], ["fi", "Tiếng Phần Lan"], ["no", "Tiếng Na Uy"], ["cs", "Tiếng Séc"], ["sk", "Tiếng Slovakia"], ["hu", "Tiếng Hungary"], ["ro", "Tiếng Romania"], ["bg", "Tiếng Bulgaria"],
  ["hr", "Tiếng Croatia"], ["el", "Tiếng Hy Lạp"]];

// ---- Nhạc ----
export const MUSIC_MODELS = [
  { id: "music_v2_5", name: "Music v2.5", note: "Mới nhất · hát rõ lời, phối khí đầy đặn" },
  { id: "music_v2", name: "Music v2", note: "Ổn định, nhiều thể loại" },
  { id: "music_v1", name: "Music v1", note: "Model đầu tiên" },
];
export const MUSIC_CHIPS: { label: string; items: string[] }[] = [
  { label: "Thể loại", items: ["Pop", "Lo-fi", "Ballad", "EDM", "Rock", "Jazz", "Hip hop", "Bolero", "Nhạc phim", "Acoustic"] },
  { label: "Tâm trạng", items: ["vui tươi", "buồn", "thư giãn", "hùng tráng", "lãng mạn", "hồi hộp", "mơ màng"] },
  { label: "Nhạc cụ", items: ["piano", "guitar", "đàn tranh", "sáo trúc", "violin", "synth", "trống", "bass"] },
];
export const MUSIC_EX: [string, string][] = [
  ["Học bài", "Nhạc lo-fi nhẹ nhàng để học bài, piano mộc, tiếng mưa lách tách, nhịp chậm"],
  ["Vlog du lịch", "Nhạc nền vlog du lịch tươi sáng, guitar acoustic và tiếng vỗ tay, cảm giác tự do"],
  ["Sinh nhật", "Bài hát chúc mừng sinh nhật vui nhộn, giọng nữ trẻ hát tiếng Việt, nhịp pop sôi động"],
  ["Quảng cáo", "Nhạc quảng cáo ngắn tươi vui, tiết tấu nhanh, kết thúc bằng hợp âm sáng"],
  ["Nhạc phim", "Nhạc phim hùng tráng, dàn dây và trống lớn, cao trào dần, cảm giác chiến thắng"],
  ["Ballad buồn", "Ballad tiếng Việt buồn, giọng nam ấm, piano và dàn dây, kể về mối tình đầu"],
];

// ---- Tiếng động ----
// Danh mục gợi ý (rút gọn từ thư viện hiệu ứng của ElevenLabs): nhãn tiếng Việt và câu lệnh tiếng Anh cho kết quả chuẩn nhất.
export const SFX_CATS: { label: string; items: [string, string][] }[] = [
  { label: "Thiên nhiên", items: [["Mưa lớn trên mái tôn, sấm xa", "Heavy rain on a tin roof with distant thunder"], ["Gió rít qua rừng thông", "Wind howling through a pine forest"], ["Sóng biển vỗ vào đá", "Ocean waves crashing on rocks"]] },
  { label: "Động vật", items: [["Chó sủa hai tiếng ngoài sân", "A dog barking twice in a backyard"], ["Chim hót lúc bình minh", "Birds chirping at dawn in a jungle"], ["Mèo kêu gừ gừ sát micro", "A cat purring close to the microphone"]] },
  { label: "Phố xá", items: [["Xe máy chạy qua phố đêm", "Motorbikes passing on a busy street at night"], ["Tàu vào ga, phanh rít", "A train arriving at a station, brakes squealing"], ["Còi xe giữa giờ cao điểm", "Car horns honking in rush hour traffic"]] },
  { label: "Trong nhà", items: [["Cửa gỗ cũ kẽo kẹt mở ra", "An old wooden door creaking open slowly"], ["Bước chân trên sàn gỗ", "Footsteps on a wooden floor"], ["Chùm chìa khóa và tiếng mở khóa", "Keys jingling and a lock turning"]] },
  { label: "Đám đông", items: [["Khán đài reo hò khi có bàn thắng", "A stadium crowd cheering after a goal"], ["Vỗ tay lịch sự trong hội trường", "Polite applause in a small hall"], ["Quán cà phê đông người", "Busy café chatter with cups clinking"]] },
  { label: "Hành động", items: [["Tiếng nổ xa, mảnh vỡ rơi", "A distant explosion with debris falling"], ["Kiếm chém và va vào nhau", "Swords slashing and clanging"], ["Kính vỡ trên sàn gạch", "Glass shattering on a tile floor"]] },
  { label: "Viễn tưởng", items: [["Động cơ phi thuyền khởi động", "Spaceship engine humming and powering up"], ["Súng laser bắn ba phát", "Laser blaster firing three shots"], ["Cửa tự động trượt mở", "Futuristic door sliding open with a hiss"]] },
  { label: "Kinh dị", items: [["Tiếng thì thầm vọng hành lang tối", "Creepy whisper echoing in a dark hallway"], ["Nhịp tim nhanh dần", "Heartbeat slowly getting faster"], ["Xích sắt lạch cạch trong ngục", "Chains rattling in a dungeon"]] },
  { label: "Giao diện & game", items: [["Tiếng bấm nút gọn, sáng", "Short bright UI click"], ["Nhặt xu trong game 8-bit", "Coin collected chime in an 8-bit game"], ["Nhạc lên cấp vui tươi", "Cheerful level up fanfare"]] },
  { label: "Con người", items: [["Ngáp thật to", "A person yawning loudly"], ["Gõ bàn phím cơ thật nhanh", "Someone typing fast on a mechanical keyboard"], ["Em bé cười khanh khách", "A baby giggling"]] },
  { label: "Âm nhạc", items: [["Trống dồn kết bằng chũm chọe", "Drum roll ending with a cymbal crash"], ["Đoạn piano ngắn vui tươi", "Short happy piano jingle"], ["Tiếng bùm trầm kiểu điện ảnh", "Deep cinematic boom"]] },
  { label: "Thể thao", items: [["Bóng rổ nảy trong nhà thi đấu", "Basketball bouncing on an indoor court"], ["Đánh bóng tennis qua lại", "Tennis ball rally"], ["Trọng tài thổi còi", "Referee whistle blow"]] },
];
export const SFX_MODELS = [
  { id: "eleven_text_to_sound_v3", name: "Sound Effects v3", note: "Mới nhất · bám mô tả tốt hơn" },
  { id: "eleven_text_to_sound_v2", name: "Sound Effects v2", note: "Model trước" },
];
