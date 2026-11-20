// Rút gọn họ tên để hiển thị: "Nguyễn Hữu Lâm Tùng" -> "Lâm Tùng", "Nguyễn Văn An" -> "An", "Mary Jane Watson" -> "Mary".
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

// Họ phổ biến của người Việt (so khớp không dấu để nhận cả tên gõ không dấu).
const SURNAMES = new Set([
  "nguyen", "tran", "le", "pham", "hoang", "huynh", "phan", "vu", "vo", "dang", "bui", "do", "ho", "ngo", "duong", "ly", "dinh", "lam",
  "mai", "truong", "dao", "doan", "cao", "ta", "ha", "to", "luong", "chau", "trinh", "quach", "kieu", "thai", "luu", "tang", "phung",
  "la", "tu", "trieu", "vuong", "hua", "dam", "mac", "khuc", "nghiem", "tieu", "chu", "giang", "lai", "au", "than", "diep", "ong",
  "phi", "dong", "lu", "khong", "quan", "tong", "kim", "lieu", "nong", "son", "van", "ung", "bach", "banh",
]);
// Tên đệm thường chỉ để phân biệt nam / nữ, không phải phần tên gọi.
const MIDDLES = new Set(["van", "thi", "huu", "dinh", "cong", "ba"]);

const cap = (w: string) => (w ? w.charAt(0).toLocaleUpperCase("vi") + w.slice(1) : w);

export function shortName(full: string | null | undefined): string {
  const words = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return cap(words[0] ?? "");
  // Giữ cách viết hoa của người dùng; nếu gõ toàn chữ thường thì viết hoa chữ đầu mỗi từ.
  const nice = words.map((w) => (w === w.toLocaleLowerCase("vi") ? cap(w) : w));
  // Hai chữ thì đã đủ ngắn (và không phân biệt được "Lê Tùng" với "Lâm Tùng"), giữ nguyên.
  if (words.length === 2) return nice.join(" ");
  if (!SURNAMES.has(fold(words[0]))) return nice[0];
  const last2 = nice.slice(-2);
  return MIDDLES.has(fold(last2[0])) ? last2[1] : last2.join(" ");
}

// Lựa chọn nghề nghiệp của hồ sơ (màn hình đăng nhập, Cài đặt → Tài khoản).
export const OCCUPATIONS = ["Student", "Engineering", "Design", "Product management", "Data science", "Marketing", "Sales", "Finance", "Operations", "Human resources", "Legal", "Other"];

/** Tên đoạn chat model trả về: chỉ dòng đầu, bỏ nhãn model hay chép theo ("Tên đoạn chat: …", "Title: …"), dấu Markdown, ngoặc kép và dấu câu ở cuối. */
export const cleanTitle = (s: string) => s.split("\n").map((x) => x.trim()).find(Boolean)?.replace(/[*_`#>]+/g, "").replace(/^["'“”‘’«»\s]+/, "")
  .replace(/^(?:tên\s+(?:đoạn\s+chat|cuộc\s+trò\s+chuyện)|đoạn\s+chat|tên|tiêu\s+đề|chat\s+title|title)\s*[:：]\s*/i, "")
  .replace(/^["'“”‘’«»\s]+|["'“”‘’«»\s.。!?,;:]+$/g, "").replace(/\s+/g, " ").trim() ?? "";

// ---------------------------------------------------------------- tên đoạn chat theo chủ đề
// Brief dài thường mở bằng câu đóng vai ("Bạn là nhà thiết kế sản phẩm…", "You are a senior…"): câu đó không nói gì về
// việc cần làm, nên tên lấy từ mấy chữ đầu thành "Bạn là nhà thiết kế sản". Bỏ câu đó trước khi đặt tên (cả tên tạm lẫn
// tên model đặt).
// \b của JavaScript chỉ hiểu chữ ASCII ("là", "ảnh" không có ranh giới từ): ranh giới theo mọi chữ cái Unicode.
const word = (src: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, "iu");
const ROLE_LEADS = [
  "(?:bạn|anh|chị|em|cậu)\\s+(?:hãy\\s+)?(?:là|đóng vai|nhập vai)", "hãy\\s+(?:đóng vai|nhập vai|tưởng tượng bạn là)",
  "đóng vai", "nhập vai", "giả sử bạn là", "you\\s+are", "you're", "act\\s+as", "pretend\\s+(?:to\\s+be|you\\s+are)",
  "imagine\\s+you\\s+are",
];
const ROLE_RE = new RegExp(`^\\s*(?:${ROLE_LEADS.join("|")})(?![\\p{L}\\p{N}])[^.!?\\n]*(?:[.!?]+|\\n|$)\\s*`, "iu");
/** Bỏ tối đa ba câu đóng vai ở đầu tin nhắn; tin chỉ có câu đó ("Bạn là ai?") thì giữ nguyên. */
export function stripRole(text: string): string {
  let s = text;
  for (let i = 0; i < 3 && ROLE_RE.test(s); i++) s = s.replace(ROLE_RE, "");
  return s.trim() ? s.trim() : text;
}
// Sản phẩm người dùng nhờ làm. Tên giữ đúng chữ người dùng viết ("bộ slide", "slide deck", "landing page"): đoạn chat
// tiếng Anh không bị gắn chữ tiếng Việt. "ảnh hưởng" là một từ, chữ "ảnh" trong đó không phải ảnh.
const PRODUCT = word([
  "bộ slide", "bản trình bày", "pitch deck", "slide deck", "slides?", "landing page", "dashboard", "bảng điều khiển",
  "poster", "áp phích", "brand sheet", "bộ nhận diện(?: thương hiệu)?", "logo", "infographic", "hồ sơ gọi vốn",
  "báo cáo", "report", "website", "trang web", "ứng dụng", "web app", "kế hoạch", "email", "video", "hình ảnh",
  "ảnh(?!\\s+hưởng)",
].join("|"));
// Sản phẩm phải nằm ở phần yêu cầu đầu tin; nhắc tới ở đoạn sau ("… rồi làm báo cáo") thì không phải thứ cần làm.
const PRODUCT_WITHIN = 120;
// Brief từ chừng này ký tự (không kể câu đóng vai) mới đặt tên theo sản phẩm; câu nhờ ngắn giữ nguyên câu đầu.
const LONG_BRIEF = 200;
// Chữ ngay sau tên sản phẩm chỉ nói khổ, số trang, định dạng: không phải chủ đề.
const SIZE_WORD = /^(?:\d\S*|[a-z]\d+|trang|slides?|pages?|web|html|một|mới|hoàn|chỉnh|khổ|dọc|ngang|a|an|the|new)$/iu;
// Chữ nối mở đầu đối tượng / mục đích của sản phẩm ("cho …", "về …", "for …").
const LINK = "cho|về|for|about|of|để|to|with|với|ở|in";
const LINK_AT = word(LINK);
// Đầu cụm "cho …" không mang nghĩa chủ đề: "cho chủ chuỗi 5 cửa hàng" → "chuỗi 5 cửa hàng".
const FILLER = /^(?:(?:chủ|một|các|những|team|đội|the|a|an|our|my|your|their|this|these)\s+)+/iu;
const POLITE = /^(?:(?:hãy|làm ơn|vui lòng|giúp (?:tôi|mình|em)|bạn có thể|bạn hãy|please|can you|could you)\s+)+/iu;
const QUOTED = /[“"«]([^”"»\n]{2,48})[”"»]/u;
const STOP = /[.,;:!?\n"“”«»]/u;
const capFirst = (s: string) => (s ? s.charAt(0).toLocaleUpperCase("vi") + s.slice(1) : s);
const words = (s: string) => s.split(/\s+/).filter(Boolean);
/** Cắt theo từ, tối đa max ký tự. */
function fitWords(s: string, max: number) {
  let out = "";
  for (const w of words(s)) {
    if ((out ? out.length + 1 : 0) + w.length > max) break;
    out = out ? `${out} ${w}` : w;
  }
  return out;
}
/** Phần trước chữ nối hay dấu câu đầu tiên. */
const untilLink = (s: string) => {
  const head = s.split(STOP)[0];
  const at = LINK_AT.exec(head);
  return at ? head.slice(0, at.index) : head;
};
/**
 * Tên theo sản phẩm của brief: tên riêng trong ngoặc kép ("Bộ slide Sương Sớm"), chữ người dùng viết ngay sau sản phẩm
 * ("Kế hoạch du lịch Đà Lạt"), hoặc đối tượng sau "cho / về" ("Dashboard chuỗi 5 cửa hàng cà phê"). Phần nào chỉ còn
 * một chữ ("cho sếp", "for my class") thì không đủ nghĩa: rỗng để dùng câu đầu.
 */
function productTitle(flat: string): string {
  const m = PRODUCT.exec(flat);
  if (!m || m.index > PRODUCT_WITHIN) return "";
  const after = flat.slice(m.index + m[0].length);
  const own = words(untilLink(after)).filter((w) => !SIZE_WORD.test(w));
  const link = new RegExp(`^[^.,;:!?\\n"“”«»]*?${LINK_AT.source}\\s+`, "iu").exec(after);
  const about = link ? words(untilLink(after.slice(link[0].length)).replace(FILLER, "")) : [];
  const quoted = QUOTED.exec(after)?.[1].trim();
  const tail = quoted || (own.length >= 2 ? own.join(" ") : about.length >= 2 ? about.join(" ") : "");
  return tail ? fitWords(`${capFirst(m[0])} ${tail}`, 48) : "";
}
/**
 * Tên đoạn chat đoán từ tin đầu, không gọi model. Tin mở bằng câu đóng vai hoặc brief dài: theo sản phẩm
 * (productTitle). Còn lại, và khi không tìm được tên sản phẩm đủ nghĩa: câu đầu (bỏ lời mời "Hãy …"), tối đa 48
 * ký tự. Rỗng khi không còn chữ nào.
 */
export function topicTitle(text: string): string {
  const plain = text.replace(/#(?:tool|args)=\S+/g, " ").replace(/[*_`#>~|]+/g, " ").replace(/\s+/g, " ").trim();
  const body = stripRole(plain);
  const flat = body.replace(/\([^)]{0,200}\)/g, " ").replace(/\s+/g, " ");
  const brief = body !== plain || body.length >= LONG_BRIEF;
  const named = brief ? productTitle(flat) : "";
  if (named) return named;
  const first = (/^(.{8,60}?)[.!?…](\s|$)/u.exec(body)?.[1] ?? body).replace(POLITE, "").replace(/[.?!:;,]+$/, "");
  const cut = first.length > 48 ? `${first.slice(0, 48).replace(/\s+\S*$/, "")}…` : first;
  return capFirst(cut);
}
