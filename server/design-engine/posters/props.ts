// Phần thuần của mẫu poster (không JSX, không next/og): tên mẫu, trường, giới hạn độ dài và hàm kiểm tra trường. Lượt chat (chatengine.ts) nhập tệp này
// trực tiếp và chỉ nạp render.tsx (Satori) khi thật sự dựng poster, nên các kiểm thử không cần máy chủ vẫn nạp được chatengine.ts.
import "server-only";
export const POSTER_TEMPLATES = ["poster-master-og"] as const;
export type PosterTemplate = (typeof POSTER_TEMPLATES)[number];
export type PosterProps = { tag: string; title: string; metricValue: string; metricLabel: string; author: string };
/** Độ dài tối đa mỗi trường: quá thì chữ tràn khỏi khung 1200×630 của mẫu. */
export const POSTER_LIMITS: Record<keyof PosterProps, number> = { tag: 32, title: 90, metricValue: 12, metricLabel: 40, author: 40 };

/** Kiểm tra và làm sạch trường do model / người dùng điền; trả về chuỗi lỗi nếu thiếu hay quá dài. */
export function posterProps(input: unknown): PosterProps | string {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const pick = (k: keyof PosterProps, ...alt: string[]) => [k, ...alt].map((x) => o[x]).find((v) => typeof v === "string" || typeof v === "number");
  const out = {} as PosterProps;
  for (const [k, alt] of [["tag", []], ["title", []], ["metricValue", ["metric_value"]], ["metricLabel", ["metric_label"]], ["author", []]] as [keyof PosterProps, string[]][]) {
    const v = String(pick(k, ...alt) ?? "").replace(/\s+/g, " ").trim();
    if (!v) return `Thiếu trường ${k} của poster.`;
    if (v.length > POSTER_LIMITS[k]) return `Trường ${k} dài ${v.length} ký tự, tối đa ${POSTER_LIMITS[k]} để chữ không tràn khung 1200×630.`;
    out[k] = v;
  }
  return out;
}
