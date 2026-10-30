// Biểu tượng của tiện ích Synchro, vẽ từ hình học của bộ nhận diện v4 "Lệch pha" (public/brand/*.svg; cùng số đo với app/brand.tsx):
// hai nửa đĩa bán kính R = 350 lệch nhau R, mark cao 3R, khe R/6 — cỡ ≤ 32 px dùng khe R/4 cho khỏi dính.
// - extension/icons/toolbar-{light,dark}-{16,24,32}.png: biểu tượng trên thanh công cụ, Carbon cho thanh sáng, Ivory cho thanh tối
//   (background.js đổi theo theme).
// - extension/icons/{16,32,48,128}.png: biểu tượng của tiện ích (chrome://extensions, hộp thoại cài): app icon Carbon với mark Ivory
//   cao 54% khung như bộ nhận diện; 128 là ô 96 px chừa lề trong suốt 16 px theo chuẩn Chrome Web Store.
// - extension/logo.png: lockup ngang (mark + chữ) cho cửa sổ tiện ích, dùng làm mặt nạ tô bằng màu mực của theme.
// - extension/logo-mask.js: mark dạng độ phủ (alpha) cho dải "Synchro đang điều khiển tab này" (vẽ bằng canvas, không tải ảnh).
// Favicon, app icon, ảnh chia sẻ của web lấy thẳng từ bộ file nhận diện (app/icon.svg, app/favicon.ico, app/apple-icon.png, public/icon-*.png,
// app/opengraph-image.png). Chạy lại khi đổi logo: node scripts/brand-icons.mjs
import fs from "node:fs";
import sharp from "sharp";

const CARBON = "#111210", IVORY = "#EEECE5";
/** Hai nửa đĩa quanh tâm (cx, cy), bán kính r, nửa khe g. */
const halves = (cx, cy, r, g) => `M${cx - g} ${cy - 1.5 * r}A${r} ${r} 0 0 0 ${cx - g} ${cy + 0.5 * r}ZM${cx + g} ${cy - 0.5 * r}A${r} ${r} 0 0 1 ${cx + g} ${cy + 1.5 * r}Z`;
/** SVG n×n: mark cao h (px) giữa khung, màu ink; small: khe R/4. bg: ô nền bo góc (tuỳ chọn). */
function markSvg(n, h, ink, { small = false, bg = null, pad = 0, rx = 0 } = {}) {
  const r = h / 3, g = small ? r / 8 : r / 12;
  const tile = bg ? `<rect x="${pad}" y="${pad}" width="${n - 2 * pad}" height="${n - 2 * pad}" rx="${rx}" fill="${bg}"/>` : "";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 ${n} ${n}">${tile}<path fill="${ink}" d="${halves(n / 2, n / 2, r, g)}"/></svg>`);
}
const png = (svg, n) => sharp(svg, { density: 72 * 4 }).resize(n, n, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();

// Thanh công cụ: mark cao ~88% khung.
for (const n of [16, 24, 32]) for (const [t, ink] of [["light", CARBON], ["dark", IVORY]]) {
  fs.writeFileSync(`extension/icons/toolbar-${t}-${n}.png`, await png(markSvg(n, n * 0.88, ink, { small: true }), n));
}
// Biểu tượng tiện ích: app icon Carbon bo góc, mark Ivory cao 54% ô (cỡ nhỏ cao hơn cho rõ).
for (const n of [16, 32, 48, 128]) {
  const pad = n === 128 ? 16 : 0, side = n - 2 * pad, frac = n >= 48 ? 0.54 : 0.62;
  fs.writeFileSync(`extension/icons/${n}.png`, await png(markSvg(n, side * frac, IVORY, { small: n <= 32, bg: CARBON, pad, rx: side * 0.225 }), n));
}
// Lockup ngang cho cửa sổ tiện ích (mặt nạ): cao 64 px, nét ở màn hình độ phân giải cao.
{
  const src = fs.readFileSync("public/brand/synchro-logo-carbon.svg", "utf8");
  await sharp(Buffer.from(src), { density: 72 * 4 }).resize({ height: 64 }).png({ compressionLevel: 9 }).toFile("extension/logo.png");
}
// Mark cho dải điều khiển: độ phủ cao 38 px (hiện cao 19 px), mã base64.
{
  const H = 38, W = Math.round((H * 787.5) / 1050);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 787.5 1050"><path fill="#000" d="M350 0A350 350 0 0 0 350 700ZM437.5 350A350 350 0 0 1 437.5 1050Z"/></svg>`);
  const a = await sharp(svg, { density: 72 * 4 }).resize(W, H, { kernel: "lanczos3", fit: "fill" }).ensureAlpha().extractChannel(3).raw().toBuffer();
  fs.writeFileSync("extension/logo-mask.js", `// Sinh bởi scripts/brand-icons.mjs: độ phủ (alpha) của mark Synchro ${W}×${H} (bộ nhận diện v4, khe R/4 cho cỡ nhỏ), mỗi điểm ảnh một byte, mã base64.\n// Dải "Synchro đang điều khiển tab này" vẽ mark bằng canvas từ dữ liệu này nên không phải tải ảnh (trang có CSP chặt vẫn hiện được).\nexport const LOGO = { w: ${W}, h: ${H}, a: "${a.toString("base64")}" };\n`);
}
console.log("Đã vẽ biểu tượng Synchro (bộ nhận diện v4) vào extension/icons, extension/logo.png, extension/logo-mask.js");
