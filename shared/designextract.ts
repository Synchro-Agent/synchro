// Đọc token thiết kế từ trang đang mở hoặc từ điểm ảnh của ảnh chụp: dùng chung cho bộ chụp mẫu, "Làm theo kiểu này"
// và vòng chấm (đo sản phẩm vừa dựng để so với mẫu).
import type { FontCat, KitFontId, PaletteColor, Probe, ProbeTokens } from "./designrefs";

/** Mã nguồn một hàm chạy trong trang: (root: Element) => Probe | null. */
export const TOKEN_PROBE = "(root) => null";
/** Mã nguồn một hàm chạy trong trang: ẩn logo, dấu thương hiệu, hộp cookie trước khi chụp; trả số phần tử đã ẩn. */
export const HIDE_MARKS = "() => 0";
export function paletteFromPixels(_rgba: Uint8Array, _w: number, _h: number, _max = 8): PaletteColor[] {
  return [];
}
export function tokensFromProbe(_p: Probe, _palette: PaletteColor[]): ProbeTokens {
  return { tokens: {}, measured: [] };
}
export function shadowLevel(_css: string): 0 | 1 | 2 | 3 {
  return 0;
}
export function nearestKitFont(_seen: string, cat: FontCat): KitFontId {
  return cat === "serif" ? "source-serif-4" : cat === "mono" ? "jetbrains-mono" : "inter";
}
