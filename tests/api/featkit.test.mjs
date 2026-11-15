// Hướng dẫn riêng của tính năng theo lượt (server/featkit.ts): biểu đồ ECharts trong artifact, 3D trong React, PowerPoint Morph, văn bản hành chính,
// ảnh sản phẩm / poster mẫu. Chỉ nạp ở lượt cần, đi cạnh tin nhắn mới nhất; lời nhắc hệ thống (ARTIFACT_RULES, IMAGE_RULES) không còn mang chúng
// ở mọi lượt nhưng không mất quy tắc nào. Không cần máy chủ.
import { readFileSync } from "node:fs";
import { loadTs } from "../lib/ts.mjs";
import { readChatEngine } from "../lib/srcroots.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const { featkit: F, artifacts: A, designkit: K } = await loadTs(["featkit", "artifacts", "designkit"]);
const on = { art: true, image: true };
const parts = (typed, o = {}) => F.featTurn({ typed, ...on, ...o }).parts.sort().join(",");

console.log("1. Trò chuyện thường, sửa trang thường: không có khối");
for (const q of ["xin chào", "tạo trang web giới thiệu quán cà phê", "liệt kê đơn hàng rồi sửa trang #rev 3", "#rev 4", "giúp tôi quyết định nên mua laptop nào", "lên kế hoạch tính toán chi tiêu tuần này", "anh ơi giải thích giúp em", "viết code python tính fibonacci"])
  ok(parts(q) === "", `không khối: "${q}"`, parts(q));

console.log("1b. Từ thường gặp của 3D trong câu không phải yêu cầu dựng giao diện: không có khối 3D");
for (const q of ["Tôi có nên đóng tài khoản ngân hàng này không?", "Màn hình laptop không xoay được thì làm sao?", "Bạn có biết hành tinh nào lớn nhất hệ mặt trời không?", "Có nên động viên con khi thi trượt?", "Bài hát bay bổng nhất của Trịnh Công Sơn", "Explain floating point precision in Python", "Lập lịch rotating shifts cho nhân viên", "Lịch tập spinning ở phòng gym", "Viết code Python đọc file canvas.json", "Giải thích về thiên hà Milky Way", "Tôi muốn mua quả địa cầu cho con", "Viết bài thơ về ngân hà", "business model canvas", "particle physics là gì"])
  ok(!parts(q).split(",").includes("three"), `không khối 3D: "${q}"`, parts(q));

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

console.log("2b. WebGL / 3D không nói chữ 3D vẫn có khối 3D");
for (const q of ["Build a landing page hero with a floating glass object", "Làm quả địa cầu xoay tương tác hiển thị các thành phố", "Make an animated galaxy background for my site",
  "Make a spinning globe with our office locations", "Tạo hiệu ứng hạt bay trên nền tối", "Làm nền lưới gradient chuyển động cho trang chủ", "Glassmorphism hero with floating orbs",
  "Trang giới thiệu sản phẩm có mô hình xoay được", "hero section with a moving gradient", "mesh gradient background", "làm nền động cho website", "vẽ thiên hà bằng canvas"])
  ok(parts(q).split(",").includes("three"), `"${q}" → three`, parts(q));

console.log("2c. Poster / ảnh chia sẻ có chữ, số liệu");
for (const q of ["Làm ảnh thẻ KPI cho bài LinkedIn", "Make a share image with our 14% growth stat", "Tạo ảnh có chữ tăng trưởng 14% cho fanpage", "Tạo ảnh bìa cho bài viết", "make a cover image for the blog post",
  "Make a LinkedIn post image about Q3 revenue", "Thiết kế stat card cho Instagram", "social media image for our launch"])
  ok(F.featTurn({ typed: q, ...on }).block.includes("poster-master-og"), `"${q}" → poster`, parts(q));
for (const q of ["Làm dashboard có thẻ KPI doanh thu", "Viết bài LinkedIn về tăng trưởng 14% của công ty", "anh có chú ý không"])
  ok(!F.featTurn({ typed: q, ...on }).block.includes("poster-master-og"), `không poster: "${q}"`, parts(q));

console.log("2d. Không nhầm: báo cáo công ty không phải văn bản hành chính, \"mô hình\" không phải ảnh");
for (const q of ["Làm báo cáo PDF về doanh thu năm 2026 của công ty", "Viết báo cáo tổng kết năm của phòng kinh doanh công ty ABC", "Lập kế hoạch kinh doanh cho ban giám đốc tổng công ty",
  "Viết thông báo nghỉ Tết gửi các phòng ban, bộ phận", "Viết báo cáo nghiên cứu thị trường xe điện", "Lập kế hoạch học cơ sở dữ liệu", "Hướng dẫn bố cục trang web", "Kế hoạch marketing trên mạng xã hội",
  "Hướng dẫn đổi đơn vị đo trong Excel", "Báo cáo hội đồng quản trị quý 3"])
  ok(!parts(q).split(",").includes("vbhc"), `không vbhc: "${q}"`, parts(q));
for (const q of ["Soạn công văn của công ty gửi Cục Thuế", "Soạn tờ trình của công ty xin chủ trương đầu tư", "Trình bày báo cáo đúng thể thức văn bản theo Nghị định 30", "Viết báo cáo tổng kết năm của UBND xã Tân Lập", "Soạn kế hoạch của Sở Giáo dục về thi tốt nghiệp", "Viết thông báo của nhà trường về lịch thi"])
  ok(parts(q).split(",").includes("vbhc"), `vẫn vbhc: "${q}"`, parts(q));
for (const q of ["Trang giới thiệu sản phẩm có mô hình xoay được", "Tạo mô hình dự báo doanh số sản phẩm", "Thiết kế màn hình đăng nhập cho app bán hàng", "Phân tích tình hình kinh doanh sản phẩm quý này",
  "Hướng dẫn cấu hình server bán hàng", "ảnh hưởng của quảng cáo tới doanh số sản phẩm", "Đổi hình thức thanh toán của sản phẩm", "địa hình khu vực bán hàng", "sản phẩm điển hình của shop", "định hình thương hiệu sản phẩm", "hình dung sản phẩm mới", "bài tập hình học"])
  ok(!parts(q).split(",").includes("image"), `không ảnh: "${q}"`, parts(q));
ok(parts("Chụp hình sản phẩm son môi trên nền hồng").split(",").includes("image") && parts("Tạo hình ảnh quảng cáo sản phẩm sữa").split(",").includes("image"), "\"hình\" đứng riêng, \"hình ảnh\" vẫn là ảnh");

console.log("2e. Ảnh sản phẩm chỉ khi generate_image có product_shot (máy chủ có khóa Replicate)");
ok(F.featTurn({ typed: "Tạo ảnh sản phẩm chai serum", ...on, product: false }).block === "", "không có khóa Replicate: không có dòng ảnh sản phẩm");
ok(F.featTurn({ typed: "Làm poster thẻ số liệu", ...on, product: false }).block.includes("poster-master-og"), "không có khóa Replicate: poster vẫn có");
ok(F.featTurn({ typed: "Tạo ảnh sản phẩm chai serum", ...on, product: true }).block.includes("product_shot true"), "có khóa Replicate: có dòng ảnh sản phẩm");

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
const rules = A.ARTIFACT_RULES(true), img = readFileSync("server/ai/imagegen.ts", "utf8");
for (const [k, s] of [["chart", "FT Visual Vocabulary"], ["three", "MeshTransmissionMaterial"], ["morph", 'data-sx-morph="!!ten-vat-the"'], ["vbhc", "Nghị định 30/2020/NĐ-CP"], ["vbhc", "noiNhan"]]) {
  const block = { chart: F.CHART_KIT, three: F.THREE_KIT, morph: F.MORPH_KIT, vbhc: F.VBHC_KIT }[k];
  ok(block.includes(s) && !rules.includes(s), `${k}: "${s}" ở khối theo lượt, không ở ARTIFACT_RULES`);
}
ok(/application\/vnd\.synchro\.vbhc\+json/.test(rules) && /three, @react-three\/fiber, @react-three\/drei, shadergradient/.test(rules), "ARTIFACT_RULES vẫn kể kiểu vbhc và các thư viện 3D có sẵn");
ok(!/product_relight true/.test(img.slice(img.indexOf("export const IMAGE_RULES"))) && F.imageKit(true, false).includes("product_relight true"), "IMAGE_RULES: dòng ảnh sản phẩm chuyển sang khối ảnh");
// Quy tắc an toàn ở mọi lượt: canvas WebGL tự viết (không nói chữ 3D thì khối 3D có thể không nạp) vẫn tải về không trắng.
ok(/Canvas WebGL tự viết: gl=\{\{ preserveDrawingBuffer: true \}\}/.test(rules) && F.THREE_KIT.includes("preserveDrawingBuffer"), "preserveDrawingBuffer ở ARTIFACT_RULES (mọi lượt) và trong khối 3D");
ok(rules.includes("(echarts và bộ 3D chỉ tải khi import)"), "ARTIFACT_RULES: echarts và bộ 3D chỉ tải khi import");
ok(F.CHART_KIT.includes("biểu đồ gốc sửa được số liệu (sankey giữ dạng hình)"), "khối biểu đồ: sankey giữ dạng hình trong PowerPoint");
ok(/Poster \/ banner \/ ảnh chia sẻ 1200×630 nhiều chữ/.test(F.imageKit(false, true)), "khối poster: có banner và nhiều chữ");
ok(img.includes("Chỉ khi sửa / dựa trên ảnh có sẵn, ảnh mới hoàn toàn thì bỏ tham số này"), "reference: ảnh mới hoàn toàn thì bỏ tham số này");
ok(/\.\.\.\(product \? \{\s*product_shot:[\s\S]*product_relight:[\s\S]*\} : \{\}\)/.test(img) && /imageTool = \(product = imageProduct\(\)\)/.test(img) && /imageProduct = \(\) => !!serviceKey\("replicate"\)/.test(img), "generate_image: product_shot / product_relight chỉ khi có khóa Replicate");
ok(!/IMAGE_TOOL\b/.test(readChatEngine()) && (readChatEngine().match(/\[imageTool\(\)\]/g) ?? []).length === 2, "chatengine dùng imageTool() ở cả hai nơi ghép công cụ");
ok(rules.length < 5600, `ARTIFACT_RULES ${rules.length} ký tự (r10 trước khi tách: 8118)`);

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
