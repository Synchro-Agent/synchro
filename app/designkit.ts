// Khối quy tắc thiết kế cho từng lượt: chỉ nạp đúng thứ việc đang làm cần (slide, tài liệu, bảng tính, đồ họa), bằng số đo thay cho tính từ.
// Không vào system prompt: khối đổi theo yêu cầu nên đi cạnh tin nhắn mới nhất như skill_routing, phần đầu prompt giữ nguyên từng chữ để đọc từ bộ đệm (xem chatengine.ts).
// Trò chuyện thường, câu hỏi kiến thức, đường nhanh: không thêm gì. Lượt tiếp theo trên cùng sản phẩm: bản rút gọn, vì mỗi dòng ở đây còn lại trong lịch sử đoạn chat.
// Tệp thuần (không DB, không mạng), kiểm thử bằng tests/api/designkit.test.mjs. #nodesign trong tin nhắn hoặc SYNCHRO_DESIGNKIT=0 thì tắt, để so sánh trước / sau với model thật.
import { presetOf, PRESETS } from "./designpresets";

export type DesignFormat = "slide" | "doc" | "sheet" | "graphic";
export type DesignDomain = "finance" | "data" | "tech" | "editorial" | "marketing" | "event" | "product" | "general";
/** Trần mỗi lượt, tính theo byte UTF-8 (tiếng Việt nặng hơn số ký tự). */
export const DESIGN_BUDGET = 6144;
export const STUDIO_FORMAT: Record<string, DesignFormat> = { slides: "slide", docs: "doc", design: "graphic" };

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
const noMarks = (s: string) => fold(s) === s.toLowerCase();

// ---------------------------------------------------------------- nhận diện
// Tệp đầu vào không phải đầu ra: "làm slide từ file excel này" là slide.
const INPUT_FILE = /\b(?:tu|trong|theo|dua tren|doc|tom tat|from|based on|using)\s+(?:cai\s+|the\s+|this\s+|my\s+)?(?:file\s+|tep\s+|bang\s+)?(?:excel|xlsx|bang tinh|spreadsheet|pdf|word|docx|powerpoint|pptx)\b/g;
const FORMATS: [DesignFormat, RegExp][] = [
  ["slide", /\b(?:slides?|pitch ?deck|deck|thuyet trinh|trinh chieu|ban trinh bay|powerpoint|pptx|keynote|presentation)\b/],
  ["sheet", /\b(?:excel|xlsx|bang tinh|spreadsheet|google sheets?|financial model|mo hinh tai chinh)\b/],
  ["graphic", /\b(?:poster|banner|infographic|flyer|to roi|to gap|brochure|the mang xa hoi|anh bia|thumbnail|landing page|trang dich|thiep|dashboard|trang web|website|giao dien)\b/],
  ["doc", /\b(?:bao cao|de xuat|ke hoach (?:kinh doanh|marketing|du an|trien khai|chien luoc|tai chinh|san xuat|truyen thong|nhan su)|business plan|tai lieu|de an|ho so|word|docx|pdf|proposal|report|white ?paper|memo|one.?pager|mot trang|so tay|handbook)\b/],
];
// Văn bản hành chính có kiểu artifact riêng (vbhc), Synchro tự dàn trang đúng thể thức: quy tắc này không áp dụng.
const VBHC = /\b(?:cong van|quyet dinh|to trinh|bien ban|giay moi|chi thi)\b/;
const ASK = /\b(?:la gi|nghia la|tai sao|vi sao|lam sao|lam the nao|the nao|cach (?:lam|tao|viet|dung|ve|thiet ke|xuat)|khac gi|co nen|bao nhieu|what is|what are|how (?:do|to|can)|why|difference between|should i)\b/;
const POLITE = /\b(?:giup|duoc khong|duoc ko|can you|could you|please)\b/;
const OTHER_JOB = /^\s*(?:hay\s+)?(?:dich|tom tat|giai thich|translate|summari[sz]e|explain)\b/;
const MAKE_VI = /(?<!\p{L})(?:làm|tạo|viết|soạn|thiết kế|dựng|vẽ|xuất|lập|chuẩn bị|sửa|chỉnh|đổi|cập nhật|thêm|trình bày|cần|muốn|giúp)(?!\p{L})/u;
const MAKE_EN = /\b(?:make|create|build|design|draft|write|generate|prepare|produce|export|update|redo|convert)\b/;
const MAKE_FOLD = /\b(?:lam|tao|viet|soan|thiet ke|dung|ve|xuat|lap|chuan bi|sua|chinh|doi|cap nhat|them|can|muon|giup)\b/;
const EDIT_VI = /(?<!\p{L})(?:sửa|chỉnh|đổi|thêm|bỏ|xóa|thay|cập nhật|làm lại|ngắn lại|to hơn|nhỏ hơn|đậm hơn)(?!\p{L})/u;
const EDIT_EN = /\b(?:change|fix|edit|add|remove|replace|update|redo|make it)\b/;
const EDIT_FOLD = /\b(?:sua|chinh|doi|them|bo|xoa|thay|cap nhat|lam lai)\b/;
// "Làm bộ slide khác về…" là sản phẩm mới dù đoạn chat đã có slide: phải có đủ số đo, gọi model bằng khóa API không còn khối của lượt trước trong lịch sử.
const NEW_ONE = /\b(?:moi|khac|new|another|separate)\b/;

const DOMAINS: [DesignDomain, RegExp][] = [
  ["data", /\b(?:giao dich|trading|chung khoan|quant|bang so lieu|thong ke|analytics|dashboard|bang dieu khien)\b/],
  ["finance", /\b(?:tai chinh|doanh thu|loi nhuan|ngan sach|dong tien|ke toan|dau tu|co phieu|kiem toan|ngan hang|bao hiem|thue|bien ro?ng|quy (?:i|ii|iii|iv|[1-4])|q[1-4]|financial|finance|revenue|budget|profit|investor)\b/],
  ["event", /\b(?:su kien|hoi nghi|hoi thao|truyen cam hung|khai mac|gala|tri an|concert|festival|le hoi|conference|summit|event|keynote)\b/],
  ["marketing", /\b(?:marketing|quang cao|chien dich|ra mat|khuyen mai|gen ?z|mang xa hoi|thuong hieu|giam gia|tuyen dung|campaign|promo|launch|social media)\b/],
  ["editorial", /\b(?:tap chi|bat dong san|nghien cuu|van hoa|du lich|am thuc|thoi trang|nghe thuat|khach san|noi that|nha hang|ca phe|magazine|editorial|research|travel|food)\b/],
  ["tech", /\b(?:cong nghe|phan mem|saas|tri tue nhan tao|ky thuat|kien truc he thong|lap trinh|devops|startup|software|tech|api)\b/],
  ["product", /\b(?:ho so nang luc|gioi thieu cong ty|san pham|portfolio|pitch|profile|product)\b/],
];
// Lần lượt theo hạt giống (mã đoạn chat): cùng lĩnh vực không phải lúc nào cũng ra một kiểu, nhưng trong một đoạn chat thì giữ nguyên.
const PICK: Record<DesignDomain, Record<DesignFormat, string[]>> = {
  finance: { slide: ["exec-navy", "swiss-grid", "soft-bento"], doc: ["exec-navy", "swiss-grid"], sheet: ["exec-navy"], graphic: ["exec-navy", "swiss-grid"] },
  data: { slide: ["data-terminal", "midnight-tech"], doc: ["swiss-grid", "exec-navy"], sheet: ["exec-navy"], graphic: ["data-terminal", "midnight-tech"] },
  tech: { slide: ["midnight-tech", "soft-bento", "swiss-grid"], doc: ["swiss-grid", "exec-navy"], sheet: ["exec-navy"], graphic: ["midnight-tech", "soft-bento", "neo-brutalist"] },
  editorial: { slide: ["editorial-serif", "soft-bento"], doc: ["editorial-serif"], sheet: ["swiss-grid"], graphic: ["editorial-serif", "swiss-grid"] },
  marketing: { slide: ["soft-bento", "neo-brutalist", "aurora-glass"], doc: ["editorial-serif", "soft-bento"], sheet: ["swiss-grid"], graphic: ["neo-brutalist", "aurora-glass", "soft-bento"] },
  event: { slide: ["aurora-glass", "midnight-tech", "editorial-serif"], doc: ["editorial-serif", "soft-bento"], sheet: ["swiss-grid"], graphic: ["aurora-glass", "neo-brutalist", "midnight-tech"] },
  product: { slide: ["soft-bento", "midnight-tech", "swiss-grid"], doc: ["soft-bento", "swiss-grid"], sheet: ["swiss-grid"], graphic: ["soft-bento", "neo-brutalist"] },
  general: { slide: ["swiss-grid", "soft-bento", "editorial-serif", "exec-navy"], doc: ["swiss-grid", "editorial-serif", "exec-navy"], sheet: ["swiss-grid"], graphic: ["swiss-grid", "neo-brutalist", "editorial-serif", "aurora-glass"] },
};
// Người dùng nói rõ phong cách.
const STYLE_WORDS: [RegExp, string][] = [
  [/\b(?:tap chi|editorial|sang trong co dien)\b/, "editorial-serif"], [/\b(?:brutalis\w*|tho moc)\b/, "neo-brutalist"], [/\b(?:kinh mo|glass\w*|cuc quang|aurora)\b/, "aurora-glass"],
  [/\bbento\b/, "soft-bento"], [/\b(?:terminal|bang so day)\b/, "data-terminal"], [/\bswiss\b|\bthuy si\b/, "swiss-grid"], [/\b(?:nen toi|dark mode|dark theme|giao dien toi)\b/, "midnight-tech"],
];
// Họ đã có bản sắc riêng: giữ số đo, không áp bảng màu có sẵn.
const OWN_BRAND = /\b(?:thuong hieu (?:cua|ben)|brand (?:color|guide|book)|mau chu dao|mau cua (?:cong ty|hang)|logo cua|theo mau|template cua|bang mau cua|mau (?:xanh|do|vang|cam|tim|hong) (?:chu dao|lam chu|la chinh))\b/;

const enc = new TextEncoder();
export const designBytes = (s: string) => enc.encode(s).length;
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h; };
export const domainOf = (typed: string): DesignDomain => {
  if (/(?<![\p{L}\p{N}])AI(?![\p{L}\p{N}])/u.test(typed)) return "tech";
  const t = fold(typed);
  return DOMAINS.find(([, re]) => re.test(t))?.[0] ?? "general";
};
export function formatOf(typed: string): DesignFormat | null {
  const t = fold(typed).replace(INPUT_FILE, " ");
  return FORMATS.find(([, re]) => re.test(t))?.[0] ?? null;
}
const isQuestion = (head: string) => { const t = fold(head); return ASK.test(t) || (/\?\s*$/.test(head) && !POLITE.test(t)); };
const wantsMake = (head: string) => MAKE_VI.test(head.toLowerCase()) || MAKE_EN.test(head.toLowerCase()) || (noMarks(head) && MAKE_FOLD.test(fold(head))) || /^\s*(?:bo |mot |1 |a )?(?:slides?|poster|banner|infographic)\b/.test(fold(head));
const wantsEdit = (head: string) => EDIT_VI.test(head.toLowerCase()) || EDIT_EN.test(head.toLowerCase()) || (noMarks(head) && EDIT_FOLD.test(fold(head)));
export function presetFor(format: DesignFormat, domain: DesignDomain, typed: string, seed = ""): string {
  const t = fold(typed);
  const asked = PRESETS.find((p) => t.includes(p.id))?.id ?? STYLE_WORDS.find(([re]) => re.test(t))?.[1];
  if (asked) return asked;
  const list = PICK[domain][format];
  return list[hash(seed || typed) % list.length];
}

// ---------------------------------------------------------------- quy tắc
const CORE = `Chữ: chỉ dùng thang 12·14·16·21·28·38·56 (tỉ lệ 1.333), mỗi trang tối đa 4 cỡ. Giãn chữ: cỡ từ 38 trở lên -0.02 đến -0.03em (siết hơn thì dấu tiếng Việt dính nhau), 21-28 -0.01em, chữ thường 0, nhãn in hoa nhỏ +0.08em. Dòng: tiêu đề 1.2 (không dưới 1.15, dấu chồng như ấ ệ chạm dòng trên), thân 1.5-1.6.
Khoảng cách: chỉ 8·16·24·32·48·64; trong nhóm nhỏ hơn giữa các nhóm; lề ngoài lớn hơn mọi khoảng trong.
Màu 60-30-10: 60% nền, 30% bề mặt và chữ, 10% nhấn; một màu nhấn, tối đa một màu phụ. Thẻ, nhãn, hộp ghi chú: pha 6-12% màu nhấn vào nền (color-mix), không tô màu bão hòa thuần. Chữ thường đạt tương phản 4.5:1, chữ từ 24px 3:1.
Bo góc đồng tâm: R ngoài = R trong + padding; thẻ lồng thẻ không cùng một bán kính.
Số: font-variant-numeric:tabular-nums trong bảng và KPI, cột số căn phải, cùng số chữ số thập phân; số tiếng Việt viết 14,2% và 1.250 tỉ; KPI hẹp thì đơn vị nhỏ hơn số, không để đơn vị rớt dòng.
Xuống dòng: tiêu đề text-wrap:balance, không để một chữ rớt một mình ở dòng cuối; đoạn văn text-wrap:pretty; khối văn đọc dài rộng 60-75 ký tự (đặt cho khối văn, không đặt cho mọi p, li, nhất là trong thẻ và bảng).
Biểu đồ: mỗi hình một ý. Bỏ lưới dọc, khung, 3D, chú giải khi ghi nhãn thẳng được; các cột hoặc đường thường dùng màu trung tính, chỉ chuỗi mà tiêu đề nhắc tới dùng màu nhấn; ghi số ngay trên cột thay cho trục y; tròn tối đa 5 phần; luôn ghi nguồn. Không cầu vồng.
Nội dung: số liệu không có trong yêu cầu thì ghi rõ là ví dụ, không viết như thật.`;

const FORMAT_RULES: Record<DesignFormat, string> = {
  slide: `Slide 16:9, một trang text/html, mỗi slide một <section class="slide">. Cỡ ở 1280×720: nhãn 14, tiêu đề 38-44, kicker và thân 18-22, nguồn 12-14, KPI 56-96. Khung xem trước nhỏ hơn 1280 nên không dùng px cứng: dùng lớp sx-…, calc(N*var(--sx-u)) hoặc vw.
Mỗi slide 3 tầng: nhãn (chủ đề ngắn) → tiêu đề kết luận (một câu nêu phát hiện, có số: "Tự động hóa kho đưa biên ròng tăng 14,2%", không viết "Doanh thu quý 3"; tối đa 14 từ, 2 dòng) → kicker (phạm vi, nguồn, tùy chọn).
Một slide một ý, tối đa 40 từ ngoài bảng. Chữ dài thì chia slide, không thu nhỏ chữ dưới 18. Bố cục đổi nhịp: không dùng một lưới quá 2 slide liền, bìa và slide phân đoạn khác hẳn slide nội dung. Chân slide tối đa một dòng nguồn.`,
  doc: `Tài liệu: thân 16px màn hình, 11pt in; tiêu đề 28/21/16; mở đầu bằng tóm tắt kết luận 2-3 câu trước phần diễn giải; mục lớn có tiêu đề nêu điều rút ra, không chỉ tên mục. Bảng: chỉ kẻ ngang mảnh, không kẻ dọc, số căn phải, hàng tổng đậm.
In: khổ A4 lề 20mm; break-after:avoid cho tiêu đề; break-inside:avoid cho thẻ, hình, bảng ngắn; bảng dài dài hơn một trang thì cho ngắt và lặp thead; orphans:3; widows:3; bỏ bóng, kính mờ, nền trang tối khi in.
Dạng: mặc định artifact Markdown (đề mục, bảng, danh sách là đủ); cần bố cục, biểu đồ, một trang A4 thì text/html. Văn bản hành chính của cơ quan dùng kiểu vbhc, không áp dụng khối này.`,
  sheet: `Excel: mọi tổng, tỉ lệ, chênh lệch là công thức sống (=SUM(D4:D11), =(D11-C11)/C11), không ghi số Python tính sẵn; giả định ở ô riêng, công thức trỏ tới ô đó.
Màu chữ theo vai trò: ô nhập tay xanh dương Font(color="0000FF"), công thức đen "000000", liên kết sang sheet khác xanh lục "006100". Nền trắng, chỉ tô nhẹ giả định chính.
Hàng tổng: đậm, Border(top=Side(style="thin"), bottom=Side(style="double")). Tiêu đề cột đậm có nền, freeze_panes dưới tiêu đề, số căn phải.
Định dạng số: #,##0 · tiền #,##0 "₫" · âm trong ngoặc #,##0;(#,##0);"-" · tỉ lệ 0.0% · ngày dd/mm/yyyy · bội 0.0"x".
Thanh trong ô bằng định dạng có điều kiện thật (Excel tự cập nhật theo số), không vẽ bằng ký tự hay ảnh:
from openpyxl.formatting.rule import DataBarRule, ColorScaleRule
ws.conditional_formatting.add("E4:E11", DataBarRule(start_type="num", start_value=0, end_type="max", color="5B9BD5", showValue=True))
Bản đồ nhiệt: ColorScaleRule(start_type="min", start_color="FFFFFF", end_type="max", end_color="5B9BD5"). Biểu đồ: một chuỗi nhấn, các chuỗi khác xám.`,
  graphic: `Đồ họa (poster, banner, infographic, trang đích): dựng theo 4 lớp: nền → hình và đường lưới → ảnh → chữ. Một ý chính; tiêu đề lớn gấp 3-4 lần chữ thường, đọc được trong 3 giây; tối đa 3 cỡ chữ; lề từ 5% cạnh ngắn; chữ không đè vùng ảnh nhiều chi tiết, cần thì phủ một lớp nền.
Cần chữ chính xác thì dựng bằng text/html hoặc SVG; xin ảnh chụp, tranh thì dùng generate_image. Icon trong React dùng lucide-react; SVG tự viết thoải mái cho biểu đồ, hình học, sơ đồ khi có viewBox rõ và màu lấy từ biến.
Hiệu ứng có chủ đích, tối đa 2 loại mỗi trang: kính mờ chỉ khi có nền sâu phía sau; không chữ chuyển màu ở nội dung phải đọc (không đo được tương phản, xuất PowerPoint mất màu).`,
};

const KIT = (preset: string) => `Bộ CSS sẵn trong khung artifact: không cần nạp, phông đủ dấu tiếng Việt tự tải, tải về vẫn kèm. Đặt <html data-sx-preset="${preset || "swiss-grid"}"> (React: trên div ngoài cùng); thêm data-sx-theme="auto" nếu trang đọc nên theo chế độ tối của máy (slide, poster giữ cố định). Trong run_code không có bộ này: dùng các số ở trên.
Khung: <section class="slide sx-slide"> .sx-page (A4, tự có luật in) .sx-poster (3:4). Chữ: .sx-eyebrow .sx-title .sx-display .sx-kicker .sx-h2 .sx-h3 .sx-text .sx-small .sx-source .sx-kpi .sx-num .sx-muted .sx-accent .sx-up .sx-down. Bố cục: .sx-stack .sx-row .sx-between .sx-grow .sx-end .sx-gap-{8,16,24,32,48,64} .sx-p-{…}. Lưới: .sx-grid-hero (1 lớn trái, 2 nhỏ phải) .sx-grid-4060 .sx-grid-6040 .sx-grid-bento4 (7:5 rồi 5:7) .sx-grid-dash (4 KPI, phần tử thứ 5 tràn hàng) .sx-grid-3. Bề mặt: .sx-card .sx-inner (ảnh, hộp trong thẻ, bo đồng tâm) .sx-tint .sx-solid .sx-badge .sx-callout .sx-rule. Bảng: .sx-table, ô số .n, hàng tổng .sx-total, thanh trong ô <td class="sx-bar n" style="--sx-v:72%">. Hiệu ứng: .sx-shadow .sx-rim .sx-glass .sx-aurora .sx-noise. Chuyển động: .sx-rise .sx-fade .sx-pop (style="--sx-i:0,1,2…" để lệch nhịp 70ms), .sx-draw cho path có pathLength="1"; đã tôn trọng prefers-reduced-motion, hỏng hay khi in vẫn hiện đủ: đừng tự đặt opacity:0 chờ JS.
Biến: --sx-bg --sx-surface --sx-raised --sx-ink --sx-muted --sx-accent --sx-accent2 --sx-line --sx-neutral --sx-pos --sx-neg --sx-head --sx-body --sx-mono; cỡ tự tính: calc(N*var(--sx-u)). CSS của bạn viết sau sẽ thắng nếu cần chỉnh.`;

const FILE_RULES: Partial<Record<DesignFormat, string>> = {
  slide: `Tệp .pptx qua run_code (chỉ khi cần shape gốc, còn lại Tải về › PowerPoint từ artifact): python-pptx 13.333×7.5in, tiêu đề ở placeholder, phông Arial hoặc Calibri vì máy người nhận chắc có.`,
  doc: `Tệp qua run_code: Word bằng python-docx, dùng style Heading và Table thay vì tô tay, Calibri hoặc Arial 11pt, keep_with_next cho tiêu đề, chân trang có số trang (phông lạ sẽ bị thay trên máy người nhận). PDF: HTML in bằng Chromium (page.pdf, preferCSSPageSize) với luật in ở trên.`,
  graphic: `Ảnh qua run_code: HTML + Chromium ở deviceScaleFactor 2, đúng kích thước yêu cầu.`,
};
// Phông trong image workspace (workspace/Dockerfile): PDF và ảnh nhúng sẵn nên dùng được; Office thì không (xem trên).
const WS_FONTS = `Phông có sẵn trong sandbox: Be Vietnam Pro, Inter, Plus Jakarta Sans, Playfair Display, Space Grotesk, JetBrains Mono, Noto Sans.`;

function presetLine(id: string, own: boolean) {
  if (own) return `Người dùng đã có bản sắc riêng (thương hiệu, bảng màu, mẫu): theo đúng bản sắc đó, chỉ giữ các số đo; không áp preset màu.`;
  const p = presetOf(id)!;
  return `Phong cách gợi ý: ${p.id} (${p.label}; phông ${p.head}${p.body !== p.head ? ` + ${p.body}` : ""}; nền ${p.bg}, chữ ${p.ink}, nhấn ${p.accent}). Người dùng hoặc nội dung nói khác thì theo họ. Preset khác: ${PRESETS.filter((x) => x.id !== id).map((x) => x.id).join(", ")}. Không bắt chước thương hiệu có thật.`;
}

export type DesignPick = { format: DesignFormat; domain: DesignDomain; preset: string; own: boolean };
/** Ghép khối quy tắc đầy đủ; phần sau bị bỏ nếu vượt trần (phần trên quan trọng hơn). */
export function designBlock(p: DesignPick, caps: { art: boolean; code: boolean }): string {
  const open = `<design_kit format="${p.format}" domain="${p.domain}"${p.own ? "" : ` preset="${p.preset}"`}>\nSố đo cho sản phẩm của lượt này (artifact hoặc tệp), áp dụng im lặng, không kể lại. Yêu cầu riêng của người dùng luôn ưu tiên. Chỉ trả lời thường trong chat thì bỏ qua khối này.`, close = "</design_kit>";
  const sheetOnly = p.format === "sheet" && caps.code;
  const parts = [
    FORMAT_RULES[p.format],
    sheetOnly ? "" : presetLine(p.preset, p.own),
    sheetOnly ? "" : CORE,
    caps.art && !sheetOnly ? KIT(p.own ? "" : p.preset) : "",
    caps.code && FILE_RULES[p.format] ? FILE_RULES[p.format]! : "",
    caps.code && (p.format === "doc" || p.format === "graphic" || p.format === "slide") ? WS_FONTS : "",
  ].filter(Boolean);
  let out = open;
  for (const x of parts) if (designBytes(`${out}\n${x}\n${close}`) <= DESIGN_BUDGET) out += `\n${x}`;
  return `${out}\n${close}`;
}
const compactBlock = (format: DesignFormat, preset: string) => `<design_kit format="${format}" mode="follow-up"${preset ? ` preset="${preset}"` : ""}>
Đang sửa tiếp sản phẩm đã có: giữ nguyên phong cách, phông, thang chữ và lưới 8pt của bản hiện tại (lớp sx-… nếu bản hiện tại đang dùng vẫn có sẵn); chỉ đổi đúng chỗ được yêu cầu. Tiêu đề vẫn nêu kết luận, tương phản đạt 4.5:1, chữ không tràn.
</design_kit>`;

/** Thiết kế đã dùng trong đoạn chat: artifact gần nhất trong lịch sử (hoặc bản còn giữ trong artBase). */
export function priorDesign(texts: string[]): { format: DesignFormat; preset: string } | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    if (!t || !/<artifact\b/.test(t)) continue;
    const preset = /data-sx-preset=["']?([\w-]+)/.exec(t)?.[1] ?? "";
    if (/<section\b[^>]*class=["'][^"']*\bslide\b/.test(t)) return { format: "slide", preset };
    if (/type=["'](?:text\/markdown|markdown)/.test(t)) return { format: "doc", preset };
    if (/sx-page/.test(t)) return { format: "doc", preset };
    if (/type=["'](?:text\/html|html|react|svg|application\/vnd\.(?:ant\.)?react|image\/svg)/.test(t)) return { format: "graphic", preset };
    return null;
  }
  return null;
}

export type DesignTurn = DesignPick & { block: string; compact: boolean; bytes: number };
/** Khối cho lượt này, hoặc null (trò chuyện thường, hỏi kiến thức, câu xác nhận, không có khả năng nào để tạo sản phẩm). */
export function designTurn(i: { typed: string; studio?: string | null; art: boolean; code: boolean; ack?: boolean; seed?: string; prior?: string[] }): DesignTurn | null {
  if ((!i.art && !i.code) || process.env.SYNCHRO_DESIGNKIT === "0" || /(?:^|\s)#nodesign\b/.test(i.typed)) return null;
  const typed = i.typed.trim();
  const inStudio = i.studio ? STUDIO_FORMAT[i.studio] : undefined;
  // Câu lệnh nằm ở đầu tin nhắn; phần sau có thể là văn bản dán vào, từ khóa trong đó không tính.
  const head = typed.slice(0, 300);
  if (!head || i.ack || isQuestion(head) || OTHER_JOB.test(fold(head))) return null;
  const prior = priorDesign(i.prior ?? []);
  const said = formatOf(head);
  const follow = (f: DesignFormat, preset: string) => { const block = compactBlock(f, preset); return { format: f, domain: "general" as const, preset, own: false, block, compact: true, bytes: designBytes(block) }; };
  if (!said) {
    if (prior && wantsEdit(head)) return follow(prior.format, prior.preset);
    if (!inStudio) return null;
  } else if (!inStudio && !wantsMake(head)) return null;
  const format = said ?? inStudio!;
  if (format === "doc" && VBHC.test(fold(head))) return null;
  if (format === "sheet" && !i.code) return null; // không có run_code thì không làm được tệp Excel, quy tắc openpyxl vô nghĩa
  if (prior && prior.format === format && (wantsEdit(head) || !NEW_ONE.test(fold(head)))) return follow(format, prior.preset);
  const domain = domainOf(head);
  const own = OWN_BRAND.test(fold(head));
  const preset = presetFor(format, domain, head, i.seed);
  const block = designBlock({ format, domain, preset, own }, { art: i.art, code: i.code });
  return { format, domain, preset, own, block, compact: false, bytes: designBytes(block) };
}

/** Văn bản của các artifact trước trong đoạn chat, để biết lượt này là làm mới hay sửa tiếp. */
export function historyTexts(messages: unknown, base?: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(base)) for (const b of base as { ident?: unknown; type?: unknown; content?: unknown }[]) if (typeof b?.content === "string") out.push(`<artifact type="${String(b.type ?? "")}">${b.content.slice(0, 20_000)}`);
  if (Array.isArray(messages)) for (const m of (messages as { role?: string; content?: unknown }[]).slice(-12)) {
    if (m?.role !== "assistant" && m?.role !== "ai") continue;
    if (typeof m.content === "string") out.push(m.content);
    else if (Array.isArray(m.content)) out.push((m.content as { text?: unknown }[]).map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n"));
  }
  return out;
}
