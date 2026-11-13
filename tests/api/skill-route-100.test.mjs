// D4 — nghiệm thu: bộ 100 câu có nhãn trên danh mục thật phải chọn đúng top-3 ≥ 90 câu, và yêu cầu motion-graphic chọn skill Remotion.
// Mô tả từng skill chỉ có sau khi cài, nên dựng ứng viên như lúc gợi ý thật: tên skill + tóm tắt thư viện (weight 0.6). Không cần máy chủ.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };
const { skillroute: SR, videokit: VK } = await loadTs(["skillroute", "videokit"]);
const dir = JSON.parse(fs.readFileSync("catalog/claude-directory.json", "utf8")).plugins;
const real = dir.flatMap((p) => p.skills.map((name) => ({ skill: { name: `${p.slug}:${name}`, description: `${name.replace(/-/g, " ")}. ${p.summary}`, user_id: "u" }, weight: 0.6 })));
const top3 = (q) => SR.suggest(q, real).slice(0, 3).map((h) => h.skill.name.split(":").pop());

// [câu hỏi, biểu thức khớp tên skill mong đợi trong top-3]. Trộn tiếng Việt và tiếng Anh, có dấu và không dấu, như người dùng thật gõ.
const SAMPLES = [
  ["Tối ưu SEO cho website", /seo/], ["phân tích từ khóa SEO", /seo|keyword/], ["Làm hóa đơn cho khách hàng", /invoice/], ["lam hoa don cho khach hang", /invoice/],
  ["Tính thuế thu nhập cá nhân", /tax/], ["tu van thue doanh nghiep", /tax/], ["Soạn hợp đồng thuê nhà", /legal|contract|agreement|nda/], ["review hợp đồng NDA", /legal|contract|nda|review/],
  ["Làm slide thuyết trình về khí hậu", /slide|deck|present/], ["tạo pitch deck gọi vốn", /deck|pitch|present/], ["Tạo file Excel bảng lương", /excel|spreadsheet|sheet/], ["phân tích dữ liệu bằng spreadsheet", /excel|spreadsheet|sheet|data/],
  ["Viết email xin nghỉ phép", /email|mail/], ["soạn email marketing cho khách", /email|mail|marketing/], ["Review pull request này", /pull-request|pr-review|pr\b|review/], ["review pull request của team", /pull-request|pr|review|code/],
  ["Tuyển dụng lập trình viên", /recruit|talent|hiring|candidate/], ["viết mô tả công việc tuyển dụng", /recruit|job|hiring|talent/], ["Lịch trình du lịch Đà Lạt 3 ngày", /itinerary|trip|travel/], ["đặt phòng khách sạn cho chuyến đi", /hotel|travel|trip|booking/],
  ["Làm video giới thiệu sản phẩm", /video/], ["dựng video TikTok", /video|tiktok|short/], ["Lập ngân sách đám cưới", /wedding|budget|event/], ["kế hoạch tổ chức tiệc cưới", /wedding|event|plan/],
  ["Thiết kế logo thương hiệu", /logo|brand|design/], ["làm poster sự kiện", /poster|design|flyer/], ["thiết kế giao diện trang đích", /landing|ui|design|web/], ["design system cho app", /design-system|design|token/],
  ["Viết tài liệu kỹ thuật", /doc|documentation|writing|technical/], ["tạo file Word báo cáo", /word|docx|doc|report/], ["chuyển tài liệu PDF sang Word", /pdf|word|doc|convert/],
  ["Viết CV xin việc", /resume|cv/], ["viết thư xin việc cover letter", /cover|letter|resume|cv/], ["truy vấn cơ sở dữ liệu SQL", /sql|database|query/], ["thiết kế schema database", /database|schema|sql/],
  ["Rà soát bảo mật ứng dụng", /security|vuln|audit|pentest/], ["tìm lỗ hổng bảo mật", /security|vuln|threat/], ["viết test tự động Playwright", /test|playwright|e2e/], ["kiểm thử giao diện web", /test|qa|review|design|web/],
  ["Triển khai app lên Vercel", /deploy|vercel|hosting/], ["cấu hình Docker container", /docker|container|cloud/], ["Lập kế hoạch marketing", /marketing|campaign|seo|growth|content/], ["chạy chiến dịch quảng cáo", /ads?|campaign|marketing/],
  ["Quản lý khách hàng tiềm năng", /crm|lead|sales|customer/], ["chốt đơn bán hàng B2B", /sales|deal|pipeline/], ["Hỗ trợ khách hàng qua ticket", /support|ticket|helpdesk/], ["trả lời khiếu nại khách hàng", /support|customer|complaint/],
  ["Lịch tập gym cho người mới", /fitness|workout|gym|exercise/], ["thực đơn giảm cân", /nutrition|diet|meal|food/], ["Công thức nấu phở", /recipe|cooking|food|meal/], ["lên thực đơn nhà hàng", /menu|recipe|food/],
  ["Soạn giáo án dạy Toán", /lesson|education|teach|course/], ["tạo flashcard ôn thi", /flashcard|study|quiz|learn/], ["Viết nhạc cho đám cưới", /music|song|wedding/], ["sáng tác bài hát pop", /song|music|compose/],
  ["Thu âm podcast", /podcast|audio|voice/], ["lồng tiếng cho video", /voice|audio|video|dub/], ["Tóm tắt bài báo khoa học", /research|paper|summar|academic/], ["viết luận văn thạc sĩ", /thesis|research|academic|paper/],
  ["Làm game đơn giản bằng Unity", /game|unity/], ["tạo trò chơi ô chữ sudoku", /puzzle|sudoku|crossword|game/], ["Ghi chú vào Notion", /notes?|notion|obsidian/],
  ["Quản lý máy chủ AWS", /aws|cloud|server|infra/], ["cấu hình Kubernetes", /kubernetes|k8s|cloud|devops/], ["Bán hàng trên Shopify", /shopify|ecommerce|store/],
  ["Lập kế hoạch tài chính cá nhân", /finance|budget|saving|money/], ["lập ngân sách cho dự án", /budget|finance|expense/], ["Gây quỹ cho tổ chức phi lợi nhuận", /nonprofit|fundrais|donor|grant/], ["viết đơn xin tài trợ", /grant|fundrais|proposal|nonprofit/],
  ["Viết PRD cho tính năng mới", /prd|spec|product|requirement/], ["lập roadmap sản phẩm", /roadmap|product|backlog/], ["Tự động hóa quy trình", /automation|workflow|pipeline/], ["lên lịch chạy cron job", /cron|schedule|automation|job/],
  ["Giám sát lỗi hệ thống", /log|monitor|observ|error|sentry/], ["theo dõi hiệu năng ứng dụng", /monitor|performance|observ|metric/], ["Nâng cấp thư viện npm", /dependency|package|npm|upgrade/], ["kiểm tra lỗ hổng dependency", /dependency|vuln|package|audit/],
  ["Lên lịch cuộc họp", /calendar|schedule|meeting/], ["ghi biên bản cuộc họp", /meeting|minutes|notes/], ["Dịch tài liệu sang tiếng Anh", /translat/], ["dịch phụ đề video", /translat|subtitle|video/],
  ["Viết blog về du lịch", /blog|writing|article/], ["biên tập bài viết dài", /edit|article|writing|prose/], ["Vẽ minh họa cho sách", /poster|illustration|art|design|image|book/], ["tạo ảnh bằng AI", /image|generat|art/],
  ["Phân tích đối thủ cạnh tranh", /competitor|market|research|analysis/], ["khảo sát thị trường", /market|survey|research/], ["Xây dựng chatbot AI", /chatbot|ai|agent|llm/],
  ["Quản lý công việc nhóm", /task|project|jira|management/], ["tạo ticket Jira", /jira|ticket|task/], ["Soạn chính sách nội bộ công ty", /policy|handbook|hr|document/], ["viết sổ tay nhân viên", /handbook|hr|employee|policy/],
  ["Làm infographic số liệu", /infographic|chart|data|visual/], ["vẽ biểu đồ từ dữ liệu", /chart|data|visual|graph/], ["Tạo trang web giới thiệu", /website|web|landing|site/], ["xây dựng landing page bán hàng", /landing|web|page|site/],
  ["Viết kịch bản video YouTube", /script|video|youtube/], ["lên nội dung mạng xã hội", /social|content|marketing/], ["Tạo bản tin email hàng tuần", /newsletter|email|update/], ["viết thông cáo báo chí", /press|release|announcement|news|pr|writing/],
];

console.log(`Bộ ${SAMPLES.length} câu có nhãn trên danh mục thật`);
let hit = 0;
const miss = [];
for (const [q, re] of SAMPLES) { const t = top3(q); if (t.some((n) => re.test(n))) hit++; else miss.push([q, t]); }
ok(SAMPLES.length === 100, `đúng 100 câu (${SAMPLES.length})`);
ok(hit >= 90, `chọn đúng top-3: ${hit}/100 (cần ≥ 90)`, miss.map(([q, t]) => `${q} → ${t}`).join(" | "));

console.log("Yêu cầu đồ họa chuyển động chọn Remotion");
for (const q of ["làm một motion graphic cho logo", "dựng video đồ họa chuyển động giới thiệu sản phẩm", "tạo intro animation cho kênh"])
  ok(VK.wantsVideo(q) && /remotion/i.test(VK.VIDEO_KIT), `“${q}” → bộ video Remotion`, VK.wantsVideo(q));

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
