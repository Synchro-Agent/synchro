// Ngân sách tải đầu của trang chủ (blueprint B3.7): JS tối đa 350 KB gzip, CSS tối đa 45 KB gzip cho lần mở trang đầu, đọc từ bản build.
// Dùng: node scripts/budget.mjs [thư mục build]   (mặc định: bản build mới hơn trong .next-mockfast của npm run dev:mock:fast và .next)
// scripts/qa.mjs chạy tệp này như một bộ kiểm. Mã thoát:
// - 1: vượt phần ngân sách đang bắt buộc (ENFORCED), hoặc vượt CEIL (trần chống tăng lại, đặt ngay trên số đo của lần giảm gần nhất).
// - 2: CHƯA ĐO được: không có bản build production, hoặc bản build cũ hơn mã nguồn hiện tại (đo bản cũ là báo đạt sai). BUDGET_SKIP=1 bỏ qua.
// ENFORCED: JS bắt buộc ngay. CSS lần đầu ~97 KB gzip, còn ~87 KB sau B5 bước 1 (Tailwind chỉ quét hai tệp dùng lớp tiện ích), chỉ giảm về 45 KB được khi B5 (một hệ token, @layer, gộp khai báo trùng của
// globals.css) xong: tới lúc đó CSS chỉ báo "CHƯA BẮT BUỘC" (in rõ trong qa) và chặn bằng CEIL.css; B5 xong thì đặt ENFORCED.css = true
// (BUDGET_STRICT=1 bắt buộc cả CSS ngay bây giờ).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const BUDGET = { js: 350 * 1024, css: 45 * 1024 };
export const CEIL = { js: 350 * 1024, css: 89 * 1024 };
export const ENFORCED = { js: true, css: false };

// Mã nguồn quyết định bản build của trang chủ: bản build cũ hơn tệp nào trong này là đo nhầm bản cũ.
const SRC = ["app", "next.config.ts", "package.json", "postcss.config.mjs", "tsconfig.json"];
/** Lúc sửa gần nhất (ms) của mã nguồn trong root (tệp .ts/.tsx/.css/.mjs/.json, bỏ app/api: không vào bản build của trình duyệt). */
export function newestSource(root = ".") {
  let newest = 0, file = "";
  const visit = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { if (path.basename(p) === "api" || path.basename(p) === "node_modules") return; for (const e of fs.readdirSync(p)) visit(path.join(p, e)); return; }
    if (/\.(tsx?|css|mjs|json)$/.test(p) && st.mtimeMs > newest) { newest = st.mtimeMs; file = p; }
  };
  for (const s of SRC) visit(path.join(root, s));
  return { at: newest, file };
}
/** Thư mục build để đo: thư mục có app-build-manifest.json mới nhất; stale: cũ hơn mã nguồn. */
export function pickBuild(root = ".", dirs = [".next-mockfast", ".next"]) {
  const found = dirs.map((d) => path.join(root, d)).filter((d) => fs.existsSync(path.join(d, "app-build-manifest.json")))
    .map((d) => ({ dir: d, at: fs.statSync(path.join(d, "app-build-manifest.json")).mtimeMs })).sort((a, b) => b.at - a.at);
  if (!found.length) return null;
  const src = newestSource(root);
  return { ...found[0], stale: src.at > found[0].at, src };
}

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
  const skip = process.env.BUDGET_SKIP === "1";
  const pick = process.argv[2] ? { dir: process.argv[2], stale: false } : pickBuild();
  if (!pick) {
    console.log("✗ CHƯA ĐO: không có bản build production (.next-mockfast hoặc .next). Chạy npm run dev:mock:fast hoặc next build rồi chạy lại.");
    process.exit(skip ? 0 : 2);
  }
  const dir = pick.dir;
  const built = new Date(fs.statSync(path.join(dir, "app-build-manifest.json")).mtimeMs).toLocaleString("vi-VN");
  if (pick.stale) {
    console.log(`✗ CHƯA ĐO: bản build ${dir} (dựng lúc ${built}) cũ hơn mã nguồn (${pick.src.file}, sửa lúc ${new Date(pick.src.at).toLocaleString("vi-VN")}). Dựng lại rồi chạy lại.`);
    process.exit(skip ? 0 : 2);
  }
  const m = measure(dir);
  const strict = process.env.BUDGET_STRICT === "1";
  const enforced = { js: ENFORCED.js || strict, css: ENFORCED.css || strict };
  const tag = (k) => (enforced[k] ? "bắt buộc" : "CHƯA BẮT BUỘC tới B5");
  console.log(`Tải đầu trang chủ (${dir}, dựng lúc ${built}): JS ${kb(m.js)} gzip / ngân sách ${kb(BUDGET.js)} (${tag("js")}); CSS ${kb(m.css)} gzip / ngân sách ${kb(BUDGET.css)} (${tag("css")})`);
  for (const x of [...m.jsFiles.slice(0, 8), ...m.cssFiles]) console.log(`  ${kb(x.gzip).padStart(9)}  ${x.file}`);
  const ceil = measure(dir, "/page", CEIL).over;
  if (ceil.length) { console.log(`✗ Vượt trần chống tăng lại (JS ${kb(CEIL.js)}, CSS ${kb(CEIL.css)}): ${ceil.join(", ")}`); process.exit(1); }
  const hard = m.over.filter((k) => enforced[k]), soft = m.over.filter((k) => !enforced[k]);
  if (soft.length) console.log(`! Chưa đạt ngân sách blueprint nhưng CHƯA BẮT BUỘC (không làm qa đỏ): ${soft.join(", ")}; vẫn dưới trần chống tăng lại.`);
  if (hard.length) { console.log(`✗ Vượt ngân sách blueprint: ${hard.join(", ")}`); process.exit(1); }
  console.log(soft.length ? "✓ Phần bắt buộc trong ngân sách" : "✓ Trong ngân sách");
}
