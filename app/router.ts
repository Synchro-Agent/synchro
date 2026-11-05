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
//     câu nối tiếp ngắn ("giải thích thêm", "tiếp đi") và câu xác nhận ("ok làm đi") giữ loại việc và model của yêu cầu trước;
//  6) gõ không dấu ("lam trang web") được so khớp lượt hai trên từ điển các cụm không thể nhầm; tạo media, thao tác trên web, connector là việc
//     nhiều bước ("act"); câu hỏi sức khỏe, pháp lý, tài chính không dùng mức thấp nhất; việc nhẹ ưu tiên model hiện chữ dần.

export const AUTO = "auto";
export type Tier = "fast" | "balanced" | "strong";
export type Vendor = "anthropic" | "openai" | "google" | "xai" | "deepseek" | "other";
export type Task = "chat" | "qa" | "language" | "translate" | "summarize" | "write" | "code" | "debug" | "reason" | "analyze" | "build" | "act" | "vision" | "longdoc" | "data";
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
  anthropic: { code: 0.7, debug: 0.6, build: 0.8, act: 0.4, write: 0.5, analyze: 0.3, reason: 0.2, longdoc: 0.2, summarize: 0.3, language: 0.2 },
  openai: { reason: 0.8, data: 0.6, code: 0.4, debug: 0.4, analyze: 0.4, qa: 0.3, write: 0.2, translate: 0.2, build: 0.2, act: 0.2, language: 0.3, summarize: 0.2 },
  // Đọc ảnh là thế mạnh thật của Gemini: model nhanh của Gemini đủ sức cho câu hỏi về ảnh mức vừa.
  google: { longdoc: 0.9, vision: 1.6, translate: 0.5, qa: 0.3, data: 0.3, reason: 0.3, code: 0.1, language: 0.3, summarize: 0.5 },
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
// Tên lỗi không có dấu ":" ("sửa lỗi này: TypeError undefined") chỉ tính khi câu đang nói về lỗi: "TypeError là gì" vẫn là câu hỏi khái niệm.
const TRACE_NAME = /\b[A-Z][a-z]+\w*(?:Error|Exception)\b|Cannot read propert|is not a function|is not defined/;
const TRACE_TALK = /(?<![\p{L}\p{N}])(?:lỗi|loi|sửa|sua|fix|bug|debug|crash)(?![\p{L}\p{N}])/iu;
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
  const trace = TRACE.test(s) || (TRACE_NAME.test(s) && TRACE_TALK.test(s));
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
  chat: [[W("xin chào|chào(?: bạn| em| anh| chị| synchro| buổi sáng)?|hi|hello|hey|alo|cảm ơn|cám ơn|thanks?|thank you|ok|oke|okay|vâng|dạ|ừ|ừm|uh|yes|no|tạm biệt|bye|good (?:morning|night|evening)|chúc ngủ ngon|bạn khỏe không|how are you|bạn là ai|who are you|haha|hihi|hehe|tuyệt|great|nice|hay (?:quá|lắm)|tốt (?:quá|lắm)|giỏi (?:quá|lắm)|đẹp (?:quá|lắm)"), 3]],
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
    // "chiến dịch", "miễn dịch", "mậu dịch", "đại dịch", "dung dịch" không phải việc dịch: "Đề xuất chiến dịch quảng cáo" từng thành dịch, nỗ lực thấp, không công cụ.
    [/(?<![\p{L}\p{N}])(?<!giao |di |biên |chiến |miễn |mậu |đại |ôn |bệnh |dung |thông |phòng |chống )dịch(?! vụ| bệnh| tễ| chuyển| giả| cúm| covid| truyền| vị| não| tiêu)(?![\p{L}\p{N}])/iu, 5],
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
    [W("(?:thiết kế|làm(?! (?:thế|sao|gì|như|cách|ơn|việc|quen|bài tập|bài kiểm tra))|tạo|xây dựng|dựng|viết|code|lập trình|phát triển|build|create|make|design|develop|set up|clone)(?:(?![.?!\\n]).){0,40}?(?:trang web|website|web ?app|webapp|landing(?: page)?|ứng dụng|app|application|dashboard|game|trò chơi|slides?|bài (?:thuyết trình|trình bày)|presentation|pitch deck|deck|powerpoint|pptx?|infographic|logo|banner|poster|công cụ|tool|extension|tiện ích|bot|chatbot|hệ thống|system|phần mềm|software|portfolio|blog|cửa hàng online|online store|e-?commerce|plugin|template|giao diện|ui|mockup|prototype)"), 5],
    // "web" trần chỉ tính khi đứng ngay sau động từ làm ("làm web bán hàng"); "vẽ logo" là việc thiết kế, không phải câu hỏi.
    [W("(?:làm|tạo|dựng|xây)(?: (?:giúp|hộ|cho|mình|tôi|em|một|cái|1))* web|vẽ(?:(?![.?!\\n]).){0,30}?(?:logo|banner|poster|infographic)|draw(?:(?![.?!\\n]).){0,30}?(?:logo|banner|poster|infographic)"), 5],
    [W("landing page|pitch deck|website|web app|portfolio|dashboard"), 2],
  ],
  // Việc nhiều bước bằng công cụ: tạo ảnh, video, âm thanh; thao tác trên web và connector (đăng bài, gửi thư, tạo lịch, đặt chỗ).
  act: [
    [W("(?:làm(?! (?:thế|sao|gì|như|cách|ơn|việc|quen|bài tập|bài kiểm tra))|tạo|dựng|quay|sản xuất|render|xuất(?! hiện| bản| khẩu| sắc)|ghép|cắt|vẽ|generate|create|make|edit|draw)(?:(?![.?!\\n]).){0,30}?(?:video|clip|phim|ảnh(?! hưởng)|hình ảnh|hình minh họa|hình minh hoạ|hình(?! (?:học|thức|như|không gian))|image|picture|photo|illustration|nhạc|bài hát|audio|giọng đọc|podcast|voiceover)"), 5],
    [W("đăng (?:bài|lên|status|ảnh|video|tin)|post (?:to|on)|publish|gửi (?:email|mail|thư|tin nhắn|hóa đơn|hoá đơn|báo giá)|send (?:an? |the )?(?:email|message|invoice)|tạo (?:sự kiện|lịch|cuộc họp|cuộc hẹn|hóa đơn|hoá đơn|đơn hàng|ticket|task)|đặt (?:lịch|vé|phòng|bàn|hẹn)|lên lịch|create (?:an? )?(?:event|invoice|ticket|meeting)|schedule (?:a|an)|book (?:a|an)|mở trang|vào trang|truy cập (?:trang|web)|open (?:the )?(?:website|page|site)|điền (?:form|biểu mẫu)|fill (?:in|out) (?:the |this )?form|crawl|scrape|cào dữ liệu|tải (?:về|xuống)"), 5],
    // Đọc / xem dữ liệu ở connector và sản phẩm người dùng đã nối: cần công cụ, không phải câu hỏi nhỏ.
    [W("(?:đọc|xem|kiểm tra|check|lấy|tìm|liệt kê|tổng hợp|read|show|get|list|fetch|open)(?:(?![.?!\\n]).){0,40}?(?:gmail|outlook|mail|e-?mail|hộp thư|inbox|lịch(?! sử| trình)|calendar|stripe|notion|slack|jira|linear|asana|trello|hubspot|salesforce|shopify|zalo|fanpage|google drive|drive|google sheets?|airtable|figma|vercel|supabase|sentry|telegram|discord)"), 5],
    [W("(?:tạo|mở|gộp|merge|create|open)(?:(?![.?!\\n]).){0,20}?(?:pull request|merge request|pr|issue)"), 5],
    // Đổi định dạng, tải về, tạo tệp văn phòng: phải chạy công cụ mới ra tệp.
    [W("(?:chuyển|đổi|convert|export|xuất)(?:(?![.?!\\n]).){0,40}?(?:sang|thành|ra|to|as|into) (?:pdf|word|docx?|excel|xlsx?|pptx?|powerpoint|csv|png|jpe?g|mp3|mp4)"), 5],
    [W("tải(?:(?![.?!\\n]).){1,40}?(?:về|xuống)|download (?:this|the|a|my|file|video)"), 5],
    // Nhờ tìm hoặc mở trang ngoài ("tìm giúp mình khách sạn…", "mở youtube tìm nhạc"): phải có công cụ mới làm được.
    [W("^(?:(?:hãy|giúp|giùm|hộ|cho|mình|tôi|em|làm ơn|please|can you|could you)[\\s,]+)*(?:tìm|tra cứu|search|look up|find)(?: (?:giúp|hộ|giùm|cho|mình|tôi|em|me|for me))+|(?:mở|vào|open) (?:youtube|google|facebook|tiktok|shopee|lazada|maps|google maps)"), 5],
    [W("(?:tạo|lập|làm(?! (?:thế|sao|gì|như|cách|ơn|việc|quen|bài tập|bài kiểm tra))|soạn|xuất|dựng|create|make|generate|prepare)(?:(?![.?!\\n]).){0,30}?(?:(?:file|tệp) \\p{L}+|bảng (?:lương|chấm công|báo giá|kê|tính|theo dõi|dự toán)|báo giá|dự toán|sổ (?:theo dõi|thu chi|quỹ)|tracker|excel|xlsx|docx|word document|spreadsheet|pdf)"), 5],
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
const ORDER: Task[] = ["build", "act", "debug", "code", "translate", "summarize", "language", "reason", "data", "analyze", "write", "chat", "qa"];
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
// Lời chê nằm giữa câu ngắn sau một việc lớn ("nút bấm không chạy", "trang bị trắng", "trông rẻ tiền lắm"): RETRY chỉ bắt ở đầu câu nên việc sửa từng rơi về model yếu nhất.
const COMPLAINT = W("lỗi rồi|bị lỗi|fix đi|fix lại|sửa đi|sửa lại|không chạy|chạy không được|không hoạt động|không bấm được|không hiện|hỏng rồi|bị hỏng|bị trắng|trắng (?:trang|màn hình|xóa|xoá)|rẻ tiền|quê mùa|quê quá|(?:trông|nhìn|giao diện|trang|web|font|màu|thiết kế|hơi|thấy)(?: \\p{L}+)? xấu|^xấu|xấu (?:quá|lắm|thế|vậy|ghê|kinh)|chưa đẹp|không đẹp|doesn'?t work|does not work|not working|isn'?t working|broken|ugly|looks? (?:bad|cheap|awful|terrible)|blank page");
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+\S/gm;
// Hỏi cách làm ("Cách tạo ảnh bằng AI", "How to download a video") là hỏi đáp, không phải nhờ làm.
// Danh từ đứng đầu câu, không có động từ: "Slide giới thiệu công ty", "App quản lý chi tiêu", "Lập ngân sách đám cưới". Từng thành hỏi đáp, đường nhanh, không skill.
const NOUN_BUILD = W("^(?:một |1 |cái |bộ |mẫu )?(?:slides?|bài thuyết trình|bài trình bày|powerpoint|pptx?|app|ứng dụng|web ?app|website|trang web|landing page|dashboard|portfolio|chatbot)");
const NOUN_BUILD_FOLD = W("^(?:mot |1 |cai |bo |mau )?(?:slides?|bai thuyet trinh|bai trinh bay|powerpoint|pptx?|app|ung dung|web ?app|website|trang web|landing page|dashboard|portfolio|chatbot)");
const NOUN_PLAN = W("^(?:(?:lập|làm|lên|xây dựng|soạn|tạo)(?: (?:giúp|hộ|cho|mình|tôi|em|một|1))* )?(?:kế hoạch|quy trình|ngân sách|thực đơn|lịch trình|đề án|chiến dịch|plan for|budget for|itinerary)");
const NOUN_PLAN_FOLD = W("^(?:(?:lap|lam|len|xay dung|soan|tao)(?: (?:giup|ho|cho|minh|toi|em|mot|1))* )?(?:ke hoach|quy trinh|ngan sach|thuc don|lich trinh|de an|chien dich)");
const NOUN_DOC = W("^(?:(?:lập|làm|soạn|viết|tạo)(?: (?:giúp|hộ|cho|mình|tôi|em|một|1))* )?(?:thông cáo(?: báo chí)?|bản mô tả|mô tả công việc|nội dung (?:fanpage|facebook|tiktok|website|marketing|quảng cáo)|bản đề xuất|press release|job description)");
const NOUN_DOC_FOLD = W("^(?:(?:lap|lam|soan|viet|tao)(?: (?:giup|ho|cho|minh|toi|em|mot|1))* )?(?:thong cao(?: bao chi)?|ban mo ta|mo ta cong viec|noi dung (?:fanpage|facebook|tiktok|website|marketing|quang cao)|ban de xuat)");
const HOWTO = W("làm sao|làm thế nào|thế nào|như thế nào|cách|là gì|có nên|tại sao|vì sao|how (?:to|do|can|should)|what is|why|should i");
// Sức khỏe, pháp lý, tài chính: trả lời sai có hại thật, không dùng model và nỗ lực thấp nhất dù câu hỏi ngắn.
// Cả cách nói gián tiếp: "sống làm gì nữa", "em muốn biến mất", "bị bạn trai đánh", "bé bỏ bú". Những câu đó từng tới model rẻ nhất ở đường nhanh, không có quy tắc an toàn nào.
const STAKES = W("không còn lý do(?: gì)? để sống|lý do để sống|sống (?:để )?làm gì|hết muốn sống|không thiết sống|muốn biến mất|kết thúc cuộc đời|chấm dứt cuộc đời|cuộc (?:sống|đời)(?: \\p{L}+){0,3} (?:vô nghĩa|bế tắc)|(?:không|chẳng)(?: còn)? ai cần|xâm hại|bạo hành|bạo lực gia đình|cưỡng hiếp|hiếp dâm|quấy rối|bị(?: \\p{L}+){0,3} đánh(?! (?:giá|dấu|máy|thức|lừa|bại|bóng|cắp|rơi|mất|thuế|răng|cờ|đàn|trống))|đánh đập|bị bỏng|bỏng (?:nặng|nước|lửa|hóa chất|hoá chất|độ)|bỏ bú|trẻ sơ sinh|lừa đảo|sa thải|đuổi việc|don'?t want to (?:live|be alive|be here)|no reason to live|want to disappear|(?:nobody|no one) needs me|hurt myself|sleeping pills?|too many pills|how many pills|\\w+ pills|abus(?:e|ed|ive)|assault\\p{L}*|raped?|molest\\p{L}*|domestic violence|severe burns?|scam\\p{L}*|laid off|đau ngực|tức ngực|khó thở|đột quỵ|tai biến|co giật|ngất|ho ra máu|chảy máu|ngộ độc|tự tử|tự sát|tự hại|tự làm đau|rạch tay|muốn chết|không muốn sống|chán sống|trầm cảm|quá liều|liều (?:dùng|thuốc)|thuốc|triệu chứng|chẩn đoán|mang thai|có thai|có bầu|mang bầu|sảy thai|ung thư|tiểu đường|huyết áp|bị sốt|sốt cao|sốt \\d+|sốt xuất huyết|lên cơn sốt|bị (?:\\p{L}+ ){1,2}(?:cắn|đốt)|đau(?: \\p{L}+){0,2} (?:dữ dội|quằn quại|kinh khủng|không chịu nổi)|khởi kiện|kiện|ly hôn|tranh chấp|thừa kế|bị bắt|hợp đồng|pháp lý|luật|thuế|vay|nợ|đầu tư|chứng khoán|bảo hiểm|phá sản|mua vàng|bán vàng|gửi tiết kiệm|tiết kiệm tiền|lãi suất|tiền ảo|bitcoin|chest pain|shortness of breath|stroke|overdose|suicid\\p{L}*|self[- ]harm|kill myself|want to die|end my life|depress\\p{L}*|seizure|dosage|fever|severe pain|bitten|pregnan\\p{L}*|miscarriage|ibuprofen|paracetamol|acetaminophen|aspirin|antibiotics?|medication|lawsuit|sue|divorce|legal|tax|invest\\p{L}*|loan|debt|mortgage|bankrupt\\p{L}*|buy gold|savings|crypto\\p{L}*");

// ---- gõ không dấu ----
// Từ điển chính so khớp trên chữ còn dấu (bỏ dấu thì "bằng" thành "bảng"). Gõ không dấu thì mọi tín hiệu đều trượt và "lam giup minh trang web" thành
// câu hỏi nỗ lực thấp: khi câu không có dấu nào và chưa có tín hiệu đủ mạnh, so thêm với các cụm không dấu không thể nhầm.
export const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
const noMarks = (s: string) => !/[\u0300-\u036fđĐ]/.test(s.normalize("NFD"));
const FOLDED: [Task, RegExp, number][] = [
  ["build", W("(?:lam|tao|thiet ke|xay dung|viet|lap trinh|phat trien)(?:(?![.?!\\n]).){0,40}?(?:trang web|website|web ?app|landing(?: page)?|ung dung|app|dashboard|game|tro choi|slides?|bai thuyet trinh|bai trinh bay|logo|banner|poster|cong cu|chatbot|he thong|phan mem|giao dien|cua hang online|powerpoint|pptx?|infographic|web)|ve (?:logo|banner|poster)"), 5],
  ["act", W("(?:tao|ve) anh|(?:lam|tao|quay|ghep|xuat)(?:(?![.?!\\n]).){0,30}?(?:video|clip|phim|hinh anh|hinh minh hoa)|anh (?:quang cao|san pham|minh hoa|bia)|dang (?:bai|len)|gui (?:email|mail|thu|tin nhan|hoa don)|tao (?:su kien|lich|cuoc hop|hoa don|pull request)|dat (?:lich|ve|phong|ban)|len lich|vao trang|mo trang|(?:doc|xem|kiem tra|lay)(?:(?![.?!\\n]).){0,40}?(?:gmail|mail|email|hop thu|lich(?! su| trinh)|stripe|notion|slack|drive)|chuyen (?:doi )?(?:file|tep)(?:(?![.?!\\n]).){0,30}?sang|tai(?:(?![.?!\\n]).){1,40}?(?:ve|xuong)|(?:tao|lap|lam|soan)(?:(?![.?!\\n]).){0,30}?(?:(?:file|tep) \\p{L}+|bang (?:luong|cham cong|bao gia|ke|tinh|theo doi)|bao gia)"), 5],
  ["reason", W("chung minh|phuong trinh|dao ham|tich phan|xac suat|bai toan|giai toan|luong giac|ma tran|so phuc"), 4],
  ["translate", W("dich (?:sang|ra|qua|giup|ho|doan|cau|bai|email)|sang tieng \\p{L}+"), 5],
  ["summarize", W("tom tat|tom luoc|y chinh"), 4],
  ["language", W("ngu phap|tu vung|phat am|chinh ta|thanh ngu|tieng anh"), 3],
  ["analyze", W("phan tich|so sanh|danh gia|uu nhuoc diem|uu diem|nhuoc diem|chien luoc"), 3],
  ["data", W("bang tinh|bieu do|so lieu|du lieu|thong ke"), 3],
  ["write", W("viet (?:bai|email|mail|thu|cau|caption|bao cao|ke hoach|don)|soan (?:thao|thu|email|bai)|bai luan|bai tho|bai van"), 3],
  ["chat", W("xin chao|chao ban|cam on|tam biet"), 3],
];
const HOWTO_FOLD = W("lam sao|lam the nao|the nao|cach|la gi|co nen|tai sao|vi sao");
const STAKES_FOLD = W("khong con ly do(?: gi)? de song|ly do de song|song (?:de )?lam gi|het muon song|khong thiet song|muon bien mat|ket thuc cuoc doi|cham dut cuoc doi|cuoc (?:song|doi)(?: \\p{L}+){0,3} (?:vo nghia|be tac)|(?:khong|chang)(?: con)? ai can|xam hai|bi bao hanh|bao luc gia dinh|cuong hiep|hiep dam|quay roi|bi(?: \\p{L}+){0,3} danh(?! (?:gia|dau|may|thuc|lua|bai|bong|cap|roi|mat|thue))|danh dap|bi bong|bong (?:nang|nuoc|lua|hoa chat)|bo bu|tre so sinh|lua dao|sa thai|duoi viec|dau nguc|tuc nguc|kho tho|dot quy|tai bien|co giat|ho ra mau|chay mau|ngo doc|tu tu|tu sat|tu hai|tu lam dau|rach tay|muon chet|khong muon song|chan song|tram cam|qua lieu|lieu thuoc|trieu chung|chan doan|mang thai|co thai|co bau|mang bau|say thai|ung thu|tieu duong|huyet ap|bi sot|sot cao|sot \\d+|sot xuat huyet|bi (?:\\p{L}+ ){1,2}(?:can|dot)|dau(?: \\p{L}+){0,2} (?:du doi|quan quai|kinh khung)|khoi kien|ly hon|tranh chap|thua ke|hop dong|phap ly|thue|dau tu|chung khoan|bao hiem|pha san|mua vang|ban vang|gui tiet kiem|lai suat|tien ao");
const hasStakes = (s: string) => STAKES.test(s) || (noMarks(s) && STAKES_FOLD.test(s));
const COMPLAINT_FOLD = W("loi roi|bi loi|fix di|fix lai|sua di|sua lai|khong chay|chay khong duoc|khong hoat dong|khong bam duoc|hong roi|bi hong|bi trang|trang trang|trang man hinh|re tien|que mua|que qua|xau|chua dep|khong dep");
const RETRY_FOLD = /^\s*(?:(?:khong|ko|no)[,.!]?\s*)?(?:sai roi|sai bet|chua dung|khong dung|khong phai|lam lai|viet lai di|thu lai|chua on|te qua|kem qua|chua hay|chua duoc|van sai|van loi|van chua|van khong)(?![\p{L}\p{N}])/iu;
// Câu chỉ để chào, cảm ơn, khen: trò chuyện thật. "ok", "vâng", "yes"… có thể là xác nhận cho việc đang bàn nên không nằm ở đây.
// "ok cảm ơn", "hay quá cảm ơn nhé": có lời cảm ơn, khen thì là khép lại câu chuyện, không phải đồng ý cho làm tiếp.
const PLAIN_CHAT = /^(?:(?:ok|oke|okay|okie|vang|da|u|um|yes|yeah)[\s,.!~]+)*(?:(?:xin chao|chao|hi|hello|hey|alo|cam on|thanks?|thank you|tks|tam biet|bye|chuc ngu ngon|good (?:morning|night|evening)|ban khoe khong|how are you|ban la ai|who are you|haha|hihi|hehe|tuyet|great|nice|hay|tot|gioi|dep)(?:\s+(?:ban|em|anh|chi|nhe|nha|nhieu|a|synchro|buoi sang|so much|a lot|lam|qua|voi|voi nhe))*[\s,.!~]*)+$/i;
// Câu chỉ đồng ý, xác nhận: không tự nói việc gì nên theo việc đang bàn ("ok làm đi", "yes please", "oke luôn").
const BARE_ACK = /^(?:(?:ok|oke|okay|okie|okela|vang|da|u|um|uh|yes|yeah|yep|yup|sure|no|nope|duoc|roi|dong y|chot|dung|vay|co|lam di|lam luon|lam nhe|lam nha|lam thoi|tien hanh|bat dau|go|go ahead|do it|please|proceed|start|luon|di|nhe|nha|a|thoi|nao)(?:\s+|$))+$/;
const looseFold = (ins: string) => fold(ins).replace(/[.,!~]+/g, " ").replace(/\s+/g, " ").trim();
// Lời chào, "dạ", "ok", lời cảm ơn đứng đầu câu không phải là việc: "Chào bạn, mình bị đau ngực…", "Dạ em muốn hỏi…" được chấm theo phần còn lại.
const HEAD = /^(?:(?:xin chào|kính chào|chào(?: buổi \p{L}+)?|hi|hello|hey|alo|a lô|dạ(?! dày| con| hội| quang| cỏ)|vâng|ừ|ừm|ok|oke|okay|okie|cảm ơn|cám ơn|thank you|thanks?|tks|good (?:morning|afternoon|evening))(?![\p{L}\p{N}])(?:\s+(?:bạn|em|anh|chị|cô|chú|bác|ad|admin|synchro|cả nhà|mọi người|nhé|nha|nhiều|ạ|so much|a lot|there|everyone))*[\s,.!~:;-]*)+/iu;
const HEAD_FOLD = /^(?:(?:xin chao|kinh chao|chao|alo|cam on|da(?= (?:em|con|cho|thua|anh|chi|minh|toi)))(?![\p{L}\p{N}])(?:\s+(?:ban|em|anh|chi|ca nha|moi nguoi|nhe|nha|nhieu|a))*[\s,.!~:;-]*)+/iu;
const stripHead = (ins: string) => { const c = ins.replace(HEAD, ""); return (c === ins && noMarks(ins) ? ins.replace(HEAD_FOLD, "") : c).trim(); };
// Câu nối tiếp thật: nói tới việc đang làm ("giải thích thêm", "đoạn đó", "đổi màu xanh"), hoặc hỏi tiếp về nó ("còn Lazada thì sao").
// Câu ngắn có từ để hỏi mà không chỉ tới việc trước ("thủ đô của Pháp là gì?", "mấy giờ rồi") là câu hỏi mới.
const QUESTION = W("là gì|là ai|là sao|ở đâu|mấy|bao nhiêu|bao giờ|khi nào|lúc nào|tại sao|vì sao|thế nào|như thế nào|làm sao|làm gì|ai|gì|what|where|who|when|why|how|which|whose");
const QUESTION_FOLD = W("la gi|la ai|la sao|o dau|may gio|bao nhieu|bao gio|khi nao|luc nao|tai sao|vi sao|the nao|lam sao|lam gi");
const POINTER = W("đó|ấy|này|kia|trên|vừa rồi|lúc nãy|nó|thế|vậy|it|that|this|those|these|them|above|previous");
const POINTER_FOLD = W("do|ay|nay|tren|vua roi|luc nay|no");
const ASK_MORE = W("(?:vậy )?còn(?: \\p{L}+){1,5} (?:thì )?sao|what about|how about");
const ASK_MORE_FOLD = W("(?:vay )?con(?: \\p{L}+){1,5} (?:thi )?sao");
const CONT = W("tiếp|nữa|thêm|giải thích|cụ thể|chi tiết|ví dụ|đổi|sửa|bỏ|xóa|xoá|thay|chỉnh|giảm|tăng|rút gọn|ngắn hơn|dài hơn|to hơn|nhỏ hơn|đẹp hơn|rõ hơn|kỹ hơn|hay hơn|màu|font|continue|go on|keep going|more|change|add|remove|delete|replace|shorter|longer|bigger|smaller|update|instead|again|elaborate|expand|next|another|example");
const CONT_FOLD = W("tiep|nua|them|giai thich|cu the|chi tiet|vi du|doi|sua|xoa|thay|chinh|rut gon|ngan hon|dai hon|to hon|nho hon|dep hon|ro hon|mau");
function followsUp(t: string): boolean {
  const bare = noMarks(t);
  if (ASK_MORE.test(t) || (bare && ASK_MORE_FOLD.test(t))) return true;
  const pointed = POINTER.test(t) || (bare && POINTER_FOLD.test(t));
  if (QUESTION.test(t) || (bare && QUESTION_FOLD.test(t))) return pointed;
  return pointed || CONT.test(t) || (bare && CONT_FOLD.test(t));
}

export type RouteInput = {
  text: string; attachments: number; turns: number; studio: boolean;
  images?: number; files?: number; docChars?: number;
  prev?: string | null; prevText?: string;
  /** Tin vừa rồi của model là thẻ hỏi lại (khối ```ask): câu này là câu trả lời cho nó, không phải việc mới. */
  answeredAsk?: boolean;
  /** Lời nhờ trước đó của người dùng: câu nối tiếp ngắn ("giải thích thêm", "làm lại") giữ loại việc của nó. */
  prevAsk?: string;
};
/** follow: câu nối tiếp ngắn theo việc của yêu cầu trước ("tiếp đi", "giải thích thêm"). */
type Read = { task: Task; score: number; why: string[]; retry: boolean; think: boolean; follow?: boolean; long?: boolean; stakes?: boolean };
const LABEL: Record<Task, string> = { chat: "trò chuyện", qa: "hỏi đáp", language: "học ngôn ngữ", translate: "dịch", summarize: "tóm tắt", write: "viết", code: "viết code", debug: "gỡ lỗi", reason: "suy luận", analyze: "phân tích", build: "tạo sản phẩm", act: "thao tác nhiều bước", vision: "đọc ảnh", longdoc: "tài liệu dài", data: "số liệu" };
export const taskLabel = (t: Task) => LABEL[t];
// Điểm gốc theo loại việc: ≤ 0 dễ, 1-2 vừa, 3-4 khó, ≥ 5 rất khó.
const BASE_D: Record<Task, number> = { chat: -2, language: 0, translate: 0, qa: 0, summarize: 1, write: 1, vision: 1, code: 2, data: 2, analyze: 2, reason: 2, act: 2, debug: 3, longdoc: 3, build: 4 };
// Trần độ khó theo loại việc: câu hỏi ngôn ngữ, dịch, hỏi đáp, tóm tắt, viết, đọc ảnh tối đa "khó" (nỗ lực cao, không cần model mạnh nhất).
const CAP_D: Partial<Record<Task, number>> = { chat: 0, language: 4, translate: 4, qa: 4, summarize: 4, write: 4, vision: 4, data: 6 };
// Việc nhẹ: model nhanh đã đủ khi điểm ≤ 1.
const LIGHT = new Set<Task>(["chat", "qa", "language", "translate", "summarize", "write", "vision"]);
// Việc mà câu trả lời ngắn và lời chê ngay sau đó vẫn thuộc về nó (không tính hỏi đáp, dịch: "cảm ơn", "Hà Nội" sau câu đó là chuyện khác).
const HEAVY_PREV = new Set<Task>(["build", "code", "debug", "act", "write", "analyze", "data"]);

const BUG_CTX = W("web|website|webapp|web app|app|ứng dụng|phần mềm|trang(?: web| này| chủ| bị| không)|màn hình|crash|crashes|lỗi \\d{3}|\\d{3} error|loi \\d{3}");
function scores(ins: string, a: Ask): Map<Task, number> {
  const out = new Map<Task, number>();
  for (const [t, sigs] of Object.entries(SIG) as [Task, Sig[]][]) {
    let n = 0;
    for (const [re, w] of sigs) if (re.test(ins)) n += w;
    if (n) out.set(t, n);
  }
  // Gõ không dấu: lượt so khớp thứ hai.
  const bare = noMarks(ins);
  if (bare && ![...out.values()].some((n) => n >= 2)) for (const [t, re, w] of FOLDED) if (re.test(ins) && !((t === "build" || t === "act") && HOWTO_FOLD.test(ins))) out.set(t, Math.max(out.get(t) ?? 0, w));
  // Hỏi cách làm, hoặc đang nhờ viết code: không phải nhờ làm thao tác.
  if (out.has("act") && (HOWTO.test(ins) || (out.get("code") ?? 0) >= 3 || (out.get("language") ?? 0) >= 3)) out.delete("act");
  // Xin ảnh là việc dùng công cụ dù câu không có chữ "ảnh" ("vẽ con mèo"): model nào được chọn cũng gọi được generate_image.
  if ((out.get("code") ?? 0) < 3 && (out.get("language") ?? 0) < 3 && wantsImageIns(ins)) out.set("act", Math.max(out.get("act") ?? 0, 5));
  if (DRAW_CHART.test(ins) && !imgQuestion(ins)) out.set("data", Math.max(out.get("data") ?? 0, 3));
  // Danh từ đầu câu là việc cần làm, trừ khi đang hỏi về nó ("app là gì", "quy trình tuyển dụng ra sao").
  if (!HOWTO.test(ins) && !QUESTION.test(ins) && !/\?\s*$/.test(ins) && !SIG.debug![0][0].test(ins) && !(bare && (HOWTO_FOLD.test(ins) || QUESTION_FOLD.test(ins)))) {
    if (NOUN_BUILD.test(ins) || (bare && NOUN_BUILD_FOLD.test(ins))) out.set("build", Math.max(out.get("build") ?? 0, 5));
    if (NOUN_PLAN.test(ins) || (bare && NOUN_PLAN_FOLD.test(ins))) out.set("analyze", Math.max(out.get("analyze") ?? 0, 3));
    if (NOUN_DOC.test(ins) || (bare && NOUN_DOC_FOLD.test(ins))) out.set("write", Math.max(out.get("write") ?? 0, 3));
  }
  if (a.code) out.set("code", (out.get("code") ?? 0) + 5);
  if (a.trace) out.set("debug", (out.get("debug") ?? 0) + 6);
  if (MATH.test(ins)) out.set("reason", (out.get("reason") ?? 0) + 3);
  // "Lỗi" chỉ là gỡ lỗi khi đang nói về code; "sửa lỗi ngữ pháp / chính tả" là việc ngôn ngữ.
  // Không có chữ lập trình mà nói về web, app đang chạy thì vẫn là gỡ lỗi ("web bị lỗi 500", "app bị crash khi mở").
  if ((out.get("debug") ?? 0) && (out.get("code") ?? 0) < 3 && !a.trace && !(BUG_CTX.test(ins) && (out.get("language") ?? 0) < 3)) out.delete("debug");
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
  const whole = a.ins.toLowerCase();
  // Bỏ lời chào ở đầu câu rồi mới chấm; chỉ có lời chào thì chấm nguyên câu (là trò chuyện).
  const ins = stripHead(whole) || whole;
  const why: string[] = [];
  let s = 0;
  const add = (n: number, w: string) => { if (!n) return; s += n; why.push(w); };
  const sc = scores(ins, a);
  let [task, strength] = pick(sc);
  const images = q.images ?? 0, docChars = q.docChars ?? 0, files = q.files ?? 0;
  const stakes = hasStakes(ins);
  // Việc trước đó (nếu có), đọc một lần: lời chê và câu trả lời ngắn chỉ theo nó khi đó là việc nặng.
  const can = !!q.prevAsk && depth === 0 && !images && !docChars;
  let pr: Read | undefined;
  const prevRead = () => (pr ??= read({ ...q, text: q.prevAsk!, prevAsk: undefined, turns: 0, answeredAsk: false }, 1));
  const heavyPrev = () => can && HEAVY_PREV.has(prevRead().task);
  const bareIns = noMarks(ins);
  const complaint = ins.length < 100 && (COMPLAINT.test(ins) || (bareIns && COMPLAINT_FOLD.test(ins))) && heavyPrev();
  const retry = q.turns >= 2 && ins.length < 160 && (RETRY.test(ins) || (bareIns && RETRY_FOLD.test(ins)) || complaint);
  // Câu nối tiếp ngắn không tự nói việc gì ("giải thích thêm", "tiếp đi", "sai rồi, làm lại"): theo việc của yêu cầu trước. Câu xác nhận sau khi
  // model hỏi lại trước việc lớn ("ok làm đi") cũng vậy: từng bị xếp thành trò chuyện, cả trang web được giao cho model rẻ nhất ở phiên mới.
  // Chỉ các trường hợp đó mới theo: "mấy giờ rồi", "ok cảm ơn" sau một việc lớn từng kéo theo Opus nỗ lực cao và tiêu hạn mức tuần của gói;
  // câu sức khỏe sau một yêu cầu dịch từng thành "dịch, nỗ lực thấp".
  const ack = q.turns >= 2 && !PLAIN_CHAT.test(looseFold(whole)) && BARE_ACK.test(looseFold(whole));
  // Trả lời câu hỏi lại trước việc nặng ("Hiện đại, tối giản", "Học sinh cấp 3", "Phương án 2"): không tự nói việc gì, không phải câu hỏi mới, không phải lời cảm ơn.
  // Từng thành hỏi đáp, nỗ lực thấp: lượt dựng cả trang web bị giao cho model rẻ nhất. Thẻ hỏi lại thì chắc chắn là câu trả lời, dù dài hay có từ khóa của việc khác.
  const answered = !!q.answeredAsk && ins.length < 800;
  const shortReply = q.turns >= 2 && strength < 2 && ins.length < 100 && !PLAIN_CHAT.test(looseFold(whole)) && !/\?\s*$/.test(ins) && !((QUESTION.test(ins) || (bareIns && QUESTION_FOLD.test(ins))) && !followsUp(ins)) && !stakes && heavyPrev();
  if (answered ? can : !stakes && (shortReply || (((strength < 2 && (retry || followsUp(ins))) || ack) && ins.length < 100 && can))) {
    const p = prevRead();
    if (p.task !== "chat") {
      s = p.score; why.push(...p.why.filter((w) => w !== "bạn chưa hài lòng với câu trả lời trước"));
      task = p.task;
      if (retry) add(2, "bạn chưa hài lòng với câu trả lời trước");
      return { task, score: s, why, retry, think: p.think, follow: true, long: p.long, stakes: p.stakes || stakes };
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
  if (stakes && ["qa", "analyze", "chat", "write", "summarize"].includes(task) && s < 2) { s = 2; why.push("liên quan sức khỏe, pháp lý hoặc tài chính"); }
  const cap = CAP_D[task];
  if (cap !== undefined && s > cap) s = cap;
  const think = (task === "reason" && PROOF.test(ins)) || task === "debug";
  if (task === "reason" && PROOF.test(ins)) why.push("cần chứng minh từng bước");
  return { task, score: s, why, retry, think, long: body > 20_000, stakes };
}
/** Câu chỉ xác nhận, trả lời ngắn, không tự nói việc gì: khi tìm lời nhờ trước đó thì bỏ qua câu này ("Làm web" → "ok" → "màu xanh nhé" vẫn là làm web). */
export function isAck(text: string): boolean {
  const a = splitAsk(text), whole = a.ins.toLowerCase(), ins = stripHead(whole) || whole;
  if (ins.length >= 100 || a.content) return false;
  const [t, n] = pick(scores(ins, a));
  if (n >= 2 && t !== "chat") return false;
  // Câu hỏi mới ("thủ đô của Pháp là gì?") và câu về sức khỏe, pháp lý là lời nhờ thật: "giải thích thêm" sau đó nói về chúng, không về việc lớn ở trước.
  return !hasStakes(ins) && !((QUESTION.test(ins) || (noMarks(ins) && QUESTION_FOLD.test(ins))) && !followsUp(ins));
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
// Antigravity (sub-agy) trả cả câu trả lời một lần khi xong (đo trên máy chủ: 5-9 giây cho một câu chào), các gói khác hiện chữ dần. Coi việc phải
// chờ không thấy chữ là một khoản chi phí: lớn hơn cách biệt giữa model nhanh và model vừa của gói, nhỏ hơn cách biệt với model mạnh. Thế mạnh nhỏ
// của hãng không còn thắng được (Flash từng thắng mọi câu hỏi nhờ +0,3 điểm). Đọc ảnh, tài liệu dài là lý do chất lượng thật: Gemini vẫn được chọn.
// Codex cũng chỉ báo chữ khi xong từng mục, câu ngắn là hiện một lần.
const lag = (key: string) => (/^sub-(?:agy|codex)\//.test(key) ? 1 : 0);
const LAG_COST = 0.6;
// Fable của gói Claude có thể tính vào usage credits (tiền thật ngoài gói): Tự động không tự tiêu, người dùng vẫn chọn tay được. Danh sách chỉ còn nó thì vẫn dùng.
const CREDIT = /^sub-claude\/.*fable/i;
// Grok Build là model viết code: chỉ tính cho việc code; từng thắng cả câu hỏi sức khỏe, thuế, toán vì tên lạ được coi là hạng vừa và có thế mạnh của xAI.
const CODE_ONLY = /grok-build/i;
const CODE_TASKS = new Set<Task>(["code", "debug", "build"]);
const TOOL_HEAVY = new Set<Task>(["code", "debug", "build", "act"]);
/** Chọn model cho chế độ Tự động trong danh sách được phép (cả ba hãng, gói lẫn khóa API). avoid: model vừa bị chê / vừa lỗi. */
export function routeModel(q: RouteInput, allowed: string[], o: { avoid?: string[] } = {}): Route | null {
  if (!allowed.length) return null;
  const { task, score, why, retry, think, follow, long } = readOf(q);
  const needQ = need(score, task);
  const wait = task === "vision" || task === "longdoc" || long ? 0 : LAG_COST;
  const price = (p: Profile) => p.cost + lag(p.key) * wait;
  const avoid = new Set([...(o.avoid ?? []), ...(retry && q.prev ? [q.prev] : [])]);
  const scored = allowed.map((k, i) => ({ p: profileOf(k), i })).map((x) => ({ ...x, q: quality(x.p, task) }));
  const fits = scored.filter((x) => !CREDIT.test(x.p.key) && (!CODE_ONLY.test(x.p.key) || CODE_TASKS.has(task)));
  const all = fits.length ? fits : scored;
  const clean = all.filter((x) => !avoid.has(x.p.key));
  // Lời chê mà không model nào khác đạt mức cần: làm lại bằng chính model đó (nỗ lực đã nâng) hơn là tụt xuống model yếu hơn.
  // Việc nhiều công cụ: Antigravity chỉ trả chữ khi xong và cắt mỗi lần chờ công cụ ở khoảng 190 giây (cầu nối phải chia nhỏ lần chờ), còn gói khác đạt mức thì không tự chọn nó.
  // Lời chê bản dựng trên Opus từng chuyển sang Gemini Argon: mất phiên làm việc, không thấy chữ tới hết lượt. Không gói nào khác đạt thì làm lại bằng chính model đó, nỗ lực đã nâng.
  const steady = (x: { p: Profile }) => !(TOOL_HEAVY.has(task) && /^sub-agy\//.test(x.p.key));
  const pool = clean.length && !(retry && !clean.some((x) => x.q >= needQ && steady(x))) ? clean : all;
  // Đạt mức cần: rẻ nhất (tính cả việc phải chờ không thấy chữ) → chất lượng cao hơn → hiện chữ dần → thứ tự quản trị viên hiển thị. Không ai đạt: chất lượng cao nhất.
  const reach = pool.filter((x) => x.q >= needQ);
  const ok = reach.some(steady) ? reach.filter(steady) : reach;
  const rank = ok.length
    ? ok.sort((a, b) => price(a.p) - price(b.p) || b.q - a.q || lag(a.p.key) - lag(b.p.key) || a.i - b.i)
    : pool.sort((a, b) => b.q - a.q || price(a.p) - price(b.p) || a.i - b.i);
  // Câu nối tiếp (không phải chê câu trả lời): model của lượt trước vẫn đủ sức thì giữ nguyên, để nối đúng mạch việc đang làm
  // (phiên làm việc của gói, bộ nhớ đệm) thay vì đổi sang model khác chỉ vì rẻ hơn một chút.
  const keep = follow && !retry && q.prev ? reach.find((x) => x.p.key === q.prev) : undefined;
  if (keep) why.push("nối tiếp việc đang làm với model trước");
  const pick = keep ?? rank[0];
  // Dự phòng khi model đã chọn lỗi / hết hạn mức: model tốt kế tiếp, ưu tiên hãng khác.
  const alt = [...ok, ...pool.filter((x) => !ok.includes(x)).sort((a, b) => b.q - a.q)].filter((x) => x.p.key !== pick.p.key)
    .sort((a, b) => Number(a.p.vendor === pick.p.vendor) - Number(b.p.vendor === pick.p.vendor)).map((x) => x.p.key);
  return { model: pick.p.key, tier: pick.p.tier, vendor: pick.p.vendor, task, effort: effortFor(score, task, think), why: [`việc ${LABEL[task]}`, ...why], alt };
}
// Câu cần dữ liệu mới hoặc địa chỉ web: để lượt đầy đủ có công cụ trả lời.
const FRESH = W("(?<!đánh )giá|tỷ giá|tỉ giá|tin tức|hôm nay|mới nhất|thời tiết|hiện nay|hiện tại|bây giờ|năm nay|kết quả|(?<!du )lịch(?! sử)|latest|news|today|price|weather|current|score");
const LONG_WORK = W("thông cáo|fanpage|mô tả công việc|press release|job description|bản đề xuất|cv|resume|cover letter|sơ yếu lý lịch|báo cáo|report|hợp đồng|đề xuất|proposal|kế hoạch|kịch bản|sách|ebook|tệp|file|word|pdf|excel|docx|artifact|tiểu luận|luận văn|thuyết trình|landing|seo");
const LONG_WORK_FOLD = W("thong cao|fanpage|mo ta cong viec|so yeu ly lich|bao cao|hop dong|de xuat|ke hoach|kich ban|sach|tep|tieu luan|luan van|thuyet trinh");
const LOOKUP = W("^(?:(?:hãy|giúp|giùm|hộ|cho|mình|tôi|em|làm ơn|please|can you|could you)[\\s,]+)*(?:tìm|tra|tra cứu|mở|search|look up|find|open|google)");
const LOOKUP_FOLD = W("^(?:(?:hay|giup|gium|ho|cho|minh|toi|em|lam on)[\\s,]+)*(?:tim|tra|tra cuu|mo)");
// ---- xin ảnh ----
// Xin ảnh phải tới lượt có công cụ (generate_image): đường nhanh không có công cụ nào. Biểu đồ, sơ đồ vẫn là việc dựng bằng code. Hỏi cách làm, hỏi nghĩa từ thì không phải xin ảnh.
const IMG_CHART = W("biểu đồ|đồ thị|sơ đồ|lưu đồ|mindmap|flowchart|chart|graph|diagram|bieu do|do thi|so do|luu do");
const IMG_ASK = W("(?:vẽ|tạo|làm(?! (?:thế|sao|gì|như|cách|ơn|việc|quen))|thiết kế|dựng|sinh|generate|create|make|draw|design|paint|sketch|render)(?:(?![.?!\\n]).){0,40}?(?:ảnh(?! hưởng)|hình ảnh|hình minh h(?:ọa|oạ)|hình vẽ|hình nền|(?<!cạnh )tranh(?! luận| chấp| cử| thủ| giành| đấu)|logo|poster|banner|image|picture|photo|illustration|artwork|wallpaper|avatar|sticker)");
// Đầu câu nhờ: "vẽ con mèo", "giúp mình vẽ", "bạn có thể vẽ". Chữ "vẽ" trần chỉ là xin ảnh ở đây: "bài thơ về họa sĩ vẽ tranh", "lớp học vẽ" là chuyện khác.
const IMG_LEAD = "(?:(?:hãy|giúp|giùm|hộ|cho|mình|tôi|tớ|em|anh|chị|bạn|làm ơn|muốn|cần|xin|nhờ|thử|đang|có thể|sẽ|bây giờ|giờ|rồi|vậy|thì|please|can you|could you|would you|i want to|i'd like to|i need to|let's|let us|help me|just|now)[\\s,]+)*";
const IMG_LEAD_FOLD = "(?:(?:hay|giup|gium|ho|cho|minh|toi|to|em|anh|chi|ban|lam on|muon|can|xin|nho|thu|dang|co the|se|bay gio|gio|roi|vay|thi)[\\s,]+)*";
const IMG_DRAW = new RegExp(`^${IMG_LEAD}(?:vẽ(?! (?:ra|nên|vời))|draw(?! (?:a |the )?conclusions?)(?=\\s)|paint (?:a|an|me)(?![\\p{L}\\p{N}]))`, "iu");
const IMG_ASK_FOLD = new RegExp(`^${IMG_LEAD_FOLD}(?:(?:tao|ve|lam|thiet ke|dung)(?: (?:giup|ho|cho|minh|toi|em|mot|1|cai|buc|tam|con))* (?:anh|hinh anh|hinh minh hoa|hinh ve|hinh nen|tranh|logo|poster|banner)(?![\\p{L}\\p{N}])|ve (?:mot|1|cho|giup|ho|con|cai|buc|tam)(?![\\p{L}\\p{N}]))`, "iu");
// Câu mở đầu bằng việc khác thì "vẽ", "tạo ảnh" trong đó chỉ là nội dung: "viết email mời học vẽ", "dịch câu: vẽ con mèo", "viết prompt để tạo ảnh".
const IMG_OTHER = new RegExp(`^${IMG_LEAD}(?:viết|soạn|dịch|tóm tắt|tóm lược|giải thích|phân tích|kể|đọc|write|compose|translate|summari[sz]e|explain|analy[sz]e|tell)(?![\\p{L}\\p{N}])`, "iu");
const IMG_OTHER_FOLD = new RegExp(`^${IMG_LEAD_FOLD}(?:viet|soan|dich|tom tat|giai thich|phan tich|ke|doc)(?![\\p{L}\\p{N}])`, "iu");
// "vẽ biểu đồ", "vẽ sơ đồ" là việc dựng bằng code, có công cụ: không đi đường nhanh, không dùng generate_image.
const DRAW_CHART = W("(?:vẽ|ve|draw|plot|tạo|tao|create|make)(?:(?![.?!\\n]).){0,30}?(?:biểu đồ|đồ thị|sơ đồ|lưu đồ|mindmap|flowchart|chart|graph|diagram|bieu do|do thi|so do|luu do)");
// Danh từ tự nó đã là xin ảnh khi câu ngắn ("logo cho quán cà phê", "poster sự kiện").
const IMG_NOUN = W("hình minh h(?:ọa|oạ)|ảnh minh h(?:ọa|oạ)|ảnh bìa|ảnh đại diện|ảnh quảng cáo|ảnh sản phẩm|logo|poster|illustration|wallpaper");
const IMG_NOUN_FOLD = W("hinh minh hoa|anh minh hoa|anh bia|anh dai dien|anh quang cao|anh san pham");
// Hỏi cách làm, hỏi nghĩa thì không phải xin ảnh. Không dùng HOWTO, QUESTION ở đây: chữ trần "cách", "ai", "gì", "mấy" có trong mô tả ảnh ("phong cách anime", "tranh AI", "mấy con mèo"), chỉ tính khi đúng là câu hỏi.
const IMG_HOW = W("làm sao|làm thế nào|thế nào|như thế nào|là gì|là ai|là sao|nghĩa là|có nên|tại sao|vì sao|ở đâu|bao nhiêu|bao giờ|khi nào|lúc nào|(?<!phong )cách (?:nào|để|mà|tạo|vẽ|làm|thiết kế|dùng|sử dụng|sinh|dựng|viết|chỉnh|sửa)|(?:do|bởi|của) ai(?! đó)|gì\\s*\\??\\s*$|mấy (?:giờ|tuổi|ngày|tháng|năm)|how (?:to|do|does|did|can|should|much|many)|what|where|who|when|why|which|whose|should i");
const IMG_HOW_FOLD = W("lam sao|lam the nao|the nao|la gi|la ai|la sao|nghia la|co nen|tai sao|vi sao|o dau|bao nhieu|bao gio|khi nao|luc nao|may gio|(?<!phong )cach (?:nao|de|ma|tao|ve|lam|thiet ke|dung|su dung|sinh|viet|chinh|sua)|(?:do|boi|cua) ai(?! do)");
const imgQuestion = (ins: string) => IMG_HOW.test(ins) || /^ai (?:đã|là|vẽ|tạo|thiết kế|làm)(?![\p{L}\p{N}])/iu.test(ins) || (noMarks(ins) && IMG_HOW_FOLD.test(ins));
const wantsImageIns = (ins: string) => {
  if (!ins || IMG_CHART.test(ins) || imgQuestion(ins) || IMG_OTHER.test(ins)) return false;
  const bare = noMarks(ins);
  if (bare && IMG_OTHER_FOLD.test(ins)) return false;
  return IMG_ASK.test(ins) || IMG_DRAW.test(ins) || (bare && IMG_ASK_FOLD.test(ins)) || (ins.length <= 80 && (IMG_NOUN.test(ins) || (bare && IMG_NOUN_FOLD.test(ins))));
};
/** Người dùng đang xin tạo ảnh (có dấu hay không dấu); dùng cho định tuyến, không phân loại nội dung dán vào. */
export const wantsImage = (text: string) => { const w = splitAsk(text).ins.toLowerCase(); return wantsImageIns(stripHead(w) || w); };
/**
 * Câu rõ ràng không cần công cụ: trò chuyện thật, hoặc câu hỏi kiến thức / ngôn ngữ ngắn, dễ, không có tệp, không cần dữ liệu mới, không phải sức khỏe, pháp lý, tài chính.
 * Những câu này đi đường nhanh: hướng dẫn hệ thống rất ngắn, không cầu nối MCP, không mục lục skill (chatengine.ts). Đoán sai không mất gì: model báo cần công cụ thì chạy lại lượt đầy đủ.
 */
export function needsNoTools(q: RouteInput): boolean {
  // Dấu "#…", "[…:…]" là lệnh hoặc nhãn người dùng gõ có chủ đích: để lượt đầy đủ xử lý.
  if (q.attachments || q.images || q.files || q.docChars || q.studio || /(?:^|\s)#\w|\[\w+:/.test(q.text)) return false;
  const r = readOf(q), a = splitAsk(q.text);
  if (r.retry || r.stakes || a.code || a.trace || wantsImage(q.text)) return false;
  // Nhờ tìm, mở, tra: cần công cụ web, đừng để model nỗ lực thấp tự quyết.
  if (LOOKUP.test(stripHead(a.ins.toLowerCase())) || (noMarks(a.ins) && LOOKUP_FOLD.test(stripHead(a.ins.toLowerCase())))) return false;
  if (r.task === "chat" && !r.follow) return true;
  const ins = a.ins.toLowerCase();
  if (!ins || ins.length > 200 || a.content >= 500 || /https?:|www\./.test(q.text) || FRESH.test(ins)) return false;
  if (["qa", "language", "translate"].includes(r.task)) return r.score <= 0;
  // Viết ngắn (email, thư, thơ, caption) và phép tính nhỏ cũng không cần công cụ: đó là phần lớn câu mỗi ngày, trước đây mỗi câu là một lần khởi động CLI, cầu nối MCP và cả bộ hướng dẫn.
  // Tài liệu nghiêm túc và thứ có skill riêng thì giữ lượt đầy đủ; đoán sai thì model báo cần công cụ và Synchro chạy lại lượt đầy đủ.
  return (r.task === "write" || r.task === "reason") && r.score <= 1 && !LONG_WORK.test(ins) && !(noMarks(ins) && LONG_WORK_FOLD.test(ins));
}
/** Mức nỗ lực tự động cho một yêu cầu khi người dùng để effort "Tự động" (model chọn tay hay chế độ Tự động đều dùng). */
export const autoEffort = (q: RouteInput): AutoEffort => { const r = readOf(q); return effortFor(r.score, r.task, r.think); };
