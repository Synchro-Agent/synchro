// Các gốc mã nguồn của ứng dụng (H3 — cấu trúc thư mục): app/ chỉ còn route, layout, page; mã máy chủ ở server/, giao diện ở ui/,
// mã dùng chung ở shared/. Bộ kiểm thử và script quét mã nguồn đi qua đây thay vì chỉ app/, để một tệp chuyển thư mục vẫn được quét.
// Gốc chưa có thì bỏ qua; tests/api/paths-guard.test.mjs kiểm số tệp tối thiểu nên bỏ sót cả một gốc không thể qua lặng lẽ.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const SRC_ROOTS = ["app", "server", "ui", "shared"];

/** Mọi tệp dưới các gốc mã nguồn (đường dẫn tương đối với gốc repo, dấu /) khớp re; bỏ node_modules. */
export function walkSrc(re = /\.tsx?$/, cwd = process.cwd(), roots = SRC_ROOTS) {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(path.join(cwd, d))) {
      if (f === "node_modules") continue;
      const p = `${d}/${f}`;
      if (statSync(path.join(cwd, p)).isDirectory()) walk(p);
      else if (re.test(f)) out.push(p);
    }
  };
  for (const r of roots) if (existsSync(path.join(cwd, r))) walk(r);
  return out;
}

/** Tìm tệp theo đường dẫn tính từ gốc mã nguồn cũ ("chatengine.ts", "ai/subs.ts") trong mọi gốc; không thấy hoặc thấy hai nơi thì báo lỗi. */
export function findSrc(rel, cwd = process.cwd()) {
  const hits = SRC_ROOTS.map((r) => `${r}/${rel}`).filter((p) => existsSync(path.join(cwd, p)));
  if (hits.length !== 1) throw new Error(`findSrc: "${rel}" ${hits.length ? `trùng ở ${hits.join(", ")}` : `không có trong ${SRC_ROOTS.join("/, ")}/`}`);
  return hits[0];
}
