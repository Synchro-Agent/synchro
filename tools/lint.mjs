// npm run lint: ESLint theo eslint.config.mjs (next/core-web-vitals + jsx-a11y) trên cả repo: app/ server/ ui/ shared/ tools/ ops/ tests/,
// scripts/, extension/ và tệp cấu hình ở gốc (bỏ những gì eslint.config.mjs liệt kê trong ignores). Thoát khác 0 chỉ khi có lỗi (error);
// cảnh báo (warn) chỉ in ra. Tham số chuyển thẳng cho eslint (vd. npm run lint -- app/page.tsx, npm run lint -- --quiet để chỉ xem lỗi).
// Các gói ESLint là devDependencies (package.json): thiếu gói nghĩa là chưa chạy npm ci, báo lỗi thay vì lặng lẽ bỏ qua.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const LINT_DEPS = ["eslint", "eslint-config-next", "@eslint/eslintrc", "eslint-plugin-jsx-a11y"];

const R = createRequire(path.join(process.cwd(), "package.json"));
const has = (m) => { try { R.resolve(`${m}/package.json`); return true; } catch { try { R.resolve(m); return true; } catch { return false; } } };
const args = process.argv.slice(2);
const missing = LINT_DEPS.filter((m) => !has(m));
if (missing.length) {
  console.error(`ESLint chưa cài (thiếu ${missing.join(", ")}). Chạy npm ci (các gói này nằm trong devDependencies).`);
  process.exit(1);
}
// "exports" của eslint không mở bin/eslint.js cho require.resolve: đi từ package.json của gói tới trường "bin".
const pkgJson = R.resolve("eslint/package.json");
const bin = path.join(path.dirname(pkgJson), R(pkgJson).bin.eslint);
const r = spawnSync(process.execPath, [bin, ...(args.length ? args : ["."])], { stdio: "inherit" });
process.exit(r.status ?? 1);
