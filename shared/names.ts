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
// Loại sản phẩm người dùng nhờ làm, dạng viết như trong tên ("Bộ slide Sương Sớm", "Dashboard chuỗi cửa hàng cà phê").
const PRODUCTS: [RegExp, string][] = [
  [word("bộ slide|bản trình bày|pitch deck|slide deck|slides?"), "Bộ slide"],
  [word("landing page"), "Landing page"],
  [word("dashboard|bảng điều khiển"), "Dashboard"],
  [word("poster|áp phích"), "Poster"],
  [word("brand sheet|bộ nhận diện(?: thương hiệu)?"), "Bộ nhận diện"],
  [word("logo"), "Logo"],
  [word("infographic"), "Infographic"],
  [word("hồ sơ gọi vốn"), "Hồ sơ gọi vốn"],
  [word("báo cáo|report"), "Báo cáo"],
  [word("website|trang web"), "Trang web"],
  [word("ứng dụng|web app"), "Ứng dụng"],
  [word("kế hoạch"), "Kế hoạch"],
  [word("email"), "Email"],
  [word("video"), "Video"],
  [word("ảnh|hình ảnh"), "Ảnh"],
];
// Đầu cụm "cho …" / "về …" không mang nghĩa chủ đề: "cho chủ chuỗi 5 cửa hàng" → "chuỗi cửa hàng".
const FILLER = /^(?:(?:chủ|khách hàng|người dùng|người|một|các|những|team|đội|the|a|an)\s+)+/iu;
const POLITE = /^(?:(?:hãy|làm ơn|vui lòng|giúp (?:tôi|mình|em)|bạn có thể|bạn hãy|please|can you|could you)\s+)+/iu;
const ABOUT = new RegExp(`${word("cho|về|for|about|of").source}\\s+([^.,;:!?\\n"“”]+)`, "iu");
const QUOTED = /[“"«]([^”"»\n]{2,48})[”"»]/u;
const capFirst = (s: string) => (s ? s.charAt(0).toLocaleUpperCase("vi") + s.slice(1) : s);
/** Cắt theo từ: tối đa words từ và max ký tự. */
function fitWords(s: string, words: number, max: number) {
  let out = "";
  for (const w of s.split(/\s+/).filter(Boolean).slice(0, words)) {
    if ((out ? out.length + 1 : 0) + w.length > max) break;
    out = out ? `${out} ${w}` : w;
  }
  return out;
}
/**
 * Tên đoạn chat đoán từ tin đầu, không gọi model: loại sản phẩm + tên riêng trong ngoặc kép ("Bộ slide Sương Sớm") hoặc
 * + đối tượng sau "cho / về" ("Dashboard chuỗi cửa hàng cà phê"); không thấy sản phẩm thì câu đầu đã bỏ phần đóng vai
 * và lời mời ("Hãy …"). Rỗng khi không còn chữ nào.
 */
export function topicTitle(text: string): string {
  const plain = text.replace(/#(?:tool|args)=\S+/g, " ").replace(/[*_`#>~|]+/g, " ");
  const body = stripRole(plain).replace(/\s+/g, " ").trim();
  const flat = body.replace(/\([^)]{0,200}\)/g, " ").replace(/\s+/g, " ");
  // Sản phẩm nhắc tới sớm nhất trong tin là thứ cần làm ("bộ slide … có biểu đồ" là bộ slide, không phải biểu đồ).
  const hits = PRODUCTS.map(([re, name]) => ({ m: re.exec(flat), name })).filter((x) => x.m);
  const hit = hits.sort((a, b) => a.m!.index - b.m!.index)[0];
  if (hit) {
    const after = flat.slice(hit.m!.index + hit.m![0].length);
    const quoted = QUOTED.exec(after) ?? QUOTED.exec(flat);
    const about = ABOUT.exec(after)?.[1]?.replace(FILLER, "").replace(/(?<![\p{L}])\d+\s+/gu, "");
    const tail = quoted?.[1].trim() || about?.trim() || "";
    const t = fitWords(`${hit.name} ${tail}`.trim(), 8, 48);
    if (t.length > hit.name.length) return t;
  }
  const first = /^(.{8,80}?)[.!?…:](\s|$)/u.exec(body)?.[1] ?? body;
  return capFirst(fitWords(first.replace(POLITE, "").replace(/[.?!:;,]+$/, ""), 8, 48));
}
