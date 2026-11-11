// Hợp đồng props (JSON) của 4 mẫu video. Model chỉ điền props theo các schema này; mã bố cục nằm cố định trong src/.
// Tệp .mjs (zod thuần) để cả bundle Remotion lẫn CLI synchro-video (Node, không biên dịch) dùng chung một nguồn:
// CLI kiểm tra props và in JSON Schema (z.toJSONSchema), composition kiểm tra lại trong calculateMetadata.
import { z } from "zod";

export const TEMPLATE_IDS = ["tiktok", "next-tailwind", "audiogram", "github-unwrapped"];
export const STYLES = ["linear-dark", "apple-bento", "swiss-grid", "editorial-serif", "mckinsey-exec", "neo-brutalist", "atmospheric-glass", "quant-terminal"];
export const FONTS = ["Be Vietnam Pro", "Inter", "Plus Jakarta Sans", "Space Grotesk", "Playfair Display", "JetBrains Mono"];
export const SIZES = { vertical: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] };

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Màu dạng #RRGGBB");
// Đường dẫn tương đối trong thư mục làm việc (inputs/anh.png, giong.mp3). CLI đổi thành địa chỉ máy chủ tệp nội bộ trước khi dựng.
const file = z.string().min(1).max(300).describe("Đường dẫn tương đối tới tệp trong thư mục làm việc, vd. inputs/anh.jpg");
const seconds = (min, max, def) => z.number().min(min).max(max).default(def);

export const captionSchema = z.object({
  text: z.string(),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  timestampMs: z.number().nullable().default(null),
  confidence: z.number().nullable().default(null),
});
// "auto": nhận dạng giọng nói bằng whisper.cpp (không cần mạng); đường dẫn .json (Caption[]) hoặc .srt; hay mảng Caption.
const captions = z.union([z.literal("auto"), z.literal("none"), file, z.array(captionSchema).max(5000)]);

const common = {
  fps: z.union([z.literal(30), z.literal(60)]).default(60).describe("Số khung hình mỗi giây (mặc định 60)"),
  size: z.union([z.enum(["vertical", "square", "landscape"]), z.string().regex(/^\d{3,4}x\d{3,4}$/)]).optional()
    .describe("vertical 1080x1920, square 1080x1080, landscape 1920x1080, hoặc RỘNGxCAO (số chẵn)"),
  font: z.enum(FONTS).default("Be Vietnam Pro"),
  accent: color.optional().describe("Màu nhấn, ghi đè màu của style"),
  music: z.object({ src: file, volumeDb: z.number().min(-40).max(0).default(-18) }).optional().describe("Nhạc nền, mặc định thấp hơn giọng 18 dB"),
  // Do synchro-video tự điền (thời lượng đo bằng ffprobe), model không cần ghi.
  durationSec: z.number().min(0.5).max(900).optional(),
};

// ---------------------------------------------------------------- tiktok
export const tiktokSchema = z.object({
  ...common,
  style: z.enum(STYLES).default("neo-brutalist"),
  video: file.optional().describe("Video nền (giữ tiếng gốc, phủ kín khung)"),
  images: z.array(file).max(40).optional().describe("Ảnh nền khi không có video: Ken Burns, mỗi ảnh imageSeconds giây"),
  imageSeconds: seconds(1, 20, 3),
  audio: file.optional().describe("Giọng đọc / âm thanh chính"),
  captions: captions.default("auto"),
  language: z.string().regex(/^[a-z]{2}$/).default("vi"),
  caption: z.object({
    highlightColor: color.default("#39E508"),
    textColor: color.default("#FFFFFF"),
    weight: z.union([z.literal(700), z.literal(800), z.literal(900)]).default(900),
    uppercase: z.boolean().default(true),
    position: z.enum(["bottom", "center"]).default("bottom"),
    switchEveryMs: z.number().int().min(200).max(4000).default(1200).describe("Gom từ trong khoảng này thành một trang chữ (200 = từng chữ)"),
    maxFontSize: z.number().int().min(40).max(200).default(120),
  }).prefault({}),
  hook: z.object({ text: z.string().min(1).max(80), seconds: seconds(1, 6, 2.5) }).optional().describe("Câu mở đầu lớn ở giữa màn hình"),
  background: color.optional().describe("Màu nền khi không có video / ảnh"),
});

// ---------------------------------------------------------------- next-tailwind (video giới thiệu sản phẩm)
export const ICONS = ["spark", "bolt", "shield", "chart", "globe", "clock", "users", "check", "lock", "rocket", "star", "heart", "code", "cloud", "chat", "layers"];
const sceneBase = { seconds: z.number().min(1.5).max(12).optional() };
export const promoSceneSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("logo-reveal"), ...sceneBase, tagline: z.string().max(90).optional() }),
  z.object({ type: z.literal("headline"), ...sceneBase, eyebrow: z.string().max(40).optional(), title: z.string().min(1).max(90), body: z.string().max(220).optional() }),
  z.object({ type: z.literal("feature-grid"), ...sceneBase, title: z.string().max(80).optional(),
    items: z.array(z.object({ icon: z.enum(ICONS).default("spark"), title: z.string().min(1).max(40), text: z.string().max(120).optional() })).min(2).max(6) }),
  z.object({ type: z.literal("screenshot"), ...sceneBase, image: file, title: z.string().max(80).optional(), caption: z.string().max(140).optional() }),
  z.object({ type: z.literal("stat"), ...sceneBase, value: z.number(), decimals: z.number().int().min(0).max(3).default(0),
    prefix: z.string().max(6).optional(), suffix: z.string().max(10).optional(), label: z.string().min(1).max(90) }),
  z.object({ type: z.literal("quote"), ...sceneBase, text: z.string().min(1).max(240), author: z.string().min(1).max(60), role: z.string().max(80).optional() }),
  z.object({ type: z.literal("cta"), ...sceneBase, title: z.string().min(1).max(80), button: z.string().min(1).max(30), url: z.string().max(80).optional() }),
]);
export const promoSchema = z.object({
  ...common,
  style: z.enum(STYLES).default("linear-dark"),
  brand: z.object({ name: z.string().min(1).max(40), logo: file.optional(), tagline: z.string().max(90).optional() }),
  scenes: z.array(promoSceneSchema).min(1).max(14),
  transition: z.enum(["fade", "slide", "wipe", "none"]).default("fade"),
  transitionSeconds: z.number().min(0.2).max(1.5).default(0.6),
  voiceover: file.optional(),
  captions: captions.default("none").describe("Phụ đề dưới đáy cho giọng đọc (mặc định không có)"),
  language: z.string().regex(/^[a-z]{2}$/).default("vi"),
});

// ---------------------------------------------------------------- audiogram
const baseVisualizer = { color: color.default("#F4B941"), numberOfSamples: z.enum(["32", "64", "128", "256", "512"]).default("64") };
export const visualizerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("spectrum"), ...baseVisualizer, linesToDisplay: z.number().int().min(0).default(65), freqRangeStartIndex: z.number().int().min(0).default(0), mirrorWave: z.boolean().default(true) }),
  z.object({ type: z.literal("oscilloscope"), ...baseVisualizer, windowInSeconds: z.number().min(0.1).default(0.1), posterization: z.number().int().min(1).default(3),
    amplitude: z.number().int().min(1).default(4), padding: z.number().int().min(0).default(50) }),
]);
export const audiogramSchema = z.object({
  ...common,
  style: z.enum(STYLES).default("atmospheric-glass"),
  audio: file.describe("Tệp âm thanh (mp3, wav, m4a…)"),
  clip: z.object({ startSec: z.number().min(0), endSec: z.number().min(0.5) }).optional().describe("Chỉ lấy một đoạn của tệp âm thanh"),
  title: z.string().min(1).max(110),
  show: z.string().max(60).optional().describe("Tên chương trình / podcast"),
  cover: file.optional(),
  captions: captions.default("auto"),
  language: z.string().regex(/^[a-z]{2}$/).default("vi"),
  visualizer: visualizerSchema.prefault({ type: "oscilloscope" }),
  titleColor: color.optional(),
  captionsTextColor: color.optional(),
  onlyDisplayCurrentSentence: z.boolean().default(true),
});

// ---------------------------------------------------------------- github-unwrapped (tổng kết số liệu năm)
const label = z.string().min(1).max(60);
export const recapSceneSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("opening"), ...sceneBase, title: z.string().max(60).optional(), subtitle: z.string().max(90).optional() }),
  z.object({ type: z.literal("top-list"), ...sceneBase, title: label, items: z.array(z.object({ label: z.string().min(1).max(30), value: z.number(), unit: z.string().max(12).optional() })).min(1).max(3) }),
  z.object({ type: z.literal("counter"), ...sceneBase, label, value: z.number().int().min(0).max(99999999), unit: z.string().max(20).optional(), note: z.string().max(90).optional() }),
  z.object({ type: z.literal("heatmap"), ...sceneBase, label, values: z.array(z.number().min(0)).min(7).max(371), total: z.number().optional(), unit: z.string().max(20).optional() }),
  z.object({ type: z.literal("by-hour"), ...sceneBase, label, values: z.array(z.number().min(0)).length(24) }),
  z.object({ type: z.literal("by-weekday"), ...sceneBase, label, values: z.array(z.number().min(0)).length(7),
    dayNames: z.array(z.string().min(1).max(4)).length(7).default(["T2", "T3", "T4", "T5", "T6", "T7", "CN"]) }),
  z.object({ type: z.literal("compare"), ...sceneBase, title: label, items: z.array(z.object({ label: z.string().min(1).max(30), value: z.number().min(0) })).length(2) }),
  z.object({ type: z.literal("end"), ...sceneBase, title: z.string().min(1).max(60), cta: z.string().max(60).optional() }),
]);
export const recapSchema = z.object({
  ...common,
  style: z.enum(STYLES).default("linear-dark"),
  title: z.string().min(1).max(60),
  subject: z.string().max(40).optional().describe("Người / nhóm / sản phẩm được tổng kết"),
  year: z.number().int().min(1900).max(2200).optional(),
  theme: z.enum(["blue", "red", "gold", "purple", "green"]).default("blue"),
  scenes: z.array(recapSceneSchema).min(1).max(12),
});

export const SCHEMAS = { tiktok: tiktokSchema, "next-tailwind": promoSchema, audiogram: audiogramSchema, "github-unwrapped": recapSchema };
// Kích thước mặc định của từng mẫu (giữ đúng mẫu gốc: tiktok dọc, next-tailwind ngang, audiogram và github-unwrapped vuông).
export const DEFAULT_SIZE = { tiktok: "vertical", "next-tailwind": "landscape", audiogram: "square", "github-unwrapped": "square" };
export const PURPOSE = {
  tiktok: "Video ngắn TikTok / Reels / Shorts: phụ đề nhảy theo từng chữ của giọng nói, trên video, ảnh Ken Burns hoặc nền màu",
  "next-tailwind": "Video giới thiệu / quảng cáo sản phẩm SaaS, công nghệ: chuỗi cảnh logo, tiêu đề, lưới tính năng, ảnh chụp màn hình, số liệu, trích dẫn, kêu gọi hành động",
  audiogram: "Audiogram podcast / âm thanh: sóng âm (oscilloscope hoặc spectrum), bìa, tiêu đề, phụ đề chạy theo lời",
  "github-unwrapped": "Video tổng kết số liệu năm (kiểu GitHub Unwrapped): mở đầu, top 3 hành tinh, bộ đếm 7 đoạn, lưới đóng góp, biểu đồ theo giờ / thứ, so sánh, cảnh kết",
};

// Thời lượng mặc định của từng loại cảnh (giây).
export const SCENE_SECONDS = { "logo-reveal": 3, headline: 4, "feature-grid": 5, screenshot: 5, stat: 4, quote: 5, cta: 4,
  opening: 3.5, "top-list": 5, counter: 4, heatmap: 5.5, "by-hour": 5, "by-weekday": 4.5, compare: 4.5, end: 4 };
export const sceneSeconds = (s) => s.seconds ?? SCENE_SECONDS[s.type] ?? 4;

export function sizeOf(id, size) {
  const s = size ?? DEFAULT_SIZE[id];
  if (SIZES[s]) return { width: SIZES[s][0], height: SIZES[s][1] };
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(s));
  if (!m) throw new Error(`Kích thước không hợp lệ: ${s}`);
  const w = Number(m[1]), h = Number(m[2]);
  if (w % 2 || h % 2 || w < 240 || h < 240 || w > 3840 || h > 3840) throw new Error(`Kích thước ${s}: cạnh phải là số chẵn từ 240 đến 3840`);
  return { width: w, height: h };
}

/** Thời lượng (giây) khi props không có tệp để đo: tổng cảnh trừ phần chồng của chuyển cảnh. */
export function plannedSeconds(id, p) {
  if (id === "next-tailwind") {
    const t = p.transition === "none" ? 0 : p.transitionSeconds ?? 0.6;
    return p.scenes.reduce((a, s) => a + sceneSeconds(s), 0) - t * Math.max(0, p.scenes.length - 1);
  }
  if (id === "github-unwrapped") return p.scenes.reduce((a, s) => a + sceneSeconds(s), 0);
  return null;
}
