// Mã nguồn ứng dụng (app/, server/, ui/, shared/ — tests/lib/srcroots.mjs) để kiểm thử đọc mã tìm theo dấu hiệu, không gắn với một tệp:
// thành phần chuyển sang tệp hay thư mục khác (tách home.tsx, H3 chuyển sang server/…) thì phép kiểm vẫn tìm thấy, còn đoạn mã bị xóa
// hay đổi cách làm thì vẫn báo lỗi.
import { readFileSync } from "node:fs";
import { walkSrc } from "./srcroots.mjs";

let cache = null;
/** Mọi tệp .ts / .tsx của ứng dụng (bỏ .d.ts): Map đường dẫn tương đối → nội dung. */
export function appSources() {
  if (cache) return cache;
  cache = new Map();
  for (const f of walkSrc(/\.tsx?$/)) if (!/\.d\.ts$/.test(f)) cache.set(f, readFileSync(f, "utf8"));
  return cache;
}
/** Các tệp khớp re (mỗi tệp xét riêng, không nối tệp này với tệp khác). */
export const filesMatching = (re) => [...appSources()].filter(([, s]) => re.test(s)).map(([f]) => f);
/** Có ít nhất một tệp mã nguồn khớp re. */
export const anySource = (re) => filesMatching(re).length > 0;
