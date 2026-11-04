// Làm sạch dòng lỗi trước khi lưu: bỏ email, khóa, token, tham số trên địa chỉ, và cắt ngắn. Nhật ký vận hành chỉ cần biết lỗi gì, ở đâu; không giữ nội dung của người dùng.
export function redact(s: unknown, max = 400): string {
  return String(s ?? "")
    .replace(/https?:\/\/[^\s"')]+/g, (u) => u.replace(/[?#].*$/, ""))
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\b(?:Bearer|token|key|secret|password|cookie)\b[=:\s"']+[^\s"',;]+/gi, (m) => `${m.split(/[=:\s"']/)[0]}=<ẩn>`)
    .replace(/\b(?:sk|pk|rk|ghp|gho|xox[abp]|eyJ)[-_A-Za-z0-9.]{12,}/g, "<ẩn>")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<ẩn>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
