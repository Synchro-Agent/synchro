// Làm sạch dòng lỗi trước khi lưu cho quản trị viên xem (hàm thuần, kiểm thử ở tests/api/ops-redact.test.mjs): lỗi có thể chứa email, token, đường dẫn có mã.
const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/-----BEGIN [^-]+-----[\s\S]*?(-----END [^-]+-----|$)/g, "[khóa]"],
  [/\b(bearer|token|authorization|cookie|password|passwd|secret|api[_-]?key|code)(["'\s:=]+)[^\s"',;&]+/gi, (_, k, s) => `${k}${s}[ẩn]`],
  [/\b(sk|pk|rk|ghp|gho|ghu|ghs|xox[abp]|ya29|sess)[-_.][\w.-]{8,}/g, "[ẩn]"],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}(\.[\w-]+)?/g, "[ẩn]"],
  [/([\w.+-]+)@([\w-]+(\.[\w-]+)+)/g, (_, __, d) => `***@${d}`],
  [/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, (_, u) => `${u}?…`],
  [/\b[a-f0-9]{32,}\b/gi, "[mã]"],
  [/\b[A-Za-z0-9+/_-]{48,}={0,2}/g, "[mã]"],
];

/** Một dòng, không email đầy đủ, không token, không chuỗi truy vấn của URL, tối đa max ký tự. */
export function redactLine(s: string, max = 400) {
  let t = String(s ?? "").slice(0, 8000);
  for (const [re, to] of RULES) t = typeof to === "string" ? t.replace(re, to) : t.replace(re, to as (...a: string[]) => string);
  return t.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Đối số console.error thành một dòng: lỗi lấy tên, thông điệp và hai dòng đầu của stack. */
export function formatArgs(args: unknown[]) {
  return args.map((a) => {
    if (a instanceof Error) return `${a.name}: ${a.message} ${(a.stack ?? "").split("\n").slice(1, 3).map((x) => x.trim()).join(" ")}`;
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" ");
}
