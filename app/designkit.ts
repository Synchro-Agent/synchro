// Khối quy tắc thiết kế cho từng lượt: chỉ nạp đúng thứ việc đang làm cần (slide, tài liệu, bảng tính, đồ họa), bằng số đo thay cho tính từ.
// Không vào system prompt: khối đổi theo yêu cầu nên đi cạnh tin nhắn mới nhất như skill_routing, phần đầu prompt giữ nguyên từng chữ để đọc từ bộ đệm (xem chatengine.ts).
// Trò chuyện thường, câu hỏi kiến thức, đường nhanh: không thêm gì. Lượt tiếp theo trên cùng sản phẩm: bản rút gọn, vì mỗi dòng ở đây còn lại trong lịch sử đoạn chat.
// Tệp thuần (không DB, không mạng), kiểm thử bằng tests/api/designkit.test.mjs. #nodesign trong tin nhắn hoặc SYNCHRO_DESIGNKIT=0 thì tắt, để so sánh trước / sau với model thật.
import { PRESET_ALIASES, presetId, presetOf, PRESETS } from "./designpresets";
import { SLIDE_TPL_GUIDE, templateKinds } from "./designtemplates";

export type DesignFormat = "slide" | "doc" | "sheet" | "graphic";
export type DesignDomain = "finance" | "data" | "tech" | "editorial" | "marketing" | "event" | "product" | "general";
/** Trần mỗi lượt, tính theo byte UTF-8 (tiếng Việt nặng hơn số ký tự). 8 KB từ khi có hợp đồng mẫu điền sẵn (designtemplates.ts): model chỉ viết vài trăm byte JSON
 *  thay cho hàng chục KB HTML, phần đổi lại là thực đơn mẫu của đúng một định dạng (slide, tài liệu hay đồ họa), không nạp thực đơn của định dạng khác. */
export const DESIGN_BUDGET = 8192;
export const STUDIO_FORMAT: Record<string, DesignFormat> = { slides: "slide", docs: "doc", design: "graphic" };

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();

// ---------------------------------------------------------------- nhận diện
// So khớp giữ dấu: chữ có dấu khớp đúng dấu đó hoặc không dấu. "nền tối" nhận "nen toi", "nền toi", không nhận "nên tôi"; "vẽ" không nhận "về", "làm" không nhận "lắm", "đề án" không nhận "để ăn".
const accented = (src: string) => src.normalize("NFC").replace(/\p{L}/gu, (c) => { const f = fold(c); return f === c.toLowerCase() ? c : `[${c}${f}]`; });
const WB = "(?<![\\p{L}\\p{N}])", WE = "(?![\\p{L}\\p{N}])";
const word = (src: string) => new RegExp(`${WB}(?:${accented(src)})${WE}`, "u");
const clean = (s: string) => s.normalize("NFC").toLowerCase(); // NFC: chuỗi dán từ macOS, bảng mã tổ hợp

// Danh từ chỉ sản phẩm. Từ nhiều nghĩa (đề xuất, báo cáo, hồ sơ, tài liệu) chỉ tính khi là tân ngữ của động từ làm ra (xem OBJ): "giúp mình đề xuất món ăn", "lời khuyên về hồ sơ du học" là trò chuyện.
const N_SLIDE = "slide ?decks?|slides?|pitch ?decks?|decks?|thuyết trình|trình chiếu|bản trình bày|bài trình bày|powerpoint|pptx|keynote|presentation";
const N_SHEET = "excel|xlsx|bảng tính|spreadsheet|google sheets?|financial model|mô hình tài chính";
const N_GRAPHIC = "poster|banner|infographic|flyer|tờ rơi|tờ gấp|brochure|thẻ mạng xã hội|ảnh bìa|thumbnail|landing page|trang đích|thiệp|dashboard|trang web|website|giao diện";
const N_DOC = "báo cáo|đề xuất|kế hoạch (?:kinh doanh|marketing|dự án|triển khai|chiến lược|tài chính|sản xuất|truyền thông|nhân sự)|business plan|tài liệu|đề án|hồ sơ|word(?: document| doc| file)?(?! [a-z])|docx|pdf|proposal|reports?|white ?paper|memo|one.?pager|một trang|sổ tay|handbook";
// Văn bản hành chính có kiểu artifact riêng (vbhc), Synchro tự dàn trang đúng thể thức: quy tắc này không áp dụng. "ra quyết định" trong câu thường không tính: phải là tân ngữ hoặc đứng đầu câu.
const N_VBHC = "công văn|quyết định|tờ trình|biên bản|giấy mời|chỉ thị";
const NOUNS = `(?:(?<slide>${N_SLIDE})|(?<sheet>${N_SHEET})|(?<graphic>${N_GRAPHIC})|(?<vbhc>${N_VBHC})|(?<doc>${N_DOC}))${WE}(?! (?:formula|macro|công thức|hàm))`;
// Giữa động từ và danh từ chỉ cho lượng từ, người được làm giúp, tính từ tiếng Anh: "viết email gửi sếp nói báo cáo sẽ trễ" có sản phẩm là email, "sửa lỗi trên trang web" là sửa lỗi.
const FILL = "(?:(?:giúp|hộ|dùm|giùm|cho|tôi|mình|em|anh|chị|bạn|tớ|ra|một|1|vài|mấy|hai|ba|2|3|4|5|6|bộ|cái|chiếc|tấm|tờ|bản|bài|tập|file|tệp|trang|mẫu|mới|nhanh|a|an|the|me|us|my|our|this|new|another|one|some) ){0,5}";
const ADJ = "(?:(?!about|to|for|on|in|of|with|from|and|sure|learn|know|understand|use|fix|email|e-mail|letter|message|code|script|function|bug|error|ve|cho|cua|gui|thu|tin|ham|loi)[a-z-]+ ){0,2}?";
const CHO = "(?:cho (?:\\S+ ){1,4}?(?=một |1 |bộ |a |an ))?";
const obj = (verb: string, nouns = NOUNS) => new RegExp(`${WB}(?:${accented(verb)}) ${accented(`${CHO}${FILL}`)}${ADJ}${accented(nouns)}`, "u");
const NOT_NOW = "(?<!(?:đã|không|chưa|đừng|sản|nhập|đề|don't|didn't) )";
const MAKE = obj(`${NOT_NOW}(?:làm|tạo|viết|soạn|thiết kế|dựng|vẽ|xuất|lập|chuẩn bị|trình bày|make|create|build|design|draft|write|generate|prepare|produce|export)`);
// Không có "đổi", "convert": "đổi file pdf sang word" là đổi định dạng tệp, không cần quy tắc thiết kế.
const EDIT_OBJ = obj("sửa|chỉnh|chỉnh sửa|cập nhật|thêm|bỏ|xóa|xoá|thay|làm lại|viết lại|làm tiếp|viết tiếp|rút gọn|rút ngắn|change|fix|edit|add|remove|replace|update|redo|revise|tweak|shorten");
// Cần, muốn, giúp chỉ tính với từ chỉ sản phẩm rõ nghĩa ("cần bộ slide"), từ nhiều nghĩa phải có lượng từ ("cần một bản báo cáo").
const WANT = "cần|muốn|giúp|need|want|would like|help";
const WANT_OBJ = obj(`(?:${WANT})(?: (?:tôi|mình|em|có|to|me))?`, `(?:(?<slide>${N_SLIDE})|(?<sheet>${N_SHEET})|(?<graphic>${N_GRAPHIC}))${WE}(?! (?:formula|macro|công thức|hàm))`);
const WANT_DOC = new RegExp(`${WB}(?:${accented(WANT)})(?: (?:${accented("tôi|mình|em")}))? (?:${accented("một|1|cái|bản|a|an")}) ${accented(FILL)}${accented(`(?<doc>${N_DOC})`)}${WE}`, "u");
// "Chuyển báo cáo này thành slide", "turn this report into a poster": sản phẩm là phần sau. Đích là tệp thuần (word, pdf, excel) thì không tính.
const CONVERT = new RegExp(`${WB}(?:${accented("đổi|chuyển|biến|tóm tắt|convert|turn|transform|summari[sz]e")}) .{0,80}? (?:${accented("thành|sang|into|to")}) ${accented(FILL)}${accented(`(?:(?<slide>${N_SLIDE})|(?<graphic>${N_GRAPHIC}))`)}${WE}`, "u");
// Không động từ: "bộ slide về thị trường", "một tấm poster sự kiện". Không tính "slide 2 nói gì", "poster này đẹp".
const BARE = new RegExp(`^(?:(?:${accented("bộ|một|1|a|an|tấm|cái")}) )*${accented(`(?:(?<slide>slides?|slide ?decks?|pitch ?decks?)|(?<graphic>poster|banner|infographic)|(?<vbhc>${N_VBHC}))`)}${WE}(?! (?:\\d|${accented("số|này|đó|kia|nào|là|nói|có|thì|của|this|that")}${WE}))`, "u");
export type DesignJob = { format: DesignFormat | "vbhc"; kind: "make" | "edit" | "convert"; at: number; end: number };
function jobOf(t: string): DesignJob | null {
  const found: DesignJob[] = [];
  for (const [re, kind] of [[CONVERT, "convert"], [EDIT_OBJ, "edit"], [MAKE, "make"], [WANT_OBJ, "make"], [WANT_DOC, "make"], [BARE, "make"]] as const) {
    const m = re.exec(t); if (!m) continue;
    const format = (Object.entries(m.groups ?? {}).find(([, v]) => v)?.[0] ?? "doc") as DesignJob["format"];
    found.push({ format, kind, at: m.index, end: m.index + m[0].length });
  }
  return found.sort((a, b) => a.at - b.at)[0] ?? null;
}
const ASK = /\b(?:la gi|nghia la|tai sao|vi sao|lam sao|lam the nao|the nao|cach (?:lam|tao|viet|dung|ve|thiet ke|xuat)|khac gi|co nen|bao nhieu|what is|what are|how (?:do|to|can)|why|difference between|should i)\b/;
const POLITE = /\b(?:giup|duoc khong|duoc ko|can you|could you|please)\b/;
const OTHER_JOB = /^\s*(?:hay\s+)?(?:dich|tom tat|giai thich|translate|summari[sz]e|explain)\b/;
// Hỏi về việc làm, không phải nhờ làm: từ hỏi đứng trước trong cùng vế ("cách làm slide"), đứng ngay sau ("làm slide thế nào"), hay câu kết bằng dấu hỏi.
// Từ hỏi sau sản phẩm là chủ đề của sản phẩm: "Làm slide giải thích vì sao khách hàng rời bỏ", "Make a poster about how to recycle", "Làm infographic: AI là gì?".
const ASK_AFTER = /^(?:\s+(?:cho dep|dep|hay|tot|nhanh))*\s*(?:(?:nhu )?the nao|ra sao|lam sao|la gi|co nen|co can|co kho|co de|khac gi|bao nhieu)\b/;
const TOPIC_AFTER = /^\s*(?::|(?:ve|gioi thieu|giai thich|phan tich|huong dan|about|on|explaining|showing|for|cho|de)\b)/;
function isQuestion(t: string, job: DesignJob | null) {
  const f = fold(t);
  if (!job) return ASK.test(f) || (/\?\s*$/.test(t) && !POLITE.test(f));
  const before = fold(t.slice(0, job.at)).split(/[,.;:]|\bnen\b/).pop() ?? "", after = fold(t.slice(job.end));
  if (ASK.test(before) || ASK_AFTER.test(after)) return true;
  return /\?\s*$/.test(t) && !POLITE.test(f) && !TOPIC_AFTER.test(after);
}
const CODE = word("code|script|python|javascript|typescript|sql|regex|bug|function|hàm|lập trình");
const wantsEdit = word("sửa|chỉnh|đổi|thêm|bỏ|xóa|xoá|thay|cập nhật|làm lại|viết lại|làm tiếp|viết tiếp|rút gọn|rút ngắn|ngắn lại|gọn lại|(?:to|nhỏ|lớn|đậm|nhạt|sáng|tối|ngắn|dài|gọn|đẹp|rõ) hơn|change|fix|edit|add|remove|replace|update|redo|revise|tweak|shorten|make (?:it|this)|bolder|shorter|longer|bigger|smaller|darker|lighter");
// Động từ "làm" mà nói về chính sản phẩm đã có: "Làm slide 3 đậm hơn", "Làm báo cáo này gọn hơn", "make this deck shorter". Phần sau "về, about" là chủ đề của sản phẩm mới, không tính.
const REFERS_BACK = new RegExp(`${WB}${accented(`(?:(?:slide|trang|mục|phần|bảng|biểu đồ|hình|page|section|chart) (?:số )?\\d+|(?:${N_SLIDE}|${N_GRAPHIC}|${N_DOC}) (?:này|đó|kia|trên|vừa (?:rồi|làm|tạo)|hiện tại|cũ)|(?:this|that|current|existing) (?:${N_SLIDE}|${N_GRAPHIC}|${N_DOC})|(?:to|nhỏ|lớn|đậm|nhạt|sáng|tối|ngắn|dài|gọn|đẹp|rõ) hơn|ngắn lại|gọn lại|bolder|shorter|longer|bigger|smaller|darker|lighter)`)}${WE}`, "u");
const TOPIC = word("về|giới thiệu|about");
const refersBack = (t: string) => REFERS_BACK.test(t.split(TOPIC)[0]);
const NEW_ONE = word("mới|khác|new|another|separate");

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
  [word("tạp chí|editorial|sang trọng cổ điển"), "editorial-serif"], [word("brutalis\\w*|thô mộc"), "neo-brutalist"], [word("kính mờ|glass\\w*|cực quang|aurora"), "aurora-glass"],
  [word("bento"), "soft-bento"], [word("terminal|bảng số dày"), "data-terminal"], [word("swiss|thụy sĩ|thuỵ sĩ"), "swiss-grid"], [word("nền tối|dark mode|dark theme|giao diện tối"), "midnight-tech"],
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
/** Định dạng người dùng nhờ làm ra, không phải từ nào đó trong câu: "làm slide từ file excel này" là slide. */
export function formatOf(typed: string): DesignFormat | null {
  const j = jobOf(clean(typed));
  return j && j.format !== "vbhc" ? j.format : null;
}
export function presetFor(format: DesignFormat, domain: DesignDomain, typed: string, seed = ""): string {
  const t = clean(typed);
  const asked = PRESETS.find((p) => t.includes(p.id))?.id ?? Object.entries(PRESET_ALIASES).find(([k]) => t.includes(k))?.[1] ?? STYLE_WORDS.find(([re]) => re.test(t))?.[1];
  if (asked) return asked;
  const list = PICK[domain][format];
  return list[hash(seed || typed) % list.length];
}

// ---------------------------------------------------------------- quy tắc
const CORE = `Chữ: chỉ dùng thang của định dạng ở trên, mỗi trang tối đa 4 cỡ. Giãn chữ: cỡ từ 38 trở lên -0.02 đến -0.03em (siết hơn thì dấu tiếng Việt dính nhau), 21-28 -0.01em, chữ thường 0, nhãn in hoa nhỏ +0.08em. Dòng: tiêu đề 1.2, phông có chân 1.25 (thấp hơn thì dấu chồng như ấ ệ chạm dòng trên), thân 1.5-1.6.
Khoảng cách: chỉ 8·16·24·32·48·64; trong nhóm nhỏ hơn giữa các nhóm; lề ngoài lớn hơn mọi khoảng trong.
Màu 60-30-10: 60% nền, 30% bề mặt và chữ, 10% nhấn; một màu nhấn, tối đa một màu phụ. Thẻ, nhãn, hộp ghi chú: pha 6-12% màu nhấn vào nền (color-mix), không tô màu bão hòa thuần. Chữ thường đạt tương phản 4.5:1, chữ từ 24px 3:1.
Bo góc đồng tâm: R ngoài = R trong + padding; thẻ lồng thẻ không cùng một bán kính.
Số: font-variant-numeric:tabular-nums trong bảng và KPI, cột số căn phải, cùng số chữ số thập phân; số tiếng Việt viết 14,2% và 1.250 tỉ; KPI hẹp thì đơn vị nhỏ hơn số, không để đơn vị rớt dòng.
Xuống dòng: tiêu đề text-wrap:balance, không để một chữ rớt một mình ở dòng cuối; đoạn văn text-wrap:pretty; khối văn đọc dài rộng 60-75 ký tự (đặt cho khối văn, không đặt cho mọi p, li, nhất là trong thẻ và bảng).
Biểu đồ: mỗi hình một ý. Bỏ lưới dọc, khung, 3D, chú giải khi ghi nhãn thẳng được; các cột hoặc đường thường dùng màu trung tính (xám), chỉ chuỗi mà tiêu đề nhắc tới dùng màu nhấn; ghi số ngay trên cột thay cho trục y; tròn tối đa 5 phần; luôn ghi nguồn. Không cầu vồng.
Nội dung: số liệu không có trong yêu cầu thì ghi rõ là ví dụ, không viết như thật.`;

const FORMAT_RULES: Record<DesignFormat, string> = {
  slide: `Slide 16:9, một trang text/html, mỗi slide một <section class="slide">. Thang ở 1280×720: nhãn, nguồn 14; bảng, chú thích 16; thân, kicker 20; phụ đề 26; tiêu đề 44; bìa 56 hoặc 80; KPI 96. Khung xem trước nhỏ hơn 1280 nên không dùng px cứng: dùng lớp sx-… hoặc calc(N*var(--sx-u)).
Mỗi slide 3 tầng: nhãn (chủ đề ngắn) → tiêu đề kết luận (một câu nêu phát hiện, có số: "Tự động hóa kho đưa biên ròng tăng 14,2%", không viết "Doanh thu quý 3"; tối đa 14 từ, 2 dòng) → kicker (phạm vi, nguồn, tùy chọn).
Một slide một ý, tối đa 40 từ ngoài bảng. Chữ dài thì chia slide, thân không dưới 20. Bố cục đổi nhịp: không dùng một lưới quá 2 slide liền, bìa và slide phân đoạn khác hẳn slide nội dung. Chân slide tối đa một dòng nguồn.`,
  doc: `Tài liệu: thang 12·14·16·21·28·38; thân 16px màn hình, 11pt in; tiêu đề 28/21/16; mở đầu bằng tóm tắt kết luận 2-3 câu trước phần diễn giải; mục lớn có tiêu đề nêu điều rút ra, không chỉ tên mục. Bảng: chỉ kẻ ngang mảnh, không kẻ dọc, số căn phải, hàng tổng đậm.
In: khổ A4 lề 20mm; break-after:avoid cho tiêu đề; break-inside:avoid cho thẻ, hình, bảng ngắn; bảng dài dài hơn một trang thì cho ngắt và lặp thead; orphans:3; widows:3; bỏ bóng, kính mờ, nền trang tối khi in.
Dạng: mặc định artifact Markdown (đề mục, bảng, danh sách là đủ); cần bố cục, biểu đồ, một trang A4 thì text/html. Văn bản hành chính của cơ quan dùng kiểu vbhc, không áp dụng khối này.`,
  sheet: `Excel: mọi tổng, tỉ lệ, chênh lệch là công thức sống (=SUM(D4:D11), =(D11-C11)/C11), không ghi số Python tính sẵn; giả định ở ô riêng, công thức trỏ tới ô đó.
Màu chữ theo vai trò: ô nhập tay xanh dương Font(color="0000FF"), công thức đen "000000", liên kết sang sheet khác xanh lục "006100". Nền trắng, chỉ tô nhẹ giả định chính.
Hàng tổng: đậm, Border(top=Side(style="thin"), bottom=Side(style="double")). Tiêu đề cột đậm có nền, freeze_panes dưới tiêu đề, số căn phải.
Định dạng số: #,##0 · tiền #,##0 "₫" · âm trong ngoặc #,##0;(#,##0);"-" · tỉ lệ 0.0% · ngày dd/mm/yyyy · bội 0.0"x".
Thanh trong ô bằng định dạng có điều kiện thật (Excel tự cập nhật theo số), không vẽ bằng ký tự hay ảnh:
from openpyxl.formatting.rule import DataBarRule, ColorScaleRule
ws.conditional_formatting.add("E4:E11", DataBarRule(start_type="num", start_value=0, end_type="max", color="FF5B9BD5", showValue=True))
Bản đồ nhiệt: ColorScaleRule(start_type="min", start_color="FFFFFFFF", end_type="max", end_color="FF5B9BD5"). Biểu đồ: một chuỗi nhấn, các chuỗi khác xám.`,
  graphic: `Đồ họa (poster, banner, infographic, trang đích): dựng theo 4 lớp: nền → hình và đường lưới → ảnh → chữ. Thang: trang web 12·14·16·21·28·38·56; poster (rộng 1080) 20·24·30·40·64·96·152·200. Một ý chính; tiêu đề lớn gấp 3-4 lần chữ thường, đọc được trong 3 giây; tối đa 3 cỡ chữ, không tính nhãn và nguồn; lề từ 5% cạnh ngắn; chữ không đè vùng ảnh nhiều chi tiết, cần thì phủ một lớp nền.
Cần chữ chính xác thì dựng bằng text/html hoặc SVG; xin ảnh chụp, tranh thì dùng generate_image. Icon trong React dùng lucide-react; SVG tự viết thoải mái cho biểu đồ, hình học, sơ đồ khi có viewBox rõ và màu lấy từ biến.
Hiệu ứng có chủ đích, tối đa 2 loại mỗi trang: kính mờ chỉ khi có nền sâu phía sau; không chữ chuyển màu ở nội dung phải đọc (không đo được tương phản, xuất PowerPoint mất màu).`,
};

const KIT = (preset: string) => `Bộ CSS sẵn trong khung artifact: không cần nạp, phông đủ dấu tiếng Việt tự tải, tải về vẫn kèm. Đặt <html data-sx-preset="${preset || "swiss-grid"}"> (React: trên div ngoài cùng; SVG: trên thẻ svg); thêm data-sx-theme="auto" nếu trang đọc nên theo chế độ tối của máy (slide, poster giữ cố định). Trong run_code không có bộ này: dùng các số ở trên.
Khung: <section class="slide sx-slide"> (luôn 16:9, tự co vừa cửa sổ) .sx-page (A4, tự có luật in) .sx-poster (3:4, tự co vừa cửa sổ). Chữ: .sx-eyebrow .sx-title .sx-display .sx-kicker .sx-h2 .sx-h3 .sx-text .sx-small .sx-source .sx-kpi .sx-num .sx-muted .sx-accent .sx-up .sx-down. Bố cục: .sx-stack .sx-row .sx-between .sx-grow .sx-end .sx-gap-{8,16,24,32,48,64} .sx-p-{…}. Lưới: .sx-grid-hero (1 lớn trái, 2 nhỏ phải) .sx-grid-4060 .sx-grid-6040 .sx-grid-bento4 (7:5 rồi 5:7) .sx-grid-dash (4 KPI, phần tử thứ 5 tràn hàng) .sx-grid-3. Bề mặt: .sx-card .sx-inner (ảnh, hộp trong thẻ, bo đồng tâm) .sx-tint .sx-solid .sx-badge .sx-callout .sx-rule. Bảng: .sx-table, ô số .n, hàng tổng .sx-total, thanh trong ô <td class="sx-bar n" style="--sx-v:72%">, ô nhiệt <td class="sx-heat n" style="--sx-v:72%"> (chữ tự đổi sáng / tối theo độ chói nền). Hiệu ứng: .sx-shadow (nền sáng) .sx-rim (nền tối) .sx-glass .sx-aurora .sx-noise; .sx-gradient-text chỉ cho số KPI hay chữ cực lớn, không cho chữ đọc. Ô chữ ngắn trong khung cố định (tiêu đề slide, KPI, thẻ) thêm data-sx-fit: tràn thì Synchro tự co 1px một lần tới 11px, tương phản dưới 4.5:1 thì tự đổi màu chữ; vẫn phải viết vừa khung. Chuyển động: .sx-rise .sx-fade .sx-pop (style="--sx-i:0,1,2…" để lệch nhịp 70ms), .sx-draw cho path có pathLength="1"; đã tôn trọng prefers-reduced-motion, hỏng hay khi in vẫn hiện đủ: đừng tự đặt opacity:0 chờ JS.
Biến: --sx-bg --sx-surface --sx-raised --sx-ink --sx-muted --sx-accent --sx-accent2 --sx-line --sx-neutral --sx-pos --sx-neg --sx-vivid (màu nhấn gốc cho hình, cột được nhấn, không cho chữ) --sx-head --sx-body --sx-mono; cỡ tự tính: calc(N*var(--sx-u)). CSS của bạn viết sau sẽ thắng nếu cần chỉnh.`;

const TPL_GUIDE: Partial<Record<DesignFormat, string>> = { slide: SLIDE_TPL_GUIDE };
const DEFAULT_TPL_STYLE = "swiss-grid";
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
  return `Phong cách gợi ý: ${p.id} (${p.looks}; phông ${p.head}${p.body !== p.head ? ` + ${p.body}` : ""}; nền ${p.bg}, chữ ${p.ink}, nhấn ${p.accent}; bo ${p.r}/${p.ri}px; hợp ${p.best}). Người dùng hoặc nội dung nói khác thì theo họ. Preset khác: ${PRESETS.filter((x) => x.id !== id).map((x) => x.id).join(", ")}. Không bắt chước thương hiệu có thật.`;
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
    // Thực đơn mẫu điền sẵn của đúng định dạng này (không nạp thực đơn của định dạng khác), đứng trước bộ CSS vì là cách nên dùng.
    caps.art && !sheetOnly && TPL_GUIDE[p.format] ? TPL_GUIDE[p.format]!.replace("<phong cách>", p.own ? DEFAULT_TPL_STYLE : p.preset) : "",
    caps.art && !sheetOnly ? KIT(p.own ? "" : p.preset) : "",
    caps.code && FILE_RULES[p.format] ? FILE_RULES[p.format]! : "",
    caps.code && (p.format === "doc" || p.format === "graphic" || p.format === "slide") ? WS_FONTS : "",
  ].filter(Boolean);
  let out = open;
  for (const x of parts) if (designBytes(`${out}\n${x}\n${close}`) <= DESIGN_BUDGET) out += `\n${x}`;
  return `${out}\n${close}`;
}
const compactBlock = (format: DesignFormat, preset: string) => `<design_kit format="${format}" mode="follow-up"${preset ? ` preset="${preset}"` : ""}>
Đang sửa tiếp sản phẩm đã có (câu này không nói về sản phẩm thì bỏ qua khối): giữ nguyên phong cách, phông, thang chữ và lưới 8pt của bản hiện tại (lớp sx-… nếu bản hiện tại đang dùng vẫn có sẵn); chỉ đổi đúng chỗ được yêu cầu. Tiêu đề vẫn nêu kết luận, tương phản đạt 4.5:1, chữ không tràn.
</design_kit>`;

const attrOf = (tag: string, name: string) => new RegExp(`\\b${name}=["']([^"']*)`).exec(tag)?.[1] ?? "";
/**
 * Thiết kế đã dùng trong đoạn chat: artifact đầy đủ gần nhất trong lịch sử (hoặc bản còn giữ trong artBase).
 * Bản sửa (mode="patch", ARTIFACT_RULES bắt sửa theo cách này) và thẻ đánh dấu phiên bản cũ tự đóng không có kiểu, không có thân: đi tiếp về bản đầy đủ của cùng artifact.
 * Bản sửa đổi data-sx-preset thì phong cách hiện tại là của bản sửa (khối thay thế đứng sau khối tìm).
 */
export function priorDesign(texts: string[]): { format: DesignFormat; preset: string } | null {
  let ident = "", newer = "";
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    if (!t || !/<artifact\b/.test(t)) continue;
    for (const part of t.split(/(?=<artifact\b)/).filter((x) => x.startsWith("<artifact")).reverse()) {
      const open = /^<artifact\b[^>]*>/.exec(part)?.[0] ?? "";
      const id = attrOf(open, "identifier");
      if (ident && id && id !== ident) continue;
      if (/\/>$/.test(open)) { ident ||= id; continue; }
      const sets = [...part.matchAll(/data-sx-preset=["']?([\w-]+)/g)].map((m) => presetId(m[1]));
      if (attrOf(open, "mode").toLowerCase() === "patch") { ident ||= id; newer ||= sets[sets.length - 1] ?? ""; continue; }
      const preset = newer || sets[0] || presetId(/"styleArchetype"\s*:\s*"([\w-]+)"/.exec(part)?.[1] ?? ""), type = attrOf(open, "type");
      // Trang viết bằng mẫu điền sẵn: loại sản phẩm theo mẫu của khối JSON.
      const kinds = templateKinds(part);
      if (kinds.includes("slide")) return { format: "slide", preset };
      if (kinds.includes("doc")) return { format: "doc", preset };
      if (kinds.length) return { format: "graphic", preset };
      if (/<section\b[^>]*(?:class(?:Name)?=["'][^"']*\bslide\b|data-slide)/.test(part)) return { format: "slide", preset };
      if (/^(?:text\/markdown|markdown)/.test(type) || /sx-page/.test(part)) return { format: "doc", preset };
      if (/^(?:text\/html|html|react|svg|application\/vnd\.(?:ant\.)?react|image\/svg)/.test(type)) return { format: "graphic", preset };
      return null;
    }
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
  const head = typed.slice(0, 300), t = clean(head);
  if (!head || i.ack) return null;
  const job = jobOf(t);
  if (job?.format === "vbhc" || isQuestion(t, job) || (OTHER_JOB.test(fold(head)) && job?.kind !== "convert")) return null;
  // Việc lập trình nhắc tới sản phẩm ("viết script python xuất báo cáo pdf"): không phải làm sản phẩm.
  if (job && CODE.test(t.slice(0, job.at))) return null;
  const prior = priorDesign(i.prior ?? []);
  const follow = (f: DesignFormat, preset: string) => { const block = compactBlock(f, preset); return { format: f, domain: "general" as const, preset, own: false, block, compact: true, bytes: designBytes(block) }; };
  if (!job) {
    if (prior && wantsEdit.test(t) && !CODE.test(t)) return follow(prior.format, prior.preset);
    if (!inStudio) return null;
    // Trong studio, đã có sản phẩm cùng loại: câu không nêu định dạng là nói về sản phẩm đó.
    if (prior?.format === inStudio && !NEW_ONE.test(t)) return follow(prior.format, prior.preset);
  }
  const format = (job?.format ?? inStudio) as DesignFormat;
  if (format === "sheet" && !i.code) return null; // không có run_code thì không làm được tệp Excel, quy tắc openpyxl vô nghĩa
  // Sửa tiếp chỉ khi câu nói về sản phẩm đã có. "Làm bộ slide về marketing Q4" trong đoạn chat đã có slide là sản phẩm mới: phải có đủ số đo, gọi model bằng khóa API không còn khối của lượt trước trong lịch sử, và khối rút gọn sẽ bảo model chỉ sửa đúng chỗ trên bản cũ.
  if (prior && prior.format === format && (job?.kind === "edit" || refersBack(t))) return follow(format, prior.preset);
  const domain = domainOf(head);
  const own = OWN_BRAND.test(fold(head));
  const preset = presetFor(format, domain, head, i.seed);
  const block = designBlock({ format, domain, preset, own }, { art: i.art, code: i.code });
  return { format, domain, preset, own, block, compact: false, bytes: designBytes(block) };
}

/** Văn bản của các artifact trước trong đoạn chat, để biết lượt này là làm mới hay sửa tiếp. */
export function historyTexts(messages: unknown, base?: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(base)) for (const b of base as { ident?: unknown; type?: unknown; content?: unknown }[]) if (typeof b?.content === "string") out.push(`<artifact identifier="${String(b.ident ?? "")}" type="${String(b.type ?? "")}">${b.content.slice(0, 20_000)}`);
  if (Array.isArray(messages)) for (const m of (messages as { role?: string; content?: unknown }[]).slice(-12)) {
    if (m?.role !== "assistant" && m?.role !== "ai") continue;
    if (typeof m.content === "string") out.push(m.content);
    else if (Array.isArray(m.content)) out.push((m.content as { text?: unknown }[]).map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n"));
  }
  return out;
}
