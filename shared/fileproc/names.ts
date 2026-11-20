// Tên tệp đính kèm không được trùng trong một tin nhắn: trình duyệt giữ trạng thái tải lên, máy chủ chép tệp vào
// workspace và thư mục chạy code đều theo tên, nên hai tệp khác nội dung cùng tên thì tệp sau đè tệp trước và
// model chỉ thấy một.

/** Tên thứ n của một tệp: n = 1 là tên gốc, từ 2 trở đi chèn " (n)" trước đuôi như Finder ("báo cáo (2).pdf"). */
export function nthName(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf(".");
  // Tệp ẩn ".env" hay tên không có đuôi: thêm số vào cuối, không tách nhầm cả tên làm đuôi.
  if (dot <= 0) return `${name} (${n})`;
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

/** Tên đầu tiên trong dãy name, "name (2)", "name (3)"… chưa bị chiếm. */
export function distinctName(name: string, taken: (candidate: string) => boolean): string {
  for (let n = 1; ; n++) {
    const c = nthName(name, n);
    if (!taken(c)) return c;
  }
}

/**
 * Đặt tên riêng cho từng mục của một danh sách: mục cùng tên nhưng khác nội dung (khóa same khác nhau) nhận tên có
 * số, mục trùng cả nội dung thì dùng chung tên. Trả về tên theo đúng thứ tự đầu vào.
 */
export function distinctNames<T>(items: readonly T[], nameOf: (x: T) => string, same: (x: T) => string): string[] {
  const owner = new Map<string, string>();
  return items.map((x) => {
    const key = same(x);
    const name = distinctName(nameOf(x), (c) => owner.has(c) && owner.get(c) !== key);
    owner.set(name, key);
    return name;
  });
}
