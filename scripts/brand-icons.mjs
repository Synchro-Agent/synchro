// Mọi biểu tượng của Synchro, vẽ từ một nguồn là logo gốc public/brand/synchro-logo.png (chữ S trong quỹ đạo kèm ngôi sao, vân mực sần):
// - app/icon.svg: biểu tượng tab (favicon), mực đen; trình duyệt / hệ điều hành dùng giao diện tối thì chuyển sang màu sáng.
// - app/apple-icon.png: biểu tượng khi thêm vào màn hình chính iPhone / iPad (nền trắng, iOS tự bo góc).
// - extension/icons/toolbar-{light,dark}-{16,24,32}.png: biểu tượng tiện ích trên thanh công cụ, mực đen cho thanh sáng, mực sáng cho thanh tối
//   (background.js đổi theo theme). Cỡ nhỏ lấp bớt vân sần để chữ S không vỡ thành chấm.
// - extension/icons/{16,32,48,128}.png: biểu tượng của tiện ích (trang chrome://extensions, hộp thoại cài): logo đen trên ô trắng bo góc,
//   rõ trên cả trang sáng lẫn tối; 128 là ô 96 px chừa lề trong suốt 16 px theo chuẩn Chrome Web Store.
// - extension/logo.png: logo cho cửa sổ tiện ích (dùng làm mặt nạ, tô bằng màu mực của theme).
// - extension/logo-mask.js: logo nhỏ dạng độ phủ (alpha) cho dải "Synchro đang điều khiển tab này" (vẽ bằng canvas trong trang, không cần tải ảnh).
// Căn giữa theo thị giác: logo lệch khối (đuôi quỹ đạo dài về dưới trái, ngôi sao mảnh ở trên phải) nên đặt trọng tâm độ phủ mực vào giữa khung
// chứ không đặt giữa hộp bao, và không bao giờ cắt phần nào của logo ra ngoài khung. Ghép ở độ phân giải gấp 8 rồi thu nhỏ nên vị trí chính xác
// tới 1/8 điểm ảnh ở cỡ cuối.
// Chạy lại khi đổi logo: node scripts/brand-icons.mjs
import fs from "node:fs";
import sharp from "sharp";

const BRAND = fs.readFileSync("public/brand/synchro-logo.png");
const INK = { light: [0, 0, 0], dark: [245, 244, 239] };
const SS = 8;

// Hộp bao và trọng tâm độ phủ mực của logo gốc.
const { data: A0, info } = await sharp(BRAND).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0, sx = 0, sy = 0, sw = 0;
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  const v = A0[y * info.width + x];
  if (v <= 8) continue;
  x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  sx += (x + 0.5) * v; sy += (y + 0.5) * v; sw += v;
}
const BOX = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
const CX = (sx / sw - x0) / BOX.width, CY = (sy / sw - y0) / BOX.height;
const CROPPED = await sharp(BRAND).extract(BOX).png().toBuffer();

/** Vị trí logo rộng w trong khung (fx, fy, fw, fh): trọng tâm vào giữa khung, giữ cả logo trong khung. */
function place(fx, fy, fw, fh, w) {
  const h = (w * BOX.height) / BOX.width;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  return { w, h, left: clamp(fx + fw / 2 - CX * w, fx, fx + fw - w), top: clamp(fy + fh / 2 - CY * h, fy, fy + fh - h) };
}
/** Ảnh N×N (độ phân giải gấp SS) có logo màu ink ở vị trí p, kèm các lớp nền phía dưới. */
async function compose(N, p, ink, under = []) {
  const w = Math.round(p.w), h = Math.round(p.h);
  const logo = await sharp(CROPPED).resize(w, h, { kernel: "lanczos3", fit: "fill" }).ensureAlpha().extractChannel(3).raw().toBuffer();
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = ink[0]; rgba[i * 4 + 1] = ink[1]; rgba[i * 4 + 2] = ink[2]; rgba[i * 4 + 3] = logo[i]; }
  return sharp({ create: { width: N, height: N, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([...under, { input: rgba, raw: { width: w, height: h, channels: 4 }, left: Math.round(p.left), top: Math.round(p.top) }]).png().toBuffer();
}
/** Thu nhỏ về n×n. clean: tăng tương phản độ phủ để vân sần không thành chấm ở cỡ nhỏ (0 = giữ nguyên vân). */
async function shrink(big, n, clean = 0) {
  const { data, info: i } = await sharp(big).resize(n, n, { kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (clean) {
    const lo = 0.15 * clean, span = 1 - 0.5 * clean;
    for (let k = 3; k < data.length; k += 4) data[k] = Math.max(0, Math.min(255, Math.round(((data[k] / 255 - lo) / span) * 255)));
  }
  return sharp(data, { raw: { width: i.width, height: i.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}
// Logo không nền: rộng frac bề ngang khung (chừa lề hai bên cho phần căn theo thị giác).
const bare = (n, ink, frac, clean) => { const N = n * SS; return compose(N, place(0, 0, N, N, N * frac), ink).then((b) => shrink(b, n, clean)); };

// Biểu tượng tab: logo rộng 98% khung, không cắt đuôi hay ngôi sao.
const fav = await bare(256, INK.light, 0.98);
fs.writeFileSync("app/icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256">
  <!-- Sinh bởi scripts/brand-icons.mjs. Logo Synchro: chữ S trong quỹ đạo kèm ngôi sao, vân mực sần, rộng 98% khung, trọng tâm mực nằm giữa khung,
       không cắt phần nào. Màu đen trên nền sáng; trình duyệt / hệ điều hành dùng giao diện tối thì chuyển sang màu sáng. -->
  <style>@media (prefers-color-scheme: dark) { image { filter: invert(1) brightness(.98); } }</style>
  <image width="256" height="256" href="data:image/png;base64,${fav.toString("base64")}"/>
</svg>
`);

// Màn hình chính iPhone / iPad: nền trắng kín (iOS tự bo góc), logo rộng 76% như lề của biểu tượng ứng dụng.
{
  const n = 180, N = n * SS;
  const big = await compose(N, place(0, 0, N, N, N * 0.76), INK.light);
  await sharp(await sharp(big).resize(n, n, { kernel: "lanczos3" }).png().toBuffer()).flatten({ background: "#ffffff" }).png({ compressionLevel: 9 }).toFile("app/apple-icon.png");
}

// Thanh công cụ của trình duyệt.
for (const n of [16, 24, 32]) for (const t of ["light", "dark"]) fs.writeFileSync(`extension/icons/toolbar-${t}-${n}.png`, await bare(n, INK[t], 0.98, n <= 24 ? 1 : 0.8));

// Biểu tượng tiện ích: ô trắng bo góc (viền mảnh để rõ trên trang trắng), logo đen giữa ô theo thị giác.
for (const n of [16, 32, 48, 128]) {
  const N = n * SS, pad = (n === 128 ? 16 : n === 48 ? 4 : 0) * SS, side = N - pad * 2, r = side * 0.22;
  const frac = n >= 128 ? 0.84 : n >= 48 ? 0.86 : n >= 32 ? 0.88 : 0.92, inset = (side * (1 - frac)) / 2;
  const tile = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}"><rect x="${pad + SS / 2}" y="${pad + SS / 2}" width="${side - SS}" height="${side - SS}" rx="${r}" fill="#ffffff" stroke="#000" stroke-width="${SS}" stroke-opacity="${n >= 48 ? 0.1 : 0.16}"/></svg>`);
  const big = await compose(N, place(pad + inset, pad + inset, side - inset * 2, side - inset * 2, side * frac), INK.light, [{ input: tile, left: 0, top: 0 }]);
  fs.writeFileSync(`extension/icons/${n}.png`, await shrink(big, n, n >= 48 ? 0.35 : 1));
}

// Logo cho cửa sổ tiện ích (giữ vân mực, đủ nét cho màn hình độ phân giải cao).
await sharp(BRAND).resize({ height: 96 }).png({ compressionLevel: 9 }).toFile("extension/logo.png");

// Logo cho dải điều khiển: độ phủ cao 36 px (hiện cao 18 px, nét ở màn hình độ phân giải cao), mã base64.
{
  const H = 36, W = Math.round((info.width / info.height) * H), clean = 0.6;
  const px = await sharp(await sharp(BRAND).ensureAlpha().extractChannel(3).png().toBuffer()).resize(W, H, { kernel: "lanczos3", fit: "fill" }).extractChannel(0).raw().toBuffer();
  const lo = 0.15 * clean, span = 1 - 0.5 * clean;
  const mask = Buffer.from(px.map((v) => Math.max(0, Math.min(255, Math.round(((v / 255 - lo) / span) * 255)))));
  fs.writeFileSync("extension/logo-mask.js", `// Sinh bởi scripts/brand-icons.mjs từ public/brand/synchro-logo.png: độ phủ (alpha) của logo Synchro ${W}×${H}, mỗi điểm ảnh một byte, mã base64.\n// Dải "Synchro đang điều khiển tab này" vẽ logo bằng canvas từ dữ liệu này nên không phải tải ảnh (trang có CSP chặt vẫn hiện được).\nexport const LOGO = { w: ${W}, h: ${H}, a: "${mask.toString("base64")}" };\n`);
}
console.log(`Đã vẽ biểu tượng Synchro từ logo gốc (trọng tâm mực ${(CX * 100).toFixed(1)}% × ${(CY * 100).toFixed(1)}% hộp bao) vào app/icon.svg, app/apple-icon.png, extension/icons, extension/logo.png, extension/logo-mask.js`);
