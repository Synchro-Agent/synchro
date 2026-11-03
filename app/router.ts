// Chế độ "Tự động": Synchro tự chọn model (qua cả Claude, ChatGPT, Gemini, Grok, DeepSeek — gói subscription lẫn khóa API) và mức nỗ lực
// theo từng việc. Nguyên tắc: đủ chất lượng cho việc đó với chi phí và thời gian thấp nhất —
//  1) tách chỉ thị (điều người dùng nhờ) khỏi nội dung đi kèm (đoạn dán vào, câu trong ngoặc kép, code, tệp đính kèm):
//     chỉ thị quyết định loại việc, nội dung chỉ tính độ dài cho những việc phải đọc hết;
//  2) nhận dạng loại việc (trò chuyện, hỏi đáp, học ngôn ngữ, dịch, tóm tắt, viết, code, gỡ lỗi, suy luận, phân tích,
//     tạo sản phẩm, đọc ảnh, tài liệu dài, số liệu) bằng từ điển Việt + Anh, so khớp trên chữ CÒN DẤU
//     (bỏ dấu thì "bằng" thành "bảng", "toàn" thành "toán", "thử" thành "thư");
//  3) độ khó = điểm gốc của loại việc + điều chỉnh (đòi chi tiết, đòi ngắn gọn, lĩnh vực chuyên sâu, nhiều yêu cầu,
//     nội dung dài, tệp / ảnh, chê câu trả lời trước), có trần theo loại việc: câu hỏi ngôn ngữ, dịch, hỏi đáp
//     không bao giờ cần model mạnh nhất hay nỗ lực "cao hơn";
//  4) mỗi model có điểm chất lượng theo loại việc = hạng của model (nhanh / cân bằng / mạnh / mạnh nhất) + thế mạnh của hãng;
//     chọn model rẻ, nhanh nhất vẫn đạt mức chất lượng cần (không model nào đạt thì lấy model tốt nhất);
//     gói subscription đã trả tiền nên được ưu tiên hơn khóa API cùng mức;
//  5) người dùng chê câu trả lời trước ("sai rồi", "làm lại") thì nâng độ khó và đổi sang model khác;
//     câu nối tiếp ngắn ("giải thích thêm", "tiếp đi") giữ loại việc của yêu cầu trước.

export const AUTO = "auto";
export type Tier = "fast" | "balanced" | "strong";
export type Vendor = "anthropic" | "openai" | "google" | "xai" | "deepseek" | "other";
export type Task = "chat" | "qa" | "language" | "translate" | "summarize" | "write" | "code" | "debug" | "reason" | "analyze" | "build" | "vision" | "longdoc" | "data";
export type AutoEffort = "low" | "medium" | "high" | "extra" | "max";

// Hạng theo tên model của các hãng (không khớp thì coi là "balanced"); "mạnh nhất" là dòng đầu bảng của từng hãng.
// Model mã nguồn mở chạy qua gói (GPT-OSS, Llama, Qwen, Mistral…): hạng nhanh, không mang thế mạnh của hãng lớn — "gpt-oss" từng bị coi là
// GPT của OpenAI, được cộng điểm việc số liệu và được chọn làm bảng tính (rồi treo).
const OPEN_WEIGHT = /(gpt-oss|llama|qwen|mistral|mixtral|gemma|phi-\d)/i;
const FAST = /(haiku|flash|lite|mini|nano|luna|small|gpt-oss|llama|qwen|mistral|mixtral|gemma|phi-\d)/i;
// Grok 4.5 trở lên là dòng mạnh nhất của xAI; DeepSeek V4 Pro khớp "-pro".
const STRONG = /(opus|fable|astra|argon|ultra|-pro\b|\bpro\b|grok-4\.[5-9]|grok-[5-9])/i;
const FRONTIER = /(fable|astra|argon|ultra)/i;
export const tierOf = (key: string): Tier => (STRONG.test(key) ? "strong" : FAST.test(key) ? "fast" : "balanced");
export function vendorOf(key: string): Vendor {
  const k = key.toLowerCase();
  if (OPEN_WEIGHT.test(k)) return "other";
  if (/^(anthropic|sub-claude)\//.test(k) || /claude|opus|sonnet|haiku|fable/.test(k)) return "anthropic";
  if (/^(openai|sub-codex)\//.test(k) || /\bgpt|\bo\d|chatgpt|codex/.test(k)) return "openai";
  if (/^(google|sub-agy)\//.test(k) || /gemini/.test(k)) return "google";
  if (/^(xai|sub-grok)\//.test(k) || /\bgrok/.test(k)) return "xai";
  if (/^deepseek\//.test(k) || /deepseek/.test(k)) return "deepseek";
  return "other";
}
const BASE: Record<Tier | "frontier", number> = { fast: 6, balanced: 7.5, strong: 9, frontier: 9.5 };
const COST: Record<Tier | "frontier", number> = { fast: 1, balanced: 3, strong: 8, frontier: 12 };
// Thế mạnh của từng hãng theo loại việc (cộng vào điểm chất lượng của model).
const EDGE: Record<Vendor, Partial<Record<Task, number>>> = {
  anthropic: { code: 0.7, debug: 0.6, build: 0.8, write: 0.5, analyze: 0.3, reason: 0.2, longdoc: 0.2, summarize: 0.3, language: 0.2 },
  openai: { reason: 0.8, data: 0.6, code: 0.4, debug: 0.4, analyze: 0.4, qa: 0.3, write: 0.2, translate: 0.2, build: 0.2, language: 0.3, summarize: 0.2 },
  google: { longdoc: 0.9, vision: 0.9, translate: 0.5, qa: 0.3, data: 0.3, reason: 0.3, code: 0.1, language: 0.3, summarize: 0.5 },
  xai: { reason: 0.5, qa: 0.5, analyze: 0.3, code: 0.4, debug: 0.3, data: 0.3, longdoc: 0.3 },
  deepseek: { code: 0.5, debug: 0.4, reason: 0.5, data: 0.4, analyze: 0.2, longdoc: 0.3 },
  other: {},
};
export type Profile = { key: string; vendor: Vendor; tier: Tier; frontier: boolean; sub: boolean; cost: number };
export function profileOf(key: string): Profile {
  const tier = tierOf(key), frontier = tier === "strong" && FRONTIER.test(key), sub = /^sub-/.test(key);
  // Gói subscription đã trả theo tháng: mỗi lượt gần như không tốn thêm, nên rẻ hơn khóa API cùng hạng.
  return { key, vendor: vendorOf(key), tier, frontier, sub, cost: COST[frontier ? "frontier" : tier] * (sub ? 0.25 : 1) };
}
export const quality = (p: Profile, task: Task) => BASE[p.frontier ? "frontier" : p.tier] + (EDGE[p.vendor][task] ?? 0);

// ---- tách chỉ thị và nội dung ----
// Từ trọn vẹn theo Unicode (\b của JavaScript coi chữ có dấu là ký tự ngăn cách nên "dịch vụ" vẫn khớp "dịch").
const W = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, "iu");
const count = (re: RegExp, s: string) => s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))?.length ?? 0;
// Dòng trông như code thật (không phải chỉ nhắc tên ngôn ngữ lập trình) và dấu vết lỗi khi chạy chương trình.
const CODE_LINE = /^\s*(?:def \w+\(|class \w+\s*[:({]|(?:async )?function\b|(?:const|let|var) \w+\s*=|import .+ from |from [\w.]+ import |#include|(?:public|private|protected) |return\b|if\s*\(|for\s*\(|while\s*\(|\}\s*(?:else)?|<\/?[a-z][\w-]*(?:\s[^>]*)?>|select .+ from |insert into |update \w+ set |\$ \w|>>> |console\.\w+\(|print\(|echo |\w+(?:\.\w+)*\([^()]*\);\s*$|.*\)\s*(?:=>\s*)?\{\s*$)/i;
const TRACE = /Traceback \(most recent call last\)|^\s+at [\w$.<>]+ \(?[^\n]*:\d+:\d+\)?$|^\s*File "[^"]+", line \d+|\b[A-Z]\w*(?:Error|Exception)\b:|npm ERR!|Uncaught \w|Segmentation fault|exit code [1-9]|panicked at/m;
// Phần trước dấu ":" chỉ tới một đoạn nội dung ("Câu này có đúng không: …", "Translate this: …") → phần sau là nội dung.
const POINT = W("câu|đoạn|bài|văn bản|đoạn văn|từ|cụm từ|cụm|email|thư|tin nhắn|nội dung|dịch|sửa|kiểm tra|chữa|check|correct|fix|translate|translation|proofread|rewrite|paraphrase|nghĩa|mean|meaning|phát âm|pronounce|giải thích|explain|phân tích|analy[sz]e|tóm tắt|summari[sz]e|viết lại|this|following|sau|sentence|paragraph|text|phrase|word|passage|essay|đúng|sai|correct|right|wrong");
// Dấu hiệu một câu là lời nhờ (không phải nội dung dán vào).
const ASK_WORDS = W("giúp|hãy|làm ơn|nhờ|cho (?:mình|tôi|em)|please|can you|could you|would you|help|tóm tắt|dịch|sửa|kiểm tra|check|correct|translate|summari[sz]e|explain|giải thích|viết|write|phân tích|analy[sz]e|rewrite|proofread|làm sao|thế nào|how|what|why|là gì");
const ASKING = { test: (x: string) => ASK_WORDS.test(x) || /\?\s*$/.test(x) };
const FILE_NOTE = /Các khối <file> bên dưới[^\n]*|\[File: [^\]\n]*\]|<file\b[\s\S]*?(?:<\/file>|$)/g;

// Phần sau dấu ":" lại chính là lời nhờ tạo sản phẩm ("Kiểm tra giao diện: tạo một trang web…"): phần trước chỉ là nhãn, không phải
// "kiểm tra đoạn sau". Trước đây cả yêu cầu bị coi là nội dung dán vào, Tự động xếp thành hỏi đáp, nỗ lực thấp. Chỉ áp dụng khi nhãn chỉ
// có chữ "kiểm tra / check / test" (bỏ chữ đó đi thì không còn chỉ tới nội dung) và không có "này / sau / this…": "Dịch câu này: Make a
// website…", "Tóm tắt: Tạo một trang web cần ba bước…" thì phần sau vẫn là nội dung.
const MADE = /^\s*(?:(?:hãy|giúp (?:tôi|mình|em)|please|can you)\s+)?(?:tạo|thiết kế|xây dựng|dựng|làm|lập trình|build|create|make|design|develop)(?![\p{L}\p{N}])/iu;
const LABEL_CHECK = new RegExp(W("kiểm tra|kiểm thử|check|test|thử").source, "giu");
const POINTED = W("này|sau|dưới đây|bên dưới|this|these|following|below");
const madeAfter = (head: string, tail: string) =>
  MADE.test(tail) && !POINTED.test(head) && !POINT.test(head.replace(LABEL_CHECK, " ")) && !!SIG.build?.some(([re]) => re.test(tail));

export type Ask = { ins: string; content: number; code: boolean; trace: boolean; quotes: number };
/** Tách chữ người dùng gõ thành chỉ thị (để đoán loại việc) và nội dung đi kèm (chỉ tính độ dài). */
export function splitAsk(text: string): Ask {
  let s = text.normalize("NFC"), content = 0, quotes = 0;
  const trace = TRACE.test(s);
  const keep = (m: string) => { content += m.length; return " ‹…› "; };
  // Khối tệp đính kèm (nếu nơi gọi gửi cả nội dung tệp vào đây) và khối code.
  s = s.replace(FILE_NOTE, keep);
  let code = /```/.test(s) || s.split("\n").filter((l) => CODE_LINE.test(l)).length >= 2;
  s = s.replace(/```[\s\S]*?(?:```|$)/g, keep);
  // Đoạn trong ngoặc kép: là thứ được hỏi tới, không phải lời nhờ (dấu ' trong từ như don't, I'm vẫn nằm trong ngoặc).
  s = s.replace(/“[^”\n]{1,3000}”|"[^"\n]{1,3000}"|«[^»\n]{1,3000}»/g, (m) => { quotes++; return keep(m); });
  s = s.replace(/(^|[\s(:,;])'((?:[^'\n]|'(?=\p{L}))+)'(?=$|[\s.,;:!?)])/gu, (_m, a: string, b: string) => { quotes++; content += b.length + 2; return `${a} ‹…› `; });
  // Phần sau dấu ":" khi phần trước chỉ tới nội dung.
  const c = s.indexOf(":");
  if (c > 0 && c < 220 && !/^\s*\/\//.test(s.slice(c + 1)) && POINT.test(s.slice(0, c)) && s.slice(c + 1).trim().length > 0 && !madeAfter(s.slice(0, c), s.slice(c + 1))) {
    content += s.length - c - 1;
    s = s.slice(0, c);
  }
  // Nhiều đoạn văn: đoạn dài (> 400 ký tự) là nội dung dán vào, đoạn ngắn là lời nhờ.
  const paras = s.split(/\n\s*\n/);
  if (paras.length > 1 && paras.some((p) => p.length > 400) && paras.some((p) => p.trim() && p.length <= 400)) {
    content += paras.filter((p) => p.length > 400).join("").length;
    s = paras.filter((p) => p.length <= 400).join("\n\n");
  } else if (paras.length === 1 && s.length > 700 && !/^\s*(?:[-*•]|\d+[.)])\s/m.test(s)) {
    // Một khối chữ dài liền: lời nhờ thường ở câu đầu hoặc câu cuối, phần giữa là nội dung dán vào.
    const sents = s.split(/(?<=[.?!])\s+|\n+/).filter((x) => x.trim());
    if (sents.length > 2) {
      const head = sents[0], tail = sents[sents.length - 1];
      // Không câu nào là lời nhờ: cả khối là nội dung dán vào, chưa nói cần làm gì.
      const asks = [head, tail].filter((x) => ASKING.test(x));
      content += s.length - asks.join("").length;
      s = asks.join("\n");
    }
  }
  if (trace) code = true;
  return { ins: s.replace(/\s+/g, " ").trim(), content, code, trace, quotes };
}

// ---- nhận dạng loại việc ----
type Sig = [RegExp, number];
const SIG: Partial<Record<Task, Sig[]>> = {
  chat: [[W("xin chào|chào(?: bạn| em| anh| chị| synchro| buổi sáng)?|hi|hello|hey|alo|cảm ơn|cám ơn|thanks?|thank you|ok|oke|okay|vâng|dạ|ừ|ừm|uh|yes|no|tạm biệt|bye|good (?:morning|night|evening)|chúc ngủ ngon|bạn khỏe không|how are you|bạn là ai|who are you|haha|hihi|hehe|tuyệt|great|nice"), 3]],
  language: [
    [W("ngữ pháp|grammar|grammatical|từ vựng|vocabulary|vocab|phát âm|pronounce|pronunciation|phrasal verbs?|idioms?|thành ngữ|tục ngữ|collocations?|synonyms?|antonyms?|từ đồng nghĩa|từ trái nghĩa|chính tả|spelling|giới từ|prepositions?|mạo từ|câu bị động|passive voice|câu điều kiện|conditional sentences?|mệnh đề quan hệ|relative clauses?|câu tường thuật|reported speech|so sánh (?:hơn|nhất)|comparatives?|superlatives?|ielts|toeic|toefl|vstep|cambridge|speaking|listening|writing task|reading passage|proofread"), 4],
    [W("thì (?:hiện tại|quá khứ|tương lai)(?: \\p{L}+)*|(?:present|past|future)(?: perfect| continuous| simple| progressive)+(?: tense)?|tenses?"), 3],
    [W("nghĩa (?:là gì|của (?:từ|cụm|câu)|tiếng việt|là sao)|có nghĩa (?:là )?gì|meaning(?: of)?|what does .{1,60} mean|what is the meaning|định nghĩa (?:của )?từ"), 3],
    [W("how (?:do|to|would|should|can) (?:you |i |we )?(?:say|pronounce|spell)|nói (?:thế|như thế|như) nào|nói sao|nói làm sao|đọc (?:thế|như thế|như) nào|phát âm (?:thế|như) nào|cách (?:dùng|sử dụng|nói|đọc|phát âm) (?:từ|cụm|câu)"), 3],
    [W("(?:câu|đoạn|cụm từ|từ|cách viết) (?:này|đó|trên|sau|dưới)(?: viết)? (?:có )?(?:đúng|sai|chuẩn|tự nhiên|ổn)|(?:is|are) (?:this|it|that|these|the following) (?:sentences? |phrases? |words? |grammar )?(?:correct|right|wrong|incorrect|grammatical|natural)|correct (?:my|this|the|these) (?:sentences?|grammar|english|writing|essay|paragraph)|check (?:my |this |the )?(?:grammar|english|sentences?|spelling|essay|writing)|sửa (?:câu|lỗi ngữ pháp|lỗi chính tả|ngữ pháp|bài viết tiếng)"), 4],
    [W("tiếng (?:anh|việt|nhật|hàn|trung|pháp|đức|nga|tây ban nha)|in english|in vietnamese|english|bản ngữ|native speakers?"), 2],
    [W("đặt câu|make (?:a|some) sentences?|example sentences?|ví dụ (?:câu|về cách dùng)|word (?:formation|family)|từ loại|part of speech|danh từ|động từ|tính từ|trạng từ|nouns?|verbs?|adjectives?|adverbs?"), 2],
    [W("phân biệt|khác nhau|difference between|differences between|vs\\.?|versus"), 1],
  ],
  translate: [
    [/(?<![\p{L}\p{N}])(?<!giao |di |biên )dịch(?! vụ| bệnh| tễ| chuyển| giả)(?![\p{L}\p{N}])/iu, 5],
    [W("translate|translation|phiên dịch|dịch thuật"), 5],
    [W("(?:sang|ra|qua) tiếng \\p{L}+|into (?:english|vietnamese|japanese|korean|chinese|french|german|spanish)"), 3],
  ],
  summarize: [[W("tóm tắt|tóm lược|tổng hợp (?:lại|nội dung|ý chính)|ý chính|summari[sz]e|summary|tl;?dr|key points|main points|rút gọn"), 4]],
  code: [
    [W("python|javascript|typescript|java|c\\+\\+|c#|golang|php|ruby|kotlin|swiftui|sql|mysql|postgres(?:ql)?|mongodb|sqlite|html|css|tailwind|react(?:\\.?js| native| hooks?| components?)|vue(?:\\.?js)?|angular(?:js)?|next\\.?js|nextjs|node\\.?js|nodejs|express\\.?js|django|flask|fastapi|spring boot|laravel|flutter|regex|regexp|bash|powershell|shell script|docker|kubernetes|k8s|git|github|api|rest api|graphql|json|yaml|npm|pip|webpack|vite|lập trình|programming|code|coding|source code|mã nguồn|thuật toán|algorithm|đệ quy|recursion|backend|frontend|database|cơ sở dữ liệu|deploy|compile|terminal|command line|devops|unit test|refactor"), 3],
    [W("class|method|object|function|hàm(?! số)|biến(?! mất| thành| đổi| động| cố| dạng)|variable|vòng lặp|loop|mảng|array|framework|thư viện|library|server|script|query|truy vấn|react|swift|rust|endpoint|bug"), 1],
  ],
  debug: [[W("lỗi|bug|bugs|error|errors|exception|traceback|stack ?trace|crash|crashes|không chạy|không hoạt động|bị treo|fix|sửa lỗi|debug|undefined|null|nan|segfault|failed|failing|doesn'?t work|not working|broken|hỏng|warning"), 3]],
  build: [
    [W("(?:thiết kế|làm(?! (?:thế|sao|gì|như|cách|ơn|việc|quen|bài tập|bài kiểm tra))|tạo|xây dựng|dựng|viết|code|lập trình|phát triển|build|create|make|design|develop|set up|clone)(?:(?![.?!\\n]).){0,40}?(?:trang web|website|web ?app|webapp|landing(?: page)?|ứng dụng|app|application|dashboard|game|trò chơi|slides?|bài (?:thuyết trình|trình bày)|presentation|pitch deck|deck|logo|banner|poster|công cụ|tool|extension|tiện ích|bot|chatbot|hệ thống|system|phần mềm|software|portfolio|blog|cửa hàng online|online store|e-?commerce|plugin|template|giao diện|ui|mockup|prototype)"), 5],
    [W("landing page|pitch deck|website|web app|portfolio|dashboard"), 2],
  ],
  write: [
    [W("viết|soạn|biên tập|viết lại|diễn đạt lại|paraphrase|rewrite|write|draft|compose|email|e-mail|thư (?:xin|mời|cảm ơn|cám ơn|gửi|tay|tình|ngỏ|giới thiệu|chúc|xin lỗi)|bức thư|lá thư|letter|bài (?:đăng|viết|luận|văn|báo|blog|phát biểu|diễn văn|thơ)|caption|status|tweet|thơ|bài thơ|poem|truyện|story|kịch bản|lời (?:bài hát|chúc|mời|cảm ơn|tựa)|slogan|cv|resume|cover letter|đơn (?:xin|đề nghị)|essay|article|blog post|tiểu luận|luận văn|báo cáo|report|thesis|speech|bài phát biểu"), 3],
  ],
  reason: [
    [W("chứng minh|prove|proof|giải (?:bài toán|phương trình|hệ phương trình|bất phương trình|hệ|bài tập toán|toán)|đạo hàm|tích phân|nguyên hàm|phương trình|bất phương trình|hệ phương trình|xác suất|tổ hợp|chỉnh hợp|hoán vị|hình học|hình không gian|lượng giác|logarit|ma trận|số phức|cấp số|dãy số|hàm số|derivative|integral|equation|inequality|probability|combinatorics|geometry|trigonometry|matrix|theorem|lemma|calculus|algebra|đại số|giải tích|(?<!(?:kế|thanh|dự|quyết|hạch|kiểm|tất) )toán(?: học)?|math|maths|mathematics|câu đố logic|logic puzzle|puzzle|riddle|bài toán"), 4],
    [W("tính (?:toán|giúp|nhanh|giá trị|tổng|trung bình|lãi|phần trăm|diện tích|chu vi|thể tích|xác suất)|calculate|compute|solve|bao nhiêu phần trăm|giới hạn của|lim|logic|vector|véc ?tơ"), 2],
  ],
  analyze: [
    [W("phân tích|so sánh(?! hơn| nhất)|đánh giá|ưu (?:và )?nhược điểm|ưu điểm|nhược điểm|điểm mạnh|điểm yếu|swot|pros and cons|compare|comparison|analy[sz]e|analysis|evaluate|evaluation|assess|assessment|critique|review|chiến lược|strategy|strategic|kế hoạch kinh doanh|business plan|mô hình kinh doanh|business model|nghiên cứu|research|kiến trúc|architecture|tối ưu(?: hóa| hoá)?|optimi[sz]e|optimization|root cause|nguyên nhân (?:sâu xa|gốc)"), 3],
    [W("giải pháp|đề xuất|recommend|tư vấn|nên chọn|should i (?:choose|pick|use|buy)|lựa chọn nào|which (?:one|is better)|tốt hơn|better"), 2],
  ],
  data: [
    [W("excel|google sheets?|spreadsheet|bảng tính|csv|xlsx|pivot|vlookup|xlookup|công thức (?:excel|sheets)|số liệu|dữ liệu|data|dataset|biểu đồ|chart|graph|thống kê|statistics|statistical|hồi quy|regression|tương quan|correlation|phân phối|distribution|độ lệch chuẩn|standard deviation"), 3],
    [W("bảng|table"), 1],
  ],
};
// Ưu tiên khi hai loại việc cùng điểm: việc cụ thể hơn đứng trước.
const ORDER: Task[] = ["build", "debug", "code", "translate", "summarize", "language", "reason", "data", "analyze", "write", "chat", "qa"];
// Biểu thức toán (không tính "/" và "-" vì hay là ngày tháng, khoảng số: 28/10, 2020-2021).
const MATH = /\d\s*[+*×÷^=<>≤≥]\s*\(?-?\d|√|∫|∑|π|\bx\s*\^\s*\d|\b[xy]\s*[=+]\s*\d/;
// Chứng minh cần nghĩ kỹ (nỗ lực cao) nhưng bài quen thuộc thì model vừa đã đủ; bài thi chọn lọc mới cần model mạnh.
const PROOF = W("chứng minh|prove|proof");
const HARD_MATH = W("olympic|olympiad|hsg|học sinh giỏi|vận dụng cao|nâng cao|chuyên toán|imo|putnam|khó");
const CONCEPT_Q = W("là gì|what is|what are|what's|giải thích|explain|khác nhau|difference|dùng để làm gì|used for|tại sao|why");
const LONG_WRITE = W("bài luận|essay|tiểu luận|luận văn|thesis|báo cáo|report|bài báo|article|sách|book|chương|chapter|kịch bản|screenplay|whitepaper|research paper");
const DOMAIN = W("luật|pháp luật|pháp lý|hợp đồng|điều khoản|thuế|kế toán|kiểm toán|tài chính|đầu tư|chứng khoán|bảo hiểm|y khoa|y tế|bệnh|triệu chứng|thuốc|chẩn đoán|điều trị|legal|law|lawsuit|contract|tax|accounting|audit|finance|financial|investment|stocks?|insurance|medical|medicine|symptoms?|diagnos\\p{L}*|treatment|clinical|dược|vật lý|physics|hóa học|hoá học|chemistry");
const DEPTH = W("chi tiết|cặn kẽ|kỹ càng|kỹ lưỡng|kĩ càng|kĩ lưỡng|thật kỹ|thật kĩ|giải thích kỹ|phân tích kỹ|kỹ hơn|chuyên sâu|đầy đủ|toàn diện|từng bước|step[- ]by[- ]step|in detail|detailed|thorough(?:ly)?|in[- ]depth|deep dive|comprehensive|think (?:hard|carefully|deeply)|suy nghĩ kỹ");
const BRIEF = W("ngắn gọn|ngắn thôi|nhanh thôi|trả lời nhanh|nhanh gọn|một câu|1 câu|vài dòng|briefly|brief|short answer|in short|in one (?:sentence|line|word)|quick(?:ly)?|đơn giản thôi|eli5");
// Người dùng chê câu trả lời trước → nâng độ khó, đổi model. Chỉ tính khi lời chê là chính câu nói (không phải chữ "wrong" trong câu hỏi).
const RETRY = /^\s*(?:(?:không|ko|no)[,.!]?\s*)?(?:sai rồi|sai bét|sai|chưa đúng|không đúng|không phải|làm lại|viết lại đi|thử lại|chưa ổn|tệ quá|kém quá|chưa hay|chưa được|vẫn sai|vẫn lỗi|vẫn chưa|vẫn không|that'?s (?:wrong|not right|incorrect)|you'?re wrong|wrong answer|incorrect|try again|redo|do it again|not right|still (?:wrong|broken|not working|failing)|nope)(?![\p{L}\p{N}])|(?:bạn|câu trả lời|cái này|nó|your answer|the answer) (?:\p{L}+ )?(?:sai|chưa đúng|không đúng|is wrong|was wrong)(?![\p{L}\p{N}])/iu;
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+\S/gm;

export type RouteInput = {
  text: string; attachments: number; turns: number; studio: boolean;
  images?: number; files?: number; docChars?: number;
  prev?: string | null; prevText?: string;
  /** Lời nhờ trước đó của người dùng: câu nối tiếp ngắn ("giải thích thêm", "làm lại") giữ loại việc của nó. */
  prevAsk?: string;
};
/** follow: câu nối tiếp ngắn theo việc của yêu cầu trước ("tiếp đi", "giải thích thêm"). */
type Read = { task: Task; score: number; why: string[]; retry: boolean; think: boolean; follow?: boolean };
const LABEL: Record<Task, string> = { chat: "trò chuyện", qa: "hỏi đáp", language: "học ngôn ngữ", translate: "dịch", summarize: "tóm tắt", write: "viết", code: "viết code", debug: "gỡ lỗi", reason: "suy luận", analyze: "phân tích", build: "tạo sản phẩm", vision: "đọc ảnh", longdoc: "tài liệu dài", data: "số liệu" };
export const taskLabel = (t: Task) => LABEL[t];
// Điểm gốc theo loại việc: ≤ 0 dễ, 1-2 vừa, 3-4 khó, ≥ 5 rất khó.
const BASE_D: Record<Task, number> = { chat: -2, language: 0, translate: 0, qa: 0, summarize: 1, write: 1, vision: 1, code: 2, data: 2, analyze: 2, reason: 2, debug: 3, longdoc: 3, build: 4 };
// Trần độ khó theo loại việc: câu hỏi ngôn ngữ, dịch, hỏi đáp, tóm tắt, viết, đọc ảnh tối đa "khó" (nỗ lực cao, không cần model mạnh nhất).
const CAP_D: Partial<Record<Task, number>> = { chat: 0, language: 4, translate: 4, qa: 4, summarize: 4, write: 4, vision: 4, data: 6 };
// Việc nhẹ: model nhanh đã đủ khi điểm ≤ 1.
const LIGHT = new Set<Task>(["chat", "qa", "language", "translate", "summarize", "write", "vision"]);

function scores(ins: string, a: Ask): Map<Task, number> {
  const out = new Map<Task, number>();
  for (const [t, sigs] of Object.entries(SIG) as [Task, Sig[]][]) {
    let n = 0;
    for (const [re, w] of sigs) if (re.test(ins)) n += w;
    if (n) out.set(t, n);
  }
  if (a.code) out.set("code", (out.get("code") ?? 0) + 5);
  if (a.trace) out.set("debug", (out.get("debug") ?? 0) + 6);
  if (MATH.test(ins)) out.set("reason", (out.get("reason") ?? 0) + 3);
  // "Lỗi" chỉ là gỡ lỗi khi đang nói về code; "sửa lỗi ngữ pháp / chính tả" là việc ngôn ngữ.
  if ((out.get("debug") ?? 0) && (out.get("code") ?? 0) < 3 && !a.trace) out.delete("debug");
  if (out.has("debug")) out.set("debug", out.get("debug")! + (out.get("code") ?? 0));
  // Câu chào, cảm ơn chỉ là trò chuyện khi câu ngắn và không nhờ việc gì khác.
  if (out.has("chat") && (ins.length > 60 || [...out].some(([t, n]) => t !== "chat" && n >= 2))) out.delete("chat");
  // Đoạn trong ngoặc kép + hỏi nghĩa / cách dùng / đúng sai → hỏi về từ ngữ ("What does 'take off' mean?").
  if (a.quotes && W("mean|meaning|nghĩa|difference|phân biệt|khác|say|nói|dùng|use|usage|correct|đúng|sai|wrong|word|từ|phrase|cụm|pronounce|phát âm|spell|natural|tự nhiên").test(ins))
    out.set("language", (out.get("language") ?? 0) + 3);
  // Dịch và học ngôn ngữ cùng có "tiếng Anh": có chữ "dịch / translate" thì là dịch.
  if ((out.get("translate") ?? 0) >= 5) out.set("language", Math.min(out.get("language") ?? 0, 2));
  return out;
}

function pick(sc: Map<Task, number>): [Task, number] {
  let best: Task = "qa", n = 0;
  for (const t of ORDER) { const v = sc.get(t) ?? 0; if (v > n) { best = t; n = v; } }
  // Chỉ một tín hiệu yếu ("class", "react", "bảng"…) chưa đủ để đổi loại việc.
  return n >= 2 ? [best, n] : ["qa", n];
}

function read(q: RouteInput, depth = 0): Read {
  const a = splitAsk(q.text);
  const ins = a.ins.toLowerCase();
  const why: string[] = [];
  let s = 0;
  const add = (n: number, w: string) => { if (!n) return; s += n; why.push(w); };
  const sc = scores(ins, a);
  let [task, strength] = pick(sc);
  const images = q.images ?? 0, docChars = q.docChars ?? 0, files = q.files ?? 0;
  const retry = q.turns >= 2 && ins.length < 160 && RETRY.test(ins);
  // Câu nối tiếp ngắn không tự nói việc gì ("giải thích thêm", "tiếp đi", "sai rồi, làm lại"): theo việc của yêu cầu trước.
  if (strength < 2 && ins.length < 100 && q.prevAsk && depth === 0 && !images && !docChars) {
    const p = read({ ...q, text: q.prevAsk, prevAsk: undefined, turns: 0 }, 1);
    if (p.task !== "chat") {
      s = p.score; why.push(...p.why.filter((w) => w !== "bạn chưa hài lòng với câu trả lời trước"));
      task = p.task;
      if (retry) add(2, "bạn chưa hài lòng với câu trả lời trước");
      return { task, score: s, why, retry, think: p.think, follow: true };
    }
  }
  // Studio (Tài liệu, Slide, Thiết kế): luôn là tạo ra cả một sản phẩm.
  if (q.studio && task !== "chat") task = "build";
  else if (images && strength < 3) task = "vision";
  else if (docChars > 60_000 && !["translate", "summarize", "code", "debug"].includes(task)) task = "longdoc";
  else if ((files || docChars) && strength < 2) task = "summarize";
  s = BASE_D[task];
  // Điều chỉnh theo từng loại việc.
  if (task === "code" && !a.code && CONCEPT_Q.test(ins) && !SIG.write![0][0].test(ins)) { s = 1; why.push("hỏi khái niệm lập trình"); }
  if (task === "reason") {
    if (HARD_MATH.test(ins)) add(2, "bài toán khó");
    else if (ins.length < 40 && MATH.test(ins) && !(sc.get("reason")! > 3)) { s = 0; why.push("phép tính đơn giản"); }
  }
  if (task === "write" && (LONG_WRITE.test(ins) || /\d{3,5}\s*(?:từ|chữ|words)/iu.test(ins))) add(1, "bài viết dài");
  if (["qa", "write", "analyze", "summarize"].includes(task) && DOMAIN.test(ins)) add(1, "lĩnh vực chuyên sâu");
  if (DEPTH.test(ins)) add(task === "reason" ? 2 : 1, "bạn muốn trả lời chi tiết");
  if (BRIEF.test(ins)) add(-1, "bạn muốn trả lời ngắn gọn");
  if (q.studio) why.push("chế độ studio");
  const items = count(LIST_ITEM, q.text.split(/\n\s*\n/).filter((p) => p.length <= 400).join("\n"));
  if (items >= 8) add(2, "nhiều yêu cầu");
  else if (items >= 4) add(1, "nhiều yêu cầu");
  if (ins.length > 1200) add(2, "yêu cầu dài");
  else if (ins.length > 400) add(1, "yêu cầu dài");
  // Nội dung đi kèm chỉ làm việc khó hơn khi phải đọc hết nó (tóm tắt, phân tích, dịch, sửa văn…).
  const body = a.content + docChars;
  if (["translate", "summarize", "analyze", "write", "language", "qa", "data", "longdoc", "code", "debug"].includes(task)) {
    if (body > 20_000) add(task === "language" ? 1 : 2, "nội dung dài");
    else if (body > 4_000) add(1, "nội dung dài");
  }
  if (images || q.attachments || files) add(1, "có tệp đính kèm");
  if (images >= 3 || files >= 3) add(1, "nhiều tệp");
  if (retry) add(2, "bạn chưa hài lòng với câu trả lời trước");
  if (task === "chat") why.push("trò chuyện ngắn");
  const cap = CAP_D[task];
  if (cap !== undefined && s > cap) s = cap;
  const think = (task === "reason" && PROOF.test(ins)) || task === "debug";
  if (task === "reason" && PROOF.test(ins)) why.push("cần chứng minh từng bước");
  return { task, score: s, why, retry, think };
}
const memo = new WeakMap<RouteInput, Read>();
const readOf = (q: RouteInput) => { let r = memo.get(q); if (!r) { r = read(q); memo.set(q, r); } return r; };

export const taskOf = (q: RouteInput): Task => readOf(q).task;
/** Điểm độ khó: ≤ 0 dễ, 1-2 vừa, 3-4 khó, ≥ 5 rất khó. */
export function difficulty(q: RouteInput): { score: number; why: string[] } {
  const r = readOf(q);
  return { score: r.score, why: r.why };
}
const need = (score: number, task: Task) => (score <= 0 || (score <= 1 && LIGHT.has(task)) ? 6 : score <= 2 ? 7.5 : score <= 4 ? 8.8 : 9.4);
// Mức nỗ lực cao nhất theo loại việc (trò chuyện luôn thấp; câu hỏi ngôn ngữ, dịch, hỏi đáp… tối đa "cao").
const CAP_E: Partial<Record<Task, AutoEffort>> = { chat: "low", language: "high", translate: "high", qa: "high", summarize: "high", write: "high", vision: "high", data: "extra" };
const RANK: AutoEffort[] = ["low", "medium", "high", "extra", "max"];
/** Mức nỗ lực theo độ khó (máy chủ còn hạ theo giới hạn của quản trị viên và các mức model hỗ trợ). */
export function effortFor(score: number, task: Task, think = false): AutoEffort {
  const e: AutoEffort = task === "chat" || score <= 0 ? "low" : score <= 2 ? (think ? "high" : "medium") : score <= 4 ? "high" : score >= 7 ? "max" : "extra";
  const cap = CAP_E[task];
  return cap && RANK.indexOf(e) > RANK.indexOf(cap) ? cap : e;
}
const EFFORT_LABEL: Record<AutoEffort, string> = { low: "thấp", medium: "trung bình", high: "cao", extra: "cao hơn", max: "tối đa" };
export const effortLabel = (e: string) => EFFORT_LABEL[e as AutoEffort] ?? e;

export type Route = { model: string; tier: Tier; vendor: Vendor; task: Task; effort: AutoEffort; why: string[]; alt: string[] };
/** Chọn model cho chế độ Tự động trong danh sách được phép (cả ba hãng, gói lẫn khóa API). avoid: model vừa bị chê / vừa lỗi. */
export function routeModel(q: RouteInput, allowed: string[], o: { avoid?: string[] } = {}): Route | null {
  if (!allowed.length) return null;
  const { task, score, why, retry, think, follow } = readOf(q);
  const needQ = need(score, task);
  const avoid = new Set([...(o.avoid ?? []), ...(retry && q.prev ? [q.prev] : [])]);
  const all = allowed.map((k, i) => ({ p: profileOf(k), i })).map((x) => ({ ...x, q: quality(x.p, task) }));
  const pool = all.filter((x) => !avoid.has(x.p.key)).length ? all.filter((x) => !avoid.has(x.p.key)) : all;
  // Đạt mức cần: rẻ nhất → chất lượng cao hơn → nhanh hơn → thứ tự quản trị viên hiển thị. Không ai đạt: chất lượng cao nhất.
  const ok = pool.filter((x) => x.q >= needQ);
  const rank = ok.length
    ? ok.sort((a, b) => a.p.cost - b.p.cost || b.q - a.q || a.i - b.i)
    : pool.sort((a, b) => b.q - a.q || a.p.cost - b.p.cost || a.i - b.i);
  // Câu nối tiếp (không phải chê câu trả lời): model của lượt trước vẫn đủ sức thì giữ nguyên, để nối đúng mạch việc đang làm
  // (phiên làm việc của gói, bộ nhớ đệm) thay vì đổi sang model khác chỉ vì rẻ hơn một chút.
  const keep = follow && !retry && q.prev ? ok.find((x) => x.p.key === q.prev) : undefined;
  if (keep) why.push("nối tiếp việc đang làm với model trước");
  const pick = keep ?? rank[0];
  // Dự phòng khi model đã chọn lỗi / hết hạn mức: model tốt kế tiếp, ưu tiên hãng khác.
  const alt = [...ok, ...pool.filter((x) => !ok.includes(x)).sort((a, b) => b.q - a.q)].filter((x) => x.p.key !== pick.p.key)
    .sort((a, b) => Number(a.p.vendor === pick.p.vendor) - Number(b.p.vendor === pick.p.vendor)).map((x) => x.p.key);
  return { model: pick.p.key, tier: pick.p.tier, vendor: pick.p.vendor, task, effort: effortFor(score, task, think), why: [`việc ${LABEL[task]}`, ...why], alt };
}
/** Mức nỗ lực tự động cho một yêu cầu khi người dùng để effort "Tự động" (model chọn tay hay chế độ Tự động đều dùng). */
export const autoEffort = (q: RouteInput): AutoEffort => { const r = readOf(q); return effortFor(r.score, r.task, r.think); };
