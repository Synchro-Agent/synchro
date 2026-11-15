// Hậu tố nhiếp ảnh của FLUX (server/ai/replicate.ts): chủ dự án chốt chỉ nối cho ảnh chụp sản phẩm, không cho logo, tranh minh họa, hình vẽ;
// chuỗi hậu tố phải đúng nguyên văn chủ dự án đưa (mục 6.4 của bản mô tả). Hàm thuần, không cần máy chủ, không gọi Replicate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 600)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-flux-"));
process.env.DATA_DIR = tmp; process.env.DATA_KEY = "flux-test";
const { "ai/replicate": R } = await loadTs(["ai/replicate"]);

// Nguyên văn của chủ dự án (MASTER_IMAGE_GEN_CONFIG.masterStyleSuffix), chép tay ở đây để một lần sửa nhầm trong mã bị bắt.
const OWNER = "editorial commercial photography, shot on Hasselblad H6D-100c, 85mm f/1.4 lens, soft volumetric studio key lighting, subtle rim light, clean minimalist podium background, natural shadows, ultra-detailed texture, 8k resolution, color graded in Capture One";

console.log("1. Chuỗi hậu tố và model");
ok(R.MASTER_IMAGE_GEN_CONFIG.masterStyleSuffix === OWNER, "hậu tố đúng nguyên văn của chủ dự án", R.MASTER_IMAGE_GEN_CONFIG.masterStyleSuffix);
ok(R.MASTER_IMAGE_GEN_CONFIG.textToImageModel === "black-forest-labs/flux-1.1-pro-ultra" && R.MASTER_IMAGE_GEN_CONFIG.productRelightModel === "zsxkib/ic-light", "hai model đúng như chủ dự án chọn");

console.log("2. Ảnh chụp sản phẩm: nối hậu tố");
for (const p of ["chai serum thủy tinh màu hổ phách.", "Lọ nước hoa trên bục đá cẩm thạch", "a ceramic coffee mug with steam, morning light", "hộp quà bánh trung thu, bao bì đỏ vàng"]) {
  const f = R.finalPrompt(p, true);
  ok(f === `${p.trim().replace(/[\s,.;]+$/, "")}, ${OWNER}`, `“${p}”: nối nguyên văn, bỏ dấu câu cuối`, f);
}
const flux = R.fluxInput(undefined, { prompt: "đôi giày chạy bộ màu trắng", product: true });
ok(flux.prompt.endsWith(`, ${OWNER}`), "FLUX nhận prompt đã nối hậu tố", flux.prompt);
const relight = R.relightInput(undefined, { prompt: "lọ kem dưỡng", count: 1, ref: "https://x/y.png" });
ok(relight.prompt === `lọ kem dưỡng, ${OWNER}`, "IC-Light (đặt ảnh sản phẩm vào studio): luôn là ảnh sản phẩm, có hậu tố", relight.prompt);

console.log("3. Ảnh thường: không nối");
for (const p of ["con mèo cam đội mũ len", "phong cảnh Đà Lạt lúc bình minh", "portrait of an elderly fisherman"]) ok(R.finalPrompt(p, false) === p, `“${p}” (không phải ảnh sản phẩm): giữ nguyên`, R.finalPrompt(p, false));

console.log("4. Logo, tranh minh họa, hình vẽ: không nối kể cả khi model lỡ đánh dấu product_shot");
const art = [
  "logo tối giản cho thương hiệu mỹ phẩm Lumi", "Minimalist logo for a coffee brand, flat vector", "app icon for a budgeting app",
  "tranh minh họa cô bé đọc sách dưới gốc cây", "children's book illustration of a fox", "hình vẽ tay chai nước hoa", "phác thảo bút chì một đôi giày",
  "nhân vật hoạt hình chú mèo bán trà sữa", "cartoon mascot for a bakery", "biểu tượng con chim cho ứng dụng", "linh vật cho giải chạy", "line art of a perfume bottle",
  "anime style girl holding a skincare bottle", "hãy vẽ một chai serum theo phong cách màu nước", "watercolor painting of a teapot", "sticker set of cute fruits",
];
for (const p of art) ok(R.notPhoto(p) && R.finalPrompt(p, true) === p.trim(), `“${p}”: không nối`, R.finalPrompt(p, true));
// Từ gần giống mà vẫn là ảnh chụp sản phẩm: không bị chặn nhầm.
for (const p of ["iconic red sneakers on a concrete plinth", "bộ bút vẽ màu nước cao cấp trong hộp gỗ", "chai nước hoa có nhãn in logo nhỏ"]) {
  const blocked = R.notPhoto(p);
  ok(p.includes("logo") ? blocked : !blocked, p.includes("logo") ? `“${p}”: có chữ logo thì an toàn hơn là không nối (model nên tả sản phẩm, không tả nhãn)` : `“${p}”: vẫn là ảnh sản phẩm, có hậu tố`, String(blocked));
}

console.log("5. Hướng dẫn công cụ cho model");
const src = fs.readFileSync(path.join(process.cwd(), "server", "ai", "imagegen.ts"), "utf8");
ok(/product_shot: \{ type: "boolean", description: "[^"]*Không dùng cho logo, tranh, minh họa/.test(src), "product_shot nói rõ: không dùng cho logo, tranh, minh họa");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
