// Ngân sách tải đầu của trang chủ (blueprint B3.7): JS tối đa 350 KB gzip, CSS tối đa 45 KB gzip cho lần mở trang đầu, đọc từ bản build.
// Dùng: node scripts/budget.mjs [thư mục build]   (mặc định: .next-mockfast của npm run dev:mock:fast nếu có, không thì .next)
// scripts/qa.mjs chạy tệp này như một bộ kiểm. Hai mức:
// - BUDGET: ngân sách của blueprint. Chưa đạt thì in "✗ Chưa đạt ngân sách blueprint"; BUDGET_STRICT=1 thì báo lỗi (mã thoát 1).
// - CEIL: trần chống tăng lại, đặt ngay trên số đo của lần giảm gần nhất. Vượt trần luôn báo lỗi (mã thoát 1) kèm các tệp lớn nhất.
//   Mỗi lần giảm được thêm (B5 gộp CSS, tách tiếp phần tải đầu) thì hạ CEIL theo, tới khi bằng BUDGET.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const BUDGET = { js: 350 * 1024, css: 45 * 1024 };
export const CEIL = { js: 350 * 1024, css: 100 * 1024 };

/** Tệp JS / CSS trình duyệt phải tải khi mở một trang (app router): khung chung + layout gốc + trang. Bỏ polyfill (chỉ trình duyệt cũ tải). */
export function firstLoadFiles(dir, page = "/page") {
  const app = JSON.parse(fs.readFileSync(path.join(dir, "app-build-manifest.json"), "utf8")).pages;
  const build = JSON.parse(fs.readFileSync(path.join(dir, "build-manifest.json"), "utf8"));
  if (!app[page]) throw new Error(`Không có ${page} trong app-build-manifest.json`);
  const files = [...new Set([...(build.rootMainFiles ?? []), ...(app["/layout"] ?? []), ...app[page]])];
  return { js: files.filter((f) => f.endsWith(".js")), css: files.filter((f) => f.endsWith(".css")) };
}

const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;

/** Kích thước gzip của lần tải đầu; over: phần nào vượt ngân sách. */
export function measure(dir, page = "/page", budget = BUDGET) {
  const f = firstLoadFiles(dir, page);
  const size = (l) => l.map((x) => ({ file: x, gzip: gz(fs.readFileSync(path.join(dir, x))) })).sort((a, b) => b.gzip - a.gzip);
  const js = size(f.js), css = size(f.css);
  const total = (l) => l.reduce((a, x) => a + x.gzip, 0);
  const r = { js: total(js), css: total(css), jsFiles: js, cssFiles: css };
  return { ...r, over: [...(r.js > budget.js ? ["js"] : []), ...(r.css > budget.css ? ["css"] : [])] };
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? [".next-mockfast", ".next"].find((d) => fs.existsSync(path.join(d, "app-build-manifest.json")));
  // Không có bản build production (qa chạy trên npm run dev:mock, chế độ dev): bỏ qua, không đo được JS / CSS đã nén của bản dev.
  if (!dir) { console.log("Bỏ qua: chưa có bản build production (.next-mockfast hoặc .next). Chạy npm run dev:mock:fast hoặc next build rồi chạy lại."); process.exit(0); }
  const m = measure(dir);
  const built = new Date(fs.statSync(path.join(dir, "app-build-manifest.json")).mtimeMs).toLocaleString("vi-VN");
  console.log(`Tải đầu trang chủ (${dir}, dựng lúc ${built}): JS ${kb(m.js)} gzip / ngân sách ${kb(BUDGET.js)}; CSS ${kb(m.css)} gzip / ngân sách ${kb(BUDGET.css)}`);
  for (const x of [...m.jsFiles.slice(0, 8), ...m.cssFiles]) console.log(`  ${kb(x.gzip).padStart(9)}  ${x.file}`);
  const ceil = measure(dir, "/page", CEIL).over;
  if (ceil.length) { console.log(`✗ Vượt trần chống tăng lại (JS ${kb(CEIL.js)}, CSS ${kb(CEIL.css)}): ${ceil.join(", ")}`); process.exit(1); }
  if (m.over.length) { console.log(`✗ Chưa đạt ngân sách blueprint: ${m.over.join(", ")} (vẫn dưới trần chống tăng lại)`); process.exit(process.env.BUDGET_STRICT === "1" ? 1 : 0); }
  console.log("✓ Trong ngân sách");
}
