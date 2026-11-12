// Hướng dẫn riêng của từng tính năng (biểu đồ ECharts trong artifact, thư viện 3D của React, PowerPoint Morph, văn bản hành chính,
// ảnh sản phẩm / poster mẫu của generate_image), cho từng lượt. Như videokit.ts, dockit.ts, designkit.ts: chỉ nạp khi lượt này cần
// (câu người dùng vừa gõ, định dạng designkit đã nhận ra, artifact đang có trong đoạn chat), đi cạnh tin nhắn mới nhất, không vào lời
// nhắc hệ thống. Lời nhắc hệ thống chỉ giữ quy tắc chung nên giữ nguyên từng chữ giữa các lượt (bộ đệm prompt), và lượt trò chuyện
// hay sửa trang thường không phải gửi lại vài nghìn ký tự hướng dẫn của tính năng không dùng tới. Không bỏ quy tắc nào: chữ ở đây là
// nguyên văn phần đã chuyển ra khỏi ARTIFACT_RULES / IMAGE_RULES / mô tả công cụ generate_image.
// Tệp thuần (không DB, không mạng): tests/api/featkit.test.mjs.
import { isVbhcJob } from "./designkit";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
const words = (src: string) => new RegExp(`(?<![a-z0-9])(?:${src})(?![a-z0-9])`);

export const CHART_KIT = `<chart_kit>
Biểu đồ trong artifact (HTML, React, slide): chỉ ghi dữ liệu, không tự cấu hình thư viện: <div class="sx-chart" data-sx-chart='{"type":"bar|line|area|doughnut|pie|waterfall|sankey|radar","labels":[…],"series":[{"name","data":[…]}],"highlight":"chuỗi tiêu đề nhắc tới","unit":"%"}'></div> (bar: "horizontal", "stacked"; waterfall: data là phần tăng / giảm, "total":true khi cột đầu, cuối là tổng; sankey: "nodes":[{"name"}],"links":[{"source","target","value"}]). Synchro vẽ bằng ECharts theo phong cách trang (cao 320, đổi bằng height); PNG / PDF nét, PowerPoint là biểu đồ gốc sửa được số liệu. Chọn loại (FT Visual Vocabulary): theo thời gian → line/area; độ lớn, xếp hạng → bar (ngang khi nhãn dài, giảm dần); phần của tổng → doughnut ≤5 phần; từ A tới B → waterfall; dòng chảy, phễu → sankey; nhiều tiêu chí → radar; tương quan → scatter (recharts / echarts trong React).
</chart_kit>`;

export const THREE_KIT = `<three_kit>
3D trong React: @react-three/drei có Environment, Float, Lightformer, MeshTransmissionMaterial; shadergradient có ShaderGradientCanvas, ShaderGradient (lightType "3d", không "env": HDR cần mạng). Canvas WebGL tự viết: gl={{ preserveDrawingBuffer: true }} để ảnh / PowerPoint tải về không trắng.
</three_kit>`;

export const MORPH_KIT = `<morph_kit>
Bản trình bày: vật thể có ở hai slide liền nhau (ảnh chính, thẻ KPI, tiêu đề): gắn cùng data-sx-morph="!!ten-vat-the" ở cả hai để PowerPoint tải về tự chuyển cảnh Morph giữa hai slide.
</morph_kit>`;

export const VBHC_KIT = `<vbhc_kit>
Văn bản hành chính (công văn, quyết định, tờ trình, thông báo, báo cáo, kế hoạch, giấy mời, biên bản, chỉ thị, hướng dẫn của cơ quan, tổ chức Việt Nam): dùng KIỂU application/vnd.synchro.vbhc+json, nội dung là MỘT đối tượng JSON; Synchro tự dàn trang đúng thể thức Nghị định 30/2020/NĐ-CP (khổ A4, lề, Times New Roman, quốc hiệu, tiêu ngữ, đường kẻ, chữ ký, nơi nhận) và xuất Word, PDF. Trường: loai ("cong-van" | "quyet-dinh" | "to-trinh" | "thong-bao" | "bao-cao" | "ke-hoach" | "giay-moi" | "bien-ban" | "chi-thi" | "huong-dan"), coQuanChuQuan (không bắt buộc), coQuan, so (để trống nếu chưa có số), kyHieu (ví dụ "QĐ-UBND"; công văn: "UBND-VP"), diaDanh, ngay ("YYYY-MM-DD", trống nếu chưa ký), trichYeu (công văn: phần sau "V/v"), thamQuyen (chỉ quyết định, ví dụ "CHỦ TỊCH ỦY BAN NHÂN DÂN TỈNH BẮC NINH"), canCu (chỉ quyết định: mảng các dòng "Căn cứ …;" và dòng "Theo đề nghị của …."), kinhGui (mảng; công văn, tờ trình, giấy mời), noiDung (mảng đoạn văn; "# Tiêu đề" cho đề mục như "# I. MỤC ĐÍCH, YÊU CẦU"; quyết định viết "Điều 1. …", "Điều 2. …"; **đậm** khi cần), quyenHan ("TM. ỦY BAN NHÂN DÂN", "KT. GIÁM ĐỐC"…, không có thì bỏ), chucVu, nguoiKy, noiNhan (mảng, dòng cuối "Lưu: VT, …."). Không tự viết quốc hiệu, tiêu ngữ, số, ngày tháng vào noiDung. Văn phong hành chính: ngắn gọn, chính xác, đúng thẩm quyền; tên cơ quan, chức danh viết đúng; không bịa số hiệu văn bản pháp luật, nếu không chắc thì để người dùng điền.
</vbhc_kit>`;

const PRODUCT_LINE = "Ảnh sản phẩm để bán: product_shot true (Synchro tự thêm phong cách nhiếp ảnh studio, prompt chỉ cần tả sản phẩm và bối cảnh); người dùng gửi ảnh sản phẩm và muốn đưa vào studio: reference + product_relight true.";
const POSTER_LINE = `Poster / ảnh chia sẻ 1200×630 kiểu thẻ số liệu (tiêu đề + một con số KPI): generate_image với template "poster-master-og" và poster (độ dài tối đa: tag 32 in hoa, title 90 câu kết luận, metricValue 12 vd "+14,2%", metricLabel 40, author 40), prompt một câu ngắn. Bố cục khác thì dựng artifact HTML khung .sx-og (tải PNG 3x).`;
export const imageKit = (product: boolean, poster: boolean) => (product || poster ? `<image_kit>\n${[product ? PRODUCT_LINE : "", poster ? POSTER_LINE : ""].filter(Boolean).join("\n")}\n</image_kit>` : "");

// ---------------------------------------------------------------- nhận diện
// Phần lớn so trên chữ đã bỏ dấu (người dùng gõ không dấu vẫn nhận). Từ mà bỏ dấu thì trùng từ thường gặp ("ảnh" / "anh", "tỉnh" / "tính",
// "quyết định" là động từ) thì so trên chữ còn dấu, hoặc chỉ tính khi đi cùng dấu hiệu khác.
const CHART = words("bieu do|do thi|charts?|graphs?|plots?|dashboards?|bang dieu khien|thong ke|so lieu|kpis?|doanh thu|doanh so|loi nhuan|ty le|ti le|xu huong|tang truong|infographics?|bao cao|reports?|analytics|waterfall|sankey|radar|pheu|funnel|truc quan hoa|visuali[sz]\\w*|echarts|recharts|statistics?|revenue");
const THREE = words("3d|3-d|3 chieu|ba chieu|three(?:\\.js|js)?|r3f|react-three|drei|webgl|shaders?|shadergradient|gradient dong|kinh khuc xa|vat the noi|lo lung|particles?|hat chuyen dong|mo hinh 3d|xoay 360|orbit");
const SLIDE = words("slides?|slide ?decks?|decks?|pitch ?decks?|thuyet trinh|trinh chieu|ban trinh bay|bai trinh bay|powerpoint|pptx|keynote|presentations?|morph");
// Văn bản hành chính: tên loại rõ nghĩa luôn tính (designkit nhận cả "soạn quyết định…" khi là tân ngữ); "quyết định, thông báo, báo cáo,
// kế hoạch, hướng dẫn, chỉ thị" ở chỗ khác chỉ tính khi câu có dấu hiệu cơ quan, tổ chức ("giúp tôi quyết định nên mua gì" là trò chuyện).
const VBHC = words("cong van|to trinh|bien ban|giay moi|van ban hanh chinh|nghi dinh 30|the thuc van ban|vbhc");
const VBHC_SOFT = words("quyet dinh|chi thi|thong bao|bao cao|ke hoach|huong dan");
const ORG = /(?<![\p{L}\p{N}])(?:cơ quan|ubnd|hđnd|ủy ban|uỷ ban|sở|phòng ban|bộ phận|bộ ngành|đơn vị|trường|xã|phường|huyện|tỉnh|quận|cục|chi cục|đảng ủy|đảng uỷ|chi bộ|công đoàn|đoàn thanh niên|hội đồng|ban giám đốc|công ty|tổng công ty|hành chính|co quan|uy ban|don vi|hanh chinh|cong doan|dang uy|chi bo)(?![\p{L}\p{N}])/u;
// Ảnh: "ảnh" giữ dấu (không dấu là "anh"); câu không dấu thì nhận các cụm có chữ "anh" đứng trước danh từ ảnh.
const IMG = /(?<![\p{L}\p{N}])(?:ảnh|hình|chụp|tạo ảnh|photos?|images?|pictures?|poster|banner|thumbnail|packshot|render)(?![\p{L}\p{N}])/u;
const IMG_FOLD = words("tao anh|chup anh|anh san pham|anh quang cao|anh chia se|hinh anh");
const PRODUCT = words("san pham|bao bi|my pham|serum|nuoc hoa|do an|mon an|do uong|thuc pham|packshot|products?|quang cao|ban hang|shopee|lazada|tiki|tiktok shop|e-?commerce|catalog(?:ue)?|studio");
const POSTER = words("poster|open ?graph|og image|anh og|anh chia se|the chia se|share ?card|social card|thumbnail|banner|the so lieu");
// Artifact đang có dùng WebGL / thư viện 3D.
const THREE_SRC = /from ["'](?:three|@react-three\/|shadergradient|@shadergradient\/)|getContext\(\s*["'](?:webgl2?|experimental-webgl)|data-sx-shader\b|\bTHREE\./;

export type FeatIn = {
  /** Câu người dùng vừa gõ. */
  typed: string;
  /** Có Artifacts (ARTIFACT_RULES) và công cụ generate_image (IMAGE_RULES) trong lượt này không. */
  art: boolean; image: boolean;
  /** Định dạng designkit nhận ra cho lượt này (khối đầy đủ, không phải bản rút gọn sửa tiếp). */
  format?: string | null;
  /** Văn bản các artifact đã có trong đoạn chat (historyTexts). */
  prior?: string[];
};
export type FeatTurn = { block: string; parts: string[] };

/** Các khối cần cho lượt này (rỗng khi không cần gì). Chỉ đọc 300 ký tự đầu: phần sau có thể là văn bản dán vào. */
export function featTurn(i: FeatIn): FeatTurn {
  if (process.env.SYNCHRO_FEATKIT === "0" || /(?:^|\s)#nofeatkit\b/.test(i.typed)) return { block: "", parts: [] };
  const head = i.typed.trim().slice(0, 300), t = fold(head), lower = head.normalize("NFC").toLowerCase();
  // Artifact gần nhất đang có trong đoạn chat: sửa trang có biểu đồ, bản trình bày, cảnh 3D, văn bản hành chính vẫn có đúng hướng dẫn.
  const last = (i.prior ?? []).filter((x) => /<artifact\b/.test(x)).join("\n");
  const parts: [string, string][] = [];
  if (i.art) {
    const design = i.format === "slide" || i.format === "doc" || i.format === "graphic";
    if (CHART.test(t) || design || /data-sx-chart\b/.test(last)) parts.push(["chart", CHART_KIT]);
    if (THREE.test(t) || THREE_SRC.test(last)) parts.push(["three", THREE_KIT]);
    if (SLIDE.test(t) || i.format === "slide" || /<section\b[^>]*class(?:Name)?=["'][^"']*\bslide\b/.test(last)) parts.push(["morph", MORPH_KIT]);
    if (isVbhcJob(head) || VBHC.test(t) || (VBHC_SOFT.test(t) && ORG.test(lower)) || /vnd\.synchro\.vbhc\+json|type="vbhc"/.test(last)) parts.push(["vbhc", VBHC_KIT]);
  }
  if (i.image) {
    const pic = IMG.test(lower) || IMG_FOLD.test(t), poster = POSTER.test(t);
    const img = imageKit(pic && PRODUCT.test(t), poster);
    if (img) parts.push(["image", img]);
  }
  return { block: parts.map((p) => p[1]).join("\n\n"), parts: parts.map((p) => p[0]) };
}
