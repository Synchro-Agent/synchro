// Biểu tượng của tiện ích Synchro, vẽ từ logo Synchro (chữ S trong quỹ đạo kèm ngôi sao, vân mực sần): cùng khung hình với biểu tượng tab
// (ảnh trong app/icon.svg) và cùng logo với public/brand/synchro-logo.png; mực đen ở giao diện sáng, mực sáng #f5f4ef ở giao diện tối như trong app.
// - extension/icons/toolbar-{light,dark}-{16,24,32}.png: biểu tượng trên thanh công cụ, mực đen cho thanh sáng, mực sáng cho thanh tối
//   (background.js đổi theo theme). Cỡ nhỏ lấp bớt vân sần để chữ S không vỡ thành chấm.
// - extension/icons/{16,32,48,128}.png: biểu tượng của tiện ích (trang chrome://extensions, hộp thoại cài): logo đen trên ô trắng bo góc như
//   biểu tượng iPhone (app/apple-icon.png), rõ trên cả trang sáng lẫn tối; 128 chừa lề 16 px theo chuẩn Chrome.
// - extension/logo.png: logo cho cửa sổ tiện ích (dùng làm mặt nạ, tô bằng màu mực của theme).
// - extension/logo-mask.js: logo nhỏ dạng độ phủ (alpha) cho dải "Synchro đang điều khiển tab này" (vẽ bằng canvas trong trang, không cần tải ảnh).
// Chạy lại khi đổi logo: node scripts/ext-icons.mjs
import fs from "node:fs";
import sharp from "sharp";

const svg = fs.readFileSync("app/icon.svg", "utf8");
const FRAMED = Buffer.from(/href="data:image\/png;base64,([^"]+)"/.exec(svg)[1], "base64");
const BRAND = fs.readFileSync("public/brand/synchro-logo.png");
const INK = { light: [0, 0, 0], dark: [245, 244, 239] };

// Độ phủ của logo ở cỡ w×h. clean: tăng tương phản độ phủ để vân sần không thành chấm ở cỡ nhỏ (0 = giữ nguyên vân).
// (sharp chỉ giữ lần extractChannel cuối trong một chuỗi xử lý, nên tách kênh alpha thành một bước riêng.)
async function alpha(src, w, h, clean = 0) {
  const a = await sharp(src).ensureAlpha().extractChannel(3).png().toBuffer();
  const px = await sharp(a).resize(w, h, { kernel: "lanczos3", fit: "fill" }).extractChannel(0).raw().toBuffer();
  if (!clean) return px;
  const lo = 0.15 * clean, span = 1 - 0.5 * clean;
  return Buffer.from(px.map((v) => Math.max(0, Math.min(255, Math.round(((v / 255 - lo) / span) * 255)))));
}
const tint = (a, w, h, [r, g, b]) => {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a[i]; }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
};

// Thanh công cụ.
for (const n of [16, 24, 32]) {
  const a = await alpha(FRAMED, n, n, n <= 24 ? 1 : 0.8);
  for (const t of ["light", "dark"]) fs.writeFileSync(`extension/icons/toolbar-${t}-${n}.png`, await sharp(await tint(a, n, n, INK[t])).png({ compressionLevel: 9 }).toBuffer());
}

// Biểu tượng tiện ích: ô trắng bo góc (viền mảnh để rõ trên trang trắng), logo đen ở giữa.
for (const n of [16, 32, 48, 128]) {
  const pad = n === 128 ? 16 : n === 48 ? 4 : 0, side = n - pad * 2, radius = Math.round(side * 0.22);
  const inner = Math.round(side * (n >= 48 ? 0.84 : 0.92)), off = Math.round((n - inner) / 2);
  const tile = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}"><rect x="${pad + 0.5}" y="${pad + 0.5}" width="${side - 1}" height="${side - 1}" rx="${radius}" fill="#ffffff" stroke="#000" stroke-opacity="${n >= 48 ? 0.1 : 0.16}"/></svg>`);
  const logo = await tint(await alpha(FRAMED, inner, inner, n >= 48 ? 0.35 : 1), inner, inner, INK.light);
  await sharp(tile).composite([{ input: logo, left: off, top: off }]).png({ compressionLevel: 9 }).toFile(`extension/icons/${n}.png`);
}

// Logo cho cửa sổ tiện ích (giữ vân mực, đủ nét cho màn hình độ phân giải cao).
await sharp(BRAND).resize({ height: 96 }).png({ compressionLevel: 9 }).toFile("extension/logo.png");

// Logo cho dải điều khiển: độ phủ cao 36 px (hiện cao 18 px, nét ở màn hình độ phân giải cao), mã base64.
const meta = await sharp(BRAND).metadata();
const H = 36, W = Math.round((meta.width / meta.height) * H);
const mask = await alpha(BRAND, W, H, 0.6);
fs.writeFileSync("extension/logo-mask.js", `// Sinh bởi scripts/ext-icons.mjs từ public/brand/synchro-logo.png: độ phủ (alpha) của logo Synchro ${W}×${H}, mỗi điểm ảnh một byte, mã base64.\n// Dải "Synchro đang điều khiển tab này" vẽ logo bằng canvas từ dữ liệu này nên không phải tải ảnh (trang có CSP chặt vẫn hiện được).\nexport const LOGO = { w: ${W}, h: ${H}, a: "${mask.toString("base64")}" };\n`);

for (const old of ["extension/logo.svg", "extension/logo-dark.svg"]) fs.rmSync(old, { force: true });
console.log("Đã vẽ biểu tượng tiện ích từ logo Synchro vào extension/icons, extension/logo.png, extension/logo-mask.js");
