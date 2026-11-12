// Hướng dẫn riêng của tính năng theo lượt (app/featkit.ts): biểu đồ ECharts trong artifact, 3D trong React, PowerPoint Morph, văn bản hành chính,
// ảnh sản phẩm / poster mẫu. Chỉ nạp ở lượt cần, đi cạnh tin nhắn mới nhất; lời nhắc hệ thống (ARTIFACT_RULES, IMAGE_RULES) không còn mang chúng
// ở mọi lượt nhưng không mất quy tắc nào. Không cần máy chủ.
import { readFileSync } from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const { featkit: F, artifacts: A, designkit: K } = await loadTs(["featkit", "artifacts", "designkit"]);
const on = { art: true, image: true };
const parts = (typed, o = {}) => F.featTurn({ typed, ...on, ...o }).parts.sort().join(",");

console.log("1. Trò chuyện thường, sửa trang thường: không có khối");
for (const q of ["xin chào", "tạo trang web giới thiệu quán cà phê", "liệt kê đơn hàng rồi sửa trang #rev 3", "#rev 4", "giúp tôi quyết định nên mua laptop nào", "lên kế hoạch tính toán chi tiêu tuần này", "anh ơi giải thích giúp em", "viết code python tính fibonacci"])
  ok(parts(q) === "", `không khối: "${q}"`, parts(q));

console.log("2. Đúng khối theo câu người dùng");
for (const [q, want] of [
  ["Vẽ biểu đồ doanh thu 6 tháng trong trang", "chart"], ["make a dashboard of sales KPIs", "chart"], ["bao cao ty le chuyen doi", "chart"],
  ["làm hero 3D có khối kính khúc xạ", "three"], ["react three fiber scene with shader background", "three"],
  ["chuyển sang PowerPoint có hiệu ứng Morph", "morph"], ["lam bo trinh chieu ve AI", "morph"],
  ["Soạn công văn gửi Sở Tài chính đề nghị bố trí kinh phí", "vbhc"], ["Soạn quyết định thành lập tổ công tác", "vbhc"], ["Viết thông báo của UBND xã về lịch tiêm", "vbhc"], ["soan to trinh xin kinh phi", "vbhc"],
  ["Tạo ảnh sản phẩm chai serum trên nền đá", "image"], ["tao anh san pham hop qua tet", "image"], ["Làm poster thẻ số liệu tăng trưởng 14%", "image"],
]) ok(parts(q).split(",").includes(want), `"${q}" → ${want}`, parts(q));
ok(parts("Tạo ảnh sản phẩm chai serum trên nền đá") === "image", "ảnh sản phẩm: không kéo theo khối khác", parts("Tạo ảnh sản phẩm chai serum trên nền đá"));
ok(F.featTurn({ typed: "Tạo ảnh sản phẩm chai serum", ...on }).block.includes("product_shot true") && !F.featTurn({ typed: "Tạo ảnh sản phẩm chai serum", ...on }).block.includes("poster-master-og"), "ảnh sản phẩm: chỉ dòng sản phẩm");
ok(F.featTurn({ typed: "Làm poster thẻ số liệu", ...on }).block.includes("metricValue 12"), "poster: có độ dài tối đa của từng trường");
ok(parts("món ăn ngon ở Huế") === "", "nói về món ăn, không nhờ tạo ảnh: không có khối ảnh");

console.log("3. Theo khả năng đang bật");
ok(parts("vẽ biểu đồ doanh thu", { art: false }) === "", "tắt Artifacts: không có khối biểu đồ");
ok(parts("Tạo ảnh sản phẩm chai serum", { image: false }) === "", "không có generate_image: không có khối ảnh");
ok(parts("vẽ biểu đồ #nofeatkit") === "", "#nofeatkit tắt khối");

console.log("4. Theo việc designkit nhận ra và artifact đang có");
ok(parts("làm landing page", { format: "graphic" }) === "chart", "khối thiết kế đầy đủ (FX_RULE nhắc biểu đồ): có khối biểu đồ");
ok(parts("về thị trường xe điện", { format: "slide" }) === "chart,morph", "slide: biểu đồ + Morph");
const slideArt = `<artifact identifier="deck" type="text/html"><section class="slide">A</section>`;
ok(parts("làm slide 2 đậm hơn", { prior: [slideArt] }).includes("morph") && parts("đổi màu tiêu đề", { prior: [slideArt] }) === "morph", "sửa bản trình bày đang có: có Morph");
ok(parts("thêm một cột", { prior: [`<artifact identifier="x" type="text/html"><div class="sx-chart" data-sx-chart='{"type":"bar"}'></div>`] }) === "chart", "sửa trang có biểu đồ: có khối biểu đồ");
ok(parts("đổi màu nền", { prior: [`<artifact identifier="x" type="application/vnd.react">import { Canvas } from "@react-three/fiber"`] }) === "three", "sửa cảnh 3D đang có: có khối 3D");
ok(parts("sửa trích yếu", { prior: [`<artifact identifier="cv" type="vbhc">{"loai":"cong-van"}`] }) === "vbhc", "sửa văn bản hành chính đang có: có cấu trúc trường");
ok(K.isVbhcJob("Soạn công văn gửi UBND") && !K.isVbhcJob("giúp tôi quyết định nên mua gì"), "designkit nhận việc soạn văn bản hành chính");

console.log("5. Không mất quy tắc: chữ chuyển ra nằm nguyên văn trong khối, lời nhắc hệ thống gọn lại");
const rules = A.ARTIFACT_RULES(true), img = readFileSync("app/ai/imagegen.ts", "utf8");
for (const [k, s] of [["chart", "FT Visual Vocabulary"], ["three", "preserveDrawingBuffer"], ["morph", 'data-sx-morph="!!ten-vat-the"'], ["vbhc", "Nghị định 30/2020/NĐ-CP"], ["vbhc", "noiNhan"]]) {
  const block = { chart: F.CHART_KIT, three: F.THREE_KIT, morph: F.MORPH_KIT, vbhc: F.VBHC_KIT }[k];
  ok(block.includes(s) && !rules.includes(s), `${k}: "${s}" ở khối theo lượt, không ở ARTIFACT_RULES`);
}
ok(/application\/vnd\.synchro\.vbhc\+json/.test(rules) && /three, @react-three\/fiber, @react-three\/drei, shadergradient/.test(rules), "ARTIFACT_RULES vẫn kể kiểu vbhc và các thư viện 3D có sẵn");
ok(!/product_relight true/.test(img.slice(img.indexOf("export const IMAGE_RULES"))) && F.imageKit(true, false).includes("product_relight true"), "IMAGE_RULES: dòng ảnh sản phẩm chuyển sang khối ảnh");
ok(rules.length < 5600, `ARTIFACT_RULES ${rules.length} ký tự (r10 trước khi tách: 8118)`);

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
