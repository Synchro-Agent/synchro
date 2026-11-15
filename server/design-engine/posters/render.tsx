// Dựng poster ở máy chủ bằng Satori (next/og, bản @vercel/og đi kèm Next: không thêm gói nào) → PNG.
// Vì sao có cả đường này cạnh khung .sx-og + PNG 3x của artifact: không cần trình duyệt hay gói tạo ảnh nào (tài khoản miễn phí cũng có), model chỉ điền 5 trường nên
// không tốn token viết HTML và không bao giờ vỡ bố cục, ảnh ra đúng từng điểm ảnh như nhau mỗi lần, và là tệp ảnh thật trong khung chat (tải về, dùng lại trong run_code, slide).
// Phông: Plus Jakarta Sans tĩnh 400/700/800 có đủ dấu tiếng Việt, truyền thẳng vào Satori nên next/og không bao giờ tải phông dự phòng qua mạng (tools/fetch-poster-fonts.sh ghim mã băm).
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { MasterPosterTemplate } from "./master-poster";
import { POSTER_TEMPLATES, type PosterProps, type PosterTemplate } from "./props";

export { POSTER_LIMITS, POSTER_TEMPLATES, posterProps, type PosterProps, type PosterTemplate } from "./props";

const W = 1200, H = 630;

type Font = { name: string; data: Buffer; weight: 400 | 700 | 800; style: "normal" };
let fonts: Font[] | null = null;
function loadFonts(): Font[] {
  if (fonts) return fonts;
  const dir = path.join(process.cwd(), "server", "design-engine", "fonts");
  fonts = ([[400, "PlusJakartaSans-Regular.ttf"], [700, "PlusJakartaSans-Bold.ttf"], [800, "PlusJakartaSans-ExtraBold.ttf"]] as const).map(([weight, f]) => ({ name: "Plus Jakarta Sans", data: fs.readFileSync(path.join(dir, f)), weight, style: "normal" as const }));
  return fonts;
}

/** PNG của mẫu ở scale lần cỡ 1200×630 (3 → 3600×1890): Satori dựng lại chữ dạng vector ở cỡ đích nên nét ở mọi cỡ. */
export async function renderPoster(template: PosterTemplate, props: PosterProps, scale: 1 | 2 | 3 = 3): Promise<Buffer> {
  if (!POSTER_TEMPLATES.includes(template)) throw new Error(`Không có mẫu ${template}`);
  // Satori / resvg dựng đồng bộ trên luồng chính (vài trăm ms ở cỡ 3600×1890): mỗi lúc chỉ dựng một poster, và nhường một vòng sự kiện trước mỗi lần
  // để các lượt chat đang truyền chữ của người khác chỉ khựng tối đa một lần dựng, không bị nhiều lần dựng chồng nhau chặn liền.
  const prev = tail;
  let release!: () => void;
  tail = new Promise<void>((ok) => { release = ok; });
  try {
    await prev;
    await new Promise<void>((ok) => setImmediate(ok));
    return await draw(props, scale);
  } finally { release(); }
}
let tail: Promise<void> = Promise.resolve();
async function draw(props: PosterProps, scale: 1 | 2 | 3): Promise<Buffer> {
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
