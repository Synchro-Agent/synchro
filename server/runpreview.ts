// Ảnh gửi lại cho model xem sau mỗi lần run_code. Mỗi kết quả công cụ chỉ kèm được một ảnh qua mọi cầu nối, nên nhiều ảnh được ghép thành một tấm:
// quy tắc tự kiểm tra bảo trích nhiều khung / nhiều trang, trước đây model chỉ thấy ảnh đầu và trang 2 tràn chữ, cảnh cuối hỏng đều lọt.

// Số ảnh tối đa model được xem lại sau mỗi lần chạy.
import "server-only";
export const PREVIEW_MAX = 12;
const isPic = (p: string) => /\.(png|jpe?g|webp)$/i.test(p);
const LONG = 1600, SHEET = 1800, GAP = 8;
const jpeg = (s: import("sharp").Sharp) => s.flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer();

export type Preview = { image: string; shown: string[]; rest: string[] };

/** Ảnh trong outputs/_preview/ trước, rồi ảnh khác; bỏ qua ảnh hỏng. shown: đúng thứ tự trong tấm ghép (trái sang phải, trên xuống dưới). */
export async function previewOf(files: { path: string; data: Buffer }[]): Promise<Preview | undefined> {
  const pics = [...files.filter((f) => f.path.startsWith("_preview/")), ...files.filter((f) => !f.path.startsWith("_preview/"))].filter((f) => isPic(f.path));
  if (!pics.length) return undefined;
  const sharp = await import("sharp").then((m) => m.default, () => null);
  if (!sharp) return undefined;
  const good: { path: string; data: Buffer; w: number; h: number }[] = [];
  const rest: string[] = [];
  for (const f of pics) {
    if (good.length >= PREVIEW_MAX) { rest.push(f.path); continue; }
    const m = await sharp(f.data).metadata().catch(() => null);
    if (m?.width && m.height) good.push({ ...f, w: m.width, h: m.height });
  }
  try {
    if (good.length === 1) {
      const image = await jpeg(sharp(good[0].data).resize({ width: LONG, height: LONG, fit: "inside", withoutEnlargement: true }));
      return { image: image.toString("base64"), shown: [good[0].path], rest };
    }
    if (!good.length) return undefined;
    const n = good.length, cols = n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols);
    const cw = Math.floor((SHEET - GAP * (cols - 1)) / cols);
    // Ô cao theo ảnh cao nhất (trang dọc, video dọc), không để cả tấm dài quá: model nhận ảnh bị thu lại theo cạnh dài.
    const ratio = Math.min(Math.max(...good.map((g) => g.h / g.w)), 1.8), ch = Math.min(Math.round(cw * ratio), Math.floor((SHEET * 1.2 - GAP * (rows - 1)) / rows));
    const parts = await Promise.all(good.map(async (g, i) => {
      const input = await sharp(g.data).resize({ width: cw, height: ch, fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).png().toBuffer();
      return { input, left: (i % cols) * (cw + GAP), top: Math.floor(i / cols) * (ch + GAP) };
    }));
    // Số thứ tự ở góc mỗi ô để đối chiếu với danh sách tên trong <preview>.
    const tags = good.map((_, i) => {
      const x = (i % cols) * (cw + GAP), y = Math.floor(i / cols) * (ch + GAP);
      return `<rect x="${x}" y="${y}" width="44" height="30" fill="#000" opacity=".75"/><text x="${x + 22}" y="${y + 22}" font-family="sans-serif" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">${i + 1}</text>`;
    }).join("");
    const W = cols * cw + GAP * (cols - 1), H = rows * ch + GAP * (rows - 1);
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${tags}</svg>`);
    const sheet = await jpeg(sharp({ create: { width: W, height: H, channels: 3, background: "#888888" } }).composite([...parts, { input: label, left: 0, top: 0 }]));
    return { image: sheet.toString("base64"), shown: good.map((g) => g.path), rest };
  } catch { return undefined; }
}

/** Bản mới của cùng đường dẫn trong cùng lượt thay bản cũ tại chỗ (giữ thứ tự thẻ tệp), xóa bản cũ khỏi kho. by: đường dẫn → id đã giao trong lượt. */
export function mergeOuts<T extends { id: string }>(outs: T[], by: Map<string, string>, paths: string[], saved: T[], remove: (id: string) => void) {
  saved.forEach((o, i) => {
    const old = by.get(paths[i]), at = old ? outs.findIndex((f) => f.id === old) : -1;
    if (old) remove(old);
    if (at >= 0) outs[at] = o; else outs.push(o);
    by.set(paths[i], o.id);
  });
}

/** Thẻ <preview> trong kết quả công cụ: nói đúng những ảnh model thực sự được xem. */
export function previewNote(p: Preview | undefined): string {
  if (!p) return "";
  const list = p.shown.length === 1 ? `Ảnh ${p.shown[0]} đi kèm để bạn tự xem.` : `Tấm ảnh đi kèm ghép ${p.shown.length} ảnh, đánh số từ trái sang phải, trên xuống dưới: ${p.shown.map((s, i) => `${i + 1}. ${s}`).join("; ")}.`;
  return `\n<preview>${list}${p.rest.length ? ` Chưa xem ${p.rest.length} ảnh (mỗi lần tối đa ${PREVIEW_MAX}): ${p.rest.slice(0, 20).join(", ")}${p.rest.length > 20 ? "…" : ""}. Cần xem thì ghi các ảnh đó vào outputs/_preview/ ở lần chạy sau.` : ""}</preview>`;
}
