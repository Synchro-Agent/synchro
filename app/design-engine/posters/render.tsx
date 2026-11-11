// Dựng poster ở máy chủ bằng Satori (next/og, bản @vercel/og đi kèm Next: không thêm gói nào) → PNG.
// Vì sao có cả đường này cạnh khung .sx-og + PNG 3x của artifact: không cần trình duyệt hay gói tạo ảnh nào (tài khoản miễn phí cũng có), model chỉ điền 5 trường nên
// không tốn token viết HTML và không bao giờ vỡ bố cục, ảnh ra đúng từng điểm ảnh như nhau mỗi lần, và là tệp ảnh thật trong khung chat (tải về, dùng lại trong run_code, slide).
// Phông: Plus Jakarta Sans tĩnh 400/700/800 có đủ dấu tiếng Việt, truyền thẳng vào Satori nên next/og không bao giờ tải phông dự phòng qua mạng (scripts/fetch-poster-fonts.sh ghim mã băm).
import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { MasterPosterTemplate } from "./master-poster";

export const POSTER_TEMPLATES = ["poster-master-og"] as const;
export type PosterTemplate = (typeof POSTER_TEMPLATES)[number];
export type PosterProps = { tag: string; title: string; metricValue: string; metricLabel: string; author: string };
const W = 1200, H = 630;
/** Độ dài tối đa mỗi trường: quá thì chữ tràn khỏi khung 1200×630 của mẫu. */
export const POSTER_LIMITS: Record<keyof PosterProps, number> = { tag: 32, title: 90, metricValue: 12, metricLabel: 40, author: 40 };

type Font = { name: string; data: Buffer; weight: 400 | 700 | 800; style: "normal" };
let fonts: Font[] | null = null;
function loadFonts(): Font[] {
  if (fonts) return fonts;
  const dir = path.join(process.cwd(), "app", "design-engine", "fonts");
  fonts = ([[400, "Regular"], [700, "Bold"], [800, "ExtraBold"]] as const).map(([weight, n]) => ({ name: "Plus Jakarta Sans", data: fs.readFileSync(path.join(dir, `PlusJakartaSans-${n}.ttf`)), weight, style: "normal" as const }));
  return fonts;
}

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

/** PNG của mẫu ở scale lần cỡ 1200×630 (3 → 3600×1890): Satori dựng lại chữ dạng vector ở cỡ đích nên nét ở mọi cỡ. */
export async function renderPoster(template: PosterTemplate, props: PosterProps, scale: 1 | 2 | 3 = 3): Promise<Buffer> {
  if (!POSTER_TEMPLATES.includes(template)) throw new Error(`Không có mẫu ${template}`);
  const s = scale;
  const res = new ImageResponse(
    <div style={{ display: "flex", width: W * s, height: H * s }}>
      <div style={{ display: "flex", width: W, height: H, transform: `scale(${s})`, transformOrigin: "top left" }}>
        <MasterPosterTemplate {...props} />
      </div>
    </div>,
    { width: W * s, height: H * s, fonts: loadFonts() },
  );
  return Buffer.from(await res.arrayBuffer());
}
