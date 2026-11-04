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
