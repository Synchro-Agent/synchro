// 8 phong cách có sẵn của bộ thiết kế, ở dạng dữ liệu: bộ CSS trong khung artifact (artkit.ts) và khối quy tắc gửi model (designkit.ts) cùng đọc.
// Tên trung tính, tả cách trông: không mượn tên công ty, không bắt chước thương hiệu nào.
// Mọi cặp chữ / nền đạt WCAG 4.5:1 (tests/api/designkit.test.mjs kiểm từng cặp): bảng màu của cẩm nang gốc có vài cặp chỉ 3:1 (chữ phụ xám nhạt, nhãn cam trên nền giấy).
export type PresetColors = { bg: string; surface: string; raised: string; ink: string; muted: string; accent: string; accent2: string; line: string; neutral: string; pos: string; neg: string };
export type Preset = PresetColors & {
  id: string;
  label: string; // tả cho model, ngắn
  dark?: PresetColors; // bảng tối khi trang đặt data-sx-theme="auto"; phong cách vốn tối thì không cần
  bw: number; r: number; ri: number; // viền, bo ngoài, bo trong (px ở thang 1280)
  shadow: string; blur: number;
  head: string; body: string; mono: string; // tên phông, phải có trong FONT_SPEC
};

// Phông có đủ dấu tiếng Việt, đã đo trên chính tệp phông (bảng cmap) và dựng thử trong Chrome: tests/ui/design-kit.mjs.
// Không có DM Mono của cẩm nang gốc: bản Google Fonts không có bộ tiếng Việt (ư, ơ, ệ, ẫ rơi về phông khác).
export const FONT_SPEC: Record<string, { css: string; stack: string }> = {
  "Be Vietnam Pro": { css: "Be+Vietnam+Pro:wght@400;500;600;700", stack: `"Be Vietnam Pro","Noto Sans",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif` },
  Inter: { css: "Inter:wght@400;500;600;700;800", stack: `"Inter","Noto Sans",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif` },
  "Plus Jakarta Sans": { css: "Plus+Jakarta+Sans:wght@500;600;700;800", stack: `"Plus Jakarta Sans","Noto Sans",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif` },
  "Playfair Display": { css: "Playfair+Display:wght@500;600;700;800", stack: `"Playfair Display","Noto Serif",Georgia,"Times New Roman",serif` },
  "Space Grotesk": { css: "Space+Grotesk:wght@500;600;700", stack: `"Space Grotesk","Noto Sans",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif` },
  "JetBrains Mono": { css: "JetBrains+Mono:wght@500;600", stack: `"JetBrains Mono","Noto Sans Mono",ui-monospace,Menlo,Consolas,monospace` },
};

const POS = "#0F7B4F", NEG = "#B42318", POS_D = "#34D399", NEG_D = "#FB7185";
export const PRESETS: Preset[] = [
  { id: "swiss-grid", label: "Lưới Thụy Sĩ: nền giấy xám, chữ đen, một nhấn đỏ cam, không bo góc",
    bg: "#F4F4F0", surface: "#FFFFFF", raised: "#EBEBE6", ink: "#0F172A", muted: "#475569", accent: "#BF3100", accent2: "#0F172A", line: "#CBD5E1", neutral: "#94A3B8", pos: POS, neg: NEG,
    dark: { bg: "#121212", surface: "#1B1B1B", raised: "#262626", ink: "#F4F4F0", muted: "#A8A8A0", accent: "#FF6A3D", accent2: "#F4F4F0", line: "#3A3A3A", neutral: "#5C5C5C", pos: POS_D, neg: NEG_D },
    bw: 1, r: 0, ri: 0, shadow: "none", blur: 0, head: "Inter", body: "Inter", mono: "JetBrains Mono" },
  { id: "midnight-tech", label: "Công nghệ nền tối: đen sâu, viền mảnh sáng, nhấn chàm",
    bg: "#08090E", surface: "#12141C", raised: "#1B1E29", ink: "#F8FAFC", muted: "#A3AEBF", accent: "#818CF8", accent2: "#38BDF8", line: "#262A36", neutral: "#475569", pos: POS_D, neg: NEG_D,
    bw: 1, r: 16, ri: 8, shadow: "0 20px 40px -15px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.12)", blur: 16, head: "Plus Jakarta Sans", body: "Inter", mono: "JetBrains Mono" },
  { id: "soft-bento", label: "Ô bento mềm: nền xám rất nhạt, thẻ trắng bo lớn, nhấn xanh dương",
    bg: "#F5F5F7", surface: "#FFFFFF", raised: "#FAFAFC", ink: "#1D1D1F", muted: "#5F5F66", accent: "#0066CC", accent2: "#0F7B4F", line: "#E4E4E9", neutral: "#B6B6BE", pos: POS, neg: NEG,
    dark: { bg: "#111113", surface: "#1C1C1F", raised: "#26262A", ink: "#F5F5F7", muted: "#A8A8B0", accent: "#4DA3FF", accent2: "#34D399", line: "#34343A", neutral: "#5A5A62", pos: POS_D, neg: NEG_D },
    bw: 1, r: 24, ri: 12, shadow: "0 4px 12px rgba(0,0,0,.03),0 16px 32px -8px rgba(0,0,0,.05)", blur: 20, head: "Plus Jakarta Sans", body: "Inter", mono: "JetBrains Mono" },
  { id: "editorial-serif", label: "Tạp chí: giấy ấm, chữ than, tiêu đề có chân, nhấn nâu đồng",
    bg: "#FAF7F2", surface: "#FFFFFF", raised: "#F3EFE6", ink: "#1C1917", muted: "#6B645E", accent: "#9A3412", accent2: "#44403C", line: "#E7E5E4", neutral: "#BDB6AD", pos: POS, neg: NEG,
    dark: { bg: "#17140F", surface: "#211D17", raised: "#2B261F", ink: "#F5F0E8", muted: "#B5AC9F", accent: "#F0936A", accent2: "#D6CFC4", line: "#3A342B", neutral: "#6B6358", pos: POS_D, neg: NEG_D },
    bw: 1, r: 2, ri: 0, shadow: "0 2px 8px rgba(28,25,23,.04)", blur: 0, head: "Playfair Display", body: "Be Vietnam Pro", mono: "JetBrains Mono" },
  { id: "exec-navy", label: "Điều hành: nền trắng, chữ navy, nhấn xanh coban, gọn và nhiều số",
    bg: "#FFFFFF", surface: "#F8FAFC", raised: "#F1F5F9", ink: "#0A192F", muted: "#475569", accent: "#0052CC", accent2: "#0369A1", line: "#E2E8F0", neutral: "#CBD5E1", pos: POS, neg: NEG,
    dark: { bg: "#0B1220", surface: "#131C2E", raised: "#1B263B", ink: "#F1F5F9", muted: "#A6B3C6", accent: "#6EA8FE", accent2: "#38BDF8", line: "#2A3650", neutral: "#475569", pos: POS_D, neg: NEG_D },
    bw: 1, r: 4, ri: 2, shadow: "0 1px 3px rgba(10,25,47,.05)", blur: 0, head: "Plus Jakarta Sans", body: "Inter", mono: "JetBrains Mono" },
  { id: "neo-brutalist", label: "Tân thô mộc: nền kem, viền đen dày, bóng cứng, nhấn tím và cam",
    bg: "#FFFDF5", surface: "#FFFFFF", raised: "#FEF08A", ink: "#000000", muted: "#27272A", accent: "#6D28D9", accent2: "#C2410C", line: "#000000", neutral: "#A1A1AA", pos: POS, neg: NEG,
    dark: { bg: "#141414", surface: "#1E1E1E", raised: "#3A3200", ink: "#FFFDF5", muted: "#D4D4D8", accent: "#C4B5FD", accent2: "#FB923C", line: "#FFFDF5", neutral: "#71717A", pos: POS_D, neg: NEG_D },
    bw: 2, r: 8, ri: 4, shadow: "5px 5px 0 0 var(--sx-line)", blur: 0, head: "Space Grotesk", body: "Be Vietnam Pro", mono: "JetBrains Mono" },
  { id: "aurora-glass", label: "Kính mờ trên nền cực quang: trắng trong, chàm, nhấn hồng, hợp bìa và sự kiện",
    bg: "#EEF2FF", surface: "#FFFFFF", raised: "#F7F8FF", ink: "#1E1B4B", muted: "#4338CA", accent: "#4F46E5", accent2: "#BE185D", line: "#D9DDF7", neutral: "#B4BAE8", pos: POS, neg: NEG,
    dark: { bg: "#0D0B24", surface: "#17143A", raised: "#211D4D", ink: "#EEF2FF", muted: "#B9B8EC", accent: "#A5B4FC", accent2: "#F9A8D4", line: "#332E6B", neutral: "#5552A0", pos: POS_D, neg: NEG_D },
    bw: 1, r: 20, ri: 12, shadow: "0 12px 32px -4px rgba(79,70,229,.1),inset 0 1px 0 rgba(255,255,255,.9)", blur: 24, head: "Plus Jakarta Sans", body: "Inter", mono: "JetBrains Mono" },
  { id: "data-terminal", label: "Bảng số dày: nền than, chữ sáng, số đơn cách, nhấn xanh lục",
    bg: "#0B0E14", surface: "#111622", raised: "#1A2130", ink: "#E2E8F0", muted: "#9AA8BC", accent: "#34D399", accent2: "#F59E0B", line: "#1E293B", neutral: "#475569", pos: POS_D, neg: NEG_D,
    bw: 1, r: 4, ri: 2, shadow: "none", blur: 0, head: "Inter", body: "Inter", mono: "JetBrains Mono" },
];
export const DEFAULT_PRESET = "swiss-grid";
export const presetOf = (id: string) => PRESETS.find((p) => p.id === id);
