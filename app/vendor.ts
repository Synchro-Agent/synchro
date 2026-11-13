// Hãng của một khóa model ("sub-claude/opus" → anthropic). Tách khỏi router.ts (bộ chọn model của chế độ Tự động, gần 100 KB) để giao diện
// (vòng Mức dùng, trang Mức dùng) chỉ kéo đúng hàm nhỏ này vào phần tải đầu (blueprint B3.1).
import { OPEN_WEIGHT } from "./modelrules";

export type Vendor = "anthropic" | "openai" | "google" | "xai" | "deepseek" | "other";
export function vendorOf(key: string): Vendor {
  const k = key.toLowerCase();
  if (OPEN_WEIGHT.test(k)) return "other";
  if (/^(anthropic|sub-claude)\//.test(k) || /claude|opus|sonnet|haiku|fable/.test(k)) return "anthropic";
  if (/^(openai|sub-codex)\//.test(k) || /\bgpt|\bo\d|chatgpt|codex/.test(k)) return "openai";
  if (/^(google|sub-agy)\//.test(k) || /gemini/.test(k)) return "google";
  if (/^(xai|sub-grok)\//.test(k) || /\bgrok/.test(k)) return "xai";
  if (/^deepseek\//.test(k) || /deepseek/.test(k)) return "deepseek";
  return "other";
}
