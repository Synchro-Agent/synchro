// Biểu tượng của tiện ích Synchro, vẽ từ logo Synchro (app/icon.svg), mỗi theme một bản:
// - extension/logo.svg, logo-dark.svg: logo cho giao diện sáng / tối (cửa sổ tiện ích, dải "Synchro đang điều khiển");
// - extension/icons/{16,32,48,128}.png: biểu tượng của tiện ích (trang chrome://extensions, hộp thoại cài, thông báo), chừa lề theo chuẩn Chrome (128: hình 96 px);
// - extension/icons/toolbar-{light,dark}-{16,24,32}.png: biểu tượng trên thanh công cụ, tối ưu cho thanh sáng / tối (background.js đổi theo theme).
// Chạy lại khi đổi logo: node scripts/ext-icons.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = fs.readFileSync("app/icon.svg", "utf8");
const SHAPE = /<path d="(M99\.9[^"]+)"/.exec(SRC)[1];
const SPARK = /<path d="(M97\.5[^"]+)"/.exec(SRC)[1];

// Logo theo theme. dark: màu sáng hơn và viền sáng mờ để tách khỏi nền tối; light: tia sáng ở góc tô xanh đậm để không chìm vào nền sáng.
// small (16–32 px): nét dày thêm để phần giữa ngôi sao không vỡ thành từng mảnh, tia sáng to hơn.
// mid: bản dùng chung cho nền sáng lẫn tối (biểu tượng nhỏ ở trang tiện ích, menu chuột phải), không quá nhạt cũng không quá tối.
function logo({ dark = false, mid = false, rim = 0, small = false, box = "-2 -4 108 108" } = {}) {
  const stops = dark
    ? [["0", "#C8F2FF"], ["0.22", "#80BBFF"], ["0.52", "#5F82FF"], ["0.8", "#7D6CFF"], ["1", "#A57CFF"]]
    : mid ? [["0", "#5CC0FF"], ["0.22", "#4796FF"], ["0.52", "#4A6BFF"], ["0.8", "#6253F5"], ["1", "#8457F0"]]
    : [["0", small ? "#62BEFF" : "#9BE2FF"], ["0.22", "#3D8EFF"], ["0.52", "#2C55FF"], ["0.8", "#3A2BE0"], ["1", "#5A1FC8"]];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">
  <defs>
    <linearGradient id="c" x1="0.08" y1="0.12" x2="0.92" y2="0.9">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>
    <linearGradient id="i" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FF7BD5" stop-opacity="${dark ? 0.4 : 0.55}"/><stop offset="0.32" stop-color="#FF7BD5" stop-opacity="0"/><stop offset="0.7" stop-color="#7BF2FF" stop-opacity="0"/><stop offset="1" stop-color="#7BF2FF" stop-opacity="0.45"/></linearGradient>
    <linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="0.4" stop-color="#fff" stop-opacity="0.15"/><stop offset="1" stop-color="#E6DDFF" stop-opacity="0.7"/></linearGradient>
  </defs>
  ${rim ? `<path d="${SHAPE}" fill="none" stroke="#fff" stroke-opacity="${dark ? 0.3 : 0.9}" stroke-width="${rim}" stroke-linejoin="round"/>` : ""}
  ${small ? `<path d="${SHAPE}" fill="none" stroke="url(#c)" stroke-width="3.6" stroke-linejoin="round"/>` : ""}
  <path d="${SHAPE}" fill="url(#c)"/>
  <path d="${SHAPE}" fill="url(#i)"/>
  ${small ? "" : `<path d="${SHAPE}" fill="none" stroke="url(#r)" stroke-width="1.6" stroke-linejoin="round"/>`}
  <path d="${SPARK}" transform="${small ? "translate(97.5 17.6) scale(1.45) translate(-97.5 -17.6)" : ""}" fill="${dark || !small ? "#fff" : "#2C55FF"}" stroke="${dark ? "#9DB8FF" : small ? "#fff" : "#5B8CFF"}" stroke-width="${small ? 1.4 : 0.9}" stroke-linejoin="round" paint-order="stroke"/>
</svg>`;
}

const out = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const png = (svg, n, file) => sharp(Buffer.from(svg), { density: Math.max(72, Math.ceil((n / 108) * 72 * 4)) }).resize(n, n, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(file);

out("extension/logo.svg", logo());
out("extension/logo-dark.svg", logo({ dark: true }));
// Biểu tượng tiện ích: 48 / 128 chừa lề theo chuẩn Chrome (hình 96/128 ở giữa); 16 / 32 (đầu trang chi tiết, menu) lấp kín ô.
// 48 / 128 có viền trắng mỏng (không thấy trên nền sáng, tách logo khỏi nền tối); 16 / 32 dùng bản màu "mid" đọc được trên cả hai nền.
const padded = (n) => { const art = n >= 48 ? 0.75 : 1, side = 108 / art, o = (side - 108) / 2; return `${-2 - o} ${-4 - o} ${side} ${side}`; };
for (const n of [16, 32, 48, 128]) await png(n >= 48 ? logo({ rim: 3.2, box: padded(n) }) : logo({ mid: true, small: true, box: padded(n) }), n, `extension/icons/${n}.png`);
// Thanh công cụ: lấp gần kín ô, nét gọn cho cỡ nhỏ.
for (const n of [16, 24, 32]) {
  await png(logo({ small: true }), n, `extension/icons/toolbar-light-${n}.png`);
  await png(logo({ dark: true, small: true, rim: 6 }), n, `extension/icons/toolbar-dark-${n}.png`);
}
console.log("Đã vẽ biểu tượng tiện ích vào extension/icons, extension/logo.svg, extension/logo-dark.svg");
