// Mã nguồn giao diện trong app/ để kiểm thử đọc mã tìm theo dấu hiệu, không gắn với một tệp: thành phần chuyển sang tệp khác
// (tách home.tsx…) thì phép kiểm vẫn tìm thấy, còn đoạn mã bị xóa hay đổi cách làm thì vẫn báo lỗi.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

let cache = null;
/** Mọi tệp .ts / .tsx trong app/ (bỏ .d.ts): Map đường dẫn tương đối → nội dung. */
export function appSources() {
  if (cache) return cache;
  cache = new Map();
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)) cache.set(path.relative(process.cwd(), p), readFileSync(p, "utf8"));
    }
  };
  walk(path.join(process.cwd(), "app"));
  return cache;
}
/** Các tệp khớp re (mỗi tệp xét riêng, không nối tệp này với tệp khác). */
export const filesMatching = (re) => [...appSources()].filter(([, s]) => re.test(s)).map(([f]) => f);
/** Có ít nhất một tệp trong app/ khớp re. */
export const anySource = (re) => filesMatching(re).length > 0;
