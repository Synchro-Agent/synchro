// 8 phong cách dùng chung với bộ thiết kế của Synchro (app/designpresets.ts): bảng màu, phông tiêu đề, bo góc.
// Nền chỉ dùng chuyển màu CSS (không blur / drop-shadow lớn): Chromium không GPU vẽ hiệu ứng đó rất chậm.
import { stack } from "./fonts";

export type Theme = {
  bg: string; surface: string; text: string; muted: string; accent: string; accent2: string; border: string;
  radius: number; headingFamily: string | null; headingWeight: number; dark: boolean; backdrop: string;
};
const T: Record<string, Theme> = {
  "linear-dark": { bg: "#08090A", surface: "#141518", text: "#F7F8F8", muted: "#8A8F98", accent: "#5E6AD2", accent2: "#26B5CE", border: "rgba(255,255,255,0.08)", radius: 16, headingFamily: null, headingWeight: 700, dark: true,
    backdrop: "radial-gradient(120% 80% at 50% -10%, rgba(94,106,210,0.28) 0%, rgba(8,9,10,0) 60%), #08090A" },
  "apple-bento": { bg: "#F5F5F7", surface: "#FFFFFF", text: "#1D1D1F", muted: "#6E6E73", accent: "#0071E3", accent2: "#BF4800", border: "rgba(0,0,0,0.06)", radius: 28, headingFamily: null, headingWeight: 700, dark: false,
    backdrop: "linear-gradient(180deg, #FBFBFD 0%, #F0F0F3 100%)" },
  "swiss-grid": { bg: "#FFFFFF", surface: "#F2F2F2", text: "#111111", muted: "#555555", accent: "#E30613", accent2: "#111111", border: "#111111", radius: 0, headingFamily: "Inter", headingWeight: 800, dark: false,
    backdrop: "#FFFFFF" },
  "editorial-serif": { bg: "#F6F1E7", surface: "#FFFDF8", text: "#1B1A17", muted: "#6B6458", accent: "#9B2C1F", accent2: "#2F4858", border: "rgba(27,26,23,0.15)", radius: 4, headingFamily: "Playfair Display", headingWeight: 700, dark: false,
    backdrop: "linear-gradient(180deg, #F8F4EC 0%, #EFE7D8 100%)" },
  "mckinsey-exec": { bg: "#FFFFFF", surface: "#F4F6FA", text: "#051C2C", muted: "#5A6B7B", accent: "#2251FF", accent2: "#00A9F4", border: "rgba(5,28,44,0.12)", radius: 6, headingFamily: null, headingWeight: 700, dark: false,
    backdrop: "linear-gradient(180deg, #FFFFFF 0%, #EEF2F8 100%)" },
  "neo-brutalist": { bg: "#FFE14D", surface: "#FFFFFF", text: "#0A0A0A", muted: "#3A3A3A", accent: "#FF4D2E", accent2: "#2E5BFF", border: "#0A0A0A", radius: 12, headingFamily: "Space Grotesk", headingWeight: 700, dark: false,
    backdrop: "#FFE14D" },
  "atmospheric-glass": { bg: "#0B1026", surface: "rgba(255,255,255,0.08)", text: "#F4F6FF", muted: "#A9B1D6", accent: "#8B7CFF", accent2: "#3DD9EB", border: "rgba(255,255,255,0.14)", radius: 24, headingFamily: null, headingWeight: 700, dark: true,
    backdrop: "radial-gradient(70% 60% at 15% 10%, rgba(139,124,255,0.45) 0%, rgba(11,16,38,0) 60%), radial-gradient(60% 60% at 90% 90%, rgba(61,217,235,0.30) 0%, rgba(11,16,38,0) 60%), #0B1026" },
  "quant-terminal": { bg: "#0A0E0A", surface: "#101710", text: "#D7F5D0", muted: "#6F8F6A", accent: "#3DFF7A", accent2: "#FFB000", border: "rgba(61,255,122,0.25)", radius: 2, headingFamily: "JetBrains Mono", headingWeight: 700, dark: true,
    backdrop: "linear-gradient(180deg, #0A0E0A 0%, #0D140D 100%)" },
};

export function themeOf(style: string, accent?: string): Theme {
  const t = T[style] ?? T["linear-dark"];
  return accent ? { ...t, accent } : t;
}
export const headingStack = (t: Theme, font: string) => stack(t.headingFamily ?? font);
/** Các phông cần nạp cho một theme + phông thân. */
export const fontsFor = (t: Theme, font: string) => [font, ...(t.headingFamily ? [t.headingFamily] : [])];
